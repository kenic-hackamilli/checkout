# Checkout API

Small command reference for the domain checkout / registration API.

## Main Commands

Start the API in local development:

```bash
npm run dev
```

Start the API with the standard start script:

```bash
npm start
```

Open the terminal admin UI:

```bash
npm run admin
```

Run database migrations:

```bash
npm run migrate
```

Check whether existing registrar data will violate the registrar identity guardrails:

```bash
npm run registrars:identity-check
```

Retry failed registrar pushes:

```bash
npm run retry:registrar-pushes
```

Start the registrar portal backend:

```bash
npm run domain-updater
```

Probe the registrar portal's OTP upstream without sending a real OTP:

```bash
npm run domain-updater:otp:check
```

## What Each Command Does

`npm run dev`
Runs the API locally using `server.js`.

`npm start`
Starts the same API using the normal start script.

`npm run admin`
Launches the terminal-only admin dashboard for registrar management, domain pricing, service package catalogs, standard package pricing, stats, failed push retries, and delivery log inspection.

`npm run migrate`
Applies any new SQL files in `migrations/` and records them in `schema_migrations`.

`npm run registrars:identity-check`
Reports duplicate registrar names, emails, or phones that would block the identity guardrail indexes in migration `018`.

`npm run retry:registrar-pushes`
Retries registrar API pushes that previously failed and were logged in `failed_requests`.

`npm run domain-updater`
Starts the registrar-facing `DomainUpdater` service from the same repo.

`npm run domain-updater:otp:check`
Sends a safe empty-body probe to the configured OTP upstream so you can validate routing, TLS, and reverse-proxy wiring without triggering a real OTP delivery.

## Useful Files

`schema.sql`
Current reference schema for the project.

`migrations/`
App-owned SQL migrations for upgrading the database safely over time.

`migrations/015_remove_sample_registrar_catalog_data.sql`
Removes the legacy demo registrars and their seeded catalog records so testing can start from clean registrar onboarding.

`.env`
Environment variables for database, SMS, and email configuration.

`domainUpdater/.env`
Service-specific overrides for the registrar portal when they differ from the shared checkout env.

## DomainUpdater Auth Secret

The registrar API key flow depends on one shared `DOMAIN_UPDATER_API_KEY_PEPPER`.

- Checkout uses it when issuing registrar API keys.
- DomainUpdater uses it when looking those keys up during `POST /v1/auth/start`.
- The startup logs for both services should show the same `apiKeyPepperFingerprint`.
- DomainUpdater startup logs also show `otpServiceTarget`, which helps verify the deployed OTP upstream target quickly.
- Prefer setting the real value once in the shared root `.env`, then leave `domainUpdater/.env` blank unless you intentionally need an override.
- If you change the pepper after keys already exist, rotate and reissue those API keys because old hashes will no longer match.

## Catalog Model

The active registrar catalog now centers on five primary families:

- `domain_registration`
- `hosting`
- `emails`
- `servers`
- `security`

For non-domain families, checkout reads a simpler package model:

- each package belongs to one product family
- each package has one registrar-defined service type
- each package carries one standard active price record at a time

## Admin Catalog Workflow

Inside `npm run admin`:

- Open the registrar workspace with `g`
- Press `o` to manage domain offers and extension pricing
- Press `p` to manage service packages and standard package pricing

Registrar onboarding now requires a complete profile before save:

- `Registrar Name`
- `Primary Email`
- `Primary Phone`
- `API Endpoint`
- `Notification Email`

Inside the package manager:

- `a` adds a package
- `d` deletes the selected package together with its package pricing
- `e` edits the selected package
- `v` opens billing options for the selected package
- `t` toggles the selected package active or inactive

Inside the pricing manager:

- `a` adds or replaces the standard package price
- `e` edits the stored package price
- `d` marks the selected pricing record as the default offer
- `D` deletes the selected pricing record
- `t` toggles the selected pricing record active or inactive

## Registration Lifecycle And Status Interpretation

This is the current backend flow when the app submits a checkout request:

1. The app sends `POST /checkout/registrations` or `POST /checkout` with the structured customer profile fields and a simple purchase summary shape.
2. The backend validates the payload, resolves the exact selected offering from the catalog tables, and checks whether the same request already exists.
3. If the request is new, the backend stores a row in `registrations` with `status = 'received'`.
4. The API returns to the app immediately after the registration row is accepted.
5. SMS, user email, registrar email, and registrar API push then run in the background.
6. Each delivery channel writes its own status to `delivery_logs` and `delivery_attempt_logs`.

