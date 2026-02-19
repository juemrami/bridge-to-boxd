import { Micro } from "effect"
import {
	type Accessor,
	type Component,
	createEffect,
	createMemo,
	createSignal,
	For,
	Index,
	onMount,
	Show
} from "solid-js"
import { type LetterboxdImportRow, toCsvBlobEffect } from "./modules/letterboxd"
import {
	parseMovielensLogsCsv,
	parseMovielensRatingsCsv,
	parseMovielensTagsCsv,
	type ValidationError
} from "./modules/movielens"

type UploadStatus = "idle" | "parsing" | "loaded" | "error"
type IssueSeverity = "fatal" | "non-fatal"
type IssueSource = "ratings" | "logs" | "tags" | "export"

type UploadState = {
	status: UploadStatus
	fileName?: string
	rows?: number
	message?: string
}

type UiIssue = {
	id: string
	severity: IssueSeverity
	source: IssueSource
	rowIndex?: number
	field?: string | undefined
	message: string
}

type StagedRow = {
	id: string
	sourceMovieId: string
	LetterboxdURI: string
	tmdbID: string
	imdbID: string
	Title: string
	Directors: string
	Rating: string
	Rating10: string
	WatchedDate: string
	Rewatch: boolean
	Tags: string
	Review: string
}

type PersistedSession = {
	version: 1
	ratingsUpload: UploadState
	logsUpload: UploadState
	tagsUpload: UploadState
	stagedRows: StagedRow[]
	issues: UiIssue[]
	updatedAt: string
}

type EditableTextField = "imdbID" | "Rating" | "WatchedDate" | "Tags" | "Review"

const SESSION_STORAGE_KEY = "movie-migrate.import-session.v1"

const emptyUploadState = (): UploadState => ({ status: "idle" })

const toWatchedDate = (dateTime: string) => {
	const [datePart] = dateTime.split(" ")
	if (/^\d{4}-\d{2}-\d{2}$/.test(datePart)) {
		return datePart
	}
	const parsed = new Date(dateTime)
	if (Number.isNaN(parsed.getTime())) {
		return ""
	}
	const year = parsed.getFullYear()
	const month = String(parsed.getMonth() + 1).padStart(2, "0")
	const day = String(parsed.getDate()).padStart(2, "0")
	return `${year}-${month}-${day}`
}

const addUniqueTag = (existingCsv: string, nextTag: string) => {
	const normalized = nextTag.trim()
	if (normalized.length === 0) {
		return existingCsv
	}
	const tags = existingCsv
		.split(",")
		.map((tag) => tag.trim())
		.filter((tag) => tag.length > 0)
	if (!tags.includes(normalized)) {
		tags.push(normalized)
	}
	return tags.join(", ")
}

const parseErrorToMessage = (error: unknown) => {
	if (typeof error === "object" && error !== null && "message" in error && typeof error.message === "string") {
		return error.message
	}
	return String(error)
}

const runMicroOrThrow = async <A, E>(micro: Micro.Micro<A, E>) => {
	try {
		return await Micro.runPromise(micro)
	} catch (error) {
		if (
			typeof error === "object" &&
			error !== null &&
			"_tag" in error &&
			error._tag === "Fail" &&
			"error" in error
		) {
			throw error.error
		}
		throw error
	}
}

const validationErrorsToIssues = (source: Exclude<IssueSource, "export">, errors: ValidationError[]): UiIssue[] =>
	errors.map((error, index) => ({
		id: `${source}-${error.rowIndex}-${error.field ?? "row"}-${error.code}-${index}`,
		severity: "non-fatal" as const,
		source,
		rowIndex: error.rowIndex,
		field: error.field ?? undefined,
		message: error.message
	}))

const buildExportIssues = (rows: StagedRow[]): UiIssue[] => {
	const issues: UiIssue[] = []
	for (let index = 0; index < rows.length; index++) {
		const row = rows[index]
		const hasIdentifier = [row.LetterboxdURI, row.tmdbID, row.imdbID, row.Title].some((value) =>
			value.trim().length > 0
		)
		if (!hasIdentifier) {
			issues.push({
				id: `export-${row.id}-identifier`,
				severity: "non-fatal",
				source: "export",
				rowIndex: index + 1,
				field: "identifier",
				message: "Row is missing required identifier (LetterboxdURI, tmdbID, imdbID, or Title)."
			})
		}
	}
	return issues
}

