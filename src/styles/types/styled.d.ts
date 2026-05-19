import "styled-components"

import styledTheme from "~/src/styles/styledTheme"

declare module "styled-components" {
  export interface DefaultTheme {
    device: (typeof styledTheme)["device"]
  }
}
