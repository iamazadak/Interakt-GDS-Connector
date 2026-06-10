# Interakt → Google Sheets → Looker Studio Pipeline  v2.0.0

A modular Google Apps Script system that syncs all leads from Interakt's API
into Google Sheets on a schedule, with full upsert support and type-aware
normalisation for 30+ fields across 4 reporting tiers.

> 📚 **Documentation:** See the [Architecture Documentation](Architecture_Documentation.md) for detailed System Diagrams, Flowcharts, and Sequence Diagrams.

---

## Folder Structure

```
interakt-gsheets/
├── README.md
├── Architecture_Documentation.md  ← System diagrams and workflows
├── appsscript.json             ← GAS manifest (scopes, timezone)
│
├── config/
│   └── Config.gs               ← ALL user-editable settings live here
│
├── lib/
│   ├── InteraktClient.gs       ← HTTP client: auth, pagination, retry
│   ├── FieldMapper.gs          ← Type-aware API → row transform
│   ├── SheetManager.gs         ← Sheet read/write/upsert + tier styling
│   └── Logger.gs               ← Structured run logging to Sync_Log tab
│
├── jobs/
│   ├── FullSync.gs             ← Weekly full re-pull
│   ├── IncrementalSync.gs      ← Hourly: only modified_at > last run
│   └── TriggerManager.gs       ← Creates/removes time-driven triggers
│
└── tests/
    └── TestRunner.gs           ← 11 smoke tests (run before first sync)
```

---

## Quick Setup (5 steps)

### 1. Create a Google Sheet
Note the **Spreadsheet ID** from the URL:
`https://docs.google.com/spreadsheets/d/SPREADSHEET_ID/edit`

### 2. Open Apps Script
In the Sheet: **Extensions → Apps Script** → delete the default `Code.gs`.

### 3. Create each .gs file
Copy each file from this project in the same path names.
**File creation order matters for GAS:**
1. `config/Config.gs`
2. `lib/Logger.gs`
3. `lib/InteraktClient.gs`
4. `lib/FieldMapper.gs`
5. `lib/SheetManager.gs`
6. `jobs/FullSync.gs`
7. `jobs/IncrementalSync.gs`
8. `jobs/TriggerManager.gs`
9. `tests/TestRunner.gs`

### 4. Edit Config.gs
```js
API_KEY:        'your_interakt_secret_key',
SPREADSHEET_ID: 'your_google_sheet_id',
```

### 5. Run setup
Select `testAll` → Run (verify all 11 tests pass), then
select `setupTriggers` → Run.

**Order of execution during setup:**
1. Removes any existing project triggers to prevent duplicates.
2. Initializes all necessary Google Sheet tabs (`Leads`, `Sync_Log`, `Config`, `Agents`) and applies styling.
3. Schedules the **Hourly Incremental Sync** trigger.
4. Schedules the **Weekly Full Sync** trigger.
5. Executes an immediate **Full Sync** to pull all historical data into the spreadsheet.

---

## Field Tiers → Column Layout

| Tier | Colour band | Key fields |
|------|-------------|-----------|
| CORE | Dark navy | phone, status, owner, closure_date, deal_value |
| HIGH | Teal | company, lead_source, campaign, city, state, call_disposition |
| MEDIUM | Amber | gender, age, qualification, salary, relocation, appointment |
| LOW | Grey | user_id, source_id, source_url, marked_spam |
| COMPUTED | Green | lead_age_days, days_to_closure (formula columns) |

After CORE/HIGH/MEDIUM/LOW come two formula columns computed from dates:
- **Lead Age (Days)** — `TODAY() - created_at_utc`
- **Days to Closure** — `closure_date - created_at_utc`

These formula columns are never overwritten during syncs.

---

## Sync Behaviour

```
Every hour  → IncrementalSync
  Reads LAST_INCREMENTAL_SYNC from Config sheet
  Calls API with  modified_at_utc > that timestamp
  Upserts contacts (update if hash changed, append if new)
  Writes new timestamp on success (not on error → safe retry)

Every Sunday 2 AM  → FullSync
  Pulls ALL contacts (no date filter)
  Upserts entire dataset (reconciliation / backfill pass)
  Resets both sync timestamps to now
```

---

## Type Normalisation (FieldMapper)

| Interakt type | Sheet value | Example |
|---|---|---|
| `number` | JS Number | `"₹50,000"` → `50000` |
| `date` | ISO-8601 string | `"31/12/2025"` → `"2025-12-31"` |
| `boolean` | `"TRUE"` / `"FALSE"` | `"yes"` → `"TRUE"` |
| `selection` | Trimmed string | `" Warm "` → `"Warm"` |
| `link` | Full URL | `"example.com"` → `"https://example.com"` |
| `text` | Trimmed string | |

---

## Adding Custom Fields

In `Config.gs`, add to `TRAIT_FIELDS`:
```js
{ key: 'my_custom_trait', label: 'My Field', tier: 'HIGH', type: 'text' },
```
Then run `forceFullSync()` to backfill all rows.

---

## Looker Studio

1. Go to [lookerstudio.google.com](https://lookerstudio.google.com)
2. **Create → Report → Add data → Google Sheets**
3. Select spreadsheet → `Leads` tab
4. Recommended scorecards: Total Leads, New This Month, Avg Deal Value
5. Recommended charts:
   - Time series: `created_at_utc` (daily/weekly)
   - Bar: `Status` breakdown by `Account Owner`
   - Scatter: `Deal Value` vs `Lead Age (Days)`
   - Geo map: `City` / `State`
   - Funnel: `Status` field sorted by pipeline stage