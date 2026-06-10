// =============================================================================
// config/Config.gs  —  v4.1.0
// =============================================================================
// CONFIRMED from live API response (June 2026):
//
//   _internal_stage_id         → decoded to Status via STAGE_MAP
//   _internal_contact_owner_id → decoded to Agent Name+Email via AGENT_MAP
//   _internal_closure_date     → closure date (format: "2026-06-19T05:54:43.915000")
//   _internal_lead_source      → lead entry channel e.g. "Whatsapp", "API"
//
//   lead_status_crm, account_owner_email_crm, closure_date
//   DO NOT EXIST in the API — do not use them.
//
// DATE FORMAT: stored as-is from API e.g. "2026-06-08T09:32:45"
//   No conversion applied — Looker Studio handles ISO strings natively.
// =============================================================================

var CONFIG = {

  API_KEY:        'YOUR_INTERAKT_SECRET_KEY_HERE',   // ← YOU EDIT THIS
  SPREADSHEET_ID: 'YOUR_GOOGLE_SPREADSHEET_ID_HERE', // ← YOU EDIT THIS

  SHEETS: {
    LEADS:     'Leads',
    SYNC_LOG:  'Sync_Log',
    CONFIG:    'Config',
    AGENTS:    'Agents',
    DASHBOARD: 'Dashboard',
  },

  DASHBOARD_SETTINGS: {
    CONVERSION_STATUSES: ['In-transit', 'Joined'],
  },

  API: {
    BASE_URL:        'https://api.interakt.ai/v1/public/apis/users/',
    PAGE_SIZE:       100,
    MAX_PAGES:       500,
    RETRY_ATTEMPTS:  3,
    RETRY_DELAY_MS:  2000,
  },

  // ---------------------------------------------------------------------------
  // AGENT MAP — _internal_contact_owner_id UUID → { name, email }
  //
  // 3 UUIDs confirmed from live API response (June 2026).
  // Run debugStageAndOwnerIds() to find any missing UUIDs.
  // ---------------------------------------------------------------------------
  // All UUIDs confirmed from debugStageAndOwnerIds() output (June 2026)
  AGENT_MAP: {
    '1aa41e09-e93b-4724-8ff0-fd7d050ef20a': { name: 'Shraddha Kakade',  email: 'shraddha.kakade@gramtarang.org.in'  },
    '7c7f1d1e-61b2-4bae-89ee-f02617a57f8b': { name: 'Harshita Khari',   email: 'harshita.khari@gramtarang.org.in'   },
    'a11330f3-d433-41ea-8e4c-8f04ac32056a': { name: 'Mansi Yadav',      email: 'mansi.yadav@gramtarang.org.in'      },
    'bc60e275-b62b-45d0-8695-d8f1a6e5a7e5': { name: 'Monalisha Panda',  email: 'monalisha.panda@gramtarang.org.in'  },
    'fd8d4c22-82fd-44ae-9b63-cad6fe2f8d4e': { name: 'Srishti Baliyan',  email: 'srishti.baliyan@gramtarang.org.in'  },
    // Add Kashish Kaushik and Kriti Khari UUIDs once found via debugStageAndOwnerIds()
  },

  // ---------------------------------------------------------------------------
  // STAGE MAP — _internal_stage_id UUID → Status Name
  //
  // 5 UUIDs confirmed from live API response (June 2026).
  // Run debugStageAndOwnerIds() to find remaining 8 UUIDs.
  // ---------------------------------------------------------------------------
  // All 13 UUIDs confirmed from screenshot (June 2026)
  // Note: "Offered" has no UUID assigned in Interakt yet (-na-)
  STAGE_MAP: {
    '0d0b63f4-dcdf-4dd9-b03e-a6206a325abe': 'New Lead',
    '18a4a3fa-ede8-4032-8ed5-e4eaea6ef9fb': 'Not Qualified',
    '4ed9abd7-2741-4ca9-b6b4-95d859bcbdc4': 'Qualified',
    'd22b2f98-98df-4b55-adbe-7be4ff87ffee': 'Offer Accepted',
    '5b2e66bf-bfdd-4699-9697-dd5dca87a040': 'Date of Joining Confirmed',
    '8545748a-5688-4b5b-a1da-048fcb239794': 'In-transit',
    '522d780d-0a96-4d21-bc6a-44e675cc3a81': 'Joined',
    'c72d2eea-660f-447b-ba9d-96ba285c7eb4': 'Not Interested',
    '1991a06d-e88c-42fd-b8c3-9fbfb1dbf7f9': 'Follow up',
    '54132ece-99f7-4fa0-a906-d481c5af2de2': 'Offer diff role',
    '55aa1933-c927-4994-bfb7-7a0c8baae211': 'Not Answered',
    '74edf100-2f82-4f69-8305-bf28d7deb849': 'Dropout',
    // 'Offered' has no UUID in Interakt yet — add when assigned
  },

  // ---------------------------------------------------------------------------
  // STANDARD FIELDS — top-level on the customer object
  // Confirmed from live API JSON (June 2026)
  // ---------------------------------------------------------------------------
  STANDARD_FIELDS: [
    'phoneNumber',     // API: phone_number              (upsert key)
    'countryCode',     // API: country_code              (comes as "+91", strip +)
    'name',            // API: traits.name
    'email',           // API: traits.email
    'created_at_utc',  // API: created_at_utc            format: "2026-06-08T09:32:45"
    'modified_at_utc', // API: modified_at_utc           format: "2026-06-08T17:04:47.425000"
    'tags',            // API: tags[]
    'user_id',         // API: user_id
    'interakt_id',     // API: id                        (UUID)
    'entry_channel',   // API: customer_created_at_source e.g. "Track","MessagePersister"
    'channel_type',    // API: channel_type              e.g. "Whatsapp","Instagram"
  ],

  // ---------------------------------------------------------------------------
  // TRAIT FIELDS — inside user.traits{}
  // Confirmed from live API JSON response (June 2026)
  //
  // DERIVED fields (type:'derived') are computed from UUID lookups:
  //   status               ← decoded from traits._internal_stage_id via STAGE_MAP
  //   account_owner_name   ← decoded from traits._internal_contact_owner_id via AGENT_MAP
  //   account_owner_email  ← decoded from traits._internal_contact_owner_id via AGENT_MAP
  // ---------------------------------------------------------------------------
  TRAIT_FIELDS: [

    // ── CORE ─────────────────────────────────────────────────────────────────
    { key: 'status',                     label: 'Status',              tier: 'CORE',   type: 'derived'   },
    { key: 'account_owner_name',         label: 'Account Owner Name',  tier: 'CORE',   type: 'derived'   },
    { key: 'account_owner_email',        label: 'Account Owner Email', tier: 'CORE',   type: 'derived'   },
    { key: '_internal_closure_date',     label: 'Closure Due On',      tier: 'CORE',   type: 'datetime'  },
    { key: 'deal_value',                 label: 'Deal Value',          tier: 'CORE',   type: 'number'    },
    { key: 'whatsapp_opted_in',          label: 'WhatsApp Opted In',   tier: 'CORE',   type: 'boolean'   },

    // ── HIGH ─────────────────────────────────────────────────────────────────
    { key: 'lead_source',                label: 'Lead Source',         tier: 'HIGH',   type: 'text'      },
    { key: '_internal_lead_source',      label: 'Internal Lead Source',tier: 'HIGH',   type: 'text'      },
    { key: 'campaign_name',              label: 'Campaign Name',       tier: 'HIGH',   type: 'text'      },
    { key: 'campaign_id',                label: 'Campaign ID',         tier: 'HIGH',   type: 'text'      },
    { key: 'State',                      label: 'State',               tier: 'HIGH',   type: 'text'      },
    { key: 'City',                       label: 'City',                tier: 'HIGH',   type: 'text'      },
    { key: 'call_disposition',           label: 'Call Disposition',    tier: 'HIGH',   type: 'selection' },
    { key: 'remarks',                    label: 'Remarks',             tier: 'HIGH',   type: 'text'      },
    { key: 'company_name',               label: 'Company Name',        tier: 'HIGH',   type: 'text'      },

    // ── MEDIUM ───────────────────────────────────────────────────────────────
    { key: 'gender',                     label: 'Gender',              tier: 'MEDIUM', type: 'selection' },
    { key: 'age_in_years',               label: 'Age in Years',        tier: 'MEDIUM', type: 'number'    },
    { key: 'highestqualification',       label: 'Qualification',       tier: 'MEDIUM', type: 'selection' },
    { key: 'year_of_passing',            label: 'Year of Passing',     tier: 'MEDIUM', type: 'number'    },
    { key: 'years_of_experience',        label: 'Years of Experience', tier: 'MEDIUM', type: 'number'    },
    { key: 'work_specialisation',        label: 'Work Specialisation', tier: 'MEDIUM', type: 'text'      },
    { key: 'current_salary',             label: 'Current Salary',      tier: 'MEDIUM', type: 'number'    },
    { key: 'expected_salary',            label: 'Expected Salary',     tier: 'MEDIUM', type: 'number'    },
    { key: 'preferred_city',             label: 'Preferred City',      tier: 'MEDIUM', type: 'text'      },
    { key: 'preferred_state',            label: 'Preferred State',     tier: 'MEDIUM', type: 'text'      },
    { key: 'willing_to_relocate?',       label: 'Willing to Relocate', tier: 'MEDIUM', type: 'boolean'   },
    { key: 'current_pincode',            label: 'Current Pincode',     tier: 'MEDIUM', type: 'number'    },
    { key: 'location',                   label: 'Location',            tier: 'MEDIUM', type: 'text'      },
    { key: 'rank',                       label: 'Rank',                tier: 'MEDIUM', type: 'number'    },

    // ── LOW ──────────────────────────────────────────────────────────────────
    { key: 'source_id',                  label: 'Source ID',           tier: 'LOW',    type: 'text'      },
    { key: 'source_url',                 label: 'Source URL',          tier: 'LOW',    type: 'link'      },
    { key: 'marked_spam',                label: 'Marked as Spam',      tier: 'LOW',    type: 'boolean'   },
    { key: '_internal_stage_id',         label: 'Stage UUID',          tier: 'LOW',    type: 'text'      },
    { key: '_internal_contact_owner_id', label: 'Owner UUID',          tier: 'LOW',    type: 'text'      },
  ],

  // ---------------------------------------------------------------------------
  // COMPUTED COLUMNS — formula cells, never overwritten by sync
  // ---------------------------------------------------------------------------
  COMPUTED_COLUMNS: [
    {
      key:     'lead_age_days',
      label:   'Lead Age (Days)',
      formula: '=IF(ISBLANK({created_at_col}2),"",DAYS(TODAY(),DATEVALUE(LEFT({created_at_col}2,10))))',
    },
    {
      key:     'days_to_closure',
      label:   'Days to Closure',
      formula: '=IF(OR(ISBLANK({created_at_col}2),ISBLANK({closure_col}2)),"",DAYS(DATEVALUE(LEFT({closure_col}2,10)),DATEVALUE(LEFT({created_at_col}2,10))))',
    },
  ],

  TRIGGERS: {
    INCREMENTAL_EVERY_HOURS: 1,
    FULL_SYNC_DAY_OF_WEEK:   'SUNDAY',
    FULL_SYNC_HOUR:          2,
  },

  CONFIG_KEYS: {
    LAST_INCREMENTAL_SYNC: 'last_incremental_sync',
    LAST_FULL_SYNC:        'last_full_sync',
    PIPELINE_VERSION:      'pipeline_version',
  },

  PIPELINE_VERSION: '4.1.0',
};

