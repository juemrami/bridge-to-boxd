import { Data, Effect, Result } from "effect"

const LOGS_EXPORT_COLUMNS = ["datetime", "login_id", "action_type", "log_json"] as const
const RATINGS_EXPORT_COLUMNS = ["movie_id", "imdb_id", "tmdb_id", "rating", "average_rating", "title"] as const
const TAGS_EXPORT_COLUMNS = ["movie_id", "imdb_id", "tmdb_id", "title", "tag"] as const

export type LogsRow = {
	rowIndex: number
	datetime: string
	login_id: string
	action_type: string
	log_json?: any
}

type RatingsExportRow = {
	[K in typeof RATINGS_EXPORT_COLUMNS[number]]: string
}

export type RatingsRow = {
	rowIndex: number
} & RatingsExportRow

type TagsExportRow = {
	[K in typeof TAGS_EXPORT_COLUMNS[number]]: string
}

export type TagsRow = {
	rowIndex: number
} & TagsExportRow

type ValidationErrorCode = "invalid_json" | "missing_field" | "wrong_type" | "column_count"

export type ValidationError = {
	code: ValidationErrorCode
	rowIndex: number
	field?: string
	message: string
	expectedType?: string
	context?: {
		rawLogJson?: string
		jsonParseError?: string
	}
}

export type ParseResult<Row> = {
	rows: Row[]
	errors: ValidationError[]
}

const LOGS_ACTION_TYPES = ["pageview", "rating", "recommender-change", "similarItemSearch", "tag", "user-list"] as const
type LogsActionType = typeof LOGS_ACTION_TYPES[number]

/**
 * Declares the required top-level fields (and their expected JS typeof) for
 * each action type's log_json payload. Action types not listed here have no
 * JSON validation beyond being valid JSON.
 */
const LOG_JSON_REQUIRED_FIELDS: Partial<
	Record<LogsActionType, Record<string, "string" | "number" | "boolean" | "object">>
> = {
	rating: { movieId: "number" }
}

export class CsvParseError extends Data.TaggedError("CsvParseError")<{
	readonly message: string
	readonly cause?: unknown
}> {}

export class CsvHeaderValidationError extends Data.TaggedError("CsvHeaderValidationError")<{
	readonly message: string
	readonly expected: readonly string[]
	readonly received: string[]
}> {}

export class CsvRowValidationError extends Data.TaggedError("CsvRowValidationError")<{
	readonly message: string
	readonly rowIndex: number
	readonly cause?: unknown
}> {}

/**
 * Reads a Blob as text and splits it into trimmed, non-empty lines.
 */
const blobToLines = (data: Blob) =>
	Effect.tryPromise({
		try: () => data.text(),
		catch: (cause) => new CsvParseError({ message: "Failed to read blob as text", cause })
	}).pipe(
		Effect.map((text) => text.split("\n").map((l) => l.trimEnd()).filter((l) => l.length > 0))
	)

/**
 * Parses a single CSV line, handling quoted fields that may contain commas or escaped quotes.
 */
const parseCsvLine = (line: string): string[] => {
	const fields: string[] = []
	let current = ""
	let inQuotes = false
	for (let i = 0; i < line.length; i++) {
		const ch = line[i]
		if (inQuotes) {
			if (ch === "\"" && line[i + 1] === "\"") {
				current += "\""
				i++
			} else if (ch === "\"") {
				inQuotes = false
			} else {
				current += ch
			}
		} else {
			if (ch === "\"") {
				inQuotes = true
			} else if (ch === ",") {
				fields.push(current)
				current = ""
			} else {
				current += ch
			}
		}
	}
	fields.push(current)
	return fields
}

const normalizeFields = (
	fields: string[],
	expectedCount: number,
	rowIndex: number
): { fields: string[]; errors: ValidationError[] } => {
	let normalized = fields
	const errors: ValidationError[] = []

	if (fields.length === expectedCount) {
		normalized = fields
	} else {
		errors.push({
			code: "column_count",
			rowIndex,
			message: `Row ${rowIndex} has ${fields.length} fields, expected ${expectedCount}`
		})

		if (fields.length < expectedCount) {
			normalized = fields.concat(Array.from({ length: expectedCount - fields.length }, () => ""))
		} else {
			normalized = fields.slice(0, expectedCount)
		}
	}

	return { fields: normalized.map((field) => field.trim()), errors }
}

const appendErrors = (target: ValidationError[], additions: ValidationError[]) => {
	for (const error of additions) {
		target.push(error)
	}
}

/**
 * Validates that the header row exactly matches the expected columns,
 * then returns the remaining data lines.
 */
const validateHeader = (
	lines: string[],
	expected: readonly string[]
) =>
	Effect.gen(function*() {
		if (lines.length === 0) {
			return yield* Effect.fail(new CsvParseError({ message: "CSV is empty" }))
		}
		// note: some CSV exports may include a UTF-8 BOM, so we trim that from the first header field if present before validation
		const headerFields = parseCsvLine(lines[0].replace(/^\uFEFF/, ""))
		const matches = headerFields.length === expected.length &&
			expected.every((col, i) => col === headerFields[i])
		if (!matches) {
			return yield* Effect.fail(
				new CsvHeaderValidationError({
					message: "CSV header does not match expected columns",
					expected,
					received: headerFields
				})
			)
		}
		return lines.slice(1)
	})

