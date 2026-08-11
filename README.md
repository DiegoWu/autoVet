# autoVet

autoVet is a bilingual monthly roster builder for Taiwanese veterinary clinics. It turns staffing levels, requested leave, contracted hours, and coworker preferences into several deterministic, explainable schedule options.

Traditional Chinese (`zh-TW`) is the default. English is available from the header.

## Docker deployment

Requirements: Docker Engine with Docker Compose.

1. Create the runtime environment file:

```bash
cp .env.docker.example .env.docker
openssl rand -base64 48
```

Put the generated value in `AUTH_SECRET`, choose a strong URL-safe `POSTGRES_PASSWORD`, and replace the administrator email and password hash. Keep bcrypt hashes containing `$` inside single quotes in `.env.docker`. `OPENAI_API_KEY` is optional.

The previously exposed OpenAI key must be revoked and replaced; never reuse a key copied from chat, shell history, or repository history.

2. Build and start PostgreSQL, migrations, and autoVet:

```bash
docker compose --env-file .env.docker up --build -d
docker compose --env-file .env.docker ps
docker compose --env-file .env.docker logs -f app
```

Open `http://localhost:3000`. The database is only available on the private Compose network. PostgreSQL data persists in the `autovet_postgres-data` named volume.

Migrations run in a one-shot service before the web container starts. Seed demo records explicitly when needed:

```bash
docker compose --env-file .env.docker run --rm migrate npm run db:seed
```

Routine operations:

```bash
# Stop services while preserving data
docker compose --env-file .env.docker down

# Rebuild after application changes
docker compose --env-file .env.docker up --build -d

# Back up PostgreSQL
docker compose --env-file .env.docker exec -T db sh -c 'pg_dump -U "$POSTGRES_USER" "$POSTGRES_DB"' > autovet-backup.sql

# Restore a backup
docker compose --env-file .env.docker exec -T db sh -c 'psql -U "$POSTGRES_USER" "$POSTGRES_DB"' < autovet-backup.sql

# Permanently remove containers and database data
docker compose --env-file .env.docker down -v
```

Changing `POSTGRES_USER`, `POSTGRES_PASSWORD`, or `POSTGRES_DB` after the volume is initialized does not change the existing PostgreSQL account. Apply the change inside PostgreSQL or recreate the volume after taking a backup.

## What is included

- Four-step staff → constraints → compare → export workflow
- Fixed clinic sessions: 10:00–12:30, 13:30–17:30, and 18:00–22:00
- Seeded deterministic scheduler with hard coverage/time-off constraints and soft fairness/preference scoring
- Per-shift doctor minimum/maximum limits and backup-only doctors used only when regular coverage is unavailable
- Central Taiwanese labor-rule validation, including standard and explicitly attested four-week flexible modes
- Persistent PostgreSQL records for staff, preferences, leave, input snapshots, candidates, selected schedules, and summaries
- Searchable local/cloud schedule history
- Manual same-role assignment cycling with immediate leave warnings
- PDF, PNG, and JPG exports based on a dedicated print layout
- Optional, server-only OpenAI preference summaries; AI never creates assignments
- Signed, HTTP-only single-administrator sessions
- Optional employee cards with experience, expertise, hobbies, and clearly labeled AI scores

## Local setup

Requirements: Node.js 22+ and PostgreSQL.

```bash
npm install
cp .env.example .env.local
npm run db:generate
npm run db:migrate
npm run db:seed
npm run dev
```

Create the administrator password hash without storing a plain-text password:

```bash
node -e "import('bcryptjs').then(({hash}) => hash(process.argv[1], 12).then(console.log))" 'your-password'
```

Put the output in `ADMIN_PASSWORD_HASH`. `AUTH_SECRET` must contain at least 32 random bytes. `OPENAI_API_KEY` is optional.

The UI keeps a local browser fallback so the workflow and exports remain usable during local UI development without PostgreSQL. Production persistence requires `DATABASE_URL`.

## Quality checks

```bash
npm run typecheck
npm run lint
npm test
npm run build
```

Scheduler tests cover deterministic output, seed diversity, hard coverage, time off, maximum daily hours, consecutive work days, flexible-hours opt-in, and impossible inputs.

## Alternative deployment

The standalone application image can connect to an external PostgreSQL service by setting `DATABASE_URL` at runtime. Run the `migrate` image target against that database before starting the `runner` target.

Never commit `.env`, `.env.docker`, API keys, database credentials, or password hashes. The repository and Docker build context exclude local environment files.

## Labor-law boundary

autoVet is planning assistance, not legal advice. The validator uses conservative, centralized defaults derived from Taiwan's Labor Standards Act:

- 8 regular hours/day and 40 regular hours/week
- no more than 12 total work hours/day
- monthly overtime limit of 46 hours under standard rules
- required rest days and overtime warnings
- four-week flexible scheduling only after explicit approval attestation and employee opt-in

Before production use, the clinic must confirm its industry classification, labor-management approval, overtime agreements, holidays, individual contracts, break arrangements, and current Ministry of Labor guidance. Legal constants live in `src/lib/scheduler/labor.ts` and should be reviewed when regulations change.
