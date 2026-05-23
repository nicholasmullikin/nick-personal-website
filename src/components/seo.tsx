import React from "react"

import useSiteMetadata from "~/src/hooks/useSiteMetadata"

// Reference the default OG image as a static asset path so it stays a real
// HTTP URL (Twitter/Facebook can't fetch data: URIs). The file lives at
// /static/images/og-default.png and is copied verbatim to /images/ on build.
const defaultOpenGraphImage = "/images/og-default.png"

interface ArticleMeta {
  publishedTime?: string | null
  modifiedTime?: string | null
  section?: string | null
  tags?: ReadonlyArray<string> | null
}

interface SEOProperties {
  title?: string | null
  desc?: string | null
  image?: string | null
  pathname?: string
  noindex?: boolean
  article?: ArticleMeta
}

const joinUrl = (base: string, path: string) => {
  if (!path) return base
  if (/^https?:\/\//i.test(path)) return path
  // Webpack inlines small images as data URIs; never prefix those with siteUrl.
  if (path.startsWith("data:")) return path
  const cleanBase = base.replace(/\/$/, "")
  const cleanPath = path.startsWith("/") ? path : `/${path}`
  return cleanBase + cleanPath
}

const SEO: React.FC<SEOProperties> = ({
  title,
  desc,
  image,
  pathname,
  noindex = false,
  article,
}) => {
  const site = useSiteMetadata()

  const siteTitle = site.title ?? ""
  const siteUrl = (site.siteUrl ?? "").replace(/\/$/, "")
  const description = (desc || site.description) ?? ""
  const fullTitle = title ? `${title} | ${siteTitle}` : siteTitle
  const canonical = joinUrl(siteUrl, pathname ?? "/")
  const ogImage = joinUrl(siteUrl, image || defaultOpenGraphImage)
  const locale = site.locale ?? "en_US"
  const author = site.author ?? ""

  const isArticle = Boolean(article)

  const jsonLd: Record<string, unknown> = isArticle
    ? {
        "@context": "https://schema.org",
        "@type": "BlogPosting",
        mainEntityOfPage: { "@type": "WebPage", "@id": canonical },
        headline: title ?? siteTitle,
        description,
        image: [ogImage],
        url: canonical,
        datePublished: article?.publishedTime ?? undefined,
        dateModified:
          article?.modifiedTime ?? article?.publishedTime ?? undefined,
        author: {
          "@type": "Person",
          name: author,
          url: `${siteUrl}/about/`,
        },
        publisher: {
          "@type": "Person",
          name: author,
          url: siteUrl || undefined,
        },
        articleSection: article?.section ?? undefined,
        keywords:
          article?.tags && article.tags.length > 0
            ? article.tags.join(", ")
            : undefined,
        inLanguage: site.lang ?? "en",
      }
    : {
        "@context": "https://schema.org",
        "@type": "WebSite",
        url: `${siteUrl}/`,
        name: siteTitle,
        description: site.description ?? "",
        inLanguage: site.lang ?? "en",
        author: {
          "@type": "Person",
          name: author,
          url: `${siteUrl}/about/`,
        },
        potentialAction: {
          "@type": "SearchAction",
          target: `${siteUrl}/?q={search_term_string}`,
          "query-input": "required name=search_term_string",
        },
      }

  return (
    <>
      <title>{fullTitle}</title>
      <meta name="description" content={description} />
      <link rel="canonical" href={canonical} />

      {noindex ? (
        <meta name="robots" content="noindex,follow" />
      ) : (
        <meta name="robots" content="index,follow,max-image-preview:large" />
      )}

      <meta property="og:type" content={isArticle ? "article" : "website"} />
      <meta property="og:site_name" content={siteTitle} />
      <meta property="og:title" content={fullTitle} />
      <meta property="og:description" content={description} />
      <meta property="og:url" content={canonical} />
      <meta property="og:locale" content={locale} />
      <meta property="og:image" content={ogImage} />
      <meta property="og:image:alt" content={title ?? siteTitle} />

      {isArticle && article?.publishedTime ? (
        <meta
          property="article:published_time"
          content={article.publishedTime}
        />
      ) : null}
      {isArticle && (article?.modifiedTime || article?.publishedTime) ? (
        <meta
          property="article:modified_time"
          content={(article?.modifiedTime ?? article?.publishedTime) as string}
        />
      ) : null}
      {isArticle && article?.section ? (
        <meta property="article:section" content={article.section} />
      ) : null}
      {isArticle && author ? (
        <meta property="article:author" content={author} />
      ) : null}
      {isArticle && article?.tags
        ? article.tags.map(tag => (
            <meta key={`tag-${tag}`} property="article:tag" content={tag} />
          ))
        : null}

      <meta name="twitter:card" content="summary_large_image" />
      <meta name="twitter:title" content={fullTitle} />
      <meta name="twitter:description" content={description} />
      <meta name="twitter:image" content={ogImage} />
      <meta name="twitter:image:alt" content={title ?? siteTitle} />
      {author ? <meta name="twitter:creator" content={author} /> : null}

      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify(jsonLd, (_k, v) =>
            v === undefined ? undefined : v,
          ),
        }}
      />
    </>
  )
}

export default SEO