export const parseMovielensRatingsCsv = (data: Blob) =>
	Effect.gen(function*() {
		const lines = yield* blobToLines(data)
		const dataLines = yield* validateHeader(lines, RATINGS_EXPORT_COLUMNS)

		const rows: RatingsRow[] = []
		const errors: ValidationError[] = []

		for (let i = 0; i < dataLines.length; i++) {
			const rowIndex = i + 2
			const parsed = parseCsvLine(dataLines[i])
			const normalized = normalizeFields(parsed, RATINGS_EXPORT_COLUMNS.length, rowIndex)
			appendErrors(errors, normalized.errors)

			const [movie_id, imdb_id, tmdb_id, rating, average_rating, title] = normalized.fields
			rows.push({
				rowIndex,
				movie_id,
				imdb_id,
				tmdb_id,
				rating,
				average_rating,
				title
			})
		}

		return { rows, errors } satisfies ParseResult<RatingsRow>
	})

export const parseMovielensLogsCsv = (data: Blob) =>
	Effect.gen(function*() {
		const lines = yield* blobToLines(data)
		const dataLines = yield* validateHeader(lines, LOGS_EXPORT_COLUMNS)

		const rows: LogsRow[] = []
		const errors: ValidationError[] = []

		for (let i = 0; i < dataLines.length; i++) {
			const rowIndex = i + 2 // 1 based index + 1 for header row: therefore +2
			const parsed = parseCsvLine(dataLines[i])
			const normalized = normalizeFields(parsed, LOGS_EXPORT_COLUMNS.length, rowIndex)
			appendErrors(errors, normalized.errors)

			const [datetime, login_id, action_type, log_json_raw] = normalized.fields

			let logJson: unknown | undefined = undefined
			let jsonParseFailed = false

			if (log_json_raw.length > 0) {
				const parsed = yield* Effect.result(
					Effect.try({
						try: () => JSON.parse(log_json_raw) as unknown,
						catch: (cause) => ({
							code: "invalid_json",
							rowIndex,
							field: "log_json",
							message: `Row ${rowIndex} log_json failed to parse as JSON`,
							context: {
								rawLogJson: log_json_raw,
								jsonParseError: cause instanceof Error ? cause.message : String(cause)
							}
						} satisfies ValidationError)
					})
				)

				if (Result.isFailure(parsed)) {
					jsonParseFailed = true
					errors.push(parsed.failure)
				} else {
					logJson = parsed.success
				}
			}

			const typedActionType = (LOGS_ACTION_TYPES as readonly string[]).includes(action_type)
				? action_type as LogsActionType
				: undefined

			const requiredFields = typedActionType !== undefined ? LOG_JSON_REQUIRED_FIELDS[typedActionType] : undefined
			if (requiredFields !== undefined) {
				if (jsonParseFailed || logJson === undefined) {
					for (const [field, expectedType] of Object.entries(requiredFields)) {
						errors.push({
							code: "missing_field",
							rowIndex,
							field: `log_json.${field}`,
							message: `Row ${rowIndex} log_json is missing required field "${field}"`,
							expectedType,
							context: { rawLogJson: log_json_raw }
						})
					}
				} else if (typeof logJson !== "object" || logJson === null) {
					errors.push({
						code: "wrong_type",
						rowIndex,
						field: "log_json",
						message: `Row ${rowIndex} log_json must be an object`,
						expectedType: "object",
						context: { rawLogJson: log_json_raw }
					})
				} else {
					const record = logJson as Record<string, unknown>
					for (const [field, expectedType] of Object.entries(requiredFields)) {
						if (!(field in record)) {
							errors.push({
								code: "missing_field",
								rowIndex,
								field: `log_json.${field}`,
								message: `Row ${rowIndex} log_json is missing required field "${field}"`,
								expectedType,
								context: { rawLogJson: log_json_raw }
							})
						} else if (typeof record[field] !== expectedType) {
							errors.push({
								code: "wrong_type",
								rowIndex,
								field: `log_json.${field}`,
								message: `Row ${rowIndex} log_json field "${field}" must be of type "${expectedType}"`,
								expectedType,
								context: { rawLogJson: log_json_raw }
							})
						}
					}
				}
			}

			rows.push({
				rowIndex,
				datetime,
				login_id,
				action_type,
				log_json: logJson
			})
		}

		return { rows, errors } satisfies ParseResult<LogsRow>
	})

export const parseMovielensTagsCsv = (data: Blob) =>
	Effect.gen(function*() {
		const lines = yield* blobToLines(data)
		const dataLines = yield* validateHeader(lines, TAGS_EXPORT_COLUMNS)

		const rows: TagsRow[] = []
		const errors: ValidationError[] = []

		for (let i = 0; i < dataLines.length; i++) {
			const rowIndex = i + 2
			const parsed = parseCsvLine(dataLines[i])
			const normalized = normalizeFields(parsed, TAGS_EXPORT_COLUMNS.length, rowIndex)
			appendErrors(errors, normalized.errors)

			const [movie_id, imdb_id, tmdb_id, title, tag] = normalized.fields
			rows.push({
				rowIndex,
				movie_id,
				imdb_id,
				tmdb_id,
				title,
				tag
			})
		}

		return { rows, errors } satisfies ParseResult<TagsRow>
	})
