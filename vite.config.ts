/// <reference types="vitest/config" />
import tailwindcss from "@tailwindcss/vite"
import { defineConfig } from "vite"
import solidPlugin from "vite-plugin-solid"

export default defineConfig({
	plugins: [solidPlugin(), tailwindcss()],
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
