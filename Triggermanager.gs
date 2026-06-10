// =============================================================================
// jobs/TriggerManager.gs  —  v4.1.0
// =============================================================================
// No functional changes from previous version.
// Creates, lists, and removes Apps Script time-driven triggers.
// =============================================================================

/**
 * ⭐ MAIN SETUP FUNCTION
 * Run once from the GAS editor after pasting all files.
 * Select "setupTriggers" in the dropdown and click Run.
 */
function setupTriggers() {
  console.log('TriggerManager: Starting setup...');

  _removeAllProjectTriggers();

  SheetManager.initialiseSheets();
  console.log('TriggerManager: Sheets initialised');

  ScriptApp.newTrigger('runIncrementalSync')
    .timeBased()
    .everyHours(CONFIG.TRIGGERS.INCREMENTAL_EVERY_HOURS)
    .create();
  console.log('TriggerManager: Hourly incremental trigger created');

  var dayEnum = _dayOfWeekEnum(CONFIG.TRIGGERS.FULL_SYNC_DAY_OF_WEEK);
  ScriptApp.newTrigger('runFullSync')
    .timeBased()
    .onWeekDay(dayEnum)
    .atHour(CONFIG.TRIGGERS.FULL_SYNC_HOUR)
    .create();
  console.log('TriggerManager: Weekly full sync trigger created (' +
    CONFIG.TRIGGERS.FULL_SYNC_DAY_OF_WEEK + ' at ' +
    CONFIG.TRIGGERS.FULL_SYNC_HOUR + ':00)');

  console.log('TriggerManager: Running initial FullSync...');
  runFullSync();

  console.log('✅ TriggerManager: Setup complete! Pipeline is live.');
  _listTriggers();
}

function removeTriggers() {
  _removeAllProjectTriggers();
  console.log('TriggerManager: All project triggers removed.');
}

function listTriggers()       { _listTriggers(); }
function forceIncrementalSync() {
  console.log('TriggerManager: Force-running IncrementalSync');
  runIncrementalSync();
}
function forceFullSync() {
  console.log('TriggerManager: Force-running FullSync');
  runFullSync();
}

function _removeAllProjectTriggers() {
  var triggers = ScriptApp.getProjectTriggers();
  triggers.forEach(function(t) { ScriptApp.deleteTrigger(t); });
  console.log('TriggerManager: Removed ' + triggers.length + ' existing trigger(s)');
}

function _listTriggers() {
  var triggers = ScriptApp.getProjectTriggers();
  console.log('Active triggers (' + triggers.length + '):');
  triggers.forEach(function(t) {
    console.log('  → ' + t.getHandlerFunction() + ' | ' + t.getTriggerSource());
  });
}

function _dayOfWeekEnum(dayName) {
  var map = {
    'MONDAY':    ScriptApp.WeekDay.MONDAY,
    'TUESDAY':   ScriptApp.WeekDay.TUESDAY,
    'WEDNESDAY': ScriptApp.WeekDay.WEDNESDAY,
    'THURSDAY':  ScriptApp.WeekDay.THURSDAY,
    'FRIDAY':    ScriptApp.WeekDay.FRIDAY,
    'SATURDAY':  ScriptApp.WeekDay.SATURDAY,
    'SUNDAY':    ScriptApp.WeekDay.SUNDAY,
  };
  var result = map[dayName.toUpperCase()];
  if (!result) {
    throw new Error('Invalid FULL_SYNC_DAY_OF_WEEK: ' + dayName +
      '. Must be one of: ' + Object.keys(map).join(', '));
  }
  return result;
}