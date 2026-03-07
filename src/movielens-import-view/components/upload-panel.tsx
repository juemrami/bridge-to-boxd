import type { Component, JSX } from "solid-js"
import type { UploadState } from "../import-session-store"
import { UploadStatus, useImportSessionStore } from "../import-session-store"

export const UploadPanel: Component = () => {
	const sessionStore = useImportSessionStore()
	const displayText = {
		title: "Uploads",
		ratings: {
			label: "Ratings CSV (required)",
			description: "Contains your logged films and your latest rating for each."
		},
		logs: {
			label: "Activity Logs CSV (optional)",
			description: "Contains 'watched date' information for your rated films."
		},
		tags: {
			label: "Tags CSV (optional)",
			description: "Contains your declared tags for each film."
		},
		chooseFile: "Upload a file"
	} as const
	const formatUploadSummaryText = (rows: number, issues: number) => (
		<>
			<span class="font-medium">Summary:{" "}</span>
			{`${rows} imported films • ${issues} issues`}
		</>
	)
	const formatUploadText = (state: UploadState, isTags: boolean = false) => {
		const fileName = state.fileName ?? "no file"
		if (state.status === UploadStatus.idle) {
			return <>Not uploaded</>
		}
		if (state.status === UploadStatus.parsing) {
			return (
				<>
					Parsing <span class="whitespace-nowrap primary-text">{fileName}</span>...
				</>
			)
		}
		if (state.status === UploadStatus.loaded) {
			return (
				<>
					<span class="whitespace-nowrap primary-text">{fileName}</span>: parsed {state.rows ?? 0}{" "}
					{isTags ? "tags" : "rows"}
				</>
			)
		}
		return (
			<>
				<span class="whitespace-nowrap primary-text">{fileName}</span>
				{`: ${state.errMessage ?? "Failed to load"}`}
			</>
		)
	}
	const FileUploadInput = (
		{ disabled, inputId, onUpload }: {
			disabled?: boolean
			inputId: string
			onUpload: JSX.ChangeEventHandlerUnion<HTMLInputElement, Event>
		}
	) => (
		<label for={inputId} class="">
			<input
				type="button"
				value={displayText.chooseFile}
				class="outlined-orange-button w-max"
				disabled={disabled}
				onClick={() => document.getElementById(inputId)?.click()}
			/>
			<input
				class="w-0 h-0 opacity-0 absolute"
				id={inputId}
				type="file"
				accept=".csv,text/csv"
				aria-label={displayText.chooseFile}
				inert
				disabled={disabled}
				onChange={onUpload}
			/>
		</label>
	)
	return (
		<section class="my-3">
			<h2 class="text-2xl font-bold mb-1">{displayText.title}</h2>
			{/* upload elements */}
			<div id="upload-panel" class="grid grid-cols-3 gap-3 mb-2">
				<div id="ratings-upload">
					<p class="font-semibold mb-1">
						{displayText.ratings.label}{" "}
						<span class="cursor-pointer align-super" title={displayText.ratings.description}>🛈</span>
					</p>
					<FileUploadInput
						inputId="ratings-file"
						onUpload={sessionStore.onRatingsUpload}
					/>
					<p class="text-sm secondary-text mt-1">{formatUploadText(sessionStore.ratingsUpload())}</p>
				</div>

				<div id="logs-upload" class={`${sessionStore.canUploadOptional() ? "" : "opacity-50"}`}>
					<p class="font-semibold mb-1">
						{displayText.logs.label}{" "}
						<span class="cursor-pointer align-super" title={displayText.logs.description}>🛈</span>
					</p>
					<FileUploadInput
						inputId="logs-file"
						onUpload={sessionStore.onLogsUpload}
						disabled={!sessionStore.canUploadOptional()}
					/>
					<p class="text-sm secondary-text mt-1">{formatUploadText(sessionStore.logsUpload())}</p>
				</div>

				<div id="tags-upload" class={`${sessionStore.canUploadOptional() ? "" : "opacity-50"}`}>
					<p class="font-semibold mb-1">
						{displayText.tags.label}{" "}
						<span class="cursor-pointer align-super" title={displayText.tags.description}>🛈</span>
					</p>
					<FileUploadInput
						inputId="tags-file"
						onUpload={sessionStore.onTagsUpload}
						disabled={!sessionStore.canUploadOptional()}
					/>
					<p class="text-sm secondary-text mt-1">{formatUploadText(sessionStore.tagsUpload(), true)}</p>
				</div>
			</div>
			<p id="upload-summary" class="text-sm">
				{formatUploadSummaryText(sessionStore.stagedRows().length, sessionStore.allIssues().length)}
			</p>
		</section>
	)
}
