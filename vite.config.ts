import { defineConfig } from "vite";

const API_TARGET = process.env.MCPG_API_URL ?? "http://127.0.0.1:3000";

export default defineConfig({
	root: "web",
	build: {
		outDir: "../dist/web",
		emptyOutDir: true,
	},
	server: {
		port: 5173,
		strictPort: true,
		proxy: {
			"/api": API_TARGET,
			"/mcp": API_TARGET,
		},
	},
});
