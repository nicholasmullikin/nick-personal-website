// Gatsby's development watcher can miss nested files after the verified Earth
// importer swaps its directory. Serve that one authoritative tree directly.
function createEarthDevelopMiddleware(root) {
  return (req, res, next) => {
    if (req.method !== "GET" && req.method !== "HEAD") return next()
    let name
    try { name = decodeURIComponent(req.path).replace(/^\/+/, "") } catch { return next() }
    if (!name) return next()
    res.sendFile(name, { root, dotfiles: "deny" }, error => {
      if (error && !res.headersSent) next()
    })
  }
}
module.exports = { createEarthDevelopMiddleware }
