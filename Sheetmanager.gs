// =============================================================================
// lib/SheetManager.gs  —  v4.1.0
// =============================================================================
// Changes from previous version:
//   1. _ensureAgentsSheet() — seeded with UUID→name/email from AGENT_MAP
//      (old version seeded email→name which was wrong for v4 UUID-based map)
//   2. _seedComputedFormulas() — closure column now correctly references
//      '_internal_closure_date' instead of old 'closure_date' key
//   3. No other functional changes
// =============================================================================

var SheetManager = (function() {

  var TIER_COLORS = {
    STANDARD: { bg: '#1a73e8', fg: '#ffffff' },
    CORE:     { bg: '#0f4c81', fg: '#ffffff' },
    HIGH:     { bg: '#0d7377', fg: '#ffffff' },
    MEDIUM:   { bg: '#e37400', fg: '#ffffff' },
    LOW:      { bg: '#5f6368', fg: '#ffffff' },
    META:     { bg: '#202124', fg: '#9aa0a6' },
    COMPUTED: { bg: '#137333', fg: '#ffffff' },
  };

  // ---------------------------------------------------------------------------
  // Sheet initialisation
  // ---------------------------------------------------------------------------

  function initialiseSheets() {
    var ss = _getSpreadsheet();
    _ensureLeadsSheet(ss);
    _ensureSyncLogSheet(ss);
    _ensureConfigSheet(ss);
    _ensureAgentsSheet(ss);
    SyncLogger.info('SheetManager.initialiseSheets complete');
  }

  function getOrCreateSheet(ss, name, headers) {
    var sheet = ss.getSheetByName(name);
    if (!sheet) {
      sheet = ss.insertSheet(name);
      SyncLogger.info('Created new sheet tab', { name: name });
    }
    if (sheet.getLastRow() === 0 || sheet.getRange(1, 1).getValue() === '') {
      sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
      _styleGenericHeader(sheet, headers.length);
    }
    return sheet;
  }

  // ---------------------------------------------------------------------------
  // Upsert — core sync operation
  // ---------------------------------------------------------------------------

  function upsertRows(rows) {
    if (!rows || rows.length === 0) return { added: 0, updated: 0, skipped: 0 };

    var ss       = _getSpreadsheet();
    var sheet    = ss.getSheetByName(CONFIG.SHEETS.LEADS);
    var keys     = getLeadHeaders();
    var numCols  = keys.length;
    var phoneIdx = keys.indexOf(getUniqueKeyHeader());
    var hashIdx  = keys.indexOf('_row_hash');

    var computedIdxs = CONFIG.COMPUTED_COLUMNS.map(function(c) {
      return keys.indexOf(c.key);
    });

    if (phoneIdx === -1) throw new Error('phoneNumber column missing from headers');

    var lastRow  = sheet.getLastRow();
    var existing = lastRow > 1
      ? sheet.getRange(2, 1, lastRow - 1, numCols).getValues()
      : [];

    var phoneIndex = {};
    existing.forEach(function(row, i) {
      var phone = String(row[phoneIdx]).trim();
      if (phone) phoneIndex[phone] = i + 2;
    });

    var toUpdate = [];
    var toInsert = [];
    var skipped  = 0;

    // Deduplicate incoming rows by phone number, keeping the first valid appearance
    var uniqueRows = [];
    var seenPhones = {};
    for (var i = 0; i < rows.length; i++) {
      if (!Array.isArray(rows[i]) || rows[i].length !== numCols) {
        SyncLogger.warn('Skipping row with wrong column count', {
          expected: numCols,
          got:      rows[i] ? rows[i].length : 'null',
          phone:    rows[i] ? rows[i][phoneIdx] : 'unknown',
        });
        skipped++;
        continue;
      }
      var phone = String(rows[i][phoneIdx]).trim();
      if (!phone) {
        skipped++;
        continue;
      }
      if (!seenPhones[phone]) {
        seenPhones[phone] = true;
        uniqueRows.push(rows[i]);
      } else {
        skipped++; // Skip duplicate
      }
    }

    uniqueRows.forEach(function(row) {
      var phone = String(row[phoneIdx]).trim();
      var sheetRowNum = phoneIndex[phone];
      
      if (sheetRowNum) {
        var existingIdx = sheetRowNum - 2;
        var existingRow = existing[existingIdx];

        if (!existingRow || existingRow.length <= hashIdx) {
          toInsert.push(row);
          phoneIndex[phone] = lastRow + toInsert.length + 1;
          return;
        }

        var existingHash = String(existingRow[hashIdx]).trim();
        var newHash      = String(row[hashIdx]).trim();
        if (existingHash === newHash) {
          skipped++;
        } else {
          toUpdate.push({ rowNum: sheetRowNum, data: row });
        }
      } else {
        toInsert.push(row);
        phoneIndex[phone] = lastRow + toInsert.length + 1;
      }
    });

    // Execute updates using batch-like logic to prevent Google Apps Script timeout
    toUpdate.forEach(function(item) {
      var cleanUpdate = item.data.map(function(val, i) {
        return computedIdxs.indexOf(i) !== -1 ? '' : val;
      });
      // Updating row by row drastically reduces API calls (1 per row vs 40 per row)
      sheet.getRange(item.rowNum, 1, 1, numCols).setValues([cleanUpdate]);
      _seedComputedFormulas(sheet, item.rowNum, 1);
    });

    // Batch-append inserts
    if (toInsert.length > 0) {
      var insertStart  = sheet.getLastRow() + 1;
      var cleanInserts = toInsert.map(function(row) {
        return row.map(function(val, i) {
          return computedIdxs.indexOf(i) !== -1 ? '' : val;
        });
      });
      sheet.getRange(insertStart, 1, cleanInserts.length, numCols).setValues(cleanInserts);
      _seedComputedFormulas(sheet, insertStart, toInsert.length);
    }

    var result = { added: toInsert.length, updated: toUpdate.length, skipped: skipped };
    SyncLogger.info('SheetManager.upsertRows', result);
    SyncLogger.incrementAdded(result.added);
    SyncLogger.incrementUpdated(result.updated);
    return result;
  }

  // ---------------------------------------------------------------------------
  // Config sheet key-value store
  // ---------------------------------------------------------------------------

  function getConfigValue(key) {
    var sheet = _getSpreadsheet().getSheetByName(CONFIG.SHEETS.CONFIG);
    if (!sheet || sheet.getLastRow() < 2) return '';
    var data = sheet.getRange(2, 1, sheet.getLastRow() - 1, 2).getValues();
    for (var i = 0; i < data.length; i++) {
      if (String(data[i][0]).trim() === key) return String(data[i][1]).trim();
    }
    return '';
  }

  function setConfigValue(key, value) {
    var sheet = _getSpreadsheet().getSheetByName(CONFIG.SHEETS.CONFIG);
    if (!sheet) { SyncLogger.warn('Config sheet missing'); return; }
    var data = sheet.getLastRow() > 1
      ? sheet.getRange(2, 1, sheet.getLastRow() - 1, 2).getValues()
      : [];
    for (var i = 0; i < data.length; i++) {
      if (String(data[i][0]).trim() === key) {
        sheet.getRange(i + 2, 2).setValue(value);
        return;
      }
    }
    sheet.appendRow([key, value]);
  }

  // ---------------------------------------------------------------------------
  // Private: sheet initialisation
  // ---------------------------------------------------------------------------

  function _ensureLeadsSheet(ss) {
    var labels = getLeadLabelRow();
    var keys   = getLeadHeaders();
    var sheet  = ss.getSheetByName(CONFIG.SHEETS.LEADS);
    if (!sheet) {
      sheet = ss.insertSheet(CONFIG.SHEETS.LEADS);
      sheet.getRange(1, 1, 1, labels.length).setValues([labels]);
      _styleLeadsHeader(sheet, keys);
    } else if (sheet.getLastRow() === 0 || sheet.getRange(1, 1).getValue() === '') {
      sheet.getRange(1, 1, 1, labels.length).setValues([labels]);
      _styleLeadsHeader(sheet, keys);
    }
    sheet.setFrozenRows(1);
    sheet.setFrozenColumns(1);
    return sheet;
  }

  function _ensureSyncLogSheet(ss) {
    getOrCreateSheet(ss, CONFIG.SHEETS.SYNC_LOG, [
      'run_id','sync_type','started_at','finished_at',
      'duration_sec','status','records_added','records_updated',
      'pages_processed','error_count','notes',
    ]);
  }

  function _ensureConfigSheet(ss) {
    var sheet = getOrCreateSheet(ss, CONFIG.SHEETS.CONFIG, ['key', 'value']);
    var existingVersion = getConfigValue(CONFIG.CONFIG_KEYS.PIPELINE_VERSION);
    if (!existingVersion) {
      sheet.appendRow([CONFIG.CONFIG_KEYS.PIPELINE_VERSION,      CONFIG.PIPELINE_VERSION]);
      sheet.appendRow([CONFIG.CONFIG_KEYS.LAST_INCREMENTAL_SYNC, '']);
      sheet.appendRow([CONFIG.CONFIG_KEYS.LAST_FULL_SYNC,        '']);
    }
  }

  function _ensureAgentsSheet(ss) {
    // FIX v4.1: AGENT_MAP is now UUID → {name, email}, not email → name.
    // Agents sheet shows: UUID | Agent Name | Agent Email
    var sheet = getOrCreateSheet(ss, CONFIG.SHEETS.AGENTS, ['Owner UUID', 'Agent Name', 'Agent Email']);
    if (sheet.getLastRow() <= 1) {
      var rows = Object.keys(CONFIG.AGENT_MAP).map(function(uuid) {
        var agent = CONFIG.AGENT_MAP[uuid];
        return [uuid, agent.name, agent.email];
      });
      if (rows.length > 0) {
        sheet.getRange(2, 1, rows.length, 3).setValues(rows);
      }
      SyncLogger.info('Agents sheet seeded', { count: rows.length });
    }
  }

  // ---------------------------------------------------------------------------
  // Private: header styling
  // ---------------------------------------------------------------------------

  function _styleLeadsHeader(sheet, keys) {
    var standardEnd = CONFIG.STANDARD_FIELDS.length;
    _applyHeaderColor(sheet, 1, standardEnd, TIER_COLORS.STANDARD);

    var col = standardEnd + 1;
    ['CORE', 'HIGH', 'MEDIUM', 'LOW'].forEach(function(tier) {
      var count = CONFIG.TRAIT_FIELDS.filter(function(t) { return t.tier === tier; }).length;
      if (count > 0) {
        _applyHeaderColor(sheet, col, col + count - 1, TIER_COLORS[tier]);
        col += count;
      }
    });

    var computedCount = CONFIG.COMPUTED_COLUMNS.length;
    if (computedCount > 0) {
      _applyHeaderColor(sheet, col, col + computedCount - 1, TIER_COLORS.COMPUTED);
      col += computedCount;
    }

    _applyHeaderColor(sheet, col, col + 1, TIER_COLORS.META);
    sheet.setFrozenRows(1);
  }

  function _applyHeaderColor(sheet, startCol, endCol, colors) {
    var range = sheet.getRange(1, startCol, 1, endCol - startCol + 1);
    range.setBackground(colors.bg);
    range.setFontColor(colors.fg);
    range.setFontWeight('bold');
    range.setFontSize(10);
  }

  function _styleGenericHeader(sheet, numCols) {
    var range = sheet.getRange(1, 1, 1, numCols);
    range.setBackground(TIER_COLORS.STANDARD.bg);
    range.setFontColor(TIER_COLORS.STANDARD.fg);
    range.setFontWeight('bold');
    sheet.setFrozenRows(1);
  }

  // ---------------------------------------------------------------------------
  // Private: computed formula seeding
  // FIX v4.1: closure column now looks up '_internal_closure_date'
  //           (old version used 'closure_date' which no longer exists)
  // ---------------------------------------------------------------------------

  function _seedComputedFormulas(sheet, startDataRow, numRows) {
    if (numRows === 0 || CONFIG.COMPUTED_COLUMNS.length === 0) return;

    var keys = getLeadHeaders();

    function colLetter(zeroIdx) {
      var n = zeroIdx + 1, letters = '';
      while (n > 0) {
        var rem = (n - 1) % 26;
        letters = String.fromCharCode(65 + rem) + letters;
        n = Math.floor((n - 1) / 26);
      }
      return letters;
    }

    // FIX: use '_internal_closure_date' — 'closure_date' does not exist in v4.1
    var createdCol = colLetter(keys.indexOf('created_at_utc'));
    var closureCol = colLetter(keys.indexOf('_internal_closure_date'));

    CONFIG.COMPUTED_COLUMNS.forEach(function(computed) {
      var colIdx = keys.indexOf(computed.key);
      if (colIdx === -1) return;
      var letter = colLetter(colIdx);

      for (var r = 0; r < numRows; r++) {
        var row     = startDataRow + r;
        var formula = computed.formula
          .replace(/\{created_at_col\}/g, createdCol)
          .replace(/\{closure_col\}/g,    closureCol)
          .replace(new RegExp(createdCol + '2', 'g'), createdCol + row)
          .replace(new RegExp(closureCol  + '2', 'g'), closureCol  + row);
        sheet.getRange(row, colIdx + 1).setFormula(formula);
      }
    });
  }

  function _getSpreadsheet() {
    return SpreadsheetApp.openById(CONFIG.SPREADSHEET_ID);
  }

  return {
    initialiseSheets: initialiseSheets,
    getOrCreateSheet: getOrCreateSheet,
    upsertRows:       upsertRows,
    getConfigValue:   getConfigValue,
    setConfigValue:   setConfigValue,
  };

})();