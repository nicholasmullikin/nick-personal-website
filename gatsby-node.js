const path = require(`path`)
const _ = require("lodash")
const { createFilePath } = require(`gatsby-source-filesystem`)

exports.createSchemaCustomization = ({ actions }) => {
  const { createTypes } = actions
  // Declare optional frontmatter fields so they're queryable even before any
  // post uses them. dateModified is consumed by the SEO component / JSON-LD;
  // tags is consumed by article:tag meta and structured-data keywords.
  createTypes(`
    type MarkdownRemark implements Node {
      frontmatter: MarkdownRemarkFrontmatter
    }
    type MarkdownRemarkFrontmatter {
      title: String
      desc: String
      date: Date @dateformat
      dateModified: Date @dateformat
      category: String
      tags: [String]
      alt: String
    }
  `)
}

exports.onCreateNode = ({ node, getNode, actions }) => {
  const { createNodeField } = actions
  if (node.internal.type === `MarkdownRemark`) {
    const slug = createFilePath({ node, getNode, basePath: `posts` })
    createNodeField({
      node,
      name: `slug`,
      value: slug,
    })
  }
}

exports.createPages = async ({ graphql, actions }) => {
  const { createPage } = actions

  const mainTemplate = path.resolve(`./src/pages/index.tsx`)
  const blogPostTemplate = path.resolve(`./src/templates/blogPost.tsx`)

  const result = await graphql(`
    {
      postsRemark: allMarkdownRemark(
        filter: { fileAbsolutePath: { regex: "/(posts/blog)/" } }
        sort: { frontmatter: { date: DESC } }
        limit: 2000
      ) {
        edges {
          node {
            fields {
              slug
            }
          }
        }
      }
      categoriesGroup: allMarkdownRemark(limit: 2000) {
        group(field: { frontmatter: { category: SELECT } }) {
          fieldValue
          totalCount
        }
      }
    }
  `)

  const posts = result.data.postsRemark.edges

  posts.forEach(({ node }) => {
    createPage({
      path: node.fields.slug,
      component: blogPostTemplate,
      context: {
        slug: node.fields.slug,
      },
    })
  })

  const categories = result.data.categoriesGroup.group

  categories.forEach(category => {
    createPage({
      path: `/category/${_.kebabCase(category.fieldValue)}/`,
      component: mainTemplate,
      context: {
        category: category.fieldValue,
      },
    })
  })
}

exports.onCreateWebpackConfig = ({ stage, loaders, actions, getConfig }) => {
  if (stage === "build-html" || stage === "develop-html") {
    actions.setWebpackConfig({
      module: {
        rules: [
          {
            test: /lil-gui/,
            use: loaders.null(),
          },
        ],
      },
    })
  }
  if (stage === "build-javascript") {
    const config = getConfig()
    const shared = config.optimization.splitChunks.cacheGroups.shared
    // These two tiny components are shared by the full-screen iframe and the
    // article demos. Duplicating them avoids pulling the demo's Three and OL
    // vendor chunk into the full-screen page before it is needed.
    shared.test = (module, { chunkGraph }) => {
      if (/[\\/]src[\\/]components[\\/](?:map5|mapGraphics)\.tsx$/.test(module.resource || ""))
        return false
      for (const chunk of chunkGraph.getModuleChunksIterable(module))
        if (chunk.canBeInitial()) return false
      return module.type !== "css/mini-extract"
    }
    const terser = config.optimization.minimizer.find(
      plugin => plugin.constructor.name === "TerserPlugin",
    )
    if (terser) {
      // Gatsby's Terser version can remove OpenLayers imports that are used
      // by class inheritance. Keep that optimization for the rest of the site
      // and disable it only in this lazy vendor chunk.
      const TerserPlugin = require("node:module").createRequire(
        require.resolve("gatsby"),
      )("terser-webpack-plugin")
      const olChunk = /earth-demo-ol.*\.js$/
      terser.options.exclude = [terser.options.exclude, olChunk].filter(Boolean)
      config.optimization.minimizer.push(
        new TerserPlugin({
          test: olChunk,
          parallel: terser.options.parallel,
          terserOptions: {
            ...terser.options.minimizer.options,
            compress: { ...terser.options.minimizer.options.compress, unused: false },
          },
        }),
      )
      config.optimization.splitChunks.cacheGroups.earthDemoOl = {
        test: /[\\/]node_modules[\\/]ol[\\/]/,
        name: "earth-demo-ol",
        chunks: "all",
        priority: 40,
        enforce: true,
      }
    }
    actions.replaceWebpackConfig(config)
  }
}
