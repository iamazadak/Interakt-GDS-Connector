// =============================================================================
// lib/InteraktClient.gs  —  v4.1.0
// =============================================================================
// Confirmed API response envelope (June 2026):
// {
//   "result": true,
//   "message": "Customers",
//   "data": {
//     "total_customers": 6365,
//     "offset": 0,
//     "limit": 100,
//     "has_next_page": true,
//     "customers": [ ... ]   ← array is here, NOT at top-level
//   }
// }
//
// IMPORTANT: Interakt returns HTTP 400 if filters array is empty OR if you
// filter by lead_status_crm (not a supported filter field).
// Always send at least one valid filter e.g. created_at_utc > 2000-01-01
// =============================================================================

var InteraktClient = (function() {

  var FULL_SYNC_BASELINE = '2000-01-01T00:00:00.000Z';

  // ---------------------------------------------------------------------------
  // Public API
  // ---------------------------------------------------------------------------

  /**
   * Fetch ALL customers (full sync).
   * Uses created_at_utc > 2000-01-01 as the mandatory non-empty filter.
   */
  function fetchAllUsers() {
    SyncLogger.info('InteraktClient.fetchAllUsers started');
    return _paginatedFetch([
      { trait: 'created_at_utc', op: 'gt', val: FULL_SYNC_BASELINE },
    ]);
  }

  /**
   * Fetch customers modified since a given ISO timestamp (incremental sync).
   * @param {string} sinceIso  e.g. "2026-05-01T00:00:00.000Z"
   */
  function fetchModifiedSince(sinceIso) {
    SyncLogger.info('InteraktClient.fetchModifiedSince', { since: sinceIso });
    return _paginatedFetch([
      { trait: 'modified_at_utc', op: 'gt', val: sinceIso },
    ]);
  }

  // ---------------------------------------------------------------------------
  // Private: pagination loop
  // ---------------------------------------------------------------------------

  function _paginatedFetch(filters) {
    var allCustomers = [];
    var offset       = 0;
    var pageSize     = CONFIG.API.PAGE_SIZE;
    var maxPages     = CONFIG.API.MAX_PAGES;
    var pageNum      = 0;
    var hasNextPage  = true;

    while (hasNextPage && pageNum < maxPages) {
      var url      = CONFIG.API.BASE_URL + '?offset=' + offset + '&limit=' + pageSize;
      SyncLogger.info('Fetching page', { page: pageNum + 1, offset: offset });

      var response = _requestWithRetry(url, filters);
      var data     = response && response.data;

      if (!data || !Array.isArray(data.customers)) {
        SyncLogger.warn('Unexpected API response structure', {
          page:      pageNum + 1,
          topKeys:   response ? Object.keys(response).join(', ') : 'null',
          dataKeys:  data     ? Object.keys(data).join(', ')     : 'null',
          rawSample: response ? JSON.stringify(response).substring(0, 300) : 'null',
        });
        break;
      }

      allCustomers = allCustomers.concat(data.customers);
      hasNextPage  = !!data.has_next_page;
      offset      += pageSize;
      pageNum++;

      SyncLogger.incrementPages(1);
      SyncLogger.info('Page fetched', {
        page:            pageNum,
        customersOnPage: data.customers.length,
        totalSoFar:      allCustomers.length,
        totalCustomers:  data.total_customers,
        hasNextPage:     hasNextPage,
      });

      if (hasNextPage) Utilities.sleep(300);
    }

    if (pageNum >= maxPages) {
      SyncLogger.warn('MAX_PAGES cap reached', {
        maxPages: maxPages, totalFetched: allCustomers.length,
      });
    }

    SyncLogger.info('InteraktClient fetch complete', { totalCustomers: allCustomers.length });
    return allCustomers;
  }

  // ---------------------------------------------------------------------------
  // Private: HTTP request with retry + exponential back-off
  // ---------------------------------------------------------------------------

  function _requestWithRetry(url, filters) {
    var attempts = CONFIG.API.RETRY_ATTEMPTS;
    var delay    = CONFIG.API.RETRY_DELAY_MS;
    for (var attempt = 1; attempt <= attempts; attempt++) {
      try {
        return _doRequest(url, filters);
      } catch (e) {
        SyncLogger.warn('Request failed (attempt ' + attempt + '/' + attempts + ')', {
          url: url, error: e.message,
        });
        if (attempt < attempts) {
          Utilities.sleep(delay * attempt);
        } else {
          SyncLogger.error('All retries exhausted', { url: url, error: e.message });
          throw e;
        }
      }
    }
  }

  function _doRequest(url, filters) {
    var options = {
      method:             'post',
      contentType:        'application/json',
      payload:            JSON.stringify({ filters: filters }),
      headers:            { 'Authorization': 'Basic ' + CONFIG.API_KEY },
      muteHttpExceptions: true,
    };
    var raw        = UrlFetchApp.fetch(url, options);
    var statusCode = raw.getResponseCode();
    var body       = raw.getContentText();

    if (statusCode === 401) throw new Error('401 Unauthorized — check API_KEY in Config.gs');
    if (statusCode === 429) throw new Error('429 Rate limit — will retry');
    if (statusCode < 200 || statusCode >= 300) {
      throw new Error('Interakt API error ' + statusCode + ': ' + body.substring(0, 300));
    }
    try {
      return JSON.parse(body);
    } catch (e) {
      throw new Error('JSON parse failed: ' + body.substring(0, 200));
    }
  }

  return {
    fetchAllUsers:      fetchAllUsers,
    fetchModifiedSince: fetchModifiedSince,
  };

})();

