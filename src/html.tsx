import React from "react"

interface HTMLProperties {
  htmlAttributes?: Record<string, unknown>
  bodyAttributes?: Record<string, unknown>
  headComponents?: React.ReactNode[]
  preBodyComponents?: React.ReactNode[]
  postBodyComponents?: React.ReactNode[]
  body: string
}

const withKeys = (components?: React.ReactNode[], prefix = "k") =>
  (components ?? []).map((child, index) =>
    React.isValidElement(child) && child.key == null
      ? // eslint-disable-next-line react/no-array-index-key
        React.cloneElement(child, { key: `${prefix}-${index}` })
      : child,
  )

export default function HTML(props: HTMLProperties) {
  return (
    // eslint-disable-next-line jsx-a11y/html-has-lang
    <html {...props.htmlAttributes}>
      <head>
        <meta charSet="utf-8" />
        <meta httpEquiv="x-ua-compatible" content="ie=edge" />
        <meta
          name="viewport"
          content="width=device-width, initial-scale=1, shrink-to-fit=no"
        />
        <meta
          name="theme-color"
          media="(prefers-color-scheme: light)"
          content="#ffffff"
        />
        <meta
          name="theme-color"
          media="(prefers-color-scheme: dark)"
          content="#1c1c1c"
        />
        {withKeys(props.headComponents, "head")}
      </head>
      <body {...props.bodyAttributes}>
        {withKeys(props.preBodyComponents, "pre")}
        <div
          key="body"
          id="___gatsby"
          dangerouslySetInnerHTML={{ __html: props.body }}
        />
        {withKeys(props.postBodyComponents, "post")}
      </body>
    </html>
  )
}
