# Cadense — Unshipped Orders Tracker

A responsive, brand-aligned CX workspace with a secure read-only Shopify backend, persistent SQLite records, hourly synchronization, an active queue, order history, internal statuses, dated warehouse contacts, and append-only notes.

## Status

The source builds and automated logic/API checks pass. Render deployment configuration is included in `render.yaml`. Live Shopify synchronization has **not** been verified: no Shopify token or team account list was provided. This environment did not have the Sites setup/publishing helpers, so this deliverable is a runnable deployment package, not a hosted production URL. Browser visual QA was not performed. Sample data is explicitly labeled and cannot run in production mode.

## Architecture

React + TypeScript + Vite for the dashboard; Node.js 24 HTTP server and built-in SQLite for the backend. There are no runtime npm dependencies in the backend. Use one always-on service with a persistent local disk, HTTPS reverse proxy, and backups. A small CX team does not require PostgreSQL or a separate job service. An always-on server starts a catch-up sync on boot and runs every 60 minutes even when no browser is open. Do not deploy this service to a sleeping/free ephemeral host or a serverless request-only runtime. SQLite must be on a local persistent volume, not a network filesystem.

### Data model

- `orders`: stable Shopify ID primary key; latest Shopify snapshot, internal CX status, last warehouse contact, first entry timestamp, closed timestamp, disposition, and last check.
- `activity`: append-only note/status/contact/sync transitions with actor and timestamp.
- `meta`: last successful sync and sanitized failure indicator.
- `sync_runs`: success/failure/start/finish records without tokens or customer payloads.
- `locks`: expiring SQLite sync lease with heartbeat; blocks overlapping workers.

Shopify snapshots and internal CX fields are updated independently. CX Resolved never closes an unshipped order. Fully shipped or canceled orders move to history; fulfillment reversals reopen the same record and retain notes. The recorded closure time is the time the tracker observed closure, not a carrier delivery timestamp.

## Try the app locally

Requires Node.js 24 and npm.

```sh
npm ci
npm run build
DEMO_MODE=true DATABASE_PATH=work/demo.sqlite npm start
```

Open http://localhost:3000. Demo mode is deliberately unauthenticated for local evaluation and must not be exposed publicly. It persists sample edits in its own SQLite database. Stop the demo before starting a live instance. Live and demo databases must be separate.

For UI development, run the backend as above, then `npm run dev` (Vite proxies `/api` to port 3000).

## Connect Cadense Shopify

Store domain is preconfigured as `cadenseadaptive.myshopify.com` in `.env.example`. Provision an app/token using Shopify's current app installation process. Configure these **read-only** scopes:

- `read_orders`
- `read_customers` (required for the customer name queried by the dashboard)
- `read_all_orders` only for partner-created apps (requires approval). Merchant-created Dev Dashboard apps can read historical orders with `read_orders`.
- `read_merchant_managed_fulfillment_orders`
- `read_third_party_fulfillment_orders`

Customer display names may require Shopify protected customer data approval. Do not request email/address/phone data for this dashboard. No write scopes, mutation operations, Slack calls, emails, or 3PL communications are used.

For a Dev Dashboard app in the same Shopify organization as the store, set `SHOPIFY_CLIENT_ID` and `SHOPIFY_CLIENT_SECRET` privately in the hosting environment. The backend obtains and renews expiring tokens automatically. For an existing legacy installation, `SHOPIFY_ACCESS_TOKEN` remains supported as an alternative. Never put credentials in frontend code or Git. `.env.example` documents all configuration variables; local `.env` is gitignored. API version defaults to `2026-10`; review and upgrade before Shopify retires it. Verify all scope approvals and test the first sync against the real store before rollout.

The sync checks granted scopes before fetching, discovers older orders not marked fulfilled or canceled, then refreshes every tracked order ID including history to detect reversals, refreshes all previously tracked IDs, paginates orders/line items/fulfillment orders, and evaluates physical `requiresShipping` plus `unfulfilledQuantity`. Fulfillment locations come from assigned fulfillment orders. API retries handle temporary network errors, 429 throttling, and server errors with backoff. A malformed page, unavailable tracked order, missing scope, or exhausted retry aborts the run. Only after all requested records are fetched does one transaction apply updates and advance the successful sync timestamp. Missing orders are never closed by inference.

**Scale consideration:** the conservative initial implementation discovers overdue candidates and refreshes all tracked records on each sync. For a large store, measure runtime/API consumption before rollout; incremental discovery plus periodic reconciliation would be the next optimization. Location labels include all assigned order locations; outstanding quantities are authoritative per line item, rather than allocated per location. Refunded/removed items with no outstanding shipping quantity close with the disposition No outstanding items when Shopify does not report Fulfilled.

## Team authentication

