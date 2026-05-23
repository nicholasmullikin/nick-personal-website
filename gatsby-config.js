const ReactDOM = require("react-dom")
const meta = require("./gatsby-meta-config")

const siteMetadata = {
  title: meta.title,
  description: meta.description,
  author: meta.author,
  siteUrl: meta.siteUrl,
  lang: meta.lang,
  locale: meta.locale,
  utterances: {
    repo: meta.utterances,
  },
  postTitle: "All",
  menuLinks: [
    {
      link: "/",
      name: "Home",
    },
    {
      link: "/about/",
      name: "About",
    },
    {
      link: meta.links.github,
      name: "Github",
    },
  ],
}

const corePlugins = [
  {
    resolve: "gatsby-source-filesystem",
    options: {
      name: "src",
      path: `${__dirname}/src`,
      ignore: [`**/*.d.ts`],
    },
  },
  {
    resolve: "gatsby-source-filesystem",
    options: {
      name: "images",
      path: `${__dirname}/src/images`,
    },
  },
]

const devPlugins = [
  {
    resolve: "gatsby-plugin-alias-imports",
    options: {
      alias: {
        "~": ".",
      },
      extensions: ["js", "ts", "tsx"],
    },
  },
  {
    resolve: "gatsby-plugin-typography",
    options: {
      pathToConfigModule: "src/styles/typography",
    },
  },
  "gatsby-plugin-typescript",
  "gatsby-plugin-styled-components",
]

const imagePlugins = [
  "gatsby-plugin-image",
  "gatsby-plugin-sharp",
  "gatsby-transformer-sharp",
]

const markdownPlugins = [
  {
    resolve: "gatsby-transformer-remark",
    options: {
      plugins: [
        "gatsby-remark-copy-linked-files",
        {
          resolve: "gatsby-remark-vscode",
          options: {
            theme: {
              default: "Github Light Theme",
              parentSelector: {
                "body[data-theme=dark]": "Dark Github",
              },
            },
            extensions: ["vscode-theme-github-light", "dark-github-theme"],
          },
        },
        {
          resolve: "gatsby-remark-images",
          options: {
            linkImagesToOriginal: false,
          },
        },
      ],
    },
  },
]

const searchPlugins = [
  {
    resolve: "gatsby-plugin-sitemap",
    options: {
      query: `
        {
          site {
            siteMetadata {
              siteUrl
            }
          }
          allSitePage {
            nodes {
              path
            }
          }
          allMarkdownRemark(
            filter: { fileAbsolutePath: { regex: "/(posts/blog)/" } }
          ) {
            nodes {
              fields {
                slug
              }
              frontmatter {
                date
              }
            }
          }
        }
      `,
      resolveSiteUrl: ({ site }) => site.siteMetadata.siteUrl,
      resolvePages: ({
        allSitePage: { nodes: pages },
        allMarkdownRemark: { nodes: posts },
      }) => {
        const postDates = new Map(
          posts.map(p => [p.fields.slug, p.frontmatter.date]),
        )
        return pages.map(page => {
          const lastmod = postDates.get(page.path)
          return {
            path: page.path,
            lastmod: lastmod || undefined,
          }
        })
      },
      serialize: ({ path, lastmod }) => {
        // Tiered priority: homepage > posts > category pages > everything else.
        let priority = 0.5
        let changefreq = "monthly"
        if (path === "/") {
          priority = 1
          changefreq = "weekly"
        } else if (path.startsWith("/blog/")) {
          priority = 0.8
          changefreq = "monthly"
        } else if (path.startsWith("/category/")) {
          priority = 0.5
          changefreq = "weekly"
        } else if (path === "/about/") {
          priority = 0.6
          changefreq = "yearly"
        }
        return {
          url: path,
          changefreq,
          priority,
          ...(lastmod ? { lastmod } : {}),
        }
      },
    },
  },
  {
    resolve: "gatsby-plugin-robots-txt",
    options: {
      host: meta.siteUrl,
      sitemap: `${meta.siteUrl}/sitemap-index.xml`,
      policy: [{ userAgent: "*", allow: "/" }],
    },
  },
  {
    resolve: `gatsby-plugin-feed`,
    options: {
      query: `
        {
          site {
            siteMetadata {
              title
              description
              siteUrl
              site_url: siteUrl
            }
          }
        }
      `,
      feeds: [
        {
          serialize: ({ query: { site, allMarkdownRemark } }) => {
            return allMarkdownRemark.edges.map(edge => {
              return Object.assign({}, edge.node.frontmatter, {
                description: edge.node.excerpt,
                date: edge.node.frontmatter.date,
                url: site.siteMetadata.siteUrl + edge.node.fields.slug,
                guid: site.siteMetadata.siteUrl + edge.node.fields.slug,
                custom_elements: [{ "content:encoded": edge.node.html }],
              })
            })
          },
          query: `
            {
              allMarkdownRemark(
                filter: { fileAbsolutePath: { regex: "/(posts/blog)/" } }
                sort: { frontmatter: { date: DESC } }
              ) {
                edges {
                  node {
                    excerpt
                    html
                    fields { slug }
                    frontmatter {
                      title
                      date
                    }
                  }
                }
              }
            }
          `,
          output: "/rss.xml",
          title: `${meta.title}'s RSS Feed`,
        },
      ],
    },
  },
]

const pwaPlugins = [
  {
    resolve: "gatsby-plugin-manifest",
    options: {
      name: meta.title,
      short_name: meta.title,
      description: meta.description,
      lang: meta.lang,
      start_url: "/",
      background_color: "#ffffff",
      theme_color: "#ffffff",
      display: "standalone",
      icon: meta.favicon,
      icon_options: {
        purpose: "any maskable",
      },
    },
  },
  "gatsby-plugin-offline",
]

exports.replaceHydrateFunction = () => {
  return (element, container) => {
    const root = ReactDOM.createRoot(container)
    root.render(element)
  }
}

module.exports = {
  graphqlTypegen: true,
  jsxRuntime: "automatic",
  siteMetadata,
  flags: {
    DEV_SSR: true,
  },
  plugins: [
    ...corePlugins,
    ...devPlugins,
    ...imagePlugins,
    ...markdownPlugins,
    ...searchPlugins,
    ...pwaPlugins,
    `gatsby-plugin-pnpm-gatsby-5`,
  ],
}
