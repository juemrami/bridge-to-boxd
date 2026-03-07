import { Cause, Effect, Exit, Option } from "effect"
import { Atom, AtomRegistry } from "effect/unstable/reactivity"
import { type Accessor, createSignal, For, onCleanup, onMount, Show } from "solid-js"
import { useImportSessionStore } from "../import-session-store"

const imdbSearchUrl = "https://api.imdbapi.dev/search/titles"

type ImdbSearchResult = {
	id: string
	primaryTitle: string
	startYear?: number
	primaryImageUrl?: string
}

type ImdbSearchState = {
	query: string
	status: "idle" | "loading" | "success" | "error"
	results: ImdbSearchResult[]
	errorMessage?: string
}

const imdbSearchRegistry = AtomRegistry.make()
const imdbSearchStateAtom = Atom.make<ImdbSearchState>({
	query: "",
	status: "idle",
	results: []
})
const imdbSearchCacheAtom = Atom.make<Record<string, ImdbSearchResult[]>>({})
const selectedImdbResultIdAtom = Atom.make<string | null>(null)

const normalizeImdbQuery = (query: string) => query.trim().toLowerCase()

const parseErrorToMessage = (error: unknown) => {
	if (typeof error === "object" && error !== null && "message" in error && typeof error.message === "string") {
		return error.message
	}
	return String(error)
}

const useAtomValue = <A, _>(atom: Atom.Atom<A>): Accessor<A> => {
	const [value, setValue] = createSignal(imdbSearchRegistry.get(atom))
	onMount(() => {
		const unsubscribe = imdbSearchRegistry.subscribe(atom, (nextValue) => setValue(() => nextValue), {
			immediate: true
		})
		onCleanup(unsubscribe)
	})
	return value
}

const resetModalSearchState = () => {
	imdbSearchRegistry.set(imdbSearchStateAtom, {
		query: "",
		status: "idle",
		results: []
	})
	imdbSearchRegistry.set(selectedImdbResultIdAtom, null)
}

const searchImdb = async (query: string) => {
	const normalizedQuery = normalizeImdbQuery(query)
	const nextStatus: ImdbSearchState["status"] = normalizedQuery.length === 0 ? "idle" : "loading"

	imdbSearchRegistry.update(imdbSearchStateAtom, (state) => ({
		query,
		status: nextStatus,
		results: normalizedQuery.length === 0 ? [] : state.results
	}))
	imdbSearchRegistry.set(selectedImdbResultIdAtom, null)

	if (normalizedQuery.length === 0) {
		return
	}

	const cachedResults = imdbSearchRegistry.get(imdbSearchCacheAtom)[normalizedQuery]
	if (cachedResults) {
		imdbSearchRegistry.set(imdbSearchStateAtom, {
			query,
			status: "success",
			results: cachedResults
		})
		return
	}

	const fetchEffect = Effect.tryPromise({
		try: async () => {
			const url = new URL(imdbSearchUrl)
			url.searchParams.set("query", query.trim())
			url.searchParams.set("limit", "12")
			const response = await fetch(url.toString())
			if (!response.ok) {
				throw new Error(`IMDb search failed (${response.status})`)
			}
			const payload = (await response.json()) as {
				titles?: Array<{
					id?: string
					primaryTitle?: string
					startYear?: number
					primaryImage?: { url?: string }
				}>
			}
			return (payload.titles ?? [])
				.filter((title) => title.id && title.primaryTitle)
				.map((title) => {
					const result: ImdbSearchResult = {
						id: title.id!,
						primaryTitle: title.primaryTitle!
					}
					if (title.startYear !== undefined) {
						result.startYear = title.startYear
					}
					if (title.primaryImage?.url !== undefined) {
						result.primaryImageUrl = title.primaryImage.url
					}
					return result
				})
		},
		catch: (error) => new Error(parseErrorToMessage(error))
	})

	const exit = await Effect.runPromiseExit(fetchEffect)
	if (Exit.isSuccess(exit)) {
		imdbSearchRegistry.update(imdbSearchCacheAtom, (cache) => ({
			...cache,
			[normalizedQuery]: exit.value
		}))
		imdbSearchRegistry.set(imdbSearchStateAtom, {
			query,
			status: "success",
			results: exit.value
		})
		return
	}

	const failure = Cause.findErrorOption(exit.cause)
	imdbSearchRegistry.set(imdbSearchStateAtom, {
		query,
		status: "error",
		results: [],
		errorMessage: Option.isSome(failure) ? parseErrorToMessage(failure.value) : Cause.pretty(exit.cause)
	})
}