const toLetterboxdRows = (rows: StagedRow[]): LetterboxdImportRow[] =>
	rows.map((row) => {
		const mapped = {
			LetterboxdURI: row.LetterboxdURI.trim() || undefined,
			tmdbID: row.tmdbID.trim().length > 0 && !Number.isNaN(Number(row.tmdbID)) ? Number(row.tmdbID) : undefined,
			imdbID: row.imdbID.trim() || undefined,
			Title: row.Title.trim() || undefined,
			Directors: row.Directors.trim() || undefined,
			Rating: row.Rating.trim().length > 0 && !Number.isNaN(Number(row.Rating)) ? Number(row.Rating) : undefined,
			Rating10: row.Rating10.trim().length > 0 && !Number.isNaN(Number(row.Rating10))
				? Number(row.Rating10)
				: undefined,
			WatchedDate: row.WatchedDate.trim() || undefined,
			Rewatch: row.Rewatch,
			Tags: row.Tags.trim() || undefined,
			Review: row.Review.trim() || undefined
		}
		return mapped as LetterboxdImportRow
	})

type UploadPanelProps = {
	ratingsUpload: Accessor<UploadState>
	logsUpload: Accessor<UploadState>
	tagsUpload: Accessor<UploadState>
	canUploadOptional: Accessor<boolean>
	stagedRows: Accessor<StagedRow[]>
	allIssues: Accessor<UiIssue[]>
	renderUploadMeta: (state: UploadState) => string
	onRatingsUpload: (event: Event) => void | Promise<void>
	onLogsUpload: (event: Event) => void | Promise<void>
	onTagsUpload: (event: Event) => void | Promise<void>
}

const UploadPanel: Component<UploadPanelProps> = (props) => (
	<section class="my-3">
		<h2 class="text-2xl font-bold mb-4">Uploads</h2>
		<div class="grid gap-3 mb-4">
			<div>
				<p class="font-semibold mb-1">
					Ratings CSV (required)
				</p>
				<label for="ratings-file" class="">
					<p class="border w-max px-1">Choose a File</p>
					<input
						class="w-0 h-0 opacity-0 absolute"
						id="ratings-file"
						type="file"
						accept=".csv,text/csv"
						onChange={props.onRatingsUpload}
					/>
				</label>
				<p class="text-sm">{props.renderUploadMeta(props.ratingsUpload())}</p>
			</div>

			<div>
				<p class="font-semibold mb-1">
					Logs CSV (optional)
				</p>
				<label for="logs-file" class="">
					<p class="border w-max px-1">Choose a File</p>
					<input
						class="w-0 h-0 opacity-0 absolute"
						id="logs-file"
						type="file"
						accept=".csv,text/csv"
						disabled={!props.canUploadOptional()}
						onChange={props.onLogsUpload}
					/>
				</label>
				<p class="text-sm">{props.renderUploadMeta(props.logsUpload())}</p>
			</div>

			<div>
				<p class="font-semibold mb-1">
					Tags CSV (optional)
				</p>
				<label for="tags-file" class="">
					<p class="border w-max px-1">Choose a File</p>
					<input
						class="w-0 h-0 opacity-0 absolute"
						id="tags-file"
						type="file"
						accept=".csv,text/csv"
						disabled={!props.canUploadOptional()}
						onChange={props.onTagsUpload}
					/>
				</label>
				<p class="text-sm">{props.renderUploadMeta(props.tagsUpload())}</p>
			</div>
		</div>
		<p class="text-sm">
			Summary: {props.stagedRows().length} staged rows • {props.allIssues().length} issues
		</p>
	</section>
)

type IssuesPanelProps = {
	allIssues: Accessor<UiIssue[]>
}

