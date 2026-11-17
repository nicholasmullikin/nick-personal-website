// Explicit map workflows; never refresh served assets as a side effect of testing.
const path = require("node:path"),
  { spawnSync } = require("node:child_process"),
  { root: sourceRoot } = require("./lib/earth-source.cjs")
const root = path.resolve(__dirname, ".."),
  bin = name => path.join(root, "node_modules/.bin", name)
const workflows = {
  build: [
    [process.execPath, [path.join(sourceRoot, "scripts/build-earth.cjs")]],
  ],
  typecheck: [
    [bin("tsc"), ["--noEmit"]],
    [
      path.join(sourceRoot, "node_modules/.bin/tsc"),
      ["--project", "@xyzmaps/harp-examples/tsconfig.earth.json", "--noEmit"],
      sourceRoot,
    ],
  ],
  lint: [
    [
      bin("eslint"),
      [
        "src/components/map.tsx",
        "src/components/map3.tsx",
        "src/components/map4.tsx",
        "src/components/map5.tsx",
        "src/components/mapGraphics.tsx",
        "src/components/mapsBlock.tsx",
        "scripts/check-earth*.cjs",
        "scripts/check-map*.cjs",
        "scripts/test-earth*.cjs",
        "scripts/test-harp-continuity.cjs",
        "scripts/lib/*.cjs",
        "scripts/maps.cjs",
        "scripts/import-earth.cjs",
        "scripts/lint-earth-source.cjs",
        "scripts/serve-earth-preview.cjs",
      ],
    ],
    [process.execPath, ["scripts/lint-earth-source.cjs"]],
  ],
  unit: [
    [
      process.execPath,
      [
        "--test",
        "scripts/test-earth-buildings.cjs",
        "scripts/test-earth-clouds.cjs",
        "scripts/test-earth-runtime.cjs",
        "scripts/test-earth-lifecycle.cjs",
        "scripts/test-earth-import.cjs",
        "scripts/test-harp-continuity.cjs",
      ],
    ],
  ],
  browser: [
    "check-earth-dynamics",
    "check-earth-imagery-cache",
    "check-earth-clouds",
    "check-map-continuity",
    "check-earth-layers",
    "check-earth-lifecycle",
    "check-map-graphics",
  ].map(name => [process.execPath, ["scripts/" + name + ".cjs"]]),
  format: [
    [
      bin("prettier"),
      [
        "--check",
        "src/components/map*.tsx",
        "scripts/check-earth*.cjs",
        "scripts/check-map*.cjs",
        "scripts/test-earth*.cjs",
        "scripts/test-harp-continuity.cjs",
        "scripts/lib/*.cjs",
        "scripts/maps.cjs",
        "scripts/import-earth.cjs",
        "scripts/lint-earth-source.cjs",
        "scripts/serve-earth-preview.cjs",
      ],
    ],
    [
      path.join(sourceRoot, "node_modules/.bin/prettier"),
      [
        "--check",
        "@xyzmaps/harp-examples/src/earth/*.{js,ts,mjs}",
        "scripts/build-earth.cjs",
      ],
      sourceRoot,
    ],
  ],
}
const workflow = workflows[process.argv[2]]
if (!workflow) {
  console.error("Choose maps workflow:", Object.keys(workflows).join(", "))
  process.exitCode = 1
} else
  for (const [command, args, cwd = root] of workflow) {
    const result = spawnSync(command, args, {
      cwd,
      stdio: "inherit",
      env: process.env,
    })
    if (result.error) {
      console.error(result.error.message)
      process.exitCode = 1
      break
    }
    if (result.status !== 0) {
      process.exitCode = result.status || 1
      break
    }
  }
