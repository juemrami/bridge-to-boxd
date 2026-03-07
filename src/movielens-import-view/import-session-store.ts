import { type LetterboxdImportRow, toCsvBlobEffect } from "@src/modules/letterboxd"
import {
	parseMovielensLogsCsv,
	parseMovielensRatingsCsv,
	parseMovielensTagsCsv,
	type ValidationError
} from "@src/modules/movielens"
import { Cause, Effect, Exit, Option } from "effect"
import { Atom, AtomRegistry } from "effect/unstable/reactivity"
import { type Accessor, createSignal, onCleanup, onMount } from "solid-js"

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

type ImportSessionState = {
	ratingsUpload: UploadState
	logsUpload: UploadState
	tagsUpload: UploadState
	stagedRows: StagedRow[]
	draftEdits: Record<string, string>
	issues: UiIssue[]
	restoreMessage: string
	sessionRestored: boolean
}

export type EditableTextField = "imdbID" | "Rating" | "WatchedDate" | "Tags" | "Review"

const SESSION_STORAGE_KEY = "movie-migrate.import-session.v1"

const emptyUploadState = (): UploadState => ({ status: "idle" })

const initialImportWorkflowState = (): ImportSessionState => ({
	ratingsUpload: emptyUploadState(),
	logsUpload: emptyUploadState(),
	tagsUpload: emptyUploadState(),
	stagedRows: [],
	draftEdits: {},
	issues: [],
	restoreMessage: "",
	sessionRestored: false
})

const clearedImportWorkflowState = (): ImportSessionState => ({
	...initialImportWorkflowState(),
	sessionRestored: true
})

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

const persistedSessionStore = AtomRegistry.make()
const userSessionState = Atom.make<ImportSessionState>(initialImportWorkflowState())

const exportIssuesAtom = Atom.make((get) => buildExportIssues(get(userSessionState).stagedRows))
const allIssuesAtom = Atom.make((get) => [...get(userSessionState).issues, ...get(exportIssuesAtom)])
const canUploadOptionalAtom = Atom.make((get) => get(userSessionState).ratingsUpload.status === UploadStatus.loaded)
const canDownloadAtom = Atom.make((get) => {
	const session = get(userSessionState)
	return session.stagedRows.length > 0 && get(exportIssuesAtom).length === 0
})
const issueCountByRowIdAtom = Atom.make((get) => {
	const session = get(userSessionState)
	const countsByRowIndex = new Map<number, number>()
	for (const issue of get(allIssuesAtom)) {
		if (issue.source === IssueSource.ratings || issue.rowIndex === undefined) {
			continue
		}
		countsByRowIndex.set(issue.rowIndex, (countsByRowIndex.get(issue.rowIndex) ?? 0) + 1)
	}
	const countsByRowId = new Map<string, number>()
	for (const [index, row] of session.stagedRows.entries()) {
		countsByRowId.set(row.id, countsByRowIndex.get(index + 1) ?? 0)
	}
	return countsByRowId
})

const draftKeyFor = (rowId: string, field: EditableTextField) => `${rowId}::${field}`

const updateRowField = <K extends keyof StagedRow>(rowId: string, key: K, value: StagedRow[K]) => {
	persistedSessionStore.update(userSessionState, (session) => ({
		...session,
		stagedRows: session.stagedRows.map((row) => (row.id === rowId ? { ...row, [key]: value } : row))
	}))
}

const setDraft = (rowId: string, field: EditableTextField, value: string) => {
	const key = draftKeyFor(rowId, field)
	persistedSessionStore.update(userSessionState, (session) => ({
		...session,
		draftEdits: { ...session.draftEdits, [key]: value }
	}))
}

const clearDraft = (rowId: string, field: EditableTextField) => {
	const key = draftKeyFor(rowId, field)
	persistedSessionStore.update(userSessionState, (session) => {
		if (!(key in session.draftEdits)) {
			return session
		}
		const { [key]: _removed, ...nextDrafts } = session.draftEdits
		return {
			...session,
			draftEdits: nextDrafts
		}
	})
}

