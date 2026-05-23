import React from "react"

import styled, { StyleSheetManager, ThemeProvider } from "styled-components"

import NavBar from "~/src/components/navBar/navBar"
import useSiteMetadata from "~/src/hooks/useSiteMetadata"
import useTheme from "~/src/hooks/useTheme"
import ThemeContext from "~/src/stores/themeContext"
import GlobalStyle from "~/src/styles/globalStyle"
import styledTheme from "~/src/styles/styledTheme"
import isPropValid from "@emotion/is-prop-valid"

import packageJSON from "../../package.json"

const { name, homepage } = packageJSON

const Layout: React.FC<React.PropsWithChildren> = ({ children }) => {
  const { theme, themeToggler } = useTheme()
  const { title, author } = useSiteMetadata()
  const copyrightString = `Copyright © ${author}. Built with `

  return (
    <StyleSheetManager shouldForwardProp={isPropValid}>
      <ThemeProvider theme={styledTheme}>
        <ThemeContext.Provider value={theme}>
          <GlobalStyle />
          <Container>
            <NavBar title={title} themeToggler={themeToggler} />
            {children}
          </Container>
          <Footer role="contentinfo">
            <Copyright aria-label="Copyright">
              {copyrightString}
              <RepoLink href={homepage} target="__blank">
                {name}
              </RepoLink>
            </Copyright>
          </Footer>
        </ThemeContext.Provider>
      </ThemeProvider>
    </StyleSheetManager>
  )
}

const Container = styled.div`
  width: 100%;
  height: 100%;
  min-height: calc(100vh - var(--footer-height));
  background-color: var(--color-post-background);
`

const Footer = styled.footer`
  display: flex;
  text-align: center;
  justify-content: center;
  align-items: center;
  height: var(--footer-height);
  background-color: var(--color-gray-1);
`

const Copyright = styled.span`
  font-size: var(--text-sm);
  font-weight: var(--font-weight-regular);
  color: var(--color-gray-6);
`

const RepoLink = styled.a`
  color: var(--color-blue);
  text-decoration: underline;
  text-underline-offset: 0.15em;
  text-decoration-thickness: from-font;
  &:hover {
    text-decoration-thickness: 0.1em;
  }
`

export default Layout
