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

Retry failed registrar pushes:

```bash
npm run retry:registrar-pushes
```

## What Each Command Does

`npm run dev`
Runs the API locally using `server.js`.

`npm start`
Starts the same API using the normal start script.

`npm run admin`
Launches the terminal-only admin dashboard for registrar management, stats, failed push retries, and delivery log inspection.

`npm run migrate`
Applies any new SQL files in `migrations/` and records them in `schema_migrations`.

`npm run retry:registrar-pushes`
Retries registrar API pushes that previously failed and were logged in `failed_requests`.

## Useful Files

`schema.sql`
Current reference schema for the project.

`migrations/`
App-owned SQL migrations for upgrading the database safely over time.

`.env`
Environment variables for database, SMS, and email configuration.
