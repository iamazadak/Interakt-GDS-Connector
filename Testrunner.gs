// =============================================================================
// tests/TestRunner.gs  —  v4.1.0
// =============================================================================
// Changes from previous version:
//   1. _mockUser() updated to use actual API field structure:
//      - phone_number (not phoneNumber) as top-level
//      - country_code (not countryCode)
//      - name/email inside traits{} (not top-level)
//      - _internal_stage_id instead of lead_status_crm
//      - _internal_contact_owner_id instead of account_owner_email_crm
//      - _internal_closure_date instead of closure_date
//   2. test_FieldMapper_fullUser() — asserts phone via phone_number key
//   3. test_FieldMapper_missingTraits() — checks 'status' not 'lead_status_crm'
//   4. test_FieldMapper_hashChange() — uses _internal_stage_id for change
//   5. test_FieldMapper_dates() — checks '_internal_closure_date' column
//   6. testApiConnection() — fixed response key from parsed.users to parsed.data.customers
// =============================================================================

function testAll() {
  var results = [
    _test('Config: getLeadHeaders returns array',         test_Config_getLeadHeaders),
    _test('Config: getLeadLabelRow matches headers',      test_Config_labelRowLength),
    _test('Config: no duplicate header keys',             test_Config_noDuplicateKeys),
    _test('Config: TRAIT_FIELDS all have required props', test_Config_traitFieldShape),
    _test('Config: STAGE_MAP has entries',                test_Config_stagemap),
    _test('Config: AGENT_MAP has entries',                test_Config_agentmap),
    _test('FieldMapper: maps a full mock user',           test_FieldMapper_fullUser),
    _test('FieldMapper: decodes _internal_stage_id',      test_FieldMapper_statusDecode),
    _test('FieldMapper: decodes _internal_contact_owner', test_FieldMapper_ownerDecode),
    _test('FieldMapper: normalises boolean values',       test_FieldMapper_booleans),
    _test('FieldMapper: normalises number values',        test_FieldMapper_numbers),
    _test('FieldMapper: datetime stored as-is',           test_FieldMapper_datetime),
    _test('FieldMapper: handles missing traits',          test_FieldMapper_missingTraits),
    _test('FieldMapper: hash changes on update',          test_FieldMapper_hashChange),
    _test('SheetManager: can open spreadsheet',           test_SheetManager_openSheet),
  ];

  var passed = results.filter(function(r) { return r.ok; }).length;
  var failed = results.length - passed;

  console.log('\n══════════════════════════════════════');
  console.log('TEST RESULTS: ' + passed + ' passed / ' + failed + ' failed');
  console.log('══════════════════════════════════════');
  results.forEach(function(r) {
    console.log((r.ok ? '  ✅' : '  ❌') + '  ' + r.name + (r.error ? ' → ' + r.error : ''));
  });

  if (failed > 0) {
    console.log('\n⚠️  Fix failing tests before running setupTriggers()');
  } else {
    console.log('\n🟢  All tests passed — safe to run setupTriggers()');
  }
}

// ---------------------------------------------------------------------------
// Config tests
// ---------------------------------------------------------------------------

function test_Config_getLeadHeaders() {
  var h = getLeadHeaders();
  _assert(Array.isArray(h),        'should be an array');
  _assert(h.length > 10,           'should have > 10 columns, got ' + h.length);
  _assert(h[0] === 'phoneNumber',  'first column should be phoneNumber');
  _assert(h.indexOf('status') > -1,               'should have status column');
  _assert(h.indexOf('account_owner_name') > -1,   'should have account_owner_name column');
  _assert(h.indexOf('_internal_closure_date') > -1,'should have _internal_closure_date column');
  _assert(h.indexOf('_internal_stage_id') > -1,    'should have _internal_stage_id UUID column');
}

function test_Config_labelRowLength() {
  var keys   = getLeadHeaders();
  var labels = getLeadLabelRow();
  _assert(keys.length === labels.length,
    'key count (' + keys.length + ') must equal label count (' + labels.length + ')');
}

function test_Config_noDuplicateKeys() {
  var keys = getLeadHeaders();
  var seen = {}, dupes = [];
  keys.forEach(function(k) { if (seen[k]) dupes.push(k); seen[k] = true; });
  _assert(dupes.length === 0, 'duplicate keys found: ' + dupes.join(', '));
}

function test_Config_traitFieldShape() {
  CONFIG.TRAIT_FIELDS.forEach(function(t) {
    _assert(t.key,   'trait missing key: '   + JSON.stringify(t));
    _assert(t.label, 'trait missing label: ' + t.key);
    _assert(t.tier,  'trait missing tier: '  + t.key);
    _assert(t.type,  'trait missing type: '  + t.key);
  });
}

function test_Config_stagemap() {
  var keys = Object.keys(CONFIG.STAGE_MAP);
  _assert(keys.length > 0, 'STAGE_MAP should have at least one entry');
  // Verify known UUIDs from screenshots
  _assert(CONFIG.STAGE_MAP['0d0b63f4-dcdf-4dd9-b03e-a6206a325abe'] === 'New Lead',
    'New Lead UUID should map correctly');
  _assert(CONFIG.STAGE_MAP['18a4a3fa-ede8-4032-8ed5-e4eaea6ef9fb'] === 'Not Qualified',
    'Not Qualified UUID should map correctly');
}

