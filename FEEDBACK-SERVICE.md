# Feedback service boundary

This branch now contains the service boundary needed for the public companion to collect player feedback and show it in the owner's private Companion inbox. The feedback origin is separate from the GitHub Pages projection. The local save-reading Companion is the only browser-facing owner client; the multi-user phone relay never exposes this inbox.

## What is implemented

`cloud/feedback-server.mjs` provides:

- `POST /v1/feedback` for the public site.
- `GET /v1/owner/feedback` for the private owner inbox.
- `POST /v1/owner/feedback/:id/read` to clear a notification.
- `GET /healthz` for the hosting provider.

The service accepts plain text feedback only. A submission contains a category (`bug`, `idea`, `data`, `ui`, or `other`), a message, and optional page, build, or reply email fields. Screenshot fields, saves, account identifiers, arbitrary JSON, and file uploads are rejected at the boundary. A user can still paste sensitive text into the allowed message field, so the public form must warn users not to include saves, account IDs, or personal photos and the owner must redact or delete anything submitted accidentally.

Feedback is stored in SQLite with a server-created ID and server timestamp. The source identity used by the in-memory limiter is hashed and is not persisted. The owner API returns the message, category, page, build, optional reply email, status, and read time.

## Security and abuse controls

- Public writes require the exact configured public-site `Origin`.
- The body is JSON and capped at 16 KiB.
- Messages are capped at 4,000 characters; optional fields have smaller limits.
- A per-source in-memory limiter allows one submission per minute and five per hour by default. A single service instance is required until a shared limiter is designed. The default identity is the socket peer address. Behind a reverse proxy, deployment must explicitly set a provider-verified `trustProxy` identity (or supply an equivalent trusted adapter); blindly trusting forwarded headers is not acceptable.
- Owner reads require a bearer token of at least 32 characters. The token is compared in constant time and is never rendered into public assets.
- Owner responses do not include source hashes or socket addresses.
- No screenshot or raw player-data upload path exists.

## Configuration

The standalone service expects:

```text
FEEDBACK_PUBLIC_ORIGIN=https://infotradescout.github.io
FEEDBACK_OWNER_TOKEN=<random secret, stored only by the operator>
FEEDBACK_OWNER_ORIGIN=<optional exact browser origin for owner requests>
FEEDBACK_DB_PATH=/var/data/feedback.sqlite
PORT=<provider port>
```

When the owner inbox is a different browser origin, set `FEEDBACK_OWNER_ORIGIN` and use the authenticated owner CORS preflight. The service allows only that exact origin and the `Authorization` header. If it is not set, owner reads are intended for a same-origin or server-side caller. In the Companion, configure `COMPANION_FEEDBACK_URL`, `COMPANION_FEEDBACK_OWNER_TOKEN`, and (when the service has an owner-origin allowlist) `COMPANION_FEEDBACK_OWNER_ORIGIN`; the local server keeps the bearer token out of browser code and proxies only the owner's inbox. Do not place those values in the public build or phone relay.

`FEEDBACK_PUBLIC_ORIGIN` is an origin, not the `/cotw-field-companion/` path. The public build accepts an optional `COTW_FEEDBACK_ENDPOINT` build variable, also as an origin. Until that URL and owner authentication are configured, the public Pages build links to the repository's public Field note issue form. The local Companion reads those bounded `feedback` issues through the GitHub API as a read-only fallback; “Mark seen” is local to that browser and does not close or mutate an issue.

## Proof and remaining release gate

The durable store, validation, origin checks, owner authorization, mark-read behavior, persistence across restart, and rejection of screenshot fields are covered by `tests/feedback-service.test.mjs`. Run:

```text
node --test tests/feedback-service.test.mjs
```

This is implemented and locally proved on the feature branch. It is not deployed, and no public feedback message has been accepted yet. Deployment still requires an explicitly chosen hosted service, a persistent storage plan, an operator-owned token, and a live owner-inbox journey from a synthetic public browser.
