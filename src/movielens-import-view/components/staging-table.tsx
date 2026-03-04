import { type Accessor, type Component, createMemo, createSignal, For, Show } from "solid-js"
import { normalizeTags, parseTagsCsv, splitTags, type StagedRow, type StagedTableProps } from "../index"

type TitleExternalIdType = "imdb" | "tmdb"
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

export const StagedTable: Component<StagedTableProps> = (props) => {
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
		deleteColumnSrOnly: "Delete",
		inputPlaceholders: {
			imdbID: "0050083",
			rating: "0.5-5",
			watchedDate: "YYYY-MM-DD",
			tags: "comma, separated",
			review: "Edit review"
		},
		tagEditor: {
			emptyState: "No tags",
			addPlaceholder: "Add a tag",
			editTitle: "Edit tags",
			stopEditingTitle: "Stop Editing",
			removePrefix: "Remove"
		},
		clearConfirmation: "Are you sure you want to clear all staged data? This cannot be undone.",
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
	const [tagEditorByRowId, setTagEditorByRowId] = createSignal<Record<string, boolean>>({})
	const [newTagByRowId, setNewTagByRowId] = createSignal<Record<string, string>>({})
	const getSortPriorityRank = (column: SortColumn) => sortPriority().findIndex((entry) => entry === column) + 1

	const SortIndicator: Component<{ column: SortColumn }> = (indicatorProps) => (
		<span
			class={`ml-1 inline-flex items-start ${
				sortPriority()[0] === indicatorProps.column ? "opacity-100" : "opacity-70"
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

	const EditIcon: Component = () => (
		<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="w-4 h-4" aria-hidden="true">
			<path stroke-linecap="round" stroke-linejoin="round" d="M12 20h9" />
			<path stroke-linecap="round" stroke-linejoin="round" d="M16.5 3.5a2.121 2.121 0 113 3L7 19l-4 1 1-4 12.5-12.5z" />
		</svg>
	)

	const CheckIcon: Component = () => (
		<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="w-4 h-4" aria-hidden="true">
			<path stroke-linecap="round" stroke-linejoin="round" d="M20 6L9 17l-5-5" />
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
	const isTagEditorOpen = (rowId: string) => tagEditorByRowId()[rowId] === true
	const setTagEditorState = (rowId: string, open: boolean) => {
		setTagEditorByRowId((previous) => ({ ...previous, [rowId]: open }))
	}
	const getTagsForRow = (row: StagedRow) => parseTagsCsv(props.getInputValue(row, "Tags"))
	const getPendingTag = (rowId: string) => newTagByRowId()[rowId] ?? ""
	const getTagEditorToggleLabel = (rowId: string) =>
		isTagEditorOpen(rowId) ? displayText.tagEditor.stopEditingTitle : displayText.tagEditor.editTitle
	const setPendingTag = (rowId: string, value: string) => {
		setNewTagByRowId((previous) => ({ ...previous, [rowId]: value }))
	}
	const addTagToRow = (row: StagedRow) => {
		const nextTag = getPendingTag(row.id)
		const nextTags = normalizeTags(splitTags(nextTag))
		if (nextTags.length === 0) {
			return
		}
		props.onAddRowTags(row.id, nextTags)
		setPendingTag(row.id, "")
	}
	const removeTagFromRow = (row: StagedRow, tagToRemove: string) => {
		props.onRemoveRowTag(row.id, tagToRemove)
	}
	const PressEnterHint = () => (
		<p class="text-sm mb-2 primary-text">
			<strong>Tip:</strong> Press{" "}
			<kbd class="px-1.5 py-0.5 text-xs font-semibold bg-gray-100 dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded">
				Enter
			</kbd>{" "}
			to save quickly. Clicking away also saves edits.
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
					const confirmed = !props.canDownload() || window.confirm(displayText.clearConfirmation)
					if (confirmed) {
						props.onClear()
					}
				}}
			/>
			<PressEnterHint />
			<div class="overflow-auto border border-gray-300">
				<table class="w-full">
					<thead class="bg-gray-100 dark:bg-gray-700">
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
								<span class="sr-only">{displayText.deleteColumnSrOnly}</span>
							</th>
						</tr>
					</thead>
					<tbody class="divide-y divide-gray-200">
						<For each={sortedRows()}>
							{(row) => (
								<tr class="hover:bg-gray-50 dark:hover:bg-gray-600">
									{/* Status */}
									<td class="px-3 py-2 text-sm">
										{props.getIssueCountForRow(row.id) > 0
											? getIssueStatusMessage(props.getIssueCountForRow(row.id))
											: displayText.rowStatusOk}
									</td>
									{/* Title */}
									<td class="px-3 py-2 text-sm">
										<Show
											when={getRowTitleExternalLink(row)}
											fallback={<span>{row.Title}</span>}
										>
											{(href) => (
												<a href={href()} target="_blank" rel="noopener noreferrer" class="external-link">
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
									{/* Title ID */}
									<td class="px-3 py-2">
										<span class="w-28 inline-block px-2 py-1 text-sm font-mono">
											{props.getInputValue(row, "imdbID")}
										</span>
									</td>
									{/* Rating */}
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
									{/* Watched Date */}
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
									{/* Rewatch checkbox */}
									<td class="text-center">
										<input
											class="self-center border"
											type="checkbox"
											checked={row.Rewatch}
											onChange={(event) => props.onToggleRewatch(row.id, event.currentTarget.checked)}
										/>
									</td>
									{/* Tags */}
									<td class="px-3 py-2 w-min">
										<div class="flex flex-col">
											<div class="flex justify-between items-start">
												{/* Chips */}
												<div class="flex flex-wrap max-w-60 gap-1 min-h-7">
													<Show
														when={getTagsForRow(row).length > 0}
														fallback={<span class="text-xs secondary-text">{displayText.tagEditor.emptyState}</span>}
													>
														<For each={getTagsForRow(row)}>
															{(tag) => (
																<span class="inline-flex items-center h-min gap-1 px-1.25 py-px text-xs border border-gray-300 rounded">
																	<span>{tag}</span>
																	<button
																		hidden={!isTagEditorOpen(row.id)}
																		type="button"
																		class="button-behavior text-xs"
																		title={`${displayText.tagEditor.removePrefix} ${tag}`}
																		onClick={() => removeTagFromRow(row, tag)}
																	>
																		×
																	</button>
																</span>
															)}
														</For>
													</Show>
												</div>
												{/* Edit Chips toggle */}
												<button
													type="button"
													class="button-behavior h-min inline-flex items-center justify-center"
													title={getTagEditorToggleLabel(row.id)}
													onClick={() => setTagEditorState(row.id, !isTagEditorOpen(row.id))}
												>
													<Show when={isTagEditorOpen(row.id)} fallback={<EditIcon />}>
														<CheckIcon />
													</Show>
													<span class="sr-only">{getTagEditorToggleLabel(row.id)}</span>
												</button>
											</div>
											<Show when={isTagEditorOpen(row.id)}>
												<input
													class="w-[50%] px-2 py-1 text-xs border border-gray-300 rounded mt-1"
													placeholder={displayText.tagEditor.addPlaceholder}
													value={getPendingTag(row.id)}
													onInput={(event) => setPendingTag(row.id, event.currentTarget.value)}
													onKeyDown={(event) => {
														if (event.key === "Enter") {
															event.preventDefault()
															const inputElement = event.currentTarget
															addTagToRow(row)
															requestAnimationFrame(() => inputElement.focus())
														}
													}}
												/>
											</Show>
										</div>
									</td>
									{/* Review */}
									<td class="px-3 py-2">
										<textarea
											class="px-2 py-1 min-h-6 text-sm border border-gray-300 rounded"
											placeholder={displayText.inputPlaceholders.review}
											value={props.getInputValue(row, "Review")}
											title={props.getInputValue(row, "Review")}
											onInput={(event) => props.setDraftValue(row.id, "Review", event.currentTarget.value)}
											onKeyDown={(event) => props.handleDraftKeyDown(event, row, "Review")}
											onBlur={() => props.handleDraftBlur(row.id, "Review")}
										/>
									</td>
									{/* Delete button */}
									<td class="px-3 py-2 text-sm text-center">
										<button
											class="button-behavior px-2 py-1 text-delete-red"
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