const commitDraft = (rowId: string, field: EditableTextField) => {
	persistedSessionStore.update(userSessionState, (session) => {
		const row = session.stagedRows.find((current) => current.id === rowId)
		if (!row) {
			const key = draftKeyFor(rowId, field)
			if (!(key in session.draftEdits)) {
				return session
			}
			const { [key]: _removed, ...nextDrafts } = session.draftEdits
			return {
				...session,
				draftEdits: nextDrafts
			}
		}

		const key = draftKeyFor(row.id, field)
		let draftValue = session.draftEdits[key]
		if (draftValue === undefined) {
			return session
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

		const nextStagedRows = draftValue !== row[field]
			? session.stagedRows.map((currentRow) =>
				currentRow.id === row.id ? { ...currentRow, [field]: draftValue } : currentRow
			)
			: session.stagedRows

		const { [key]: _removed, ...nextDrafts } = session.draftEdits

		return {
			...session,
			stagedRows: nextStagedRows,
			draftEdits: nextDrafts
		}
	})
}

const addRowTags = (rowId: string, tags: string[]) => {
	persistedSessionStore.update(userSessionState, (session) => {
		const key = draftKeyFor(rowId, "Tags")
		const { [key]: _removed, ...nextDrafts } = session.draftEdits
		return {
			...session,
			stagedRows: session.stagedRows.map((
				row
			) => (row.id === rowId ? { ...row, Tags: mergeTagCsv(row.Tags, tags) } : row)),
			draftEdits: nextDrafts
		}
	})
}

const removeRowTag = (rowId: string, tagToRemove: string) => {
	persistedSessionStore.update(userSessionState, (session) => {
		const key = draftKeyFor(rowId, "Tags")
		const { [key]: _removed, ...nextDrafts } = session.draftEdits
		return {
			...session,
			stagedRows: session.stagedRows.map((row) => {
				if (row.id !== rowId) {
					return row
				}
				const nextTags = parseTagsCsv(row.Tags).filter((tag) => tag !== normalizeTag(tagToRemove))
				return {
					...row,
					Tags: tagsToCsv(nextTags)
				}
			}),
			draftEdits: nextDrafts
		}
	})
}

const deleteRow = (rowId: string) => {
	persistedSessionStore.update(userSessionState, (session) => {
		const prefix = `${rowId}::`
		return {
			...session,
			stagedRows: session.stagedRows.filter((row) => row.id !== rowId),
			draftEdits: Object.fromEntries(Object.entries(session.draftEdits).filter(([key]) => !key.startsWith(prefix)))
		}
	})
}

const clearSession = () => {
	persistedSessionStore.set(userSessionState, clearedImportWorkflowState())
	if (typeof window !== "undefined") {
		window.localStorage.removeItem(SESSION_STORAGE_KEY)
	}
}

const displayText = {
	confirmOverwrite: "Importing a new ratings file will overwrite current staged data. Continue?"
} as const

const formatUploadMetaLoaded = (fileName: string, rows: number) => `${fileName}: loaded ${rows} rows`

const onRatingsUpload = async (event: Event) => {
	const input = event.currentTarget as HTMLInputElement
	const file = input.files?.[0]
	if (!file) {
		return
	}

	const session = persistedSessionStore.get(userSessionState)
	if (session.stagedRows.length > 0) {
		const confirmed = window.confirm(displayText.confirmOverwrite)
		if (!confirmed) {
			input.value = ""
			return
		}
	}

	persistedSessionStore.update(userSessionState, (current) => ({
		...current,
		ratingsUpload: { status: UploadStatus.parsing, fileName: file.name },
		logsUpload: emptyUploadState(),
		tagsUpload: emptyUploadState(),
		issues: []
	}))

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

		persistedSessionStore.update(userSessionState, (current) => ({
			...current,
			stagedRows: nextRows,
			draftEdits: {},
			issues: validationErrorsToIssues(IssueSource.ratings, parsed.errors),
			ratingsUpload: {
				status: UploadStatus.loaded,
				fileName: file.name,
				rows: parsed.rows.length,
				message: formatUploadMetaLoaded(file.name, parsed.rows.length)
			},
			restoreMessage: ""
		}))
	} catch (error) {
		persistedSessionStore.update(userSessionState, (current) => ({
			...current,
			stagedRows: [],
			draftEdits: {},
			ratingsUpload: { status: UploadStatus.error, fileName: file.name, message: parseErrorToMessage(error) },
			issues: [
				{
					id: `ratings-fatal-${Date.now()}`,
					severity: IssueSeverity.fatal,
					source: IssueSource.ratings,
					message: parseErrorToMessage(error)
				}
			]
		}))
	}

	input.value = ""
}

