// =============================================================================
// jobs/FullSync.gs  —  v4.1.0
// =============================================================================
// Single-pass full sync. Pulls ALL contacts, upserts into Leads sheet.
//
// Status and Account Owner are decoded from UUID fields present in every
// contact's traits{} via STAGE_MAP and AGENT_MAP in Config.gs:
//   _internal_stage_id         → Status
//   _internal_contact_owner_id → Agent Name + Email
//   _internal_closure_date     → Closure date (stored as-is)
//
// The previous two-pass approach using lead_status_crm as a filter has been
// removed — Interakt returns HTTP 400 "lead_status_crm field is not supported".
// =============================================================================

function runFullSync() {
  SyncLogger.beginRun('FULL_SYNC');

  try {
    SyncLogger.info('FullSync: initialising sheets');
    SheetManager.initialiseSheets();

    SyncLogger.info('FullSync: fetching all contacts');
    var users = InteraktClient.fetchAllUsers();

    if (!users || users.length === 0) {
      SyncLogger.warn('FullSync: no contacts returned — check API key');
      SyncLogger.endRun('NO_DATA');
      return;
    }

    SyncLogger.info('FullSync: mapping to rows', { count: users.length });
    var rows        = users.map(function(u) { return FieldMapper.userToRow(u); });
    var expectedCols = getLeadHeaders().length;

    if (rows.length > 0 && rows[0].length !== expectedCols) {
      throw new Error(
        'Column mismatch: FieldMapper returned ' + rows[0].length +
        ' cols, expected ' + expectedCols +
        '. Re-check STANDARD_FIELDS + TRAIT_FIELDS + COMPUTED_COLUMNS in Config.gs.'
      );
    }
    SyncLogger.info('FullSync: column count OK', { cols: expectedCols });

    SyncLogger.info('FullSync: upserting into Leads sheet');
    var result = SheetManager.upsertRows(rows);

    var now = new Date().toISOString();
    SheetManager.setConfigValue(CONFIG.CONFIG_KEYS.LAST_FULL_SYNC, now);
    SheetManager.setConfigValue(CONFIG.CONFIG_KEYS.LAST_INCREMENTAL_SYNC, now);

    SyncLogger.info('FullSync complete', result);
    SyncLogger.endRun('SUCCESS');

  } catch (e) {
    SyncLogger.error('FullSync failed', { message: e.message, stack: e.stack });
    SyncLogger.endRun('ERROR');
    throw e;
  }
}