// Serve a staged renderer while proxying the Gatsby site. Binds localhost only.
const http = require("node:http"),
  fs = require("node:fs/promises"),
  path = require("node:path")
function createPreview({
  assets,
  port = 8012,
  backend = "http://127.0.0.1:8011",
}) {
  const root = path.resolve(assets),
    upstream = new URL(backend)
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, "http://localhost")
    if (url.pathname.startsWith("/harp/")) {
      const file = path.resolve(
        root,
        "." + decodeURIComponent(url.pathname.slice(5)),
      )
      if (!file.startsWith(root + path.sep)) {
        res.writeHead(403).end()
        return
      }
      try {
        const body = await fs.readFile(file)
        res.writeHead(200, {
          "Content-Type":
            {
              ".html": "text/html",
              ".js": "application/javascript",
              ".map": "application/json",
              ".json": "application/json",
              ".png": "image/png",
              ".jpg": "image/jpeg",
            }[path.extname(file)] || "application/octet-stream",
          "Cache-Control": "no-store",
        })
        res.end(body)
      } catch {
        res.writeHead(404).end()
      }
    } else {
      const proxy = http.request(
        {
          hostname: upstream.hostname,
          port: upstream.port,
          path: req.url,
          method: req.method,
          headers: req.headers,
        },
        response => {
          res.writeHead(response.statusCode, response.headers)
          response.pipe(res)
        },
      )
      proxy.on("error", () =>
        res.writeHead(502).end("Preview backend unavailable"),
      )
      req.pipe(proxy)
    }
  })
  return new Promise(resolve =>
    server.listen(port, "127.0.0.1", () => resolve(server)),
  )
}
module.exports = { createPreview }
if (require.main === module)
  createPreview({
    assets: process.argv[2] || "static/harp",
    port: Number(process.env.PORT || 8012),
  }).then(s => console.log("Staged preview on", s.address().port))
