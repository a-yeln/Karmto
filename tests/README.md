# Karmto regression tests

`index.html` is a single-file app with no backend code in this repo (the real
backend is a Google Apps Script web app, deployed separately). These tests
load `index.html` from a local static server, replace `window.storage` with
an in-memory mock, seed realistic fixture data, drive the UI with Playwright,
and assert on the resulting DOM. No real backend/network calls happen.

## Running

```
cd tests
npm install          # first time only — downloads Playwright + a Chromium build
npm test
```

In this sandboxed dev environment Chromium is already installed at
`/opt/pw-browsers/chromium` and `run-all.js` finds it automatically — no
`npm install` / `playwright install` needed here.

To run a single spec directly:

```
node specs/outstanding-datesort-stats.spec.js
```

(`run-all.js` starts an HTTP server on port 8765 for you; running a single
spec directly requires one already running — e.g.
`python3 -m http.server 8765 &` from the repo root first.)

## Why this exists

Before this suite existed, every bug-fix session in this repo wrote
throwaway Playwright scripts into a temp scratchpad to verify a fix, then
discarded them when the session ended. That meant the same class of bug
could silently regress later with nothing to catch it. **Every fix or
feature from now on should add or update a spec here** instead of (or in
addition to) a scratch verification script — that's the whole point.

## Writing a new spec

Each spec is a **self-contained** Node script (not a shared test-runner
framework) that:

1. Launches Chromium via `chromium.launch(process.env.PW_CHROMIUM_PATH ? { executablePath: process.env.PW_CHROMIUM_PATH } : {})`
2. Navigates to `(process.env.BASE_URL || 'http://localhost:8765') + '/index.html'`
3. Strips the "เชื่อมต่อฐานข้อมูลไม่ได้" connection-error banner that appears
   because there's no real backend
4. Installs a mock `window.storage` (get/set/delete/list/patchField/patchOps)
   backed by an in-memory `window.__store` object, plus
   `window.bulkGetStorageImpl`
5. Seeds `window.__store` with realistic day/lot/settings fixtures
6. Drives the UI (clicks, fills, `switchTab(...)`) and asserts on the DOM
7. Prints `PASS`/`FAIL` lines via a small `check(label, cond, extra)` helper
   and exits non-zero if anything failed

Copy the shape of any existing spec in `specs/` — they're all written the
same way. Two mock-storage details that have bitten us before:

- `patchOps(key, ops, rootIsArray)` is called with **two different op
  shapes** depending on call site: `{matchField, nested:{...}}` (array-item
  patch) and `{path:[...], value}` (plain-object patch, e.g.
  `billingRecheckCurrent`). A mock that only handles one shape will make
  unrelated-looking specs fail with confusing errors — look at
  `recheck-round-summary.spec.js` for a mock that handles both.
- Always call the shared `stripBanner(page)` helper after any action that
  triggers a re-render, not just once after page load — the banner can
  reappear.

## Current coverage

- **Lot / cost-settle correctness**: orphaned-cost audit (today + past
  dates), lot-gap warnings, lot-delete orphan-bill cleanup, in-flight-guard
  toast feedback, claim/waste FIFO race fix, purchase-delete rollback retry
  behavior.
- **Billing / outstanding-bills UI**: recheck-mode round summary (counts,
  "เหลือ" filter chip, clear-round), month/year total display, inline
  paid-date tag placement, date-sort 3-state toggle + summary stats box,
  no-full-reload guarantees on quickpay-confirm and recheck-confirm.

This is **not** exhaustive — it's the set of specs that were already proven
to pass against the current `index.html` when this suite was first
committed. Known gaps (not yet covered): debts, personal income/expense,
leftover/waste beyond the claim-race fix, OCR order parsing, settings, the
calendar date-range summary, and most of the older UI redesign rounds.
Add specs for these as you touch that code, rather than all at once.
