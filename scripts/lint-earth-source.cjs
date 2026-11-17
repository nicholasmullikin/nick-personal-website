const fs = require("node:fs/promises"),
  path = require("node:path"),
  { ESLint } = require("eslint"),
  globals = require("globals"),
  { source, root } = require("./lib/earth-source.cjs")
async function main() {
  const eslint = new ESLint({
    cwd: root,
    overrideConfigFile: true,
    overrideConfig: [
      {
        files: ["**/*.js", "**/*.mjs"],
        languageOptions: {
          sourceType: "commonjs",
          ecmaVersion: "latest",
          globals: { ...globals.browser, ...globals.node },
        },
        rules: {
          ...require("@eslint/js").configs.recommended.rules,
          "no-unused-vars": [
            "error",
            {
              argsIgnorePattern: "^_",
              varsIgnorePattern: "^_",
              caughtErrorsIgnorePattern: "^_",
            },
          ],
        },
      },
      { files: ["**/*.mjs"], languageOptions: { sourceType: "module" } },
    ],
  })
  const files = (await fs.readdir(source))
    .filter(f => /\.(js|mjs)$/.test(f))
    .map(f => path.join(source, f))
  const results = await eslint.lintFiles(files)
  const formatter = await eslint.loadFormatter("stylish")
  process.stdout.write(formatter.format(results))
  if (results.some(r => r.errorCount)) process.exitCode = 1
}
main().catch(e => {
  console.error(e.message)
  process.exitCode = 1
})
