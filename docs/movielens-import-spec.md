## MovieLens Import Spec (Draft)

### Goals
- Import MovieLens CSVs into a semi-structured JS model for UI editing.
- Validate only required fields for known actions (schema-driven, partial).
- Allow targeted revalidation of failed fields without reprocessing whole rows.
- Export to Letterboxd CSV after user edits.

### Import page concept
- Provide a **MovieLens import page** in the UI.
- Users must upload the **ratings CSV** first (minimum required input).
- Users can optionally upload **logs** and **tags** CSVs to enrich data:
	- `logs` adds rating **dates** via `action_type = rating` + `log_json.movieId`.
	- `tags` adds user tags for Letterboxd export.
- Staged editing should follow the shared minimal-edit contract: expose identifier fields (`LetterboxdURI`/`tmdbID`/`imdbID`/`Title`) and editable diary metadata fields (`Rating`/`Rating10`, `WatchedDate`, `Rewatch`, `Tags`, `Review`) as the default user-editable surface.

### Primary use case (current priority)
We mainly care about `logs` rows where `action_type` is `rating`, to find a
`log_json.movieId` that can be matched to `movielens-ratings-export.csv`.

### Data flow
1. **CSV → raw rows**: parse lines, validate headers + column count only.
2. **Raw rows → structured rows**: map columns to object fields (strings by default).
3. **Optional schema validation**: only if a schema exists for the action.
4. **UI edits**: mutate structured rows; revalidate only fields that failed.
5. **Export**: transform structured rows to Letterboxd CSV.

### Effect/Micro integration (parsing + validation layer)
We will use `Effect/Micro` in the parsing + validation layer to:
- model recoverable vs. fatal errors,
- support partial success (e.g., parse all rows, keep row-level failures),
- allow consumers to decide whether to ignore, surface, or halt on errors.

Design intent:
- **Recoverability first** — imports should preserve valid rows and explain failures.
- Avoid all-or-nothing failures wherever possible.

Future option:
- We could move row-level validation into Effect (e.g., `parseLogRow -> Micro<LogsRow, ValidationError[]>`) and
	use `Micro.either` to accumulate successes + failures, if we need a more effectful pipeline later.

Pseudocode example:

```ts
// parse a single CSV row as an Effect that may fail with ValidationError[]
function parseLogRow(line: string): Micro<LogsRow, ValidationError[]> {
	return Micro.gen(function* () {
		const fields = parseCsvLine(line)
		const { fields: normalized, errors: colErrors } = normalizeFields(fields, EXPECTED_COLUMNS.length, rowIndex)

		// parse JSON with Micro.try to capture parse errors as ValidationError
		const parsedJson = yield* Micro.either(
			Micro.try({ try: () => JSON.parse(normalized[3]), catch: (e) => [/* ValidationError */] })
		)

		// build row or accumulate validation errors
		if (/* any validation errors */) {
			return yield* Micro.fail([/* ValidationError[] */])
		}
		return { rowIndex, datetime: normalized[0], ... }
	})
}

// consume the file: run all row Effects and collect successes/failures
function parseFile(lines: string[]) {
	const results = lines.map((l) => Micro.either(parseLogRow(l)))
	// results is an array of Effects; run them and partition Left/Right to errors/rows
}
```

Expected patterns:
- Use `Micro.try`/`Micro.tryPromise` for parsing/JSON.
- Use `Micro.either` (or similar) to return successes + failures together.
- Provide small, composable Effects for: header validation, row parse, JSON parse, schema validation.

### Structured row model (logs)
```ts
type LogsRow = {
	rowIndex: number;   // original CSV line number (1-based, header is line 1)
	datetime: string;
	login_id: string;
	action_type: string; // raw string; unknown values allowed
	log_json?: any;      // parsed JSON when valid
};
```

Notes:
- We include `rowIndex` to keep a stable reference to the original CSV row.
- Rows can be added/removed in the UI, so app state may diverge from the source CSV.
- We currently **do not require** `log_json_raw` on the row model, but may include
	it later if it simplifies UI error display.

### Declarative JSON schema
Schemas define **required fields** and their expected JS `typeof`.
Only actions with a schema are validated.

