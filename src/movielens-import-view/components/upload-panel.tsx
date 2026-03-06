import type { Component, JSX } from "solid-js"
import { type UploadPanelProps } from "../import-session-store"

export const UploadPanel: Component<UploadPanelProps> = (props) => {
	const displayText = {
		title: "Uploads",
		ratingsLabel: "Ratings CSV (required)",
		logsLabel: "Logs CSV (optional)",
		tagsLabel: "Tags CSV (optional)",
		chooseFile: "Choose a File"
	} as const
	const formatUploadSummaryText = (rows: number, issues: number) => `Summary: ${rows} staged rows • ${issues} issues`
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
			<h2 class="text-2xl font-bold mb-4">{displayText.title}</h2>
			{/* upload elements */}
			<div id="upload-panel" class="grid grid-cols-3 gap-3 mb-4">
				<div id="ratings-upload">
					<p class="font-semibold mb-1">
						{displayText.ratingsLabel}
					</p>
					<FileUploadInput
						inputId="ratings-file"
						onUpload={props.onRatingsUpload}
					/>
					<p class="text-sm secondary-text mt-1">{props.renderUploadMeta(props.ratingsUpload())}</p>
				</div>

				<div id="logs-upload" class={`${props.canUploadOptional() ? "" : "opacity-50"}`}>
					<p class="font-semibold mb-1">
						{displayText.logsLabel}
					</p>
					<FileUploadInput
						inputId="logs-file"
						onUpload={props.onLogsUpload}
						disabled={!props.canUploadOptional()}
					/>
					<p class="text-sm secondary-text mt-1">{props.renderUploadMeta(props.logsUpload())}</p>
				</div>

				<div id="tags-upload" class={`${props.canUploadOptional() ? "" : "opacity-50"}`}>
					<p class="font-semibold mb-1">
						{displayText.tagsLabel}
					</p>
					<FileUploadInput
						inputId="tags-file"
						onUpload={props.onTagsUpload}
						disabled={!props.canUploadOptional()}
					/>
					<p class="text-sm secondary-text mt-1">{props.renderUploadMeta(props.tagsUpload())}</p>
				</div>
			</div>
			<p id="upload-summary" class="text-sm">
				{formatUploadSummaryText(props.stagedRows().length, props.allIssues().length)}
			</p>
		</section>
	)
}
