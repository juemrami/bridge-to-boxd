/// <reference types="vitest/config" />
import tailwindcss from "@tailwindcss/vite"
import path from "path"
import { defineConfig } from "vite"
import solidPlugin from "vite-plugin-solid"

export default defineConfig({
	plugins: [solidPlugin(), tailwindcss()],
	resolve: {
		alias: {
			"@src": path.resolve(__dirname, "./src")
		}
	},
	server: {
		port: 3000,
		watch: { ignored: ["**/.jj/**"] }
	},
	build: {
		target: "esnext"
	},
	test: {
		include: ["./tests/**/*.test.ts"]
	}
})