const IssuesPanel: Component<IssuesPanelProps> = (props) => (
	<section class="my-6">
		<h2 class="text-2xl font-bold mb-4">Issues</h2>
		<Show
			when={props.allIssues().length > 0}
			fallback={<p>No issues.</p>}
		>
			<ul class="list-disc list-inside space-y-1">
				<For each={props.allIssues()}>
					{(issue) => (
						<li class="text-sm">
							<strong>{issue.severity.toUpperCase()}</strong> [{issue.source}]
							{issue.rowIndex !== undefined ? ` row ${issue.rowIndex}` : ""}
							{issue.field ? ` (${issue.field})` : ""}: {issue.message}
						</li>
					)}
				</For>
			</ul>
		</Show>
	</section>
)

type TableActionsProps = {
	canDownload: Accessor<boolean>
	restoreMessage: Accessor<string>
	onDownload: () => void | Promise<void>
	onClear: () => void
}

const TableActions: Component<TableActionsProps> = (props) => (
	<div class="flex gap-2 items-center flex-wrap mb-1">
		<button class="border px-1" type="button" onClick={props.onDownload} disabled={!props.canDownload()}>
			Download Letterboxd CSV
		</button>
		<button class="border px-1" type="button" onClick={props.onClear}>Clear import</button>
		<Show when={props.restoreMessage().length > 0}>
			<span>{props.restoreMessage()}</span>
		</Show>
	</div>
)

type StagedTableProps = {
	stagedRows: Accessor<StagedRow[]>
	issueCountsByRowIndex: Accessor<Map<number, number>>
	canDownload: Accessor<boolean>
	restoreMessage: Accessor<string>
	getInputValue: (row: StagedRow, field: EditableTextField) => string
	setDraftValue: (rowId: string, field: EditableTextField, value: string) => void
	handleDraftKeyDown: (event: KeyboardEvent, row: StagedRow, field: EditableTextField) => void
	handleDraftBlur: (rowId: string, field: EditableTextField) => void
	handleRatingChange: (row: StagedRow) => void
	onToggleRewatch: (rowId: string, checked: boolean) => void
	onDownload: () => void | Promise<void>
	onClear: () => void
}

