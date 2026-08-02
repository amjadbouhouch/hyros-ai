import js from "@eslint/js";
import tseslint from "typescript-eslint";

/**
 * Shared ESLint flat config preset for the Hyros AI monorepo.
 * Consumers spread `...config` into their own eslint.config.js.
 */
export const config = [
    js.configs.recommended,
    ...tseslint.configs.recommended,
    {
        ignores: ["**/dist/**", "**/build/**", "**/.turbo/**", "**/node_modules/**", "**/src-tauri/target/**", "**/src-tauri/gen/**"],
    },
    {
        rules: {
            "@typescript-eslint/no-unused-vars": [
                "error",
                { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
            ],
        },
    },
];

export default config;