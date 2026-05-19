const fs = require("fs")
const path = require("path")

const root = __dirname
const typegenConfig = path.join(root, ".cache/typegen/graphql.config.json")
const typegenSchema = path.join(root, ".cache/typegen/schema.graphql")
const typegenFragments = path.join(root, ".cache/typegen/fragments.graphql")
const vendoredSchema = path.join(root, "graphql/gatsby-schema.graphql")

function documentGlobs() {
  const documents = ["src/**/*.{ts,tsx,js,jsx}"]
  if (fs.existsSync(typegenFragments)) {
    documents.push(typegenFragments)
  }
  return documents
}

function pickSchemaPath() {
  if (fs.existsSync(typegenSchema)) {
    return typegenSchema
  }
  if (fs.existsSync(vendoredSchema)) {
    return vendoredSchema
  }
  return null
}

if (fs.existsSync(typegenConfig)) {
  module.exports = require(typegenConfig)
} else {
  const schema = pickSchemaPath()
  if (!schema) {
    throw new Error(
      "GraphQL ESLint: no schema found. Run `pnpm exec gatsby develop` once, or restore graphql/gatsby-schema.graphql.",
    )
  }
  module.exports = {
    schema,
    documents: documentGlobs(),
    extensions: {
      endpoints: {
        default: {
          url: "http://localhost:8000/___graphql",
        },
      },
    },
  }
}
