// Serverless health-check proxy for the Network Health Monitor.
// Does a real server-side request to a monitored service and reports the
// HTTP status plus server-measured latency. Restricted to an allowlist of
// the monitored hosts so it can't be abused as an open proxy (SSRF guard).

const ALLOWED = new Set([
  "www.google.com",
  "github.com",
  "www.cloudflare.com",
  "en.wikipedia.org",
  "www.reddit.com",
  "stackoverflow.com",
  "registry.npmjs.org",
  "news.ycombinator.com",
  "duckduckgo.com",
  "www.mozilla.org"
]);

const TIMEOUT_MS = 8000;

export default async function handler(req, res) {
  // Permissive CORS so the dashboard also works if opened from another origin
  // (when served by this same project it's same-origin and CORS is moot).
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Cache-Control", "no-store");
  if (req.method === "OPTIONS") return res.status(204).end();

  const raw = req.query.url;
  if (!raw) return res.status(400).json({ error: "missing url param" });

  let target;
  try {
    target = new URL(raw);
  } catch {
    return res.status(400).json({ error: "invalid url" });
  }
  if (target.protocol !== "https:" && target.protocol !== "http:") {
    return res.status(400).json({ error: "unsupported protocol" });
  }
  if (!ALLOWED.has(target.hostname)) {
    return res.status(403).json({ error: "host not allowed" });
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  const t0 = Date.now();
  try {
    // GET (not HEAD) — some hosts reject HEAD. fetch resolves once headers
    // arrive, so this times to first response; we then discard the body.
    const r = await fetch(target.href, {
      method: "GET",
      redirect: "follow",
      signal: controller.signal,
      headers: { "User-Agent": "NetworkHealthMonitor/1.0 (+vercel)" }
    });
    const ms = Date.now() - t0;
    try { await r.body?.cancel(); } catch {}
    clearTimeout(timer);

    // "ok" = we got a real HTTP response and the server isn't erroring.
    // A 4xx (e.g. 403/405) still means the host is up and reachable.
    return res.status(200).json({ ok: r.status > 0 && r.status < 500, status: r.status, ms });
  } catch (e) {
    clearTimeout(timer);
    return res.status(200).json({
      ok: false,
      status: 0,
      ms: Date.now() - t0,
      error: e.name === "AbortError" ? "timeout" : String(e.message || e)
    });
  }
}
