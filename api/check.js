// Serverless health-check proxy for the Network Health Monitor.
// Does a real server-side request to a monitored service and reports the
// HTTP status, server-measured latency, and TLS certificate expiry.
// Restricted to an allowlist of the monitored hosts (SSRF guard).
import tls from "tls";

const ALLOWED = new Set([
  "www.titletap.com",
  "app.titletap.com",
  "api.titletap.com",
  "app.clearviewsocial.com",
  "beta.clearviewsocial.com"
]);

const TIMEOUT_MS = 8000;

// Open a TLS connection and read the peer certificate's expiry. Returns
// { validTo: ISO, daysLeft } or null if it can't be retrieved.
function getCert(hostname) {
  return new Promise((resolve) => {
    let done = false;
    const finish = (v) => { if (!done) { done = true; resolve(v); } };
    try {
      const socket = tls.connect(
        { host: hostname, port: 443, servername: hostname, timeout: 6000 },
        () => {
          const c = socket.getPeerCertificate();
          socket.end();
          if (!c || !c.valid_to) return finish(null);
          const validTo = new Date(c.valid_to);
          if (isNaN(validTo.getTime())) return finish(null);
          finish({ validTo: validTo.toISOString(), daysLeft: Math.round((validTo.getTime() - Date.now()) / 86400000) });
        }
      );
      socket.on("error", () => finish(null));
      socket.on("timeout", () => { socket.destroy(); finish(null); });
    } catch { finish(null); }
  });
}

export default async function handler(req, res) {
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

  // Cert check runs in parallel with the HTTP check so it doesn't inflate latency.
  const certPromise = target.protocol === "https:" ? getCert(target.hostname) : Promise.resolve(null);

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
    const cert = await certPromise;
    // "ok" = we got a real HTTP response and the server isn't erroring.
    return res.status(200).json({ ok: r.status > 0 && r.status < 500, status: r.status, ms, cert });
  } catch (e) {
    clearTimeout(timer);
    const ms = Date.now() - t0;
    const cert = await certPromise; // cert may still resolve even if HTTP failed
    return res.status(200).json({
      ok: false,
      status: 0,
      ms,
      error: e.name === "AbortError" ? "timeout" : String(e.message || e),
      cert
    });
  }
}
