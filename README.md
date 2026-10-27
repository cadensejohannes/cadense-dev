# Cadense — Unshipped Orders Tracker

A responsive, brand-aligned CX workspace with a secure read-only Shopify backend, persistent SQLite records, hourly synchronization, an active queue, order history, internal statuses, dated warehouse contacts, and append-only notes.

## Status

The source builds and automated logic/API checks pass. Render deployment configuration is included in `render.yaml`. Live Shopify synchronization has **not** been verified: no Shopify token or team account list was provided. This environment did not have the Sites setup/publishing helpers, so this deliverable is a runnable deployment package, not a hosted production URL. Local desktop/mobile browser QA passed for login, sorting, completed orders, and administrator account creation. Production authenticated browser QA requires team access. Sample data is explicitly labeled and cannot run in production mode.

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

Access is restricted to provisioned accounts in the persistent SQLite team database. The initial `AUTHORIZED_USERS_JSON` email/role roster and legacy `/data/users.json` credential hashes are migrated once. The approved administrator's password is preserved, and unprovisioned approved members appear in Settings as Password not set. Subsequent environment-roster changes do not overwrite account management in Settings.

Administrators use **Settings → Team access** to add Cadense colleagues, set temporary passwords, change member/admin roles, deactivate/reactivate users, and reset passwords. The backend checks authorization independently of the UI. The last active, provisioned administrator cannot be demoted or deactivated. Temporary passwords must be changed before using the workspace. Passwords use salted scrypt hashes; signed HttpOnly SameSite cookies expire after eight hours. Password changes, resets, role changes, and deactivation invalidate earlier sessions. The account-management audit never stores passwords.

Provision the first admin with `INITIAL_ADMIN_EMAIL` and a private 12+ character `INITIAL_ADMIN_PASSWORD` only when the credential store is empty. Protect both settings with managed secrets. After first login, remove the bootstrap password from hosting configuration. Set a random `SESSION_SECRET` of at least 32 characters. Changing it signs everyone out. Configure HTTPS and `NODE_ENV=production` for Secure cookies. The app sends no invitation emails; share temporary passwords through your approved private channel.

Login attempts are rate-limited per socket address; add edge throttling at the reverse proxy. No public self-registration, SSO, MFA, or email password recovery is implemented. Members can change their own password in Settings but cannot access account-management endpoints.

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

Thirty-two automated cases cover strict >168-hour eligibility, physical items, partial/resolved retention, unique IDs, closure/reversal/history, failed sync preservation, missing records, sync overlap, malformed pagination, restart persistence, password hashing, session tampering, token cache/renewal/failure recovery, and secure administrator bootstrap. Local HTTP smoke checks additionally verified dashboard data, follow-up persistence, activity, resolved retention, demo sync guard, and static assets. Live Shopify and visual browser verification remain outstanding.

## Design and scope

Black/white, eucalyptus `#28EAB6` from the attached brand guide, neutral backgrounds, and approved Arial fallback. The brief's teal `#28EAB7` differs by one blue-channel step; the PDF brand palette is used. No licensed Calibre font or original logo file was supplied; the interface uses an editable typographic Cadense name, not an extracted/stretched logo. Primary task: oldest-first overdue queue, subtle age cues, searchable/filterable table, detail drawer, CX follow-up workflow, and history.

No Shopify order or inventory mutations. Existing Shopify Flow/Slack notifications continue independently.

Historical access must be verified against a known order older than 60 days before rollout. `SHOPIFY_REQUIRE_ALL_ORDERS_SCOPE=false` supports merchant-created apps; set it to `true` for partner-created apps and obtain the separate permission. Shopify clarification: https://community.shopify.dev/t/read-all-orders-through-admin-api/28964/5

## Preorder exclusions

Settings → Excluded order tags lets administrators maintain up to 50 exact order-tag exclusions. `FWCOL26PRE` is preconfigured. Matching is case-insensitive and affects the active queue and summary metrics, not fulfillment disposition. The active queue has a Show excluded orders control. Shopify tags appear in order details and refresh during successful syncs. Excluded orders continue to sync and retain all notes, contacts, CX statuses, and history. Clearing an exclusion restores an otherwise active order immediately using its stored tags; removing a tag in Shopify restores it after synchronization. Exclusion settings are stored separately in SQLite and survive deployments. Older snapshots without tags need a successful sync before exclusions can match them.

## Order Ops Dashboard release

This release adds full ascending/descending column sorting, completed-order explanations, revised icons, a last-successful-update timestamp, seven-day metric comparisons, fulfilled-order bars and backlog movement, a live sync progress display, and administrator-managed Team access. The decorative header is removed. Follow-up and response targets are configurable in Settings.

Existing account credentials are migrated once to SQLite without resetting passwords. Settings now manages accounts, roles, temporary passwords, and access activation. Temporary passwords must be changed at first login. Role changes, password resets, and deactivation invalidate prior sessions. Removing the last active admin is blocked. The environment allowlist seeds the team on migration; it no longer overwrites Settings changes on every deployment. See docs/PRODUCTION-SETUP.md for the updated operational model.

Seven-day trends start collecting after this release and do not infer missing historic counts. Weekly confirmed fulfillment and cancellation counts are shown separately and use the tracker's observed dates. Current tag exclusions apply to those statistics.

### Watchlist

The Watchlist includes unshipped physical orders after three weekdays, excluding the placement day and weekends, using America/Los_Angeles calendar dates. Public holidays count as weekdays. At more than the configured overdue threshold (seven elapsed calendar days by default), an order moves to the overdue queue. Partial shipments remain tracked. Tag exclusions apply to both queues.

The first successful sync after deployment discovers younger candidates; no additional Shopify scopes are required. Watchlist and overdue orders share their CX notes, status, and contact history. A database migration preserves existing overdue entry dates and adds a separate overdue-entry timestamp for newly tracked watchlist orders. Orders that close before entering overdue remain in Completed orders but do not increase overdue clearance KPIs. Sync failures preserve existing records.

### Inventory shortages and VIP orders

Both views include unshipped physical orders of all ages, including partial fulfillments. Discovery now checks all unshipped, non-canceled orders; recent orders may therefore increase sync time. Existing order IDs and CX notes/statuses are retained. Recent orders do not increase overdue metrics or overdue-clearance KPIs.

VIP matches the complete Shopify order tag `VIP` ignoring case. Current dashboard tag exclusions apply, and can be toggled off to show excluded preorders.

Inventory shortages require the additional read-only Shopify scopes `read_products`, `read_inventory`, and `read_locations`. Release the scopes in the app's active version and approve them on the store, then run a successful sync. Missing scopes mark inventory unknown while allowing existing order/VIP synchronization.

A confirmed shortage means an outstanding physical item has zero shippable stock across all active online fulfillment locations. Shippable stock is `max(0, available + committed)` at each location; this includes inventory committed to existing orders but excludes unavailable inventory such as damaged or reserved stock. Incoming inventory is not counted. This is not an allocation engine: it does not promise coverage of competing orders or of the specifically assigned warehouse. Missing/deleted variants, untracked items, missing levels and incomplete quantities are not assumed to be zero stock. Unknown items are available in Needs inventory check; untracked items are labeled in the drawer. Inventory levels are paginated and cached by inventory-item ID for each sync only.
