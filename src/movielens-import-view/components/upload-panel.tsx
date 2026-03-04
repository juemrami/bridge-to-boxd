import type { Component } from "solid-js"
import { type UploadPanelProps } from "../index"

export const UploadPanel: Component<UploadPanelProps> = (props) => {
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
					<p class="text-sm secondary-text">{props.renderUploadMeta(props.ratingsUpload())}</p>
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
					<p class="text-sm secondary-text">{props.renderUploadMeta(props.logsUpload())}</p>
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
					<p class="text-sm secondary-text">{props.renderUploadMeta(props.tagsUpload())}</p>
				</div>
			</div>
			<p id="upload-summary" class="text-sm">
				{formatUploadSummaryText(props.stagedRows().length, props.allIssues().length)}
			</p>
		</section>
	)
}