Access is limited to explicitly provisioned accounts whose email and role also appear in the private `AUTHORIZED_USERS_JSON` hosting environment variable. This is an array of objects, for example `[{"email":"admin@example.com","role":"admin"},{"email":"agent@example.com","role":"member"}]`. Do not commit employee email lists to a public repository. On the first launch only, `INITIAL_ADMIN_EMAIL` and `INITIAL_ADMIN_PASSWORD` create the initial authorized admin account on persistent disk; use a 12+ character password and remove the bootstrap password from hosting configuration afterward. Existing accounts are never overwritten on redeployment. Passwords use salted scrypt hashes; signed HttpOnly SameSite cookies expire after eight hours. Login attempts are rate-limited per socket address. Only admins can manually trigger Shopify sync; members can manage CX follow-ups. There is no public registration. Accounts are reread on each request so removal revokes access. Configure HTTPS and `NODE_ENV=production` for Secure cookies. Set a random `SESSION_SECRET` of at least 32 characters in managed secrets. Changing it revokes every session.

Provision users by feeding a password via stdin rather than passing it in command arguments. For interactive Linux setup:

```sh
read -s -p 'New password (12+ characters): ' CADENSE_NEW_PASSWORD
printf '%s' "$CADENSE_NEW_PASSWORD" | USERS_FILE=/data/users.json node server/create-user.mjs agent@cadense.com admin
unset CADENSE_NEW_PASSWORD
```

Use `member` instead of `admin` for ordinary team accounts. Protect `users.json` with filesystem permissions. Configure the reverse proxy to set `X-Forwarded-Proto: https`, preserve the Host header, and rate-limit login at the edge as well. The app rejects browser requests from a different origin. Do not expose the backend over unencrypted public HTTP. Shared-session auth is suitable for this small MVP; SSO/MFA and distributed edge login throttling are future production hardening options if Cadense requires them.

## Deploy

The included Dockerfile builds assets and runs the backend as a non-root user. Build/run using your host's supported workflow, with a **persistent `/data` volume** and secrets supplied from the host's secret manager. An ordinary Node host can instead run `npm ci`, `npm run build`, then `npm start` under a supervisor. Set `DATABASE_PATH` and `USERS_FILE` to writable persistent paths. Do not set `DEMO_MODE=true` in production. The backend refuses that combination.

Production rollout checklist:

1. Provide the Shopify token/scopes and authorized team accounts.
2. Configure HTTPS, a persistent volume, process restart policy, and host monitoring.
3. Take SQLite-consistent scheduled backups (use SQLite backup tooling or stop the server during file copy; copying a live DB alone can omit WAL transactions). Back up `users.json` securely too; rehearse restoration.
4. Start the server and verify initial discovery includes an order older than 60 days.
5. Verify partial fulfillment stays active, a successful complete fulfillment moves to History, and a real failed sync leaves last-success unchanged.
6. Verify member/admin permissions and mobile/desktop browser rendering.
7. Alert on failed `sync_runs` or a last successful sync older than two hours. Deployments reuse the same persistent disk; run one app replica on it.

## Tests

```sh
npm test
npm run build
```

Seventeen automated cases cover strict >168-hour eligibility, physical items, partial/resolved retention, unique IDs, closure/reversal/history, failed sync preservation, missing records, sync overlap, malformed pagination, restart persistence, password hashing, session tampering, token cache/renewal/failure recovery, and secure administrator bootstrap. Local HTTP smoke checks additionally verified dashboard data, follow-up persistence, activity, resolved retention, demo sync guard, and static assets. Live Shopify and visual browser verification remain outstanding.

## Design and scope

Black/white, eucalyptus `#28EAB6` from the attached brand guide, neutral backgrounds, and approved Arial fallback. The brief's teal `#28EAB7` differs by one blue-channel step; the PDF brand palette is used. No licensed Calibre font or original logo file was supplied; the interface uses an editable typographic Cadense name, not an extracted/stretched logo. Primary task: oldest-first overdue queue, subtle age cues, searchable/filterable table, detail drawer, CX follow-up workflow, and history.

No Shopify order or inventory mutations. Existing Shopify Flow/Slack notifications continue independently.

Historical access must be verified against a known order older than 60 days before rollout. `SHOPIFY_REQUIRE_ALL_ORDERS_SCOPE=false` supports merchant-created apps; set it to `true` for partner-created apps and obtain the separate permission. Shopify clarification: https://community.shopify.dev/t/read-all-orders-through-admin-api/28964/5

## Preorder exclusions

Settings → Excluded order tags lets administrators maintain up to 50 exact order-tag exclusions. `FWCOL26PRE` is preconfigured. Matching is case-insensitive and affects the active queue and summary metrics, not fulfillment disposition. The active queue has a Show excluded orders control. Shopify tags appear in order details and refresh during successful syncs. Excluded orders continue to sync and retain all notes, contacts, CX statuses, and history. Clearing an exclusion restores an otherwise active order immediately using its stored tags; removing a tag in Shopify restores it after synchronization. Exclusion settings are stored separately in SQLite and survive deployments. Older snapshots without tags need a successful sync before exclusions can match them.