```ts
const LOG_JSON_SCHEMA: Partial<Record<string, {
	required: Record<string, "string" | "number" | "boolean" | "object">
}>> = {
	rating: { required: { movieId: "number" } },
};
```

### Validation behavior
- **Unknown action_type**: never fails validation.
- **Schema exists**:
	- If JSON parsing fails (non-empty string), emit an error and treat required fields as missing.
	- If parsing succeeds, check required field presence + type.
- **No schema**: skip JSON validation entirely.

Header notes:
- We keep header validation by default.
- We may add an *optional* mode to assume headers when missing (e.g., user split a large file and forgot to include headers in subsequent chunks).
	- Intended behavior for `assumeHeader: true`:
		- Treat the first row as data (do not validate it as a header).
		- Use the expected header definition internally for column mapping.
		- Extra columns are ignored.
		- Fewer columns produce a **row-level error**, then pad missing fields with empty strings so the row can still be imported.
- **Current behavior is order-sensitive**: headers must match expected columns in the same order.
	- Future option: allow re-ordered headers by mapping columns by name (validate presence, then read fields by index map).

Notes:
- Always attempt JSON parsing for `log_json` (unless it's an empty string).
- For invalid JSON, the UI message can be user-friendly (e.g. “failed to parse; enter a valid watch date”).

### Validation errors
Errors must be addressable and suitable for targeted revalidation.

```ts
type ValidationError = {
	code: "invalid_json" | "missing_field" | "wrong_type";
	rowIndex: number;
	field?: string;      // e.g. "log_json.movieId"
	message: string;
	expectedType?: string;
	context?: {
		rawLogJson?: string;
		jsonParseError?: string;
	};
};
```
### Consumer API (draft)
Goal: keep DX simple while supporting advanced workflows (partial success, error recovery).

```ts
type ParseResult<Row> = {
	rows: Row[];               // successfully parsed rows
	errors: ValidationError[]; // row-level errors (non-fatal)
};

type ParseOptions = {
	// Future-facing: if true, treat the first row as data even when headers are missing.
	// Not planned for the first implementation.
	assumeHeader?: boolean;
};

// Parse ratings CSV (required for import page)
declare const parseMovielensRatingsCsv: (data: Blob, options?: ParseOptions) =>
	Micro.Effect<ParseResult<RatingsRow>, CsvParseError | CsvHeaderValidationError>;

// Parse logs CSV (uses internal schema keyed by action_type)
declare const parseMovielensLogsCsv: (data: Blob, options?: ParseOptions) =>
	Micro.Effect<ParseResult<LogsRow>, CsvParseError | CsvHeaderValidationError>;

// Parse tags CSV (optional upload)
declare const parseMovielensTagsCsv: (data: Blob, options?: ParseOptions) =>
	Micro.Effect<ParseResult<TagsRow>, CsvParseError | CsvHeaderValidationError>;

// Convenience: revalidate a single row or field after UI edits
declare const revalidateLogRow: (row: LogsRow) =>
	Micro.Effect<ValidationError[], never>;
```

Notes:
- `errors` are non-fatal and can be surfaced in the UI.
- fatal errors are only for parse failures that block all rows (e.g., empty file, bad header).
- Logs/tags can contain multiple entries per movie (e.g., multiple ratings or multiple tags).
- For logs `datetime`, assume local time and export local **date** only (no time component).

### Revalidation strategy
- Errors are associated to a row + field path.
- UI can revalidate only the failed fields after edits.
- Full row revalidation is still supported.

### Future considerations
- Add schema for `tag` action (optional): e.g. `{ movieId: "number", tag: "string" }`.
- Add structured models for ratings/tags/wishlist CSVs.
- Align on where errors are stored (per-row or external list) once UI shape is clearer.
- For MovieLens imports, do not maintain a separate `Year` field in staged UI/export mapping when the title already includes year text (e.g., `Film Name (1999)`).
- If release-year metadata is missing in a future flow, prefer resolving it from `imdbID`/`tmdbID` lookups rather than asking for redundant manual year entry.
- **Wishlist**: defer to a separate lists-management route (may optionally reuse data from import page).
- Batch import helper can be revisited later (avoid loading multiple large blobs at once for now).

### Open questions
- Do we want to store `log_json_raw` on the row or only in error context?
- Where should errors live: in-row vs. external indexed collection?
