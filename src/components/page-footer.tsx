import type { Component } from "solid-js"

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
		<footer class="my-6 text-sm text-center secondary-text">
			<p>
				Developed by <a href={links.personal.href} class="underline">{links.personal.label}</a>. Source code on{" "}
				<a href={links.repo.href} class="underline">{links.repo.label}</a>.
			</p>
		</footer>
	)
}

export default PageFooter