// =============================================================================
// Derived helpers — DO NOT EDIT
// =============================================================================

function getLeadHeaders() {
  var std = CONFIG.STANDARD_FIELDS.slice();
  var traits = [];
  ['CORE','HIGH','MEDIUM','LOW'].forEach(function(tier) {
    CONFIG.TRAIT_FIELDS
      .filter(function(t) { return t.tier === tier; })
      .forEach(function(t) { traits.push(t.key); });
  });
  var computed = CONFIG.COMPUTED_COLUMNS.map(function(c) { return c.key; });
  return std.concat(traits).concat(computed).concat(['_row_hash','_last_synced_at']);
}

function getLeadLabelRow() {
  var stdLabels = {
    phoneNumber:     'Phone Number',
    countryCode:     'Country Code',
    name:            'Name',
    email:           'Email',
    created_at_utc:  'Creation Date',
    modified_at_utc: 'Last Modified',
    tags:            'Tags',
    user_id:         'User ID',
    interakt_id:     'Interakt ID',
    entry_channel:   'Entry Channel',
    channel_type:    'Channel Type',
    _row_hash:       '_row_hash',
    _last_synced_at: '_last_synced_at',
  };
  return getLeadHeaders().map(function(key) {
    if (stdLabels[key]) return stdLabels[key];
    var t = CONFIG.TRAIT_FIELDS.filter(function(t) { return t.key === key; })[0];
    if (t) return t.label;
    var c = CONFIG.COMPUTED_COLUMNS.filter(function(c) { return c.key === key; })[0];
    if (c) return c.label;
    return key;
  });
}

function getUniqueKeyHeader() { return 'phoneNumber'; }
function getHeaderIndex(key)  { return getLeadHeaders().indexOf(key); }