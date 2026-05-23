/**
 * @typedef {Object} Links
 * @prop {string} github Your github repository
 */

/**
 * @typedef {Object} MetaConfig
 * @prop {string} title Site title (used in <title> suffix, og:site_name, manifest name)
 * @prop {string} description Default site description (used as fallback meta description, og:description, manifest description)
 * @prop {string} author Used for twitter:creator and JSON-LD author
 * @prop {string} siteUrl Canonical origin (no trailing slash)
 * @prop {string} lang ISO language tag for <html lang> and og:locale
 * @prop {string} locale BCP-47 locale for og:locale (e.g. en_US)
 * @prop {string} utterances Github repository to store comments
 * @prop {Links} links
 * @prop {string} favicon Favicon Path
 */

/** @type {MetaConfig} */
const metaConfig = {
  title: "Nick's Page",
  description:
    "Notes from Nick Mullikin on building things — Linux desktop fixes, reverse engineering, on-device ML, maps, and side projects.",
  author: "Nick Mullikin",
  siteUrl: "https://nicholasmullikin.com",
  lang: "en",
  locale: "en_US",
  utterances: "nicholasmullikin/website-comments",
  links: {
    github: "https://github.com/nicholasmullikin/gatsby-starter-apple",
  },
  favicon: "src/images/icon.png",
}

// eslint-disable-next-line no-undef
module.exports = metaConfig
