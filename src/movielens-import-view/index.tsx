import { type Component, For } from "solid-js"
import { IssuesPanel } from "./components/issues-panel"
import { StagedTable } from "./components/staging-table"
import { UploadPanel } from "./components/upload-panel"

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
		]
	} as const

	return (
		<main class="mx-auto p-4 max-w-6xl">
			<header class="mb-3">
				<h1 id="page-title" class="text-3xl font-bold">{displayText.pageTitle}</h1>
				<p id="page-summary" class="secondary-text text-sm mb-2">{displayText.pageSummary}</p>
				<div class="text-sm">
					<p class="font-semibold mb-2">{displayText.instructionsLabel}</p>
					<ol id="instructions-steps" class="flex flex-col gap-1 ml-4 list-decimal">
						<For each={displayText.instructionsSteps}>{(step) => <li>{step}</li>}</For>
					</ol>
				</div>
			</header>

			<UploadPanel />

			<IssuesPanel />

			<StagedTable />
		</main>
	)
}

export default App
