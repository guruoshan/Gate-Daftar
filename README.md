# Gate Daftar

A simple digital gate book for one factory or warehouse gate.

The guard records visitors coming in and workers going out. A manager can approve a worker leaving by tapping a link. Arabic and English are both supported.

This is a working draft. Do not put real visitor or worker details into it until later security work is finished.

## What you need on your computer

- Node.js 20 or newer
- A terminal

## How to run it on your computer

1. Open a terminal in this folder.
2. Copy the example settings file. On Mac or Linux:

```bash
cp .env.example .env
```

On Windows:

```bash
copy .env.example .env
```

3. Start both parts of the app:

```bash
chmod +x start.sh
./start.sh
```

The first run installs packages. That can take a minute.

4. Open a browser and go to http://localhost:5173

You should see the Gate Daftar home page.

## Try the sample gate

1. Open http://localhost:5173/booth/demo
2. Type the sample booth code `1234`
3. You should see a live list of people waiting, approved to leave, and already inside

The public gate form (what a visitor scans) is http://localhost:5173/g/demo

The owner report page is http://localhost:5173/reports/demo

## How to run the checks

These checks prove the server still answers and that sample data is fake.

```bash
cd backend
npm install
npm test
```

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
| DATABASE_URL | Database connection string (not used yet; reserved for a later change) |
| SESSION_SECRET | A long random phrase used to protect login cookies (reserved for a later change) |
| RETENTION_DAYS | How many days to keep old records (reserved for a later change) |

## What is not ready yet

Booth codes, reports, and live lists are not locked down. Anyone who knows a site address can currently read it. Work to close that is planned in later batches.

## Sample data

The sample warehouse uses made-up names and `example.com` emails only. Do not type real personal details into this copy of the app.