export const AddFilmModal = () => {
	const sessionStore = useImportSessionStore()
	const [query, setQuery] = createSignal("")
	const searchState = useAtomValue(imdbSearchStateAtom)
	const selectedResultId = useAtomValue(selectedImdbResultIdAtom)

	onMount(() => {
		resetModalSearchState()
	})

	const onSearch = async (event: Event) => {
		event.preventDefault()
		await searchImdb(query())
	}

	const onSelectResult = (id: string) => {
		imdbSearchRegistry.set(selectedImdbResultIdAtom, id)
	}

	const onAddToRatings = () => {
		const selectedId = selectedResultId()
		if (!selectedId) {
			return
		}
		const selectedResult = searchState().results.find((result) => result.id === selectedId)
		if (!selectedResult) {
			return
		}
		sessionStore.addImdbFilmToRatings(selectedResult)
		resetModalSearchState()
		setQuery("")
	}

	return (
		<div class="bg-white dark:bg-gray-800 p-4 rounded-sm w-full max-w-3xl border border-gray-300 dark:border-gray-600">
			<h2 class="text-xl font-bold mb-4">Add a film</h2>
			<form class="flex gap-2 mb-3" onSubmit={onSearch}>
				<input
					type="text"
					value={query()}
					onInput={(event) => setQuery(event.currentTarget.value)}
					placeholder="Search IMDb title"
					class="flex-1 border border-gray-300 dark:border-gray-600 rounded-sm px-2 py-1"
				/>
				<button class="outlined-orange-button px-3 py-1" type="submit" disabled={searchState().status === "loading"}>
					{searchState().status === "loading" ? "Searching..." : "Search"}
				</button>
			</form>

			<Show when={searchState().status === "error"}>
				<p class="text-sm text-delete-red mb-2">{searchState().errorMessage ?? "Search failed."}</p>
			</Show>

			<Show when={searchState().status === "success" && searchState().results.length === 0}>
				<p class="text-sm secondary-text mb-2">No results found.</p>
			</Show>

			<Show when={searchState().results.length > 0}>
				<div class="overflow-x-auto">
					<div class="flex gap-2 pb-1">
						<For each={searchState().results}>
							{(result) => (
								<button
									type="button"
									onClick={() => onSelectResult(result.id)}
									class={`shrink-0 w-24 border rounded-sm ${
										selectedResultId() === result.id
											? "border-letterboxd-blue border-2"
											: "border-gray-300 dark:border-gray-600"
									}`}
									title={`${result.primaryTitle}${result.startYear ? ` (${result.startYear})` : ""}`}
								>
									<Show
										when={result.primaryImageUrl}
										fallback={
											<div class="h-36 flex items-center justify-center text-xs secondary-text p-1">No image</div>
										}
									>
										<img
											src={result.primaryImageUrl}
											alt={`${result.primaryTitle} poster`}
											class="w-full h-36 object-cover"
										/>
									</Show>
									<div class="text-xs px-1 py-1 text-left truncate">{result.primaryTitle}</div>
								</button>
							)}
						</For>
					</div>
				</div>
			</Show>

			<div class="mt-3 flex gap-2">
				<button
					type="button"
					class="green-button px-3 py-1"
					disabled={!selectedResultId()}
					onClick={onAddToRatings}
				>
					add to ratings
				</button>
				<button class="basic-button px-3 py-1" type="button" onClick={() => sessionStore.hideAddFilmModal()}>
					Close
				</button>
			</div>
		</div>
	)
}
