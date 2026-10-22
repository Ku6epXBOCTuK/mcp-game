import js from "@eslint/js";
import { defineConfig, globalIgnores } from "eslint/config";
import globals from "globals";
import tseslint from "typescript-eslint";
import prettier from "eslint-config-prettier";

export default defineConfig(
	globalIgnores(["dist/**", "node_modules/**", "data/**", "content/**"]),
	js.configs.recommended,
	tseslint.configs.recommended,
	{
		files: ["src/**/*.ts", "tests/**/*.ts", "*.js"],
		rules: {
			"@typescript-eslint/no-unused-vars": [
				"error",
				{ argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
			],
			"@typescript-eslint/consistent-type-imports": "error",
			"no-console": "off",
		},
	},
	{
		files: ["tests/**/*.ts"],
		rules: {
			"@typescript-eslint/no-explicit-any": "off",
		},
	},
	{
		files: ["web/**/*.js"],
		languageOptions: {
			globals: globals.browser,
		},
	},
	prettier,
);
