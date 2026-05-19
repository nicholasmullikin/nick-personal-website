import eslint from "@eslint/js"
import graphqlPlugin from "@graphql-eslint/eslint-plugin"
import eslintConfigPrettier from "eslint-config-prettier/flat"
import importPlugin from "eslint-plugin-import"
import jsxA11yPlugin from "eslint-plugin-jsx-a11y"
import reactPlugin from "eslint-plugin-react"
import reactHooks from "eslint-plugin-react-hooks"
import eslintPluginUnicorn from "eslint-plugin-unicorn"
import globals from "globals"
import path from "node:path"
import { fileURLToPath } from "node:url"
import tseslint from "typescript-eslint"

const __dirname = path.dirname(fileURLToPath(import.meta.url))

export default tseslint.config(
  {
    ignores: [
      "**/node_modules/**",
      "**/public/**",
      "**/.cache/**",
      "**/coverage/**",
      "pnpm-lock.yaml",
      "src/components/map2.tsx",
      "src/components/map3.tsx",
      "src/components/map4.tsx",
      "**/gatsby-types.d.ts",
      "gatsby-config.js",
      "gatsby-node.js",
      "gatsby-browser.js",
      "gatsby-ssr.js",
      "gatsby-meta-config.js",
    ],
  },
  {
    files: ["**/*.{ts,tsx}"],
    processor: graphqlPlugin.processor,
    extends: [
      eslint.configs.recommended,
      ...tseslint.configs.recommended,
      reactPlugin.configs.flat["jsx-runtime"],
      importPlugin.flatConfigs.recommended,
      importPlugin.flatConfigs.typescript,
      jsxA11yPlugin.flatConfigs.recommended,
      reactHooks.configs.flat.recommended,
      eslintPluginUnicorn.configs.recommended,
    ],
    languageOptions: {
      parserOptions: {
        project: "./tsconfig.json",
        tsconfigRootDir: __dirname,
      },
      globals: globals.browser,
    },
    settings: {
      react: { version: "detect" },
      "import/resolver": {
        typescript: { project: "./tsconfig.json" },
        node: true,
      },
    },
    rules: {
      "unicorn/filename-case": "off",
      "unicorn/prevent-abbreviations": "off",
      "unicorn/no-abusive-eslint-disable": "off",
      "unicorn/no-null": "off",
      "unicorn/no-array-sort": "off",
      "unicorn/prefer-global-this": "off",
      "react-hooks/refs": "off",
      "react-hooks/set-state-in-effect": "off",
      "unicorn/no-array-callback-reference": "off",
      "no-var": "off",
      "no-useless-escape": "off",
      "import/no-named-as-default": "off",
      "@typescript-eslint/no-unused-expressions": [
        "error",
        { allowShortCircuit: true, allowTernary: true },
      ],
      "@typescript-eslint/no-unused-vars": [
        "error",
        {
          argsIgnorePattern: "^_",
          caughtErrorsIgnorePattern: "^_",
          varsIgnorePattern: "^_|^React$",
        },
      ],
      "@typescript-eslint/consistent-type-imports": "off",
      "@typescript-eslint/consistent-type-exports": "off",
      "import/order": "off",
      "sort-imports": "off",
      "import/no-duplicates": "off",
      "max-classes-per-file": "off",
      "react/jsx-props-no-spreading": "off",
      "react/no-array-index-key": "warn",
      "react-hooks/rules-of-hooks": "error",
      "react-hooks/exhaustive-deps": "warn",
      "@typescript-eslint/naming-convention": "off",
      "@typescript-eslint/no-unsafe-assignment": "off",
      "@typescript-eslint/no-non-null-assertion": "off",
      "@typescript-eslint/restrict-template-expressions": "off",
      "@typescript-eslint/explicit-module-boundary-types": "off",
      "@typescript-eslint/no-non-null-asserted-optional-chain": "off",
    },
  },
  {
    files: ["**/*.graphql"],
    languageOptions: {
      parser: graphqlPlugin.parser,
    },
    plugins: {
      "@graphql-eslint": graphqlPlugin,
    },
    rules: {
      "@graphql-eslint/no-anonymous-operations": "error",
      "@graphql-eslint/naming-convention": [
        "error",
        {
          OperationDefinition: {
            style: "PascalCase",
            forbiddenPrefixes: ["Query", "Mutation", "Subscription", "Get"],
            forbiddenSuffixes: ["Query", "Mutation", "Subscription"],
          },
        },
      ],
    },
  },
  eslintConfigPrettier,
)
