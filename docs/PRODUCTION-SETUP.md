# Production setup

Status: code and deployment configuration are prepared; no production service has been created, no credentials supplied, and no live Shopify import verified.

## 1. Account and deployment connection

Create a Render account at https://dashboard.render.com/register. Connect the Render integration in ChatGPT and link your GitHub account to Render, granting access to `cadensejohannes/cadense-dev`.

The `production-render` branch contains the complete backend/frontend and `render.yaml`. Create a Blueprint from that branch or use the Render integration once connected. The blueprint specifies a paid always-on Docker service (0.5 CPU / 512 MB), one instance, Oregon region, and a 1 GB persistent disk mounted at `/data`. Review Render's current quote before creating the service. Automatic deploys are off; a repository push does not trigger a production release.

A free sleeping service cannot provide reliable hourly synchronization or persistent records. You may use the generated HTTPS `onrender.com` URL initially; a custom domain is optional later.

## 2. Create the Shopify app

Use Cadense's own Shopify organization at https://dev.shopify.com/dashboard. Create an app named Cadense Order Tracker, configure a version with read-only scopes, release that version, and install it on `cadenseadaptive.myshopify.com`.

Required scopes for this merchant-created app:

- `read_orders`
- `read_customers` (required for the customer name queried by the dashboard)
- For partner-created apps only: `read_all_orders`, after Shopify approval. Merchant-created Dev Dashboard apps do not require this separate scope.
- `read_merchant_managed_fulfillment_orders`
- `read_third_party_fulfillment_orders`

Request protected customer data access only for customer names, if Shopify requires it. No write permissions, addresses, email addresses, phone numbers, or payment information are needed.

The intended authentication is a same-organization client-credentials grant. Obtain the Client ID and Client secret from the app's Settings in the Dev Dashboard and enter them **directly in Render**, not in chat or source files. Tokens are fetched server-side and renewed before expiration. If the app and store are not owned by the same Shopify organization, this grant will not work; stop and implement the appropriate Shopify installation/OAuth flow instead.

Official reference: https://shopify.dev/docs/apps/build/authentication-authorization/client-credentials-grant

## 3. Private environment setup

The Blueprint asks for:

| Setting | Value |
| --- | --- |
| `SHOPIFY_CLIENT_ID` | From Shopify Dev Dashboard |
| `SHOPIFY_CLIENT_SECRET` | From Shopify Dev Dashboard; secret |
| `AUTHORIZED_USERS_JSON` | Private array of approved `{ "email": "...", "role": "admin" or "member" }` objects |
| `INITIAL_ADMIN_EMAIL` | The approved administrator's work email |
| `INITIAL_ADMIN_PASSWORD` | A password of at least 12 characters, chosen privately |

The store domain, API version, database paths, production mode, and a generated session secret are configured by the Blueprint. Employee emails and passwords are intentionally not committed. The authorized roster was supplied in chat and can be entered into the private Render configuration after connection.

Initial startup creates only the administrator account if the persistent account file is empty. After the administrator can sign in, remove `INITIAL_ADMIN_PASSWORD` from Render. Subsequent deploys preserve existing accounts. Changes to the email/role allowlist deny access to removed users.

## 4. Member accounts

Existing approved credentials are migrated once from `/data/users.json` into the application's persistent SQLite database. The environment roster seeds the initial team; subsequent account changes are managed in **Settings → Team access**, available only to administrators.

Use Set password for each approved member who has not been provisioned, or Add team member for a new Cadense colleague. The UI supports member/admin roles, activation/deactivation, and password reset. Temporary passwords require a password change at first login. Reset, role change, and deactivation revoke existing sessions. The last active, provisioned administrator cannot be demoted or deactivated. The backend enforces all permissions independently of UI visibility. Access changes are audited without recording passwords.

Accounts added through the UI must use `@cadense.com` (override `TEAM_EMAIL_DOMAIN` in hosting configuration if Cadense explicitly authorizes another domain). Passwords are stored as salted scrypt hashes. Share temporary passwords through an approved private channel; this app sends no emails. Users can change their own password in Settings.

The original credential file is retained for rollback but is no longer authoritative after migration. Restoring an old application version after account changes also restores its legacy authentication behavior; plan recovery carefully. Back up SQLite to protect current account settings and order history.

## 5. Verification before team rollout

- Confirm Render reports a healthy service via `/healthz` and HTTPS is active.
- Sign in as administrator; confirm unauthenticated access to `/api/orders` is denied.
- Confirm initial Shopify import succeeds and includes any eligible order older than 60 days.
- Check outstanding physical quantities and assigned locations against real Shopify orders.
- Confirm partial orders stay active, and completed/canceled orders move to History without losing notes.
- Confirm an internal Resolved status does not remove an unshipped order.
- Confirm members can save follow-ups but cannot trigger a manual sync.
- Wait for a server-side hourly sync and verify the last successful timestamp advances.
- Redeploy once and verify orders, notes, and accounts persist.
- Simulate a sync failure and verify the queue is retained and last-success unchanged.
- Verify desktop/mobile browser rendering. Previous checks were build/unit/local API checks, not visual browser QA.

## 6. Operations

Run a single service instance. Back up SQLite consistently using the SQLite backup API/tooling or stop the service before copying its database and WAL. Keep encrypted off-host backups and test restoration; a same-disk copy alone is not disaster recovery. Back up the account hash file securely too.

Monitor failed `sync_runs` and alert when last successful sync is older than two hours. These records are stored, but external alerting and off-host backups still require hosting configuration. Initial discovery excludes fully fulfilled and canceled orders, while all tracked IDs including history are refreshed; measure runtime and API usage on Cadense's store before rollout, and optimize discovery if it cannot comfortably complete within an hour.

Historical access must be verified against a known order older than 60 days before rollout. `SHOPIFY_REQUIRE_ALL_ORDERS_SCOPE=false` supports merchant-created apps; set it to `true` for partner-created apps and obtain the separate permission. Shopify clarification: https://community.shopify.dev/t/read-all-orders-through-admin-api/28964/5

## Release and metrics

`APP_RELEASE` in the Blueprint identifies the published application revision at `/healthz`. This release updates that configuration value to request a Blueprint-managed deployment. Future source-only pushes still do not auto-deploy because `autoDeployTrigger` is off. Render's separate Blueprint Auto Sync must be enabled to apply configuration updates automatically; if disabled, use Manual Sync on the Blueprint or Manual Deploy on the service.

The dashboard now displays sync stages, processed/total orders, elapsed time, and interrupted leases. Manual sync starts a background task and returns immediately. All data changes commit only after fetching completes and the sync still owns its lease. A stale owner cannot delete a replacement lease or write fetched records.

Daily-looking seven-day trends are computed from successful sync snapshots and require a comparable baseline around seven days earlier under the same tag exclusions. Unknown history is labeled, not backfilled. Weekly fulfillment graphics count unique currently fulfilled tracker orders by observed closure date, not carrier delivery. Cancellations and no-outstanding-item closures are separate. The bar chart uses Pacific calendar days and marks days before tracking began as unobserved. Changes in exclusions can change the included cohort; trend baselines require matching rules.

Follow-up contact coverage and late 3PL responses use administrator-configurable targets (default three days, 1–30). These are recorded contact dates, not automatic proof of warehouse communication. Accounts, notes, CX statuses, exclusions, and metric rules are persisted separately from Shopify snapshots.