const StagedTable: Component<StagedTableProps> = (props) => (
	<section class="my-6">
		<h2 class="text-2xl font-bold mb-1">Staged Letterboxd import data</h2>
		<TableActions
			canDownload={props.canDownload}
			restoreMessage={props.restoreMessage}
			onDownload={props.onDownload}
			onClear={props.onClear}
		/>
		<p class="text-sm mb-2 text-gray-600">
			<strong>Note:</strong> Must press{" "}
			<kbd class="px-1.5 py-0.5 text-xs font-semibold bg-gray-100 border border-gray-300 rounded">Enter</kbd>{" "}
			to save any changes.
		</p>
		<div class="overflow-auto border border-gray-300">
			<table class="w-full">
				<thead class="bg-gray-100">
					<tr>
						<th class="px-3 py-2 text-left text-sm font-semibold">Status</th>
						<th class="px-3 py-2 text-left text-sm font-semibold">Title</th>
						<th class="px-3 py-2 text-left text-sm font-semibold">IMDb Title ID</th>
						<th class="px-3 py-2 text-left text-sm font-semibold">Rating</th>
						<th class="px-3 py-2 text-left text-sm font-semibold">WatchedDate</th>
						<th class="px-3 py-2 text-left text-sm font-semibold">Rewatch</th>
						<th class="px-3 py-2 text-left text-sm font-semibold">Tags</th>
						<th class="px-3 py-2 text-left text-sm font-semibold">Review</th>
					</tr>
				</thead>
				<tbody class="divide-y divide-gray-200">
					<Index each={props.stagedRows()}>
						{(row, index) => (
							<tr class="hover:bg-gray-50">
								<td class="px-3 py-2 text-sm">
									{(props.issueCountsByRowIndex().get(index + 1) ?? 0) > 0
										? `${props.issueCountsByRowIndex().get(index + 1)} issue(s)`
										: "ok"}
								</td>
								<td class="px-3 py-2 text-sm">
									{row().Title}
								</td>
								<td class="px-3 py-2">
									<input
										class="w-28 px-2 py-1 text-sm border border-gray-300 rounded font-mono"
										value={props.getInputValue(row(), "imdbID")}
										onInput={(event) => props.setDraftValue(row().id, "imdbID", event.currentTarget.value)}
										onKeyDown={(event) => props.handleDraftKeyDown(event, row(), "imdbID")}
										onBlur={() => props.handleDraftBlur(row().id, "imdbID")}
										placeholder="0050083"
									/>
								</td>
								<td class="px-3 py-2">
									<input
										class="w-16 px-2 py-1 text-sm border border-gray-300 rounded"
										value={props.getInputValue(row(), "Rating")}
										onInput={(event) => props.setDraftValue(row().id, "Rating", event.currentTarget.value)}
										onChange={() => props.handleRatingChange(row())}
										placeholder="0.5-5"
										step={0.5}
										min={0.5}
										max={5}
										type="number"
									/>
								</td>
								<td class="px-3 py-2">
									<input
										class="w-32 px-2 py-1 text-sm border border-gray-300 rounded"
										value={props.getInputValue(row(), "WatchedDate")}
										onInput={(event) => props.setDraftValue(row().id, "WatchedDate", event.currentTarget.value)}
										onKeyDown={(event) => props.handleDraftKeyDown(event, row(), "WatchedDate")}
										onBlur={() => props.handleDraftBlur(row().id, "WatchedDate")}
										placeholder="YYYY-MM-DD"
										type="date"
									/>
								</td>
								<td class="text-center">
									<input
										class="self-center border"
										type="checkbox"
										checked={row().Rewatch}
										onChange={(event) => props.onToggleRewatch(row().id, event.currentTarget.checked)}
									/>
								</td>
								<td class="px-3 py-2">
									<input
										class="w-full px-2 py-1 text-sm border border-gray-300 rounded"
										title={props.getInputValue(row(), "Tags")}
										value={props.getInputValue(row(), "Tags")}
										onInput={(event) => props.setDraftValue(row().id, "Tags", event.currentTarget.value)}
										onKeyDown={(event) => props.handleDraftKeyDown(event, row(), "Tags")}
										onBlur={() => props.handleDraftBlur(row().id, "Tags")}
										placeholder="comma, separated"
									/>
								</td>
								<td class="px-3 py-2">
									<input
										class="w-full px-2 py-1 text-sm border border-gray-300 rounded"
										value={props.getInputValue(row(), "Review")}
										title={props.getInputValue(row(), "Review")}
										onInput={(event) => props.setDraftValue(row().id, "Review", event.currentTarget.value)}
										onKeyDown={(event) => props.handleDraftKeyDown(event, row(), "Review")}
										onBlur={() => props.handleDraftBlur(row().id, "Review")}
									/>
								</td>
							</tr>
						)}
					</Index>
				</tbody>
			</table>
		</div>
	</section>
)