### Customer Payload Contract

The checkout request now carries the customer profile as first-class top-level fields:

- `first_name`
- `last_name`
- `phone`
- `email`
- `company_name` (optional)
- `kra_pin` (optional)
- `street_address`
- `city`
- `state`
- `postcode`
- `country`

This same order is now used in the app payload builders, checkout normalization, registrar push payloads, and registrar-facing documentation so integrations can mirror one stable field sequence.

The same request now carries the order selection in a simplified top-level form:

- `domain_name`
- `domain_extension`
- `plus` (optional)
- `type` (optional)
- `package` (optional)
- `registrar_name`
- `price_ksh` (optional)
- `currency_code` (optional)
- `period`

This is the public contract used by the app, the checkout API, and the registrar push payload. The
backend still keeps some legacy/internal columns for catalog resolution and history, but those are no
longer the primary communication shape.

### App To Backend HTTP Responses

The registration controller currently uses these HTTP response codes:

| HTTP code | Meaning in this backend | Typical reason |
| --- | --- | --- |
| `201` | The request was accepted by the backend | New request stored |
| `404` | The referenced registrar or selected catalog record was not found | Registrar not found, selected domain option not found, selected service package not found, or selected bundle not found |
| `409` | The order was blocked because the domain already has an active order | Same customer tried to submit the same domain again while an earlier order is still `received`, whether it was the same package or a different one |
| `422` | The request payload was structurally invalid | Missing customer profile fields, invalid email, invalid phone, invalid address data, or missing registrar selection |
| `500` | Unexpected server-side failure | Unhandled error while creating the registration |

Important behavior:

- The backend now treats any repeat active order for the same customer-domain pair as a `409`.
- This block is enforced both in application logic and by a database unique index on active orders.
- The frontend should present `409` as "already in progress" rather than a generic failure.

### Logging And Delivery Observability

The registration flow now logs the main lifecycle using clearer order-focused checkpoints:

- `---- ORDER RECEIVED ----`
- `---- ORDER PROCESSING ----`

The normalized order log now prioritizes:

- the explicit customer fields such as `first_name`, `last_name`, `phone`, `email`, `city`,
  `state`, and `country`
- the simple order summary fields `domain_name`, `domain_extension`, `plus`, `type`, `package`,
  `registrar_name`, `period`, and `price_ksh`

Delivery summaries also include per-channel:

- a compact audit line such as `success | attempts=1 | status_code=200`
- skipped reasons such as `no_registrar_email` or `no_registrar_endpoint`
- `audit_error` only when provider delivery succeeded but local persistence had a follow-up issue

### Registration Row Fields

The `registrations` table stores the core request state:

| Field | Meaning |
| --- | --- |
| `status` | Current registration status. Today it is created as `received`. This field is not yet advanced to later workflow states like `completed` by the current checkout flow. |
| `pushed` | `true` after the registrar API accepted the request with a successful HTTP response. `false` means the registrar push is still pending, skipped, or failed. |
| `registrar_reference_id` | Optional reference returned by the registrar endpoint when available as `reference_id` or `referenceId`. |
| `message_sent` | `true` after the user SMS acknowledgement succeeds. This is only for the SMS acknowledgement flag, not for all delivery channels. |
| `first_name`, `last_name`, `phone`, `email`, `company_name`, `kra_pin`, `street_address`, `city`, `state`, `postcode`, `country` | Structured customer profile fields copied from the app payload in one canonical order so the original KYC/profile data is preserved consistently with the order record. |
| `selection_snapshot_json` | A compact snapshot of the customer-facing order shape: `domain_name`, `domain_extension`, `plus`, `type`, `package`, `registrar_name`, `price_ksh`, `currency_code`, and `period`. |

### Active Domain Order Protection

Before inserting a new row, the backend checks for another active order with:

- the same `email`
- the same `domain_name`
- `status = 'received'`

If one exists, the API blocks the new order instead of inserting a new row. This prevents the same customer from resubmitting the same order or placing a different package against the same domain while an earlier order is still active.

