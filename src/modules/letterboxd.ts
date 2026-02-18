import * as Micro from "effect/Micro"

// LetterboxdURI	String (optional), matches a film or diary entry by its Letterboxd URI, example: https://boxd.it/29qU
// Note: letterboxd.com URIs are also supported for backwards compatibility; this column can alternatively be titled url
// tmdbID	Number (optional), matches a film by its numeric TMDB ID, example: 860
// imdbID	String (optional), matches a film by its alphanumeric IMDb ID, example: tt0086567
// Title	String (optional), matches a film by title when no ID or URI is provided
// Year	YYYY (optional), used to improve title matching when no ID or URI is provided
// Directors	String (optional), used to improve title matching when no ID or URI is provided; use commas to delimit multiple director names (and remember to enclose the complete string in quotes)
// Rating	Number (optional, decimals from 0.5–5 including 0.5 increments), a rating for the film out of five
// Rating10	Number (optional, integers from 1–10), a rating for the film out of ten (will be converted to 0.5–5 scale)
// WatchedDate	YYYY-MM-DD (optional), creates a Diary Entry for the film on this calendar date†
// Rewatch	Boolean (optional), if true, sets the rewatch flag on the Diary Entry when WatchedDate is provided
// Tags	String (optional), added to Diary Entry when WatchedDate is provided; use commas to delimit multiple tags (and remember to enclose the complete string in quotes)
// Review	Text/HTML (optional, accepts the same set of HTML tags as on the Letterboxd website), your review of the film, added to Diary Entry when WatchedDate is provided, otherwise added as a review with no specified date

// Note: this column title can also be used when importing to a list, to populate the Notes field.
export const LETTERBOXD_IMPORT_COLUMNS = [
	"LetterboxdURI", // e.g. https://boxd.it/29qU — also accepts letterboxd.com URIs; column can also be titled "url"
	"tmdbID", // numeric TMDB ID, e.g. 860
	"imdbID", // alphanumeric IMDb ID, e.g. tt0086567
	"Title", // used for matching only when no ID/URI is provided
	"Year", // YYYY — improves title matching when no ID/URI is provided
	"Directors", // comma-delimited; improves title matching when no ID/URI is provided
	"Rating", // 0.5–5 in 0.5 increments
	"Rating10", // 1–10 integer; converted to 0.5–5 scale on import
	"WatchedDate", // YYYY-MM-DD — creates a Diary Entry on this date
	"Rewatch", // if true, sets the rewatch flag (only applies when WatchedDate is set)
	"Tags", // comma-delimited; only added to Diary Entry when WatchedDate is set
	"Review" // text/HTML; tied to Diary Entry if WatchedDate is set, otherwise a standalone review
] as const

type LetterboxdCsvImportColumn = typeof LETTERBOXD_IMPORT_COLUMNS[number]

// All fields are optional by default — the identifier constraint is enforced separately below.
type LetterboxdImportRowBase = {
	[K in LetterboxdCsvImportColumn]?: K extends "tmdbID" | "Rating" | "Rating10" ? number :
		K extends "Rewatch" ? boolean :
		string
}

// At least one of the first four columns must be present (Letterboxd requirement).
const IDENTIFIER_COLUMNS = ["LetterboxdURI", "tmdbID", "imdbID", "Title"] as const
type LetterboxdIdentifier = typeof IDENTIFIER_COLUMNS[number]
type WithAtLeastOneIdentifier = {
	[K in LetterboxdIdentifier]:
		& Omit<LetterboxdImportRowBase, LetterboxdIdentifier>
		& Required<Pick<LetterboxdImportRowBase, K>>
		& Partial<Omit<LetterboxdImportRowBase, K>>
}[LetterboxdIdentifier]

export type LetterboxdImportRow = WithAtLeastOneIdentifier

export class BlobCreationError extends Micro.TaggedError("BlobCreationError")<{
	readonly message: string
	readonly cause?: Error | unknown
}> {}

export class LetterboxImportSchemaValidationError extends Micro.TaggedError("LetterboxImportSchemaValidationError")<{
	readonly message: string
	readonly cause?: Error | unknown
}> {}

export function toCsvBlobEffect(rows: LetterboxdImportRow[]) {
	return Micro.gen(function*() {
		const blobParts = [LETTERBOXD_IMPORT_COLUMNS.join(",") + "\n"]
		const partEffect = rows.map((row) => {
			const rowFeatures = LETTERBOXD_IMPORT_COLUMNS.map((col) => {
				const value = row[col]
				if (value === undefined) {
					return ""
				}
				if (typeof value === "string") {
					// Escape double quotes by doubling them, and wrap the value in double quotes if it contains a comma or a quote.
					const escapedValue = value.replace(/"/g, "\0x5c\0x22") // Replace `"` with `\"`
					return /[",\n]/.test(escapedValue) ? `"${escapedValue}"` : escapedValue
				}
				return String(value)
			})
			// validate that the row has at least one identifier column
			const hasIdentifier = IDENTIFIER_COLUMNS.some((col) => row[col] !== undefined)
			if (!hasIdentifier) {
				return Micro.fail(
					new LetterboxImportSchemaValidationError({
						message: `Row is missing required identifier column: ${JSON.stringify(row)}`
					})
				)
			}
			return Micro.succeed(rowFeatures.join(",") + "\n")
		})
		const resolvedParts = yield* Micro.all(partEffect)
		blobParts.concat(resolvedParts)
		return yield* Micro.try({
			try: () => new Blob(blobParts, { type: "text/csv" }),
			catch: (error) => new BlobCreationError({ message: "Failed to create letterboxd CSV blob", cause: error })
		})
	})
}
