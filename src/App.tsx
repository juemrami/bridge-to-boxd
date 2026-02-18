import { type Component, createSignal, onCleanup, onMount } from "solid-js"

const App: Component = () => {
	// Format datetime for display
	const formatDateTime = (date: Date): string => {
		const options: Intl.DateTimeFormatOptions = {
			weekday: "short",
			year: "numeric",
			month: "short",
			day: "numeric",
			hour: "2-digit",
			minute: "2-digit"
		}
		return date.toLocaleString("en-US", options)
	}
	const [currentDateTime, setCurrentDateTime] = createSignal(new Date())
	onMount(() => {
		// Update time every minute
		const timeIntervalId = setInterval(() => {
			setCurrentDateTime(new Date())
		}, 30000) // 60000ms = 1 minute
		onCleanup(() => clearInterval(timeIntervalId))
	})
	return (
		<>
			<div class="flex flex-col py-10 items-center">
				<p class="text-4xl text-green-700 text-center">Hello procrastinator!</p>
				{/* Current Date and Time Display */}
				<p class="text-lg font-medium text-gray-500">{formatDateTime(currentDateTime())}</p>
			</div>
		</>
	)
}

export default App
