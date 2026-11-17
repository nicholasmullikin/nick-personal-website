const path = require("node:path"),
  { createRequire } = require("node:module")
const root = path.resolve(
  process.env.HARP_SOURCE_ROOT || path.join(__dirname, "../../../xyz-threejs"),
)
const source = path.join(root, "@xyzmaps/harp-examples/src/earth")
const sourceRequire = createRequire(
  path.join(root, "@xyzmaps/harp-examples/package.json"),
)
module.exports = {
  root,
  source,
  sourceRequire,
  load: name => require(path.join(source, name)),
}
