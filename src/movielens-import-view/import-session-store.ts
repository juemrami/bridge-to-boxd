import { type LetterboxdImportRow, toCsvBlobEffect } from "@src/modules/letterboxd"
import {
	parseMovielensLogsCsv,
	parseMovielensRatingsCsv,
	parseMovielensTagsCsv,
	type ValidationError
} from "@src/modules/movielens"
import { Cause, Effect, Exit, Option } from "effect"
import { type Accessor, createEffect, createMemo, createSignal, onMount } from "solid-js"

const UploadStatus = {
	idle: "idle",
	parsing: "parsing",
	loaded: "loaded",
	error: "error"
} as const

type UploadStatus = typeof UploadStatus[keyof typeof UploadStatus]

const IssueSeverity = {
	fatal: "fatal",
	nonFatal: "non-fatal"
} as const

type IssueSeverity = typeof IssueSeverity[keyof typeof IssueSeverity]

const IssueSource = {
	ratings: "ratings",
	logs: "logs",
	tags: "tags",
	export: "export"
} as const

type IssueSource = typeof IssueSource[keyof typeof IssueSource]

export type UploadState = {
	status: UploadStatus
	fileName?: string
	rows?: number
	message?: string
}

export type UiIssue = {
	id: string
	severity: IssueSeverity
	source: IssueSource
	rowIndex?: number
	field?: string | undefined
	message: string
}