const onLogsUpload = async (event: Event) => {
	const input = event.currentTarget as HTMLInputElement
	const file = input.files?.[0]
	if (!file) {
		return
	}

	persistedSessionStore.update(userSessionState, (session) => ({
		...session,
		logsUpload: { status: UploadStatus.parsing, fileName: file.name },
		issues: session.issues.filter((issue) => issue.source !== IssueSource.logs)
	}))

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

		persistedSessionStore.update(userSessionState, (session) => ({
			...session,
			stagedRows: session.stagedRows.map((row) => {
				const match = latestByMovieId.get(row.sourceMovieId)
				if (!match) {
					return row
				}
				return {
					...row,
					WatchedDate: toWatchedDate(match.dateTime)
				}
			}),
			issues: [...session.issues, ...validationErrorsToIssues(IssueSource.logs, parsed.errors)],
			logsUpload: {
				status: UploadStatus.loaded,
				fileName: file.name,
				rows: parsed.rows.length,
				message: formatUploadMetaLoaded(file.name, parsed.rows.length)
			}
		}))
	} catch (error) {
		persistedSessionStore.update(userSessionState, (session) => ({
			...session,
			logsUpload: { status: UploadStatus.error, fileName: file.name, message: parseErrorToMessage(error) },
			issues: [
				...session.issues,
				{
					id: `logs-fatal-${Date.now()}`,
					severity: IssueSeverity.fatal,
					source: IssueSource.logs,
					message: parseErrorToMessage(error)
				}
			]
		}))
	}

	input.value = ""
}

const onTagsUpload = async (event: Event) => {
	const input = event.currentTarget as HTMLInputElement
	const file = input.files?.[0]
	if (!file) {
		return
	}

	persistedSessionStore.update(userSessionState, (session) => ({
		...session,
		tagsUpload: { status: UploadStatus.parsing, fileName: file.name },
		issues: session.issues.filter((issue) => issue.source !== IssueSource.tags)
	}))

	try {
		const parsed = await runEffectOrThrow(parseMovielensTagsCsv(file))
		const tagsByMovieId = new Map<string, string[]>()

		for (const row of parsed.rows) {
			if (!tagsByMovieId.has(row.movie_id)) {
				tagsByMovieId.set(row.movie_id, [])
			}
			tagsByMovieId.get(row.movie_id)?.push(row.tag)
		}

		persistedSessionStore.update(userSessionState, (session) => ({
			...session,
			stagedRows: session.stagedRows.map((row) => {
				const tags = tagsByMovieId.get(row.sourceMovieId)
				if (!tags || tags.length === 0) {
					return row
				}
				return {
					...row,
					Tags: mergeTagCsv(row.Tags, tags)
				}
			}),
			issues: [...session.issues, ...validationErrorsToIssues(IssueSource.tags, parsed.errors)],
			tagsUpload: {
				status: UploadStatus.loaded,
				fileName: file.name,
				rows: parsed.rows.length,
				message: formatUploadMetaLoaded(file.name, parsed.rows.length)
			}
		}))
	} catch (error) {
		persistedSessionStore.update(userSessionState, (session) => ({
			...session,
			tagsUpload: { status: UploadStatus.error, fileName: file.name, message: parseErrorToMessage(error) },
			issues: [
				...session.issues,
				{
					id: `tags-fatal-${Date.now()}`,
					severity: IssueSeverity.fatal,
					source: IssueSource.tags,
					message: parseErrorToMessage(error)
				}
			]
		}))
	}

	input.value = ""
}

const onToggleRewatch = (rowId: string, checked: boolean) => {
	updateRowField(rowId, "Rewatch", checked)
}

