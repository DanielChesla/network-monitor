# Network Health Monitor

A single-page network health dashboard backed by a tiny serverless proxy.

- **`index.html`** — dark-theme dashboard. Pings 10 services every 30s, shows a
  summary bar, per-service cards with sparklines, a multi-line latency history
  chart, and a countdown to the next ping.
- **`api/check.js`** — Vercel serverless function. Performs a real server-side
  HTTP request to a monitored service and returns `{ ok, status, ms }`.
  Restricted to an allowlist of the 10 monitored hosts (SSRF guard).

## Why a backend proxy?

Measuring latency from the browser with `mode: 'no-cors'` only yields opaque
responses and is easily skewed by CORS/CSP blocks and connection reuse. The
proxy does a genuine server-side request, so the status codes and timings are
real.

## Deploy (Vercel)

```bash
npx vercel login      # one-time, opens a browser
npx vercel --prod --yes
```

The root URL serves the dashboard; `/api/check?url=https://github.com` is the
proxy endpoint. The dashboard calls `/api/check` same-origin, so no CORS config
is required.

## Local dev

```bash
npx vercel dev
```