This rule is also backed by the partial unique index `idx_registrations_active_email_domain`, so concurrent requests cannot create duplicate active rows even if they arrive at nearly the same time.

### Delivery Channel Statuses

SMS, email, and registrar API pushes all use the shared delivery retry service in `services/notificationService.js`.

The `delivery_logs.status` field can be:

| Delivery status | Meaning |
| --- | --- |
| `pending` | The channel has not finished yet, or a retry is still possible |
| `success` | The channel completed successfully |
| `failed` | All allowed attempts were exhausted and the channel still failed |
| `skipped` | The channel was intentionally not attempted, for example because a destination or configuration was missing |

Related fields:

| Field | Meaning |
| --- | --- |
| `attempts` | How many attempts have been used so far |
| `max_attempts` | Maximum attempts allowed for that delivery log |
| `last_response` | Last successful provider response payload or response summary |
| `last_error` | Last failure message |
| `provider_reference` | External provider message ID or registrar reference when available |
| `delivered_at` | Timestamp recorded when a delivery reaches `success` |

The detailed attempt log in `delivery_attempt_logs` stores one row per try with status `success` or `failed`.

### Retry Behavior

The shared retry handler currently uses:

- `NOTIFICATION_MAX_ATTEMPTS`, defaulting to `3`
- retry delays of `250ms`, `750ms`, and `1500ms`

This applies to:

- user SMS acknowledgement
- user acknowledgement email
- registrar notification email
- registrar API push

### Registrar Endpoint Interpretation

The registrar push is considered successful only when the registrar endpoint returns an HTTP `2xx` response.

The registrar push payload now includes the public `order_reference` alongside the customer, domain, pricing, and selection fields. See `registrarModule.txt` for the registrar-facing contract and receiver guidance.

Current interpretation rules:

| Registrar response | Backend interpretation |
| --- | --- |
| HTTP `2xx` | Success. The backend marks `registrations.pushed = true`, stores `registrar_reference_id` if present, clears any previous failed push logs, and records a successful `registrar_api` delivery log. |
| HTTP non-`2xx` | Failure for that attempt. The backend throws an error, records the failed attempt, and retries until the max attempt count is reached. |
| Network or fetch error | Failure for that attempt. Handled the same as other delivery failures. |
| Registrar missing, inactive, or without `api_endpoint` | `skipped`. No registrar API delivery is attempted. |

Important integration note:

- The backend currently treats any HTTP `2xx` as success.
- It does not yet inspect registrar-specific business status fields in the JSON body such as `accepted`, `duplicate`, `queued`, or `rejected`.
- If a registrar needs richer response handling, their endpoint should currently return a non-`2xx` response for rejected requests, or the backend should be extended with a registrar-specific response interpreter.

If the registrar returns JSON, the backend looks for:

- `reference_id`
- `referenceId`

If found, that value is stored in `registrations.registrar_reference_id`.

### How To Read The End-To-End State

When debugging a request, use the fields together rather than relying on only one column:

| What you want to know | Where to look |
| --- | --- |
| Was the request accepted by the checkout API? | HTTP response from `POST /checkout/registrations` and the returned `request_id` |
| Was it blocked as already in progress? | HTTP `409`, the response message, and the existing active `registrations` row for the same `email + domain_name` |
| Did the request get stored? | `registrations` row with `status = 'received'` |
| Was user SMS sent? | `registrations.message_sent` and `delivery_logs` where `delivery_type = 'sms'` |
| Was user email sent? | `delivery_logs` where `delivery_type = 'email'` and `recipient_type = 'user'` |
| Was registrar email sent? | `delivery_logs` where `delivery_type = 'email'` and `recipient_type = 'registrar'` |
| Was the registrar API push accepted? | `registrations.pushed = true` and `delivery_logs` where `delivery_type = 'registrar_api'` has `status = 'success'` |
| Why did something fail? | `delivery_logs.last_error`, `delivery_attempt_logs`, and `failed_requests` for registrar push failures |


node -e "const pool=require('./db');(async()=>{try{const result=await pool.query('DELETE FROM registrars');console.log('Deleted '+result.rowCount+' registrar(s). Live catalog, bundles, API keys, portal sessions, and registrar-owned records were cascaded.');}catch(error){console.error(error);process.exit(1)}finally{await pool.end()}})()"