const onDownload = async () => {
	if (!persistedSessionStore.get(canDownloadAtom)) {
		return
	}

	try {
		const letterboxdRows = toLetterboxdRows(persistedSessionStore.get(userSessionState).stagedRows)
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
		persistedSessionStore.update(userSessionState, (session) => ({
			...session,
			issues: [
				...session.issues,
				{
					id: `export-fatal-${Date.now()}`,
					severity: IssueSeverity.fatal,
					source: IssueSource.export,
					message: parseErrorToMessage(error)
				}
			]
		}))
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

const persistSession = (userSession: ImportSessionState) => {
	if (!userSession.sessionRestored || typeof window === "undefined") {
		return
	}
	const toPersist: PersistedSession = {
		version: 1,
		ratingsUpload: userSession.ratingsUpload,
		logsUpload: userSession.logsUpload,
		tagsUpload: userSession.tagsUpload,
		stagedRows: userSession.stagedRows,
		issues: userSession.issues,
		updatedAt: new Date().toISOString()
	}
	window.localStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(toPersist))
}

let clientLifecycleInitialized = false

const initClientLifecycle = () => {
	if (clientLifecycleInitialized || typeof window === "undefined") {
		return
	}
	clientLifecycleInitialized = true

	const raw = window.localStorage.getItem(SESSION_STORAGE_KEY)
	if (raw) {
		try {
			const restored = JSON.parse(raw) as PersistedSession
			if (restored.version === 1) {
				persistedSessionStore.set(userSessionState, {
					ratingsUpload: restored.ratingsUpload,
					logsUpload: restored.logsUpload,
					tagsUpload: restored.tagsUpload,
					stagedRows: restored.stagedRows,
					draftEdits: {},
					issues: restored.issues,
					restoreMessage:
						`Restored previous session (${restored.stagedRows.length} staged rows, ${restored.issues.length} issues).`,
					sessionRestored: true
				})
			} else {
				window.localStorage.removeItem(SESSION_STORAGE_KEY)
				persistedSessionStore.set(userSessionState, {
					...persistedSessionStore.get(userSessionState),
					sessionRestored: true
				})
			}
		} catch {
			window.localStorage.removeItem(SESSION_STORAGE_KEY)
			persistedSessionStore.set(userSessionState, {
				...persistedSessionStore.get(userSessionState),
				sessionRestored: true
			})
		}
	} else {
		persistedSessionStore.set(userSessionState, {
			...persistedSessionStore.get(userSessionState),
			sessionRestored: true
		})
	}

	persistedSessionStore.subscribe(userSessionState, (session) => {
		persistSession(session)
	})
}

const useAtomValue = <A>(atom: Atom.Atom<A>): Accessor<A> => {
	const [value, setValue] = createSignal(persistedSessionStore.get(atom))
	onMount(() => {
		const unsubscribe = persistedSessionStore.subscribe(atom, (nextValue) => setValue(() => nextValue), {
			immediate: true
		})
		onCleanup(unsubscribe)
	})
	return value
}

export const useImportSessionStore = () => {
	onMount(() => {
		initClientLifecycle()
	})

	const userSession = useAtomValue(userSessionState)
	const stagedRows = useAtomValue(Atom.make((get) => get(userSessionState).stagedRows))
	const ratingsUpload = useAtomValue(Atom.make((get) => get(userSessionState).ratingsUpload))
	const logsUpload = useAtomValue(Atom.make((get) => get(userSessionState).logsUpload))
	const tagsUpload = useAtomValue(Atom.make((get) => get(userSessionState).tagsUpload))
	const restoreMessage = useAtomValue(Atom.make((get) => get(userSessionState).restoreMessage))
	const allIssues = useAtomValue(allIssuesAtom)
	const canUploadOptional = useAtomValue(canUploadOptionalAtom)
	const canDownload = useAtomValue(canDownloadAtom)
	const issueCountByRowId = useAtomValue(issueCountByRowIdAtom)

	const getInputValue = (row: StagedRow, field: EditableTextField) => {
		const key = draftKeyFor(row.id, field)
		const draftValue = userSession().draftEdits[key]
		return draftValue ?? row[field]
	}

	const handleDraftKeyDown = (event: KeyboardEvent, row: StagedRow, field: EditableTextField) => {
		if (event.key === "Enter") {
			event.preventDefault()
			commitDraft(row.id, field)
			;(event.currentTarget as HTMLInputElement).blur()
			return
		}
		if (event.key === "Escape") {
			event.preventDefault()
			clearDraft(row.id, field)
			;(event.currentTarget as HTMLInputElement).blur()
		}
	}

	const handleDraftBlur = (rowId: string, field: EditableTextField) => {
		commitDraft(rowId, field)
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
		issueCountByRowId,
		setDraft,
		commitDraft,
		deleteRow,
		clearSession,
		onRatingsUpload,
		onLogsUpload,
		onTagsUpload,
		onAddRowTags: addRowTags,
		onRemoveRowTag: removeRowTag,
		onToggleRewatch,
		onDownload,
		renderUploadMeta,
		getIssueCountForRow: (rowId: string) => issueCountByRowId().get(rowId) ?? 0,
		getInputValue,
		handleDraftKeyDown,
		handleDraftBlur
	}
}
