import solidJs from "@astrojs/solid-js"
import tailwindcss from "@tailwindcss/vite"
import { defineConfig } from "astro/config"
import { fileURLToPath, URL } from "node:url"
// https://astro.build/config
export default defineConfig({
	integrations: [solidJs()],
	server: {
		port: 3000
	},
	vite: {
		plugins: [tailwindcss()],
		resolve: {
			alias: {
				"@src": fileURLToPath(new URL("./src", import.meta.url))
			}
		},
		server: {
			watch: { ignored: ["**/.jj/**"] }
		},
		build: {
			target: "esnext"
		}
	},
	test: {
		include: ["./tests/**/*.test.ts"]
	}
})
