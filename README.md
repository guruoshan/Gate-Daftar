# Gate Daftar

A simple digital gate book for one factory or warehouse gate.

The guard records visitors coming in and workers going out. A manager can approve a worker leaving by tapping a link. Arabic and English are both supported.

This is a working draft. Do not put real visitor or worker details into it until later security work is finished.

## What you need on your computer

- Node.js 20 or newer
- PostgreSQL 15 (this is where the gate records are kept)
- A terminal

You do **not** need Docker. Docker is only one convenient way to get PostgreSQL; the steps below use a normal PostgreSQL install.

## How to run it on your computer

1. Install PostgreSQL. On Debian/Ubuntu:

```bash
sudo apt-get update
sudo apt-get install -y postgresql
```

2. Create the database and the app login once:

```bash
sudo -u postgres psql -c "CREATE USER gate WITH PASSWORD 'gate';"
sudo -u postgres psql -c "CREATE DATABASE gate_daftar OWNER gate;"
sudo -u postgres psql -c "CREATE DATABASE gate_daftar_test OWNER gate;"
```

3. Open a terminal in this folder and copy the example settings file. On Mac or Linux:

```bash
cp .env.example .env
```

On Windows:

```bash
copy .env.example .env
```

4. Start both parts of the app:

```bash
chmod +x start.sh
./start.sh
```

The first run installs packages and creates the database tables. That can take a minute.

5. Open a browser and go to http://localhost:5173

### Using Docker instead (optional)

If you have Docker, one command starts the database, the server and the website:

```bash
docker compose up --build
```

Then open http://localhost:5173.

You should see the Gate Daftar home page.

## Try the sample gate

1. Look in the terminal that is running the app for a line that says `gate-daftar demo booth PIN:` and note the number next to it. If this is a brand new copy, that line is printed once when the sample data is first created.
2. Open http://localhost:5173/booth/demo
3. Type that six digit booth code
4. You should see a live list of people waiting, approved to leave, and already inside

The booth code is never written down in the code or stored in plain form. The owner can change it from the setup page, and the new code is shown once.

The public gate form (what a visitor scans) is http://localhost:5173/g/demo

The owner report page is http://localhost:5173/reports/demo

## How to run the checks

These checks prove the server still answers, that the database layer works, and that sample data is fake. They use the separate test database, so your real records are never touched.

```bash
cd backend
npm install
npm test
```

If PostgreSQL is not on the default address, set `TEST_DATABASE_URL` before running the checks.

To build the website files:

```bash
cd frontend
npm install
npm run build
```

## Settings in the `.env` file

| Name | What it is for |
|---|---|
| PUBLIC_ORIGIN | The public web address people use in the browser, with no trailing slash |
| PORT | The number the server listens on (3001 is the default) |
| ALLOWED_ORIGINS | Which websites may call the server, comma-separated |
| DATABASE_URL | Where the PostgreSQL database lives. Change this one line to move to another database |
| TEST_DATABASE_URL | A separate database used only by the automated checks |
| PG_POOL_MAX | How many database connections the server keeps open |
| SESSION_SECRET | A long random phrase used to protect login cookies |
| RETENTION_DAYS | How many days old backups are listed by `npm run backup -- --prune`. Nothing is deleted automatically |

## Moving to a hosted database later

The app does not care whether PostgreSQL runs on this computer or with a hosting company. When you are ready, create a hosted PostgreSQL database (for example Supabase or Neon), then change only this line in `.env`:

```text
DATABASE_URL=postgres://user:password@host:5432/database
```

Nothing is rebuilt. The database tables are created automatically the next time the server starts.

## Importing the old data file

If you have an old `backend/data/db.json`, it can be copied into PostgreSQL once. Stop the server first, then run:

```bash
cd backend
npm run db:import -- ../backend/data/db.json
```

The import script rebuilds the audit chain and replaces any stored approval links with a scrambled hash. It refuses to run on a database that already has records unless you add `--force`. If the database is empty when the server starts and `backend/data/db.json` is present, the server imports it once. If that import fails, the server stops instead of starting empty.

## Backup and restore

These commands copy the PostgreSQL database. They do not print personal details.

```bash
cd backend
npm run backup
```

That writes a timestamped file under `backend/backups/`. To list old copies without deleting them:

```bash
cd backend
npm run backup -- --prune
```

Stop the server before restoring. Restore refuses to run while the server is up.

```bash
cd backend
npm run restore
```

You can pass a specific file: `npm run restore -- backend/backups/gate-daftar-YYYYMMDD-HHMMSS.dump`

Check that the audit chain still hashes correctly:

```bash
cd backend
npm run verify-audit
```

See how many records are older than the retention window (nothing is deleted):

```bash
cd backend
npm run retention-report
```

## Database tables

The server creates and upgrades its own tables from the SQL files in `backend/migrations`. You do not run them by hand; starting the server does it.

## What is not ready yet

- Real customer details should only be entered once you are using your own hosted database, with backups turned on.
- `RETENTION_DAYS` is a setting only; nothing deletes old rows yet.

## Sample data

The sample warehouse uses made-up names and `example.com` emails only. Do not type real personal details into this copy of the app.
