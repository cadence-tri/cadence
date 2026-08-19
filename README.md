# Cadence

A training log and plan tracker for marathon and triathlon training —
a Progressive Web App version of the native Cadence iOS app, built as a
lighter, easy-to-share sibling (a link instead of a TestFlight invite or a
sideload). Runs entirely client-side: no backend, no accounts, no server
ever sees your data.

Live at: **https://bonanomi.github.io/cadence/** (once deployed — see below)

## What it does

- **Daily log** — Overview dashboard (week at a glance, Road to Race
  progress, recovery-week nudges), an Upcoming list grouped by week with
  editable phase labels, and a browsable Training Log of past weeks.
- **Session tracking** — tick off prescribed sets, log free-text feedback
  per session, edit sets inline.
- **Stats** — completion rate by discipline, weekly volume charts,
  gym exercise progression, all filterable by training phase.
- **Plan generation** — builds a complete "check-in" prompt (your race
  goal, availability, and recent training history) that you paste into
  any Claude conversation; paste the reply back in and it's parsed and
  imported automatically. No API key, no server round-trip.
- **Manual entry & file import** — add a session by hand, or import a
  `.md` plan file directly.
- **Backup & Restore** — export your whole log as a JSON file, restore
  from one. This is also how you bring in training history from the
  **native iOS app** — its backup export uses the same JSON shape, so
  export from the iOS app's Profile → Backup & Restore screen and import
  that file here.

## Tech stack

- React + Vite, deployed as a static site
- [Dexie.js](https://dexie.org/) over IndexedDB for local-only storage
- Tailwind CSS v4 for styling (brand tokens in `src/index.css`)
- Recharts for the Stats charts
- `vite-plugin-pwa` for the installable-PWA/service-worker setup

## Local development

```bash
npm install
npm run dev
```

Open the printed local URL. The dev server ignores the `base: '/cadence/'`
path prefix used in production builds, so it just runs at the root.

```bash
npm run build     # production build to dist/
npm run preview   # serve the production build locally, at /cadence/
```

## Deploying to GitHub Pages

This repo is set up for `bonanomi.github.io/cadence` — a project page
under a repo named `cadence`.

**Option A — GitHub Actions (included, recommended):**

1. Push this repo to `github.com/bonanomi/cadence`, on the `main` branch.
2. In the repo's **Settings → Pages**, set **Source** to **GitHub
   Actions**.
3. Push (or manually run the "Deploy to GitHub Pages" workflow under the
   **Actions** tab). It builds and deploys automatically on every push to
   `main`.

**Option B — manual:**

```bash
npm run build
npx gh-pages -d dist   # or push dist/ to a gh-pages branch by hand
```

**If you ever rename the repo or move this to a different path** (a root
`bonanomi.github.io` page, or a different project name), update
`base`, `manifest.start_url`, and `manifest.scope` in `vite.config.js`
together — they all need to agree with the deployed path or routing and
"Add to Home Screen" will break.

## Installing on iOS

Visit the deployed URL in Safari, tap the Share icon, then **Add to Home
Screen**. It installs like a native app icon and runs full-screen — no
App Store, no sideloading, no certificate to renew.

## Data & sync

Everything lives in this browser's IndexedDB — nothing is sent anywhere.
That also means **there's no automatic sync between devices**: if you use
Cadence on your phone and a laptop, use **Export backup** on one and
**Import backup** on the other to move your log across. Export regularly
if you're relying on this as your only record — clearing site data (or a
browser reinstall) wipes IndexedDB along with everything else.

## Project structure

```
src/
  db/            Dexie schema + pure-function ports of the data model
                 (discipline/phase/session/profile helpers)
  services/      MarkdownImporter, PlanPromptBuilder, BackupService,
                 TrainingCapacityWarning, date utilities
  components/    Shared UI (sheets, cards, rows) used across screens
  screens/       Top-level screens (Login, Daily, Stats, Import)
  assets/        Brand logo + PLAN_SCHEMA.md (bundled into the app so the
                 prompt builder can embed it verbatim)
PLAN_SCHEMA.md   Copy of the governance doc at repo root, for easy
                 reference/diffing against the native app's copy
```

`PLAN_SCHEMA.md` is the contract between this app's prompt builder and
whatever parses its output — if you ever change the schema, update
**both** copies (`PLAN_SCHEMA.md` at the repo root and
`src/assets/PLAN_SCHEMA.md`, which is what actually ships in the app) and
the parsing logic in `src/services/markdownImporter.js` together.

## What's intentionally not in the PWA

Per the native-app-to-PWA handoff notes, two features are cut rather than
ported:

- **Push/local notifications** — no client-only equivalent exists for a
  static site; would need a server just for this.
- **Smart Coach (one-tap AI generation)** — no API key storage or direct
  `api.anthropic.com` calls from the browser. The copy-paste prompt flow
  (already the native app's default path) is the only generation method
  here, not a fallback.
