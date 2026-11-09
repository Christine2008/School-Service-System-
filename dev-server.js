// Local development server: serves public/ and runs the api/ functions the same way Vercel does.
// Usage: create a .env file (see .env.example), then `npm install && npm run dev`.
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const envFile = path.join(root, ".env");
if (fs.existsSync(envFile)) {
  for (const line of fs.readFileSync(envFile, "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
}
const PORT = Number(process.env.PORT || 3000);
const TYPES = { ".html": "text/html; charset=utf-8", ".css": "text/css", ".js": "text/javascript", ".json": "application/json", ".svg": "image/svg+xml", ".png": "image/png", ".ico": "image/x-icon" };

http.createServer(async (req, res) => {
  const { pathname } = new URL(req.url, "http://localhost");
  if (pathname.startsWith("/api/")) {
    const file = path.join(root, pathname.replace(/\/$/, "") + ".js");
    if (!file.startsWith(path.join(root, "api")) || !fs.existsSync(file)) { res.statusCode = 404; return res.end('{"error":"Not found"}'); }
    const mod = await import(pathToFileURL(file).href);
    return mod.default(req, res);
  }
  let file = path.join(root, "public", pathname === "/" ? "index.html" : decodeURIComponent(pathname));
  if (!file.startsWith(path.join(root, "public")) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.statusCode = 404; return res.end("Not found"); }
  res.setHeader("Content-Type", TYPES[path.extname(file)] || "application/octet-stream");
  fs.createReadStream(file).pipe(res);
}).listen(PORT, () => console.log(`School Services Queue System running at http://localhost:${PORT}`));