function test_Config_agentmap() {
  var keys = Object.keys(CONFIG.AGENT_MAP);
  _assert(keys.length > 0, 'AGENT_MAP should have at least one entry');
  // Verify a known UUID from screenshots
  var agent = CONFIG.AGENT_MAP['a11330f3-d433-41ea-8e4c-8f04ac32056a'];
  _assert(agent && agent.name === 'Mansi Yadav',
    'Mansi Yadav UUID should map correctly, got: ' + (agent ? agent.name : 'undefined'));
}

// ---------------------------------------------------------------------------
// FieldMapper tests
// ---------------------------------------------------------------------------

function test_FieldMapper_fullUser() {
  var user = _mockUser();
  var row  = FieldMapper.userToRow(user);
  var keys = getLeadHeaders();

  _assert(row.length === keys.length,
    'row length ' + row.length + ' should equal header count ' + keys.length);

  // Phone — extracted from phone_number (snake_case, confirmed from API)
  _assert(row[0] === '919876543210',
    'phone should be "919876543210", got: ' + row[0]);

  // Country code — strip + prefix
  _assert(row[keys.indexOf('countryCode')] === '91',
    'countryCode should be "91" (+ stripped)');

  // Name — from traits.name
  _assert(row[keys.indexOf('name')] === 'Test User',
    'name should come from traits.name');

  // Email — from traits.email, lowercased
  _assert(row[keys.indexOf('email')] === 'test@example.com',
    'email should be lowercased');

  // Entry channel — from customer_created_at_source
  _assert(row[keys.indexOf('entry_channel')] === 'Track',
    'entry_channel should be "Track"');
}

function test_FieldMapper_statusDecode() {
  var user = _mockUser();
  // Set _internal_stage_id to a known mapped UUID
  user.traits['_internal_stage_id'] = '0d0b63f4-dcdf-4dd9-b03e-a6206a325abe';
  var row  = FieldMapper.userToRow(user);
  var keys = getLeadHeaders();
  var val  = row[keys.indexOf('status')];
  _assert(val === 'New Lead',
    'status should decode to "New Lead", got: "' + val + '"');
}

function test_FieldMapper_ownerDecode() {
  var user = _mockUser();
  // Set _internal_contact_owner_id to Mansi Yadav's UUID
  user.traits['_internal_contact_owner_id'] = 'a11330f3-d433-41ea-8e4c-8f04ac32056a';
  var row  = FieldMapper.userToRow(user);
  var keys = getLeadHeaders();

  var ownerName  = row[keys.indexOf('account_owner_name')];
  var ownerEmail = row[keys.indexOf('account_owner_email')];

  _assert(ownerName  === 'Mansi Yadav',
    'account_owner_name should be "Mansi Yadav", got: "' + ownerName + '"');
  _assert(ownerEmail === 'mansi.yadav@gramtarang.org.in',
    'account_owner_email should be correct, got: "' + ownerEmail + '"');
}

function test_FieldMapper_booleans() {
  var cases = [
    [true,    'TRUE'],
    [false,   'FALSE'],
    ['yes',   'TRUE'],
    ['no',    'FALSE'],
    ['1',     'TRUE'],
    ['0',     'FALSE'],
    ['true',  'TRUE'],
    ['false', 'FALSE'],
    ['',      ''],
    [null,    ''],
  ];
  cases.forEach(function(c) {
    var user = _mockUser();
    user.traits['whatsapp_opted_in'] = c[0];
    var row  = FieldMapper.userToRow(user);
    var keys = getLeadHeaders();
    var actual = row[keys.indexOf('whatsapp_opted_in')];
    _assert(actual === c[1],
      'boolean(' + JSON.stringify(c[0]) + ') expected "' + c[1] + '" got "' + actual + '"');
  });
}

function test_FieldMapper_numbers() {
  var cases = [
    ['50000',   50000],
    ['50,000',  50000],
    ['₹50,000', 50000],
    ['50K',     50000],
    ['1.5',     1.5],
    ['',        ''],
    ['N/A',     ''],
  ];
  cases.forEach(function(c) {
    var user = _mockUser();
    user.traits['deal_value'] = c[0];
    var row    = FieldMapper.userToRow(user);
    var keys   = getLeadHeaders();
    var actual = row[keys.indexOf('deal_value')];
    _assert(actual === c[1],
      'number(' + JSON.stringify(c[0]) + ') expected ' + c[1] + ' got ' + actual);
  });
}