// =============================================================================
// DEBUG FUNCTIONS — run from GAS editor dropdown, read-only, no sheet writes
// =============================================================================

/**
 * testApiConnection — confirms API key works and shows sample trait keys.
 */
function testApiConnection() {
  console.log('Testing Interakt API connection...');
  try {
    var url     = CONFIG.API.BASE_URL + '?offset=0&limit=1';
    var options = {
      method: 'post', contentType: 'application/json',
      payload: JSON.stringify({ filters: [{ trait: 'created_at_utc', op: 'gt', val: '2000-01-01T00:00:00.000Z' }] }),
      headers: { 'Authorization': 'Basic ' + CONFIG.API_KEY },
      muteHttpExceptions: true,
    };
    var resp   = UrlFetchApp.fetch(url, options);
    var code   = resp.getResponseCode();
    var body   = resp.getContentText();
    if (code === 401) { console.error('❌ 401 Unauthorized — check API_KEY'); return; }
    if (code !== 200) { console.error('❌ HTTP ' + code + ': ' + body.substring(0, 300)); return; }
    var parsed = JSON.parse(body);
    console.log('✅ API connected. total_count = ' + (parsed.data ? parsed.data.total_customers : 'N/A'));
    if (parsed.data && parsed.data.customers && parsed.data.customers.length > 0) {
      var c = parsed.data.customers[0];
      console.log('Top-level keys: ' + Object.keys(c).join(', '));
      console.log('Trait keys: ' + Object.keys(c.traits || {}).join(', '));
    }
  } catch (e) { console.error('❌ Error: ' + e.message); }
}

/**
 * debugRawApiResponse — prints full raw JSON of 2 contacts.
 */
function debugRawApiResponse() {
  console.log('--- RAW API RESPONSE (2 contacts) ---');
  var url     = CONFIG.API.BASE_URL + '?offset=0&limit=2';
  var options = {
    method: 'post', contentType: 'application/json',
    payload: JSON.stringify({ filters: [{ trait: 'created_at_utc', op: 'gt', val: '2000-01-01T00:00:00.000Z' }] }),
    headers: { 'Authorization': 'Basic ' + CONFIG.API_KEY },
    muteHttpExceptions: true,
  };
  var body = UrlFetchApp.fetch(url, options).getContentText();
  console.log(body.substring(0, 3000));
}

/**
 * debugStageAndOwnerIds — scans ALL contacts to find every unique
 * _internal_stage_id and _internal_contact_owner_id UUID.
 * Run this after adding new agents or statuses in Interakt.
 */
function debugStageAndOwnerIds() {
  console.log('=== Scanning all contacts for UUID mappings ===');
  var stageIds = {}, ownerIds = {};
  var offset = 0, hasNext = true, pages = 0;

  while (hasNext && pages < 100) {
    var options = {
      method: 'post', contentType: 'application/json',
      payload: JSON.stringify({ filters: [{ trait: 'created_at_utc', op: 'gt', val: '2000-01-01T00:00:00.000Z' }] }),
      headers: { 'Authorization': 'Basic ' + CONFIG.API_KEY },
      muteHttpExceptions: true,
    };
    var url    = CONFIG.API.BASE_URL + '?offset=' + offset + '&limit=100';
    var parsed = JSON.parse(UrlFetchApp.fetch(url, options).getContentText());
    var customers = (parsed.data && parsed.data.customers) ? parsed.data.customers : [];
    hasNext = parsed.data && parsed.data.has_next_page;
    offset += 100; pages++;

    customers.forEach(function(c) {
      var t = c.traits || {}, phone = c.phone_number || '?';
      if (t._internal_stage_id) {
        var s = t._internal_stage_id;
        if (!stageIds[s]) stageIds[s] = { count: 0, sample: phone };
        stageIds[s].count++;
      }
      if (t._internal_contact_owner_id) {
        var o = t._internal_contact_owner_id;
        if (!ownerIds[o]) ownerIds[o] = { count: 0, sample: phone };
        ownerIds[o].count++;
      }
    });
    if (pages % 10 === 0) console.log('Scanned ' + offset + ' contacts...');
  }

  console.log('\n══ STAGE IDs (' + Object.keys(stageIds).length + ' unique) ══');
  Object.keys(stageIds).forEach(function(id) {
    var mapped = CONFIG.STAGE_MAP[id] || '← NEEDS LABEL';
    console.log("  '" + id + "': '" + mapped + "',   // " + stageIds[id].count + ' contacts');
  });

  console.log('\n══ OWNER IDs (' + Object.keys(ownerIds).length + ' unique) ══');
  Object.keys(ownerIds).forEach(function(id) {
    var agent = CONFIG.AGENT_MAP[id];
    var label = agent ? agent.name + ' ✅' : '← NEEDS NAME + EMAIL';
    console.log("  '" + id + "': { name: '" + label + "' },   // " + ownerIds[id].count + ' contacts');
  });

  console.log('\n══ UNMAPPED ══');
  var unmappedStages = Object.keys(stageIds).filter(function(id) { return !CONFIG.STAGE_MAP[id]; });
  var unmappedOwners = Object.keys(ownerIds).filter(function(id) { return !CONFIG.AGENT_MAP[id]; });
  console.log('Unmapped stages: ' + (unmappedStages.length === 0 ? 'None ✅' : unmappedStages.join(', ')));
  console.log('Unmapped owners: ' + (unmappedOwners.length === 0 ? 'None ✅' : unmappedOwners.join(', ')));
  console.log('=== end ===');
}