import React from "react"

import useSiteMetadata from "~/src/hooks/useSiteMetadata"

import defaultOpenGraphImage from "../images/og-default.png"

interface SEOProperties extends Pick<
  Queries.MarkdownRemarkFrontmatter,
  "title"
> {
  desc?: Queries.Maybe<string>
  image?: Queries.Maybe<string>
}

const SEO: React.FC<SEOProperties> = ({ title, desc = "", image }) => {
  const site = useSiteMetadata()
  const description = desc || site.description || ""
  const fullTitle = title ? `${title} | ${site.title}` : (site.title ?? "")
  const ogImageUrl =
    (site.siteUrl ?? "") + (image || (defaultOpenGraphImage as string))

  return (
    <>
      <title>{fullTitle}</title>
      <meta name="description" content={description} />
      <meta property="og:title" content={title ?? ""} />
      <meta property="og:description" content={description} />
      <meta property="og:type" content="website" />
      <meta name="twitter:card" content="summary" />
      <meta name="twitter:creator" content={site.author ?? ""} />
      <meta name="twitter:title" content={title ?? ""} />
      <meta name="twitter:description" content={description} />
      <meta property="image" content={ogImageUrl} />
      <meta property="og:image" content={ogImageUrl} />
      <meta property="twitter:image" content={ogImageUrl} />
    </>
  )
}

export default SEO