function test_FieldMapper_datetime() {
  // v4.1: datetime fields stored as-is from API — no conversion
  var cases = [
    '2026-06-08T09:32:45',          // created_at_utc format
    '2026-06-08T17:04:47.425000',   // modified_at_utc format
    '2026-06-18T09:32:45.663000',   // _internal_closure_date format
  ];
  var user = _mockUser();
  var keys = getLeadHeaders();
  var idx  = keys.indexOf('_internal_closure_date');

  cases.forEach(function(dtStr) {
    user.traits['_internal_closure_date'] = dtStr;
    var row = FieldMapper.userToRow(user);
    _assert(row[idx] === dtStr,
      'datetime should be stored as-is: expected "' + dtStr + '" got "' + row[idx] + '"');
  });

  // created_at_utc and modified_at_utc are standard fields
  user.created_at_utc  = '2026-06-08T09:32:45';
  user.modified_at_utc = '2026-06-08T17:04:47.425000';
  var row2 = FieldMapper.userToRow(user);
  _assert(row2[keys.indexOf('created_at_utc')]  === '2026-06-08T09:32:45',
    'created_at_utc should be stored as-is');
  _assert(row2[keys.indexOf('modified_at_utc')] === '2026-06-08T17:04:47.425000',
    'modified_at_utc should be stored as-is');
}

function test_FieldMapper_missingTraits() {
  // Contact with completely empty traits — all derived/trait columns should be ''
  var user = {
    id:                          'test-uuid',
    phone_number:                '9100000000',
    country_code:                '+91',
    created_at_utc:              '2026-01-01T00:00:00',
    modified_at_utc:             '2026-01-01T00:00:00',
    customer_created_at_source:  'Track',
    channel_type:                'Whatsapp',
    traits: {},
  };
  var row  = FieldMapper.userToRow(user);
  var keys = getLeadHeaders();

  _assert(row.length === keys.length,
    'row should always have full column count even with empty traits');

  // Derived fields should be empty string, not undefined or error
  _assert(row[keys.indexOf('status')]             === '',
    'status should be empty string when _internal_stage_id missing');
  _assert(row[keys.indexOf('account_owner_name')] === '',
    'account_owner_name should be empty string when _internal_contact_owner_id missing');
  _assert(row[keys.indexOf('_internal_closure_date')] === '',
    '_internal_closure_date should be empty string when missing');
}

function test_FieldMapper_hashChange() {
  var user1 = _mockUser();
  var user2 = _mockUser();

  // Simulate status change via _internal_stage_id UUID
  user2.traits['_internal_stage_id'] = '4ed9abd7-2741-4ca9-b6b4-95d859bcbdc4'; // Qualified

  var row1 = FieldMapper.userToRow(user1);
  var row2 = FieldMapper.userToRow(user2);
  var hi   = getLeadHeaders().indexOf('_row_hash');

  _assert(row1[hi] !== row2[hi],
    'hash should differ when _internal_stage_id changes');
}

function test_SheetManager_openSheet() {
  try {
    var ss = SpreadsheetApp.openById(CONFIG.SPREADSHEET_ID);
    _assert(ss !== null, 'spreadsheet should open');
    _assert(ss.getName().length > 0, 'spreadsheet should have a name');
  } catch (e) {
    throw new Error('Cannot open SPREADSHEET_ID: ' + e.message +
      ' — update Config.gs with a valid spreadsheet ID');
  }
}

// ---------------------------------------------------------------------------
// Test harness
// ---------------------------------------------------------------------------

function _test(name, fn) {
  try {
    fn();
    return { name: name, ok: true };
  } catch (e) {
    return { name: name, ok: false, error: e.message };
  }
}

function _assert(condition, message) {
  if (!condition) throw new Error(message || 'Assertion failed');
}

/**
 * Mock user matching the ACTUAL Interakt API response structure (June 2026).
 * - phone_number at top-level (snake_case)
 * - country_code at top-level with + prefix
 * - name and email inside traits{}
 * - _internal_stage_id and _internal_contact_owner_id inside traits{}
 * - _internal_closure_date inside traits{}
 */
function _mockUser() {
  return {
    id:                         'mock-uuid-1234',
    phone_number:               '919876543210',
    country_code:               '+91',
    user_id:                    'usr_001',
    created_at_utc:             '2026-01-15T08:30:00',
    modified_at_utc:            '2026-06-01T12:00:00',
    customer_created_at_source: 'Track',
    channel_type:               'Whatsapp',
    tags:                       [],
    traits: {
      name:                       'Test User',
      email:                      'Test@Example.com',
      whatsapp_opted_in:          true,
      _internal_stage_id:         '0d0b63f4-dcdf-4dd9-b03e-a6206a325abe', // New Lead
      _internal_contact_owner_id: 'a11330f3-d433-41ea-8e4c-8f04ac32056a', // Mansi Yadav
      _internal_closure_date:     '2026-09-30T00:00:00',
      deal_value:                 '25000',
      lead_source:                'META',
      _internal_lead_source:      'API',
      campaign_name:              'June Push',
      campaign_id:                'CMP-001',
      City:                       'Mumbai',
      State:                      'Maharashtra',
      call_disposition:           'Interested',
      gender:                     'Male',
      age_in_years:               '28',
      highestqualification:       'Graduate',
      marked_spam:                false,
    },
  };
}