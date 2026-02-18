import { describe, expect, it } from "@effect/vitest"
import { Effect } from "effect"

import { FileSystem } from "@effect/platform"
import { parseMovielensLogsCsv, parseMovielensRatingsCsv, parseMovielensTagsCsv } from "../src/modules/movielens"
import { fromMicro, withNodeFileSystem } from "./helpers/effectTestUtils"

const ratingsExportFilename = "movielens-ratings.csv"
const logsExportFilename = "movielens-logs.csv"
const tagsExportFilename = "movielens-tags.csv"

export const fixtureText = (name: string) =>
	Effect.gen(function*() {
		const fs = yield* FileSystem.FileSystem
		return yield* fs.readFileString(`tests/data/${name}`)
	})

export const fixtureBlob = (name: string) =>
	Effect.map(fixtureText(name), (text) => new Blob([text], { type: "text/csv" }))

describe("movielens", () => {
	it.effect("parses ratings fixture with expected row count and rowIndex offset", () =>
		Effect.gen(function*() {
			const blob = yield* fixtureBlob(ratingsExportFilename)
			const result = yield* fromMicro(parseMovielensRatingsCsv(blob))

			expect(result.rows).toHaveLength(30)
			expect(result.errors).toHaveLength(0)
			expect(result.rows[0]).toMatchObject({
				rowIndex: 2,
				movie_id: "2",
				title: "Jumanji (1995)"
			})
		}).pipe(withNodeFileSystem))

	it.effect("parses logs fixture and preserves action_type distribution", () =>
		Effect.gen(function*() {
			const blob = yield* fixtureBlob(logsExportFilename)
			const result = yield* fromMicro(parseMovielensLogsCsv(blob))

			expect(result.rows).toHaveLength(120)
			expect(result.errors).toHaveLength(0)

			const counts = new Map<string, number>()
			for (const row of result.rows) {
				counts.set(row.action_type, (counts.get(row.action_type) ?? 0) + 1)
			}

			expect(counts.get("pageview")).toBe(39)
			expect(counts.get("rating")).toBe(72)
			expect(counts.get("user-list")).toBe(7)
			expect(counts.get("recommender-change")).toBe(2)

			const ratingRow = result.rows.find((row) => row.action_type === "rating")
			expect(ratingRow?.log_json).toMatchObject({ movieId: expect.any(Number) })
		}).pipe(withNodeFileSystem))

	it.effect("parses tags fixture with expected rows and repeated movie tags", () =>
		Effect.gen(function*() {
			const blob = yield* fixtureBlob(tagsExportFilename)
			const result = yield* fromMicro(parseMovielensTagsCsv(blob))

			expect(result.rows).toHaveLength(30)
			expect(result.errors).toHaveLength(0)

			const movie1704Tags = result.rows.filter((row) => row.movie_id === "1704")
			expect(movie1704Tags).toHaveLength(8)
			expect(movie1704Tags.map((row) => row.tag)).toContain("coming of age")
		}).pipe(withNodeFileSystem))

	it.effect("fails with a fatal error on bad ratings header", () =>
		Effect.gen(function*() {
			const ratingsText = yield* fixtureText(ratingsExportFilename)
			const lines = ratingsText.split(/\r?\n/)
			lines[0] = "movie_id,imdb_id,tmdb_id,rating,title,average_rating"

			const either = yield* Effect.either(
				fromMicro(parseMovielensRatingsCsv(new Blob([lines.join("\n")], { type: "text/csv" })))
			)

			expect(either._tag).toBe("Left")
			if (either._tag === "Left") {
				expect(either.left._tag).toBe("CsvHeaderValidationError")
			}
		}).pipe(withNodeFileSystem))

	it.effect("emits invalid_json and missing_field for malformed rating log_json", () =>
		Effect.gen(function*() {
			const csv = [
				"datetime,login_id,action_type,log_json",
				"2020-10-29 00:17:08.0,XaGQezy,rating,\"{\"\"movieId\"\":27773\""
			].join("\n")

			const result = yield* fromMicro(parseMovielensLogsCsv(new Blob([csv], { type: "text/csv" })))

			expect(result.rows).toHaveLength(1)
			expect(result.errors.map((error) => error.code)).toEqual(["invalid_json", "missing_field"])
			expect(result.errors[1]?.field).toBe("log_json.movieId")
		}))

	it.effect("emits wrong_type when rating movieId is not a number", () =>
		Effect.gen(function*() {
			const csv = [
				"datetime,login_id,action_type,log_json",
				"2020-10-29 00:17:08.0,XaGQezy,rating,\"{\"\"movieId\"\":\"\"27773\"\",\"\"rating\"\":4.0}\""
			].join("\n")

			const result = yield* fromMicro(parseMovielensLogsCsv(new Blob([csv], { type: "text/csv" })))

			expect(result.rows).toHaveLength(1)
			expect(result.errors).toHaveLength(1)
			expect(result.errors[0]).toMatchObject({
				code: "wrong_type",
				field: "log_json.movieId",
				expectedType: "number"
			})
		}))
})