const App: Component = () => {
	const [ratingsUpload, setRatingsUpload] = createSignal<UploadState>(emptyUploadState())
	const [logsUpload, setLogsUpload] = createSignal<UploadState>(emptyUploadState())
	const [tagsUpload, setTagsUpload] = createSignal<UploadState>(emptyUploadState())
	const [stagedRows, setStagedRows] = createSignal<StagedRow[]>([])
	const [draftEdits, setDraftEdits] = createSignal<Record<string, string>>({})
	const [issues, setIssues] = createSignal<UiIssue[]>([])
	const [sessionRestored, setSessionRestored] = createSignal(false)
	const [restoreMessage, setRestoreMessage] = createSignal("")

	const canUploadOptional = createMemo(() => ratingsUpload().status === "loaded")
	const exportIssues = createMemo(() => buildExportIssues(stagedRows()))
	const allIssues = createMemo(() => [...issues(), ...exportIssues()])
	const issueCountsByRowIndex = createMemo(() => {
		const counts = new Map<number, number>()
		for (const issue of allIssues()) {
			if (issue.source === "ratings" || issue.rowIndex === undefined) {
				continue
			}
			counts.set(issue.rowIndex, (counts.get(issue.rowIndex) ?? 0) + 1)
		}
		return counts
	})
	const canDownload = createMemo(() => stagedRows().length > 0 && exportIssues().length === 0)

	const draftKeyFor = (rowId: string, field: EditableTextField) => `${rowId}::${field}`

	const getInputValue = (row: StagedRow, field: EditableTextField) => {
		const key = draftKeyFor(row.id, field)
		const draftValue = draftEdits()[key]
		return draftValue ?? row[field]
	}

	const setDraftValue = (rowId: string, field: EditableTextField, value: string) => {
		const key = draftKeyFor(rowId, field)
		setDraftEdits((previous) => ({ ...previous, [key]: value }))
	}

	const clearDraftValue = (rowId: string, field: EditableTextField) => {
		const key = draftKeyFor(rowId, field)
		setDraftEdits((previous) => {
			if (!(key in previous)) {
				return previous
			}
			const { [key]: _removed, ...next } = previous
			return next
		})
	}

	const commitDraftValue = (row: StagedRow, field: EditableTextField) => {
		const key = draftKeyFor(row.id, field)
		let draftValue = draftEdits()[key]
		if (draftValue === undefined) {
			return
		}
		// Normalize imdbID: strip "tt" prefix if present, validate numeric, then prepend "tt"
		if (field === "imdbID" && draftValue.trim().length > 0) {
			const trimmed = draftValue.trim()
			// Remove "tt" prefix if user included it
			const numeric = trimmed.replace(/^tt/i, "")
			// Only accept if the result is purely numeric
			if (/^\d+$/.test(numeric)) {
				draftValue = `tt${numeric}`
			}
			// If not valid format, save as-is (will likely fail Letterboxd validation)
		}
		if (draftValue !== row[field]) {
			updateRowField(row.id, field, draftValue)
		}
		clearDraftValue(row.id, field)
	}

	const handleDraftKeyDown = (event: KeyboardEvent, row: StagedRow, field: EditableTextField) => {
		if (event.key === "Enter") {
			event.preventDefault()
			commitDraftValue(row, field)
			;(event.currentTarget as HTMLInputElement).blur()
			return
		}
		if (event.key === "Escape") {
			event.preventDefault()
			clearDraftValue(row.id, field)
			;(event.currentTarget as HTMLInputElement).blur()
		}
	}

	const handleDraftBlur = (rowId: string, field: EditableTextField) => {
		clearDraftValue(rowId, field)
	}

	const handleRatingChange = (row: StagedRow) => {
		const key = draftKeyFor(row.id, "Rating")
		const draftValue = draftEdits()[key]
		if (draftValue !== undefined && draftValue !== row.Rating) {
			updateRowField(row.id, "Rating", draftValue)
			clearDraftValue(row.id, "Rating")
		}
	}

	const clearSession = () => {
		setRatingsUpload(emptyUploadState())
		setLogsUpload(emptyUploadState())
		setTagsUpload(emptyUploadState())
		setStagedRows([])
		setDraftEdits({})
		setIssues([])
		setRestoreMessage("")
		localStorage.removeItem(SESSION_STORAGE_KEY)
	}

	const persistSession = () => {
		const session: PersistedSession = {
			version: 1,
			ratingsUpload: ratingsUpload(),
			logsUpload: logsUpload(),
			tagsUpload: tagsUpload(),
			stagedRows: stagedRows(),
			issues: issues(),
			updatedAt: new Date().toISOString()
		}
		localStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(session))
	}

	onMount(() => {
		const raw = localStorage.getItem(SESSION_STORAGE_KEY)
		if (raw) {
			try {
				const restored = JSON.parse(raw) as PersistedSession
				if (restored.version === 1) {
					setRatingsUpload(restored.ratingsUpload)
					setLogsUpload(restored.logsUpload)
					setTagsUpload(restored.tagsUpload)
					setStagedRows(restored.stagedRows)
					setIssues(restored.issues)
					setRestoreMessage(
						`Restored previous session (${restored.stagedRows.length} staged rows, ${restored.issues.length} issues).`
					)
				}
			} catch {
				localStorage.removeItem(SESSION_STORAGE_KEY)
			}
		}
		setSessionRestored(true)
	})

	createEffect(() => {
		if (!sessionRestored()) {
			return
		}
		persistSession()
	})

	const handleRatingsUpload = async (event: Event) => {
		const input = event.currentTarget as HTMLInputElement
		const file = input.files?.[0]
		if (!file) {
			return
		}

		if (stagedRows().length > 0) {
			const confirmed = window.confirm("Importing a new ratings file will overwrite current staged data. Continue?")
			if (!confirmed) {
				input.value = ""
				return
			}
		}

		setRatingsUpload({ status: "parsing", fileName: file.name })
		setLogsUpload(emptyUploadState())
		setTagsUpload(emptyUploadState())
		setIssues([])

		try {
			const parsed = await runMicroOrThrow(parseMovielensRatingsCsv(file))
			const nextRows: StagedRow[] = parsed.rows.map((row) => ({
				id: `movie-${row.movie_id}`,
				sourceMovieId: row.movie_id,
				LetterboxdURI: "",
				tmdbID: row.tmdb_id,
				imdbID: row.imdb_id,
				Title: row.title,
				Directors: "",
				Rating: row.rating,
				Rating10: "",
				WatchedDate: "",
				Rewatch: false,
				Tags: "",
				Review: ""
			}))
			setStagedRows(nextRows)
			setDraftEdits({})
			setIssues(validationErrorsToIssues("ratings", parsed.errors))
			setRatingsUpload({
				status: "loaded",
				fileName: file.name,
				rows: parsed.rows.length,
				message: `Loaded ${parsed.rows.length} rows`
			})
			setRestoreMessage("")
		} catch (error) {
			setStagedRows([])
			setDraftEdits({})
			setRatingsUpload({ status: "error", fileName: file.name, message: parseErrorToMessage(error) })
			setIssues([
				{
					id: `ratings-fatal-${Date.now()}`,
					severity: "fatal",
					source: "ratings",
					message: parseErrorToMessage(error)
				}
			])
		}

		input.value = ""
	}

	const handleLogsUpload = async (event: Event) => {
		const input = event.currentTarget as HTMLInputElement
		const file = input.files?.[0]
		if (!file) {
			return
		}

		setLogsUpload({ status: "parsing", fileName: file.name })
		setIssues((prev) => prev.filter((issue) => issue.source !== "logs"))

		try {
			const parsed = await runMicroOrThrow(parseMovielensLogsCsv(file))
			const latestByMovieId = new Map<string, { dateTime: string }>()

			for (const row of parsed.rows) {
				if (row.action_type !== "rating") {
					continue
				}
				if (typeof row.log_json !== "object" || row.log_json === null || !("movieId" in row.log_json)) {
					continue
				}
				const movieId = String((row.log_json as Record<string, unknown>).movieId)
				const current = latestByMovieId.get(movieId)
				if (!current || row.datetime > current.dateTime) {
					latestByMovieId.set(movieId, { dateTime: row.datetime })
				}
			}

			setStagedRows((currentRows) =>
				currentRows.map((row) => {
					const match = latestByMovieId.get(row.sourceMovieId)
					if (!match) {
						return row
					}
					return {
						...row,
						WatchedDate: toWatchedDate(match.dateTime)
					}
				})
			)

			setIssues((prev) => [...prev, ...validationErrorsToIssues("logs", parsed.errors)])
			setLogsUpload({
				status: "loaded",
				fileName: file.name,
				rows: parsed.rows.length,
				message: `Loaded ${parsed.rows.length} rows`
			})
		} catch (error) {
			setLogsUpload({ status: "error", fileName: file.name, message: parseErrorToMessage(error) })
			setIssues((prev) => [
				...prev,
				{ id: `logs-fatal-${Date.now()}`, severity: "fatal", source: "logs", message: parseErrorToMessage(error) }
			])
		}

		input.value = ""
	}

	const handleTagsUpload = async (event: Event) => {
		const input = event.currentTarget as HTMLInputElement
		const file = input.files?.[0]
		if (!file) {
			return
		}

		setTagsUpload({ status: "parsing", fileName: file.name })
		setIssues((prev) => prev.filter((issue) => issue.source !== "tags"))

		try {
			const parsed = await runMicroOrThrow(parseMovielensTagsCsv(file))
			const tagsByMovieId = new Map<string, string[]>()

			for (const row of parsed.rows) {
				if (!tagsByMovieId.has(row.movie_id)) {
					tagsByMovieId.set(row.movie_id, [])
				}
				tagsByMovieId.get(row.movie_id)?.push(row.tag)
			}

			setStagedRows((currentRows) =>
				currentRows.map((row) => {
					const tags = tagsByMovieId.get(row.sourceMovieId)
					if (!tags || tags.length === 0) {
						return row
					}
					let merged = row.Tags
					for (const tag of tags) {
						merged = addUniqueTag(merged, tag)
					}
					return {
						...row,
						Tags: merged
					}
				})
			)

			setIssues((prev) => [...prev, ...validationErrorsToIssues("tags", parsed.errors)])
			setTagsUpload({
				status: "loaded",
				fileName: file.name,
				rows: parsed.rows.length,
				message: `Loaded ${parsed.rows.length} rows`
			})
		} catch (error) {
			setTagsUpload({ status: "error", fileName: file.name, message: parseErrorToMessage(error) })
			setIssues((prev) => [
				...prev,
				{ id: `tags-fatal-${Date.now()}`, severity: "fatal", source: "tags", message: parseErrorToMessage(error) }
			])
		}

		input.value = ""
	}

	const updateRowField = <K extends keyof StagedRow>(rowId: string, key: K, value: StagedRow[K]) => {
		setStagedRows((rows) => rows.map((row) => (row.id === rowId ? { ...row, [key]: value } : row)))
	}

	const handleDownload = async () => {
		if (!canDownload()) {
			return
		}
		try {
			const letterboxdRows = toLetterboxdRows(stagedRows())
			const blob = await runMicroOrThrow(toCsvBlobEffect(letterboxdRows))
			const url = URL.createObjectURL(blob)
			const anchor = document.createElement("a")
			anchor.href = url
			anchor.download = "letterboxd-ratings-import.csv"
			document.body.append(anchor)
			anchor.click()
			anchor.remove()
			URL.revokeObjectURL(url)
		} catch (error) {
			setIssues((prev) => [
				...prev,
				{
					id: `export-fatal-${Date.now()}`,
					severity: "fatal",
					source: "export",
					message: parseErrorToMessage(error)
				}
			])
		}
	}

	const renderUploadMeta = (state: UploadState) => {
		if (state.status === "idle") {
			return "Not uploaded"
		}
		if (state.status === "parsing") {
			return `Parsing ${state.fileName ?? "file"}...`
		}
		if (state.status === "loaded") {
			return `${state.fileName ?? "file"}: loaded ${state.rows ?? 0} rows`
		}
		return `${state.fileName ?? "file"}: ${state.message ?? "Failed"}`
	}

	return (
		<main class="mx-auto p-4 max-w-6xl">
			<header class="mb-3">
				<h1 class="text-3xl font-bold mb-2">Bridge: MovieLens to Letterboxd</h1>
				<div class="text-sm">
					<p class="font-semibold mb-2">Instructions</p>
					<ol class="flex flex-col gap-1 ml-4 list-decimal">
						<li>Upload Movielens ratings CSV (required)</li>
						<li>Upload Movielens logs and/or tags CSV (optional)</li>
						<li>Review/edit uploaded Movielens data</li>
						<li>Export to Letterboxd ratings import CSV</li>
					</ol>
				</div>
			</header>

			<UploadPanel
				ratingsUpload={ratingsUpload}
				logsUpload={logsUpload}
				tagsUpload={tagsUpload}
				canUploadOptional={canUploadOptional}
				stagedRows={stagedRows}
				allIssues={allIssues}
				renderUploadMeta={renderUploadMeta}
				onRatingsUpload={handleRatingsUpload}
				onLogsUpload={handleLogsUpload}
				onTagsUpload={handleTagsUpload}
			/>

			<IssuesPanel allIssues={allIssues} />

			<StagedTable
				stagedRows={stagedRows}
				issueCountsByRowIndex={issueCountsByRowIndex}
				canDownload={canDownload}
				restoreMessage={restoreMessage}
				getInputValue={getInputValue}
				setDraftValue={setDraftValue}
				handleDraftKeyDown={handleDraftKeyDown}
				handleDraftBlur={handleDraftBlur}
				handleRatingChange={handleRatingChange}
				onToggleRewatch={(rowId, checked) => updateRowField(rowId, "Rewatch", checked)}
				onDownload={handleDownload}
				onClear={clearSession}
			/>
		</main>
	)
}

export default App