export type StagedRow = {
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

export type EditableTextField = "imdbID" | "Rating" | "WatchedDate" | "Tags" | "Review"

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

export const splitTags = (value: string) => value.split(/[\n,\r]+/)

const normalizeTag = (value: string) => value.trim().toLowerCase()

export const normalizeTags = (values: string[]) => {
	const deduped: string[] = []
	const seen = new Set<string>()
	for (const value of values) {
		const normalized = normalizeTag(value)
		if (normalized.length === 0 || seen.has(normalized)) {
			continue
		}
		seen.add(normalized)
		deduped.push(normalized)
	}
	return deduped
}

const tagsToCsv = (values: string[]) => normalizeTags(values).join(", ")

export const parseTagsCsv = (value: string) => normalizeTags(splitTags(value))

const normalizeTagsCsv = (value: string) => tagsToCsv(splitTags(value))

const mergeTagCsv = (existingCsv: string, nextTags: string[]) => tagsToCsv([...splitTags(existingCsv), ...nextTags])

const parseErrorToMessage = (error: unknown) => {
	if (typeof error === "object" && error !== null && "message" in error && typeof error.message === "string") {
		return error.message
	}
	return String(error)
}

const runEffectOrThrow = async <A, E>(effect: Effect.Effect<A, E>) => {
	const exit = await Effect.runPromiseExit(effect)
	if (Exit.isSuccess(exit)) {
		return exit.value
	}
	const failure = Cause.findErrorOption(exit.cause)
	if (Option.isSome(failure)) {
		throw failure.value
	}
	throw new Error(Cause.pretty(exit.cause))
}

const validationErrorsToIssues = (
	source: Exclude<IssueSource, typeof IssueSource.export>,
	errors: ValidationError[]
): UiIssue[] =>
	errors.map((error, index) => ({
		id: `${source}-${error.rowIndex}-${error.field ?? "row"}-${error.code}-${index}`,
		severity: IssueSeverity.nonFatal,
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
				severity: IssueSeverity.nonFatal,
				source: IssueSource.export,
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

export type UploadPanelProps = {
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

export type IssuesPanelProps = {
	allIssues: Accessor<UiIssue[]>
}

export type StagedTableProps = {
	stagedRows: Accessor<StagedRow[]>
	getIssueCountForRow: (rowId: string) => number
	canDownload: Accessor<boolean>
	restoreMessage: Accessor<string>
	getInputValue: (row: StagedRow, field: EditableTextField) => string
	setDraftValue: (rowId: string, field: EditableTextField, value: string) => void
	handleDraftKeyDown: (event: KeyboardEvent, row: StagedRow, field: EditableTextField) => void
	handleDraftBlur: (rowId: string, field: EditableTextField) => void
	onAddRowTags: (rowId: string, tags: string[]) => void
	onRemoveRowTag: (rowId: string, tag: string) => void
	onToggleRewatch: (rowId: string, checked: boolean) => void
	onDeleteRow: (row: StagedRow) => void
	onDownload: () => void | Promise<void>
	onClear: () => void
}

export const useImportSessionStore = () => {
	const displayText = {
		confirmOverwrite: "Importing a new ratings file will overwrite current staged data. Continue?"
	} as const
	const formatUploadMetaLoaded = (fileName: string, rows: number) => `${fileName}: loaded ${rows} rows`

	const [ratingsUpload, setRatingsUpload] = createSignal<UploadState>(emptyUploadState())
	const [logsUpload, setLogsUpload] = createSignal<UploadState>(emptyUploadState())
	const [tagsUpload, setTagsUpload] = createSignal<UploadState>(emptyUploadState())
	const [stagedRows, setStagedRows] = createSignal<StagedRow[]>([])
	const [draftEdits, setDraftEdits] = createSignal<Record<string, string>>({})
	const [issues, setIssues] = createSignal<UiIssue[]>([])
	const [sessionRestored, setSessionRestored] = createSignal(false)
	const [restoreMessage, setRestoreMessage] = createSignal("")

	const canUploadOptional = createMemo(() => ratingsUpload().status === UploadStatus.loaded)
	const exportIssues = createMemo(() => buildExportIssues(stagedRows()))
	const allIssues = createMemo(() => [...issues(), ...exportIssues()])
	const issueCountsByRowIndex = createMemo(() => {
		const counts = new Map<number, number>()
		for (const issue of allIssues()) {
			if (issue.source === IssueSource.ratings || issue.rowIndex === undefined) {
				continue
			}
			counts.set(issue.rowIndex, (counts.get(issue.rowIndex) ?? 0) + 1)
		}
		return counts
	})
	const issueCountByRowId = createMemo(() => {
		const counts = issueCountsByRowIndex()
		const byRowId = new Map<string, number>()
		for (const [index, row] of stagedRows().entries()) {
			byRowId.set(row.id, counts.get(index + 1) ?? 0)
		}
		return byRowId
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

	const updateRowField = <K extends keyof StagedRow>(rowId: string, key: K, value: StagedRow[K]) => {
		setStagedRows((rows) => rows.map((row) => (row.id === rowId ? { ...row, [key]: value } : row)))
	}

	const commitDraftValue = (row: StagedRow, field: EditableTextField) => {
		const key = draftKeyFor(row.id, field)
		let draftValue = draftEdits()[key]
		if (draftValue === undefined) {
			return
		}
		if (field === "imdbID" && draftValue.trim().length > 0) {
			const trimmed = draftValue.trim()
			const numeric = trimmed.replace(/^tt/i, "")
			if (/^\d+$/.test(numeric)) {
				draftValue = `tt${numeric}`
			}
		}
		if (field === "Tags") {
			draftValue = normalizeTagsCsv(draftValue)
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
		const row = stagedRows().find((current) => current.id === rowId)
		if (row) {
			commitDraftValue(row, field)
			return
		}
		clearDraftValue(rowId, field)
	}

	const addRowTags = (rowId: string, tags: string[]) => {
		setStagedRows((rows) => rows.map((row) => (row.id === rowId ? { ...row, Tags: mergeTagCsv(row.Tags, tags) } : row)))
		clearDraftValue(rowId, "Tags")
	}

	const removeRowTag = (rowId: string, tagToRemove: string) => {
		setStagedRows((rows) =>
			rows.map((row) => {
				if (row.id !== rowId) {
					return row
				}
				const nextTags = parseTagsCsv(row.Tags).filter((tag) => tag !== normalizeTag(tagToRemove))
				return {
					...row,
					Tags: tagsToCsv(nextTags)
				}
			})
		)
		clearDraftValue(rowId, "Tags")
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
			const confirmed = window.confirm(displayText.confirmOverwrite)
			if (!confirmed) {
				input.value = ""
				return
			}
		}

		setRatingsUpload({ status: UploadStatus.parsing, fileName: file.name })
		setLogsUpload(emptyUploadState())
		setTagsUpload(emptyUploadState())
		setIssues([])

		try {
			const parsed = await runEffectOrThrow(parseMovielensRatingsCsv(file))
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
			setIssues(validationErrorsToIssues(IssueSource.ratings, parsed.errors))
			setRatingsUpload({
				status: UploadStatus.loaded,
				fileName: file.name,
				rows: parsed.rows.length,
				message: formatUploadMetaLoaded(file.name, parsed.rows.length)
			})
			setRestoreMessage("")
		} catch (error) {
			setStagedRows([])
			setDraftEdits({})
			setRatingsUpload({ status: UploadStatus.error, fileName: file.name, message: parseErrorToMessage(error) })
			setIssues([
				{
					id: `ratings-fatal-${Date.now()}`,
					severity: IssueSeverity.fatal,
					source: IssueSource.ratings,
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

		setLogsUpload({ status: UploadStatus.parsing, fileName: file.name })
		setIssues((prev) => prev.filter((issue) => issue.source !== IssueSource.logs))

		try {
			const parsed = await runEffectOrThrow(parseMovielensLogsCsv(file))
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

			setIssues((prev) => [...prev, ...validationErrorsToIssues(IssueSource.logs, parsed.errors)])
			setLogsUpload({
				status: UploadStatus.loaded,
				fileName: file.name,
				rows: parsed.rows.length,
				message: formatUploadMetaLoaded(file.name, parsed.rows.length)
			})
		} catch (error) {
			setLogsUpload({ status: UploadStatus.error, fileName: file.name, message: parseErrorToMessage(error) })
			setIssues((prev) => [
				...prev,
				{
					id: `logs-fatal-${Date.now()}`,
					severity: IssueSeverity.fatal,
					source: IssueSource.logs,
					message: parseErrorToMessage(error)
				}
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

		setTagsUpload({ status: UploadStatus.parsing, fileName: file.name })
		setIssues((prev) => prev.filter((issue) => issue.source !== IssueSource.tags))

		try {
			const parsed = await runEffectOrThrow(parseMovielensTagsCsv(file))
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
					return {
						...row,
						Tags: mergeTagCsv(row.Tags, tags)
					}
				})
			)

			setIssues((prev) => [...prev, ...validationErrorsToIssues(IssueSource.tags, parsed.errors)])
			setTagsUpload({
				status: UploadStatus.loaded,
				fileName: file.name,
				rows: parsed.rows.length,
				message: formatUploadMetaLoaded(file.name, parsed.rows.length)
			})
		} catch (error) {
			setTagsUpload({ status: UploadStatus.error, fileName: file.name, message: parseErrorToMessage(error) })
			setIssues((prev) => [
				...prev,
				{
					id: `tags-fatal-${Date.now()}`,
					severity: IssueSeverity.fatal,
					source: IssueSource.tags,
					message: parseErrorToMessage(error)
				}
			])
		}

		input.value = ""
	}

	const deleteRow = (row: StagedRow) => {
		setStagedRows((rows) => rows.filter((current) => current.id !== row.id))
		setDraftEdits((previous) => {
			const prefix = `${row.id}::`
			const next = Object.fromEntries(Object.entries(previous).filter(([key]) => !key.startsWith(prefix)))
			return next
		})
	}

	const handleDownload = async () => {
		if (!canDownload()) {
			return
		}
		try {
			const letterboxdRows = toLetterboxdRows(stagedRows())
			const blob = await runEffectOrThrow(toCsvBlobEffect(letterboxdRows))
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
					severity: IssueSeverity.fatal,
					source: IssueSource.export,
					message: parseErrorToMessage(error)
				}
			])
		}
	}

	const renderUploadMeta = (state: UploadState) => {
		const formatUploadMetaError = (fileName: string, message: string) => `${fileName}: ${message}`
		const formatUploadMetaParsing = (fileName: string) => `Parsing ${fileName}...`
		const fallbackFileText = "no file"
		if (state.status === UploadStatus.idle) {
			return "Not uploaded"
		}
		if (state.status === UploadStatus.parsing) {
			return formatUploadMetaParsing(state.fileName ?? fallbackFileText)
		}
		if (state.status === UploadStatus.loaded) {
			return formatUploadMetaLoaded(state.fileName ?? fallbackFileText, state.rows ?? 0)
		}
		return formatUploadMetaError(state.fileName ?? fallbackFileText, state.message ?? "Failed")
	}

	return {
		ratingsUpload,
		logsUpload,
		tagsUpload,
		stagedRows,
		allIssues,
		restoreMessage,
		canUploadOptional,
		canDownload,
		getIssueCountForRow: (rowId: string) => issueCountByRowId().get(rowId) ?? 0,
		getInputValue,
		setDraftValue,
		handleDraftKeyDown,
		handleDraftBlur,
		onAddRowTags: addRowTags,
		onRemoveRowTag: removeRowTag,
		onToggleRewatch: (rowId: string, checked: boolean) => updateRowField(rowId, "Rewatch", checked),
		onDeleteRow: deleteRow,
		onRatingsUpload: handleRatingsUpload,
		onLogsUpload: handleLogsUpload,
		onTagsUpload: handleTagsUpload,
		onDownload: handleDownload,
		onClear: clearSession,
		renderUploadMeta
	}
}
