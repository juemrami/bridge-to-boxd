import { Micro } from "effect"
import { type Accessor, type Component, createEffect, createMemo, createSignal, For, onMount, Show } from "solid-js"
import { type LetterboxdImportRow, toCsvBlobEffect } from "./modules/letterboxd"
import {
	parseMovielensLogsCsv,
	parseMovielensRatingsCsv,
	parseMovielensTagsCsv,
	type ValidationError
} from "./modules/movielens"

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
type TitleExternalIdType = "imdb" | "tmdb"

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

const getTitleExternalLink = (idType: TitleExternalIdType, id: string) => {
	const trimmedId = id.trim()
	if (trimmedId.length === 0) {
		return undefined
	}
	if (idType === "imdb") {
		const imdbId = /^tt/i.test(trimmedId) ? `tt${trimmedId.slice(2)}` : `tt${trimmedId}`
		return `https://www.imdb.com/title/${imdbId}`
	}
	if (idType === "tmdb") {
		return `https://www.themoviedb.org/movie/${trimmedId}`
	}
	return undefined
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

const UploadPanel: Component<UploadPanelProps> = (props) => {
	const displayText = {
		title: "Uploads",
		ratingsLabel: "Ratings CSV (required)",
		logsLabel: "Logs CSV (optional)",
		tagsLabel: "Tags CSV (optional)",
		chooseFile: "Choose a File"
	} as const
	const formatUploadSummaryText = (rows: number, issues: number) => `Summary: ${rows} staged rows • ${issues} issues`
	return (
		<section class="my-3">
			<h2 class="text-2xl font-bold mb-4">{displayText.title}</h2>
			{/* upload elements */}
			<div id="upload-panel" class="grid grid-cols-3 gap-3 mb-4">
				<div id="ratings-upload">
					<p class="font-semibold mb-1">
						{displayText.ratingsLabel}
					</p>
					<label for="ratings-file" class="">
						<p class="basic-button w-max">{displayText.chooseFile}</p>
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

				<div id="logs-upload" class={`${props.canUploadOptional() ? "" : "opacity-50"}`}>
					<p class="font-semibold mb-1">
						{displayText.logsLabel}
					</p>
					<label for="logs-file" class="">
						<p class="basic-button w-max">{displayText.chooseFile}</p>
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

				<div id="tags-upload" class={`${props.canUploadOptional() ? "" : "opacity-50"}`}>
					<p class="font-semibold mb-1">
						{displayText.tagsLabel}
					</p>
					<label for="tags-file" class="">
						<p class="basic-button w-max">{displayText.chooseFile}</p>
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
				{formatUploadSummaryText(props.stagedRows().length, props.allIssues().length)}
			</p>
		</section>
	)
}

type IssuesPanelProps = {
	allIssues: Accessor<UiIssue[]>
}
const IssuesPanel: Component<IssuesPanelProps> = (props) => {
	const displayText = {
		title: "Issues",
		onEmpty: "No issues."
	} as const
	const formatIssueRowLabel = (rowIndex: number) => ` row ${rowIndex}`
	const formatIssueFieldLabel = (field: string) => ` (${field})`
	return (
		<section class="my-6">
			<h2 class="text-2xl font-bold mb-4">{displayText.title}</h2>
			<Show
				when={props.allIssues().length > 0}
				fallback={<p>{displayText.onEmpty}</p>}
			>
				<ul class="list-disc list-inside space-y-1">
					<For each={props.allIssues()}>
						{(issue) => (
							<li class="text-sm">
								<strong>{issue.severity.toUpperCase()}</strong> [{issue.source}]
								{issue.rowIndex !== undefined ? formatIssueRowLabel(issue.rowIndex) : ""}
								{issue.field ? formatIssueFieldLabel(issue.field) : ""}: {issue.message}
							</li>
						)}
					</For>
				</ul>
			</Show>
		</section>
	)
}

type TableActionsProps = {
	canDownload: Accessor<boolean>
	restoreMessage: Accessor<string>
	onDownload: () => void | Promise<void>
	onClear: () => void
}
const TableActions: Component<TableActionsProps> = (props) => {
	const displayText = {
		downloadButton: "Download Letterboxd CSV",
		clearButton: "Clear import"
	} as const
	return (
		<div class="flex gap-2 items-center flex-wrap mb-1">
			<button
				class="basic-button"
				type="button"
				onClick={props.onDownload}
				disabled={!props.canDownload()}
			>
				{displayText.downloadButton}
			</button>
			<button class="basic-button" type="reset" onClick={props.onClear}>
				{displayText.clearButton}
			</button>
			<Show when={props.restoreMessage().length > 0}>
				<span>{props.restoreMessage()}</span>
			</Show>
		</div>
	)
}

type StagedTableProps = {
	stagedRows: Accessor<StagedRow[]>
	getIssueCountForRow: (rowId: string) => number
	canDownload: Accessor<boolean>
	restoreMessage: Accessor<string>
	getInputValue: (row: StagedRow, field: EditableTextField) => string
	setDraftValue: (rowId: string, field: EditableTextField, value: string) => void
	handleDraftKeyDown: (event: KeyboardEvent, row: StagedRow, field: EditableTextField) => void
	handleDraftBlur: (rowId: string, field: EditableTextField) => void
	onToggleRewatch: (rowId: string, checked: boolean) => void
	onDeleteRow: (row: StagedRow) => void
	onDownload: () => void | Promise<void>
	onClear: () => void
}
const StagedTable: Component<StagedTableProps> = (props) => {
	const SortColumn = {
		name: "name",
		watchedDate: "watchedDate",
		rating: "rating"
	} as const
	type SortColumn = typeof SortColumn[keyof typeof SortColumn]
	type SortDirection = "asc" | "desc"

	const displayText = {
		title: "Staged Letterboxd import data",
		rowStatusOk: "ok",
		headerLabels: ["Status", "Title", "IMDb Title ID", "Rating", "WatchedDate", "Rewatch", "Tags", "Review"],
		inputPlaceholders: {
			imdbID: "0050083",
			rating: "0.5-5",
			watchedDate: "YYYY-MM-DD",
			tags: "comma, separated"
		},
		deleteButtonHint: "Delete row",
		deleteConfirmation: "Delete this staged row? This cannot be undone."
	} as const
	const defaultSortDirections: Record<SortColumn, SortDirection> = {
		[SortColumn.name]: "desc",
		[SortColumn.watchedDate]: "desc",
		[SortColumn.rating]: "desc"
	}
	const defaultSortPriority: SortColumn[] = [SortColumn.name, SortColumn.watchedDate, SortColumn.rating]
	const sortableColumnsByHeader: Partial<Record<(typeof displayText.headerLabels)[number], SortColumn>> = {
		Title: SortColumn.name,
		Rating: SortColumn.rating,
		WatchedDate: SortColumn.watchedDate
	}
	const [sortDirections, setSortDirections] = createSignal<Record<SortColumn, SortDirection>>(defaultSortDirections)
	const [sortPriority, setSortPriority] = createSignal<SortColumn[]>(defaultSortPriority)
	const getSortPriorityRank = (column: SortColumn) => sortPriority().findIndex((entry) => entry === column) + 1

	const SortIndicator: Component<{ column: SortColumn }> = (indicatorProps) => (
		<span
			class={`ml-1 inline-flex items-start ${
				sortPriority()[0] === indicatorProps.column ? "opacity-100" : "opacity-50"
			}`}
		>
			<span class="text-xs leading-none">{sortDirections()[indicatorProps.column] === "asc" ? "▲" : "▼"}</span>
			<sup class="ml-0.5 text-[10px] leading-none">{getSortPriorityRank(indicatorProps.column)}</sup>
		</span>
	)

	const TrashIcon: Component = () => (
		<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="w-4 h-4" aria-hidden="true">
			<path stroke-linecap="round" stroke-linejoin="round" d="M3 6h18M8 6V4h8v2m-9 0v14h10V6M10 10v7m4-7v7" />
		</svg>
	)

	const compareStrings = (left: string, right: string, direction: SortDirection) => {
		const leftValue = left.trim()
		const rightValue = right.trim()
		if (leftValue.length === 0 && rightValue.length === 0) {
			return 0
		}
		if (leftValue.length === 0) {
			return 1
		}
		if (rightValue.length === 0) {
			return -1
		}
		const compared = leftValue.localeCompare(rightValue)
		return direction === "asc" ? compared : -compared
	}

	const compareRatings = (left: string, right: string, direction: SortDirection) => {
		const leftValue = Number(left)
		const rightValue = Number(right)
		const leftIsValid = !Number.isNaN(leftValue)
		const rightIsValid = !Number.isNaN(rightValue)
		if (!leftIsValid && !rightIsValid) {
			return 0
		}
		if (!leftIsValid) {
			return 1
		}
		if (!rightIsValid) {
			return -1
		}
		const compared = leftValue - rightValue
		return direction === "asc" ? compared : -compared
	}

	const sortedRows = createMemo(() => {
		const rows = [...props.stagedRows()]
		rows.sort((left, right) => {
			for (const column of sortPriority()) {
				const direction = sortDirections()[column]
				let compared = 0
				if (column === SortColumn.name) {
					compared = compareStrings(left.Title, right.Title, direction)
				} else if (column === SortColumn.watchedDate) {
					compared = compareStrings(left.WatchedDate, right.WatchedDate, direction)
				} else {
					compared = compareRatings(left.Rating, right.Rating, direction)
				}
				if (compared !== 0) {
					return compared
				}
			}
			return left.id.localeCompare(right.id)
		})
		return rows
	})

	const toggleSort = (column: SortColumn) => {
		if (sortPriority()[0] !== column) {
			setSortPriority((previous) => [column, ...previous.filter((entry) => entry !== column)])
			return
		}
		setSortDirections((previous) => ({
			...previous,
			[column]: previous[column] === "asc" ? "desc" : "asc"
		}))
	}
	const getIssueStatusMessage = (count: number) => `${count} issue(s)`
	const getRowTitleExternalLink = (row: StagedRow) => getTitleExternalLink("imdb", props.getInputValue(row, "imdbID"))
	const PressEnterHint = () => (
		<p class="text-sm mb-2 text-gray-600">
			<strong>Note:</strong> Must press{" "}
			<kbd class="px-1.5 py-0.5 text-xs font-semibold bg-gray-100 border border-gray-300 rounded">Enter</kbd>{" "}
			to save any edits to Tags or Reviews.
		</p>
	)
	return (
		<section class="my-6">
			<h2 class="text-2xl font-bold mb-1">{displayText.title}</h2>
			<TableActions
				canDownload={props.canDownload}
				restoreMessage={props.restoreMessage}
				onDownload={props.onDownload}
				onClear={() => {
					const confirmed = !props.canDownload() ||
						window.confirm("Are you sure you want to clear all staged data? This cannot be undone.")
					if (confirmed) {
						props.onClear()
					}
				}}
			/>
			<PressEnterHint />
			<div class="overflow-auto border border-gray-300">
				<table class="w-full">
					<thead class="bg-gray-100">
						<tr>
							<For each={displayText.headerLabels}>
								{(header) => {
									const sortableColumn = sortableColumnsByHeader[header]
									return (
										<th class="px-3 py-2 text-left text-sm font-semibold">
											<Show
												when={sortableColumn !== undefined}
												fallback={<span>{header}</span>}
											>
												<button class="underline" type="button" onClick={() => toggleSort(sortableColumn!)}>
													<span>{header}</span>
													<SortIndicator column={sortableColumn!} />
												</button>
											</Show>
										</th>
									)
								}}
							</For>
							<th class="px-3 py-2 text-left text-sm font-semibold">
								<span class="sr-only">Delete</span>
							</th>
						</tr>
					</thead>
					<tbody class="divide-y divide-gray-200">
						<For each={sortedRows()}>
							{(row) => (
								<tr class="hover:bg-gray-50">
									<td class="px-3 py-2 text-sm">
										{props.getIssueCountForRow(row.id) > 0
											? getIssueStatusMessage(props.getIssueCountForRow(row.id))
											: displayText.rowStatusOk}
									</td>
									<td class="px-3 py-2 text-sm">
										<Show
											when={getRowTitleExternalLink(row)}
											fallback={<span>{row.Title}</span>}
										>
											{(href) => (
												<a href={href()} target="_blank" rel="noopener noreferrer" class="underline">
													{row.Title}
												</a>
											)}
										</Show>
										{
											/* <button
											class="ml-2 px-2 py-1 text-xs border rounded bg-white text-gray-700"
											disabled
											title="Edit movie (TODO)"
										>
											Edit
										</button> */
										}
									</td>
									<td class="px-3 py-2">
										<span class="w-28 inline-block px-2 py-1 text-sm font-mono text-gray-700">
											{props.getInputValue(row, "imdbID")}
										</span>
									</td>
									<td class="px-3 py-2">
										<input
											class="w-16 px-2 py-1 text-sm border border-gray-300 rounded"
											value={props.getInputValue(row, "Rating")}
											onInput={(event) => props.setDraftValue(row.id, "Rating", event.currentTarget.value)}
											onKeyDown={(event) => props.handleDraftKeyDown(event, row, "Rating")}
											onBlur={() => props.handleDraftBlur(row.id, "Rating")}
											placeholder={displayText.inputPlaceholders.rating}
											step={0.5}
											min={0.5}
											max={5}
											type="number"
										/>
									</td>
									<td class="px-3 py-2">
										<input
											class="w-32 px-2 py-1 text-sm border border-gray-300 rounded"
											value={props.getInputValue(row, "WatchedDate")}
											onInput={(event) => props.setDraftValue(row.id, "WatchedDate", event.currentTarget.value)}
											onKeyDown={(event) => props.handleDraftKeyDown(event, row, "WatchedDate")}
											onBlur={() => props.handleDraftBlur(row.id, "WatchedDate")}
											placeholder={displayText.inputPlaceholders.watchedDate}
											type="date"
										/>
									</td>
									<td class="text-center">
										<input
											class="self-center border"
											type="checkbox"
											checked={row.Rewatch}
											onChange={(event) => props.onToggleRewatch(row.id, event.currentTarget.checked)}
										/>
									</td>
									<td class="px-3 py-2">
										<input
											class="w-full px-2 py-1 text-sm border border-gray-300 rounded"
											title={props.getInputValue(row, "Tags")}
											value={props.getInputValue(row, "Tags")}
											onInput={(event) => props.setDraftValue(row.id, "Tags", event.currentTarget.value)}
											onKeyDown={(event) => props.handleDraftKeyDown(event, row, "Tags")}
											onBlur={() => props.handleDraftBlur(row.id, "Tags")}
											placeholder={displayText.inputPlaceholders.tags}
										/>
									</td>
									<td class="px-3 py-2">
										<input
											class="w-full px-2 py-1 text-sm border border-gray-300 rounded"
											value={props.getInputValue(row, "Review")}
											title={props.getInputValue(row, "Review")}
											onInput={(event) => props.setDraftValue(row.id, "Review", event.currentTarget.value)}
											onKeyDown={(event) => props.handleDraftKeyDown(event, row, "Review")}
											onBlur={() => props.handleDraftBlur(row.id, "Review")}
										/>
									</td>
									<td class="px-3 py-2 text-sm text-center">
										<button
											class="button-behavior px-2 py-1"
											type="button"
											aria-label={displayText.deleteButtonHint}
											title={displayText.deleteButtonHint}
											onClick={() => {
												const confirmed = window.confirm(displayText.deleteConfirmation)
												if (confirmed) {
													props.onDeleteRow(row)
												}
											}}
										>
											<TrashIcon />
										</button>
									</td>
								</tr>
							)}
						</For>
					</tbody>
				</table>
			</div>
		</section>
	)
}

const PageFooter: Component = () => {
	const links = {
		personal: {
			label: "Juemrami",
			href: "https://juemrami.dev"
		},
		repo: {
			label: "GitHub",
			href: "https://github.com/juemrami/bridge-to-boxd"
		}
	}
	return (
		<footer class="my-6 text-sm text-center text-gray-600">
			<p>
				Developed by <a href={links.personal.href} class="underline">{links.personal.label}</a>. Source code on{" "}
				<a href={links.repo.href} class="underline">{links.repo.label}</a>.
			</p>
		</footer>
	)
}
const App: Component = () => {
	const displayText = {
		pageTitle: "Bridge: MovieLens to Letterboxd",
		pageSummary: "Convert MovieLens' exported ratings, logs, and tags to the Letterboxd import format.",
		instructionsLabel: "Instructions",
		instructionsSteps: [
			"Upload MovieLens ratings CSV (required)",
			"Upload MovieLens logs and/or tags CSV (optional)",
			"Review/edit uploaded MovieLens data",
			"Export to Letterboxd ratings import CSV"
		],
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
		// for rating we also commit the value on blur; other fields simply discard
		if (field === "Rating") {
			const row = stagedRows().find((r) => r.id === rowId)
			if (row) {
				const key = draftKeyFor(rowId, field)
				const draftValue = draftEdits()[key]
				if (draftValue !== undefined && draftValue !== row.Rating) {
					updateRowField(rowId, field, draftValue as string)
				}
			}
		}
		clearDraftValue(rowId, field)
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

	const updateRowField = <K extends keyof StagedRow>(rowId: string, key: K, value: StagedRow[K]) => {
		setStagedRows((rows) => rows.map((row) => (row.id === rowId ? { ...row, [key]: value } : row)))
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
			return formatUploadMetaLoaded(
				state.fileName ?? fallbackFileText,
				state.rows ?? 0
			)
		}
		return formatUploadMetaError(
			state.fileName ?? fallbackFileText,
			state.message ?? `Failed`
		)
	}

	return (
		<main class="mx-auto p-4 max-w-6xl">
			<header class="mb-3">
				<h1 class="text-3xl font-bold">{displayText.pageTitle}</h1>
				<p class="text-sm opacity-75 mb-2">{displayText.pageSummary}</p>
				<div class="text-sm">
					<p class="font-semibold mb-2">{displayText.instructionsLabel}</p>
					<ol class="flex flex-col gap-1 ml-4 list-decimal">
						<For each={displayText.instructionsSteps}>{(step) => <li>{step}</li>}</For>
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

			<Show when={allIssues().length > 0}>
				<IssuesPanel allIssues={allIssues} />
			</Show>

			<StagedTable
				stagedRows={stagedRows}
				getIssueCountForRow={(rowId) => issueCountByRowId().get(rowId) ?? 0}
				canDownload={canDownload}
				restoreMessage={restoreMessage}
				getInputValue={getInputValue}
				setDraftValue={setDraftValue}
				handleDraftKeyDown={handleDraftKeyDown}
				handleDraftBlur={handleDraftBlur}
				onToggleRewatch={(rowId, checked) => updateRowField(rowId, "Rewatch", checked)}
				onDeleteRow={deleteRow}
				onDownload={handleDownload}
				onClear={clearSession}
			/>
			<PageFooter />
		</main>
	)
}

export default App
