import type { Component } from "solid-js"
import { For, Show } from "solid-js"
import type { IssuesPanelProps } from "../index"

export const IssuesPanel: Component<IssuesPanelProps> = (props) => {
	const displayText = {
		title: "Issues",
		onEmpty: "No issues."
	} as const
	const formatIssueRowLabel = (rowIndex: number) => ` row ${rowIndex}`
	const formatIssueFieldLabel = (field: string) => ` (${field})`
	return (
		<Show when={props.allIssues().length > 0}>
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
		</Show>
	)
}
