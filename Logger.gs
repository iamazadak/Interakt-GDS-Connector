// =============================================================================
// lib/Logger.gs  —  v4.1.0
// =============================================================================
// No functional changes from previous version.
// Structural logging to Stackdriver + Sync_Log sheet tab.
// =============================================================================

var SyncLogger = (function() {

  var _runId          = null;
  var _startTime      = null;
  var _syncType       = null;
  var _messages       = [];
  var _errorCount     = 0;
  var _recordsAdded   = 0;
  var _recordsUpdated = 0;
  var _pagesProcessed = 0;

  function beginRun(syncType) {
    _runId          = Utilities.getUuid();
    _startTime      = new Date();
    _syncType       = syncType;
    _messages       = [];
    _errorCount     = 0;
    _recordsAdded   = 0;
    _recordsUpdated = 0;
    _pagesProcessed = 0;
    _console('INFO', 'Run started', { syncType: syncType, runId: _runId });
  }

  function info(message, data)  { _log('INFO',  message, data); }
  function warn(message, data)  { _log('WARN',  message, data); }
  function error(message, data) { _errorCount++; _log('ERROR', message, data); }

  function incrementAdded(count)   { _recordsAdded   += (count || 1); }
  function incrementUpdated(count) { _recordsUpdated += (count || 1); }
  function incrementPages(count)   { _pagesProcessed += (count || 1); }

  function endRun(status) {
    status = status || 'SUCCESS';
    var duration = Math.round((new Date() - _startTime) / 1000);
    _console('INFO', 'Run finished', {
      status:         status,
      durationSec:    duration,
      recordsAdded:   _recordsAdded,
      recordsUpdated: _recordsUpdated,
      pagesProcessed: _pagesProcessed,
      errorCount:     _errorCount,
    });
    _writeSummaryToSheet({
      run_id:          _runId,
      sync_type:       _syncType,
      started_at:      _startTime.toISOString(),
      finished_at:     new Date().toISOString(),
      duration_sec:    duration,
      status:          _errorCount > 0 ? 'PARTIAL' : status,
      records_added:   _recordsAdded,
      records_updated: _recordsUpdated,
      pages_processed: _pagesProcessed,
      error_count:     _errorCount,
      notes:           _messages
                         .filter(function(m) { return m.level !== 'INFO'; })
                         .map(function(m) { return '[' + m.level + '] ' + m.message; })
                         .slice(0, 5)
                         .join(' | '),
    });
  }

  function _log(level, message, data) {
    _messages.push({ level: level, message: message, data: data });
    _console(level, message, data);
  }

  function _console(level, message, data) {
    var out = '[' + level + '] ' + message;
    if (data) out += ' ' + JSON.stringify(data);
    if      (level === 'ERROR') console.error(out);
    else if (level === 'WARN')  console.warn(out);
    else                        console.log(out);
  }

  function _writeSummaryToSheet(summary) {
    try {
      var ss    = SpreadsheetApp.openById(CONFIG.SPREADSHEET_ID);
      var sheet = SheetManager.getOrCreateSheet(ss, CONFIG.SHEETS.SYNC_LOG, _syncLogHeaders());
      var row   = _syncLogHeaders().map(function(h) {
        return summary[h] !== undefined ? summary[h] : '';
      });
      sheet.appendRow(row);
      // Keep only last 500 log rows
      var totalRows = sheet.getLastRow();
      if (totalRows > 501) sheet.deleteRows(2, totalRows - 501);
    } catch (e) {
      console.error('[Logger] Failed to write to Sync_Log: ' + e.message);
    }
  }

  function _syncLogHeaders() {
    return [
      'run_id', 'sync_type', 'started_at', 'finished_at',
      'duration_sec', 'status', 'records_added', 'records_updated',
      'pages_processed', 'error_count', 'notes',
    ];
  }

  return {
    beginRun:        beginRun,
    endRun:          endRun,
    info:            info,
    warn:            warn,
    error:           error,
    incrementAdded:  incrementAdded,
    incrementUpdated:incrementUpdated,
    incrementPages:  incrementPages,
  };

})();