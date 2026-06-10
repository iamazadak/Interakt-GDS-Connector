// =============================================================================
// jobs/IncrementalSync.gs  —  v4.1.0
// =============================================================================
// Changes from previous version:
//   1. Removed Pass 2 entirely — it called fetchByStatusSince() which used
//      lead_status_crm as a filter, causing HTTP 400 from Interakt API.
//   2. Removed LEAD_STATUSES reference — no longer needed.
//   3. Removed comment referencing LEAD_STATUSES from FullSync.gs —
//      that variable no longer exists in v4.1 FullSync.gs.
//   4. Single-pass incremental sync only — Status/Owner decoded from
//      _internal_stage_id and _internal_contact_owner_id UUIDs which are
//      present in every modified contact's traits{} automatically.
// =============================================================================

var INCREMENTAL_FALLBACK_BASELINE = '2000-01-01T00:00:00.000Z';

/**
 * Entry point — called by the hourly time-driven trigger.
 * Can also be run manually from the GAS editor.
 */
function runIncrementalSync() {
  SyncLogger.beginRun('INCREMENTAL_SYNC');

  try {
    SheetManager.initialiseSheets();

    var sinceIso = _getLastSyncTimestamp();
    SyncLogger.info('IncrementalSync: pulling contacts modified since', { since: sinceIso });

    var users = InteraktClient.fetchModifiedSince(sinceIso);

    if (!users || users.length === 0) {
      SyncLogger.info('IncrementalSync: no changes since last run — nothing to do');
      SheetManager.setConfigValue(
        CONFIG.CONFIG_KEYS.LAST_INCREMENTAL_SYNC,
        new Date().toISOString()
      );
      SyncLogger.endRun('NO_CHANGES');
      return;
    }

    SyncLogger.info('IncrementalSync: contacts to process', { count: users.length });
    var rows   = users.map(function(user) { return FieldMapper.userToRow(user); });
    var result = SheetManager.upsertRows(rows);

    // Persist new baseline only after a successful upsert
    // (on error: timestamp NOT updated so next run retries the same window)
    SheetManager.setConfigValue(
      CONFIG.CONFIG_KEYS.LAST_INCREMENTAL_SYNC,
      new Date().toISOString()
    );

    SyncLogger.info('IncrementalSync complete', result);
    SyncLogger.endRun('SUCCESS');

  } catch (e) {
    SyncLogger.error('IncrementalSync failed', { message: e.message, stack: e.stack });
    SyncLogger.endRun('ERROR');
    throw e;
  }
}

// ---------------------------------------------------------------------------
// Private: timestamp resolution — 3-level priority
// ---------------------------------------------------------------------------

/**
 * Returns the ISO timestamp to use as the "since" filter.
 *
 * Priority:
 *   1. LAST_INCREMENTAL_SYNC from Config sheet  → normal hourly run
 *   2. LAST_FULL_SYNC from Config sheet          → first incremental after full sync
 *   3. INCREMENTAL_FALLBACK_BASELINE (2000-01-01)→ very first run ever
 */
function _getLastSyncTimestamp() {
  var lastIncremental = SheetManager.getConfigValue(CONFIG.CONFIG_KEYS.LAST_INCREMENTAL_SYNC);
  if (lastIncremental && lastIncremental.trim().length > 0) {
    SyncLogger.info('Using last incremental sync timestamp', { since: lastIncremental });
    return lastIncremental.trim();
  }

  var lastFull = SheetManager.getConfigValue(CONFIG.CONFIG_KEYS.LAST_FULL_SYNC);
  if (lastFull && lastFull.trim().length > 0) {
    SyncLogger.info('No incremental timestamp — using last full sync timestamp', { since: lastFull });
    return lastFull.trim();
  }

  SyncLogger.info('No timestamps found — using baseline', { baseline: INCREMENTAL_FALLBACK_BASELINE });
  return INCREMENTAL_FALLBACK_BASELINE;
}