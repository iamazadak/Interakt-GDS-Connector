// =============================================================================
// analytics/Dashboard.gs  —  v1.0.0
// =============================================================================
// Generates a comprehensive Data Analyst dashboard from the Leads sheet.
// Run via the "Interakt -> Update Dashboard" custom menu.
// =============================================================================

function onOpen() {
  var ui = SpreadsheetApp.getUi();
  ui.createMenu('Interakt')
    .addItem('Update Dashboard', 'updateDashboard')
    .addToUi();
}

function updateDashboard() {
  SyncLogger.beginRun('DASHBOARD_UPDATE');
  try {
    var ss = SpreadsheetApp.openById(CONFIG.SPREADSHEET_ID);
    
    // 1. Fetch Data
    var leads = _readLeadsData(ss);
    if (!leads || leads.length === 0) {
      SpreadsheetApp.getUi().alert('No leads data found in the Leads sheet.');
      return;
    }
    
    // 2. Process Metrics
    var metrics = _processData(leads);
    
    // 3. Render Dashboard
    _writeDashboardUI(ss, metrics);
    
    SyncLogger.info('Dashboard updated successfully');
    SpreadsheetApp.getUi().alert('Dashboard updated successfully!');
    SyncLogger.endRun('SUCCESS');
  } catch (e) {
    SyncLogger.error('Dashboard update failed', { message: e.message, stack: e.stack });
    SpreadsheetApp.getUi().alert('Error updating dashboard: ' + e.message);
    SyncLogger.endRun('ERROR');
  }
}

// ---------------------------------------------------------------------------
// Private: Read & Map Data
// ---------------------------------------------------------------------------

function _readLeadsData(ss) {
  var sheet = ss.getSheetByName(CONFIG.SHEETS.LEADS);
  if (!sheet) return [];
  var lastRow = sheet.getLastRow();
  var lastCol = sheet.getLastColumn();
  if (lastRow < 2 || lastCol < 1) return [];
  
  var data = sheet.getRange(1, 1, lastRow, lastCol).getValues();
  var headers = data[0];
  var rows = data.slice(1);
  
  return rows.map(function(row) {
    var obj = {};
    headers.forEach(function(h, i) {
      obj[h] = row[i];
    });
    return obj;
  });
}

// ---------------------------------------------------------------------------
// Private: Aggregation & Processing Engine
// ---------------------------------------------------------------------------

function _processData(leads) {
  var conversionStatuses = CONFIG.DASHBOARD_SETTINGS ? CONFIG.DASHBOARD_SETTINGS.CONVERSION_STATUSES : ['In-transit', 'Joined'];
  
  var metrics = {
    kpi: {
      totalLeads: leads.length,
      conversions: 0,
      realizedDealValue: 0,
      totalTimeToConvert: 0,
      validTimeRecords: 0
    },
    funnel: {},
    dropoff: {},
    campaigns: {},
    sources: {},
    monthly: {},
    weekly: {},
    agents: {},
    geo: { states: {}, cities: {} },
    demo: { qualification: {}, gender: {} }
  };

  leads.forEach(function(lead) {
    var status = lead['status'] || 'Unknown';
    var isConversion = conversionStatuses.indexOf(status) !== -1;
    
    // KPI
    if (isConversion) {
      metrics.kpi.conversions++;
      var value = parseFloat(lead['deal_value']);
      if (!isNaN(value)) metrics.kpi.realizedDealValue += value;
      
      var daysToClosure = parseFloat(lead['days_to_closure']);
      if (!isNaN(daysToClosure)) {
        metrics.kpi.totalTimeToConvert += daysToClosure;
        metrics.kpi.validTimeRecords++;
      }
    }
    
    // Funnel
    metrics.funnel[status] = (metrics.funnel[status] || 0) + 1;
    
    // Drop-off
    if (!isConversion && status !== 'New Lead' && status !== 'Unknown') {
      var disposition = lead['call_disposition'] || 'No Disposition Recorded';
      if (!metrics.dropoff[disposition]) metrics.dropoff[disposition] = 0;
      metrics.dropoff[disposition]++;
    }
    
    // Campaigns
    var campName = lead['campaign_name'] || 'Organic / None';
    _initAgg(metrics.campaigns, campName);
    metrics.campaigns[campName].leads++;
    if (isConversion) {
      metrics.campaigns[campName].conversions++;
      var cval = parseFloat(lead['deal_value']);
      if (!isNaN(cval)) metrics.campaigns[campName].value += cval;
    }
    
    // Sources
    var source = lead['lead_source'] || lead['entry_channel'] || 'Unknown';
    _initAgg(metrics.sources, source);
    metrics.sources[source].leads++;
    if (isConversion) metrics.sources[source].conversions++;

    // Agent
    var agent = lead['account_owner_name'] || 'Unassigned';
    _initAgg(metrics.agents, agent);
    metrics.agents[agent].leads++;
    if (isConversion) {
      metrics.agents[agent].conversions++;
      var adays = parseFloat(lead['days_to_closure']);
      if (!isNaN(adays)) {
        metrics.agents[agent].timeSum += adays;
        metrics.agents[agent].timeCount++;
      }
    }

    // Time-series
    if (lead['created_at_utc']) {
      var d = new Date(lead['created_at_utc']);
      if (!isNaN(d.getTime())) {
        var monthKey = d.getFullYear() + '-' + ('0' + (d.getMonth() + 1)).slice(-2);
        _initAgg(metrics.monthly, monthKey);
        metrics.monthly[monthKey].leads++;
        if (isConversion) metrics.monthly[monthKey].conversions++;
        
        var weekKey = _getIsoWeek(d);
        _initAgg(metrics.weekly, weekKey);
        metrics.weekly[weekKey].leads++;
        if (isConversion) metrics.weekly[weekKey].conversions++;
      }
    }
    
    // Demographics & Geo
    if (isConversion) {
      var st = lead['State'] || 'Unknown';
      metrics.geo.states[st] = (metrics.geo.states[st] || 0) + 1;
      
      var ci = lead['City'] || 'Unknown';
      metrics.geo.cities[ci] = (metrics.geo.cities[ci] || 0) + 1;
      
      var hq = lead['highestqualification'] || 'Unknown';
      metrics.demo.qualification[hq] = (metrics.demo.qualification[hq] || 0) + 1;
      
      var gn = lead['gender'] || 'Unknown';
      metrics.demo.gender[gn] = (metrics.demo.gender[gn] || 0) + 1;
    }
  });

  return metrics;
}

function _initAgg(obj, key) {
  if (!obj[key]) obj[key] = { leads: 0, conversions: 0, value: 0, timeSum: 0, timeCount: 0 };
}

function _getIsoWeek(d) {
  var date = new Date(d.getTime());
  date.setHours(0, 0, 0, 0);
  date.setDate(date.getDate() + 3 - (date.getDay() + 6) % 7);
  var week1 = new Date(date.getFullYear(), 0, 4);
  var weekNum = 1 + Math.round(((date.getTime() - week1.getTime()) / 86400000 - 3 + (week1.getDay() + 6) % 7) / 7);
  return date.getFullYear() + '-W' + ('0' + weekNum).slice(-2);
}

// ---------------------------------------------------------------------------
// Private: Rendering UI
// ---------------------------------------------------------------------------

function _writeDashboardUI(ss, metrics) {
  var sheetName = CONFIG.SHEETS.DASHBOARD || 'Dashboard';
  var sheet = ss.getSheetByName(sheetName);
  if (!sheet) {
    sheet = ss.insertSheet(sheetName);
  } else {
    sheet.clear();
    var charts = sheet.getCharts();
    charts.forEach(function(c) { sheet.removeChart(c); });
  }

  // Styling helpers
  var cursorRow = 1;
  function writeHeader(text) {
    var r = sheet.getRange(cursorRow, 1, 1, 5);
    r.mergeAcross().setValue(text).setFontWeight('bold').setFontSize(14).setBackground('#f3f3f3');
    cursorRow += 2;
  }
  
  // 1. KPIs
  writeHeader('1. KEY PERFORMANCE INDICATORS & VELOCITY');
  var kpiData = [
    ['Total Leads', 'Total Conversions', 'Conversion Rate', 'Avg Time to Convert (Days)', 'Realized Deal Value'],
    [
      metrics.kpi.totalLeads, 
      metrics.kpi.conversions, 
      (metrics.kpi.totalLeads ? (metrics.kpi.conversions / metrics.kpi.totalLeads * 100).toFixed(1) + '%' : '0%'),
      (metrics.kpi.validTimeRecords ? (metrics.kpi.totalTimeToConvert / metrics.kpi.validTimeRecords).toFixed(1) : 'N/A'),
      '₹' + metrics.kpi.realizedDealValue.toLocaleString()
    ]
  ];
  sheet.getRange(cursorRow, 1, 2, 5).setValues(kpiData).setHorizontalAlignment('center');
  sheet.getRange(cursorRow, 1, 1, 5).setFontWeight('bold').setBackground('#0f4c81').setFontColor('#ffffff');
  cursorRow += 4;
  
  // 2. Funnel Analysis
  writeHeader('2. FUNNEL ANALYSIS');
  var funnelArr = [['Stage', 'Count']];
  var funnelOrder = ['New Lead', 'Qualified', 'Offer diff role', 'Offer Accepted', 'Date of Joining Confirmed', 'In-transit', 'Joined'];
  funnelOrder.forEach(function(st) {
    if (metrics.funnel[st] !== undefined) funnelArr.push([st, metrics.funnel[st]]);
  });
  // Add remaining
  Object.keys(metrics.funnel).forEach(function(st) {
    if (funnelOrder.indexOf(st) === -1) funnelArr.push([st, metrics.funnel[st]]);
  });
  
  if (funnelArr.length > 1) {
    sheet.getRange(cursorRow, 1, funnelArr.length, 2).setValues(funnelArr);
    sheet.getRange(cursorRow, 1, 1, 2).setFontWeight('bold').setBackground('#0f4c81').setFontColor('#ffffff');
    
    // Funnel Chart
    var fChart = sheet.newChart()
      .setChartType(Charts.ChartType.BAR)
      .addRange(sheet.getRange(cursorRow, 1, funnelArr.length, 2))
      .setPosition(cursorRow, 4, 0, 0)
      .setOption('title', 'Funnel Stages')
      .setOption('width', 500)
      .setOption('height', 300)
      .build();
    sheet.insertChart(fChart);
    
    cursorRow += Math.max(funnelArr.length + 2, 16);
  }

  // 2.5 Drop-off Analysis
  writeHeader('2.5 DROP-OFF ANALYSIS (LEAKAGE REASONS)');
  var dKeys = Object.keys(metrics.dropoff).sort(function(a, b) { return metrics.dropoff[b] - metrics.dropoff[a]; });
  var dData = [['Call Disposition / Reason', 'Count']];
  dKeys.forEach(function(k) { dData.push([k, metrics.dropoff[k]]); });
  
  if (dData.length > 1) {
    sheet.getRange(cursorRow, 1, dData.length, 2).setValues(dData);
    sheet.getRange(cursorRow, 1, 1, 2).setFontWeight('bold').setBackground('#0f4c81').setFontColor('#ffffff');
    
    var dChart = sheet.newChart()
      .setChartType(Charts.ChartType.PIE)
      .addRange(sheet.getRange(cursorRow, 1, Math.min(11, dData.length), 2))
      .setPosition(cursorRow, 4, 0, 0)
      .setOption('title', 'Top Drop-off Reasons')
      .setOption('width', 400)
      .setOption('height', 300)
      .build();
    sheet.insertChart(dChart);
    
    cursorRow += Math.max(dData.length + 2, 16);
  }

  // 3. Monthly Trends
  writeHeader('3. MONTHLY TRENDS');
  var mKeys = Object.keys(metrics.monthly).sort();
  var mData = [['Month', 'Leads', 'Conversions', 'Conv. Rate']];
  mKeys.forEach(function(k) {
    var l = metrics.monthly[k].leads;
    var c = metrics.monthly[k].conversions;
    mData.push([k, l, c, l ? c/l : 0]);
  });
  
  if (mData.length > 1) {
    sheet.getRange(cursorRow, 1, mData.length, 4).setValues(mData);
    sheet.getRange(cursorRow, 1, 1, 4).setFontWeight('bold').setBackground('#0f4c81').setFontColor('#ffffff');
    sheet.getRange(cursorRow + 1, 4, mData.length - 1, 1).setNumberFormat('0.0%');
    
    var mChart = sheet.newChart()
      .setChartType(Charts.ChartType.COMBO)
      .addRange(sheet.getRange(cursorRow, 1, mData.length, 4))
      .setPosition(cursorRow, 6, 0, 0)
      .setOption('title', 'Monthly Leads vs Conversions')
      .setOption('series', {
        0: {type: 'bars'},
        1: {type: 'bars'},
        2: {type: 'line', targetAxisIndex: 1}
      })
      .setOption('width', 600)
      .setOption('height', 300)
      .build();
    sheet.insertChart(mChart);
    cursorRow += Math.max(mData.length + 2, 16);
  }

  // 4. Agent Performance
  writeHeader('4. AGENT PERFORMANCE');
  var agKeys = Object.keys(metrics.agents).sort();
  var agData = [['Agent', 'Leads', 'Conversions', 'Conv. Rate', 'Avg Days to Convert']];
  agKeys.forEach(function(k) {
    var l = metrics.agents[k].leads;
    var c = metrics.agents[k].conversions;
    var avgT = metrics.agents[k].timeCount ? (metrics.agents[k].timeSum / metrics.agents[k].timeCount).toFixed(1) : '';
    agData.push([k, l, c, l ? c/l : 0, avgT]);
  });
  
  if (agData.length > 1) {
    sheet.getRange(cursorRow, 1, agData.length, 5).setValues(agData);
    sheet.getRange(cursorRow, 1, 1, 5).setFontWeight('bold').setBackground('#0f4c81').setFontColor('#ffffff');
    sheet.getRange(cursorRow + 1, 4, agData.length - 1, 1).setNumberFormat('0.0%');
    
    var agChart = sheet.newChart()
      .setChartType(Charts.ChartType.COLUMN)
      .addRange(sheet.getRange(cursorRow, 1, agData.length, 3))
      .setPosition(cursorRow, 7, 0, 0)
      .setOption('title', 'Leads & Conversions by Agent')
      .setOption('isStacked', true)
      .setOption('width', 600)
      .setOption('height', 300)
      .build();
    sheet.insertChart(agChart);
    cursorRow += Math.max(agData.length + 2, 16);
  }

  // 5. Campaign Analytics
  writeHeader('5. CAMPAIGN ANALYTICS');
  var cKeys = Object.keys(metrics.campaigns).sort(function(a, b) { return metrics.campaigns[b].leads - metrics.campaigns[a].leads; });
  var cData = [['Campaign', 'Leads', 'Conversions', 'Conv. Rate', 'Realized Value']];
  cKeys.slice(0, 20).forEach(function(k) { // Top 20
    var l = metrics.campaigns[k].leads;
    var c = metrics.campaigns[k].conversions;
    var v = metrics.campaigns[k].value;
    cData.push([k, l, c, l ? c/l : 0, v]);
  });
  
  if (cData.length > 1) {
    sheet.getRange(cursorRow, 1, cData.length, 5).setValues(cData);
    sheet.getRange(cursorRow, 1, 1, 5).setFontWeight('bold').setBackground('#0f4c81').setFontColor('#ffffff');
    sheet.getRange(cursorRow + 1, 4, cData.length - 1, 1).setNumberFormat('0.0%');
    
    var cChart = sheet.newChart()
      .setChartType(Charts.ChartType.BAR)
      .addRange(sheet.getRange(cursorRow, 1, Math.min(11, cData.length), 3)) // Top 10 chart
      .setPosition(cursorRow, 7, 0, 0)
      .setOption('title', 'Top Campaigns by Volume')
      .setOption('width', 600)
      .setOption('height', 300)
      .build();
    sheet.insertChart(cChart);
    cursorRow += Math.max(cData.length + 2, 16);
  }

  // 6. Demographics (Top Qualifications for Conversions)
  writeHeader('6. DEMOGRAPHICS (CONVERTED LEADS)');
  var qKeys = Object.keys(metrics.demo.qualification).sort(function(a, b) { return metrics.demo.qualification[b] - metrics.demo.qualification[a]; });
  var qData = [['Qualification', 'Conversions']];
  qKeys.slice(0, 10).forEach(function(k) { qData.push([k, metrics.demo.qualification[k]]); });
  
  if (qData.length > 1) {
    sheet.getRange(cursorRow, 1, qData.length, 2).setValues(qData);
    sheet.getRange(cursorRow, 1, 1, 2).setFontWeight('bold').setBackground('#0f4c81').setFontColor('#ffffff');
    
    var qChart = sheet.newChart()
      .setChartType(Charts.ChartType.PIE)
      .addRange(sheet.getRange(cursorRow, 1, qData.length, 2))
      .setPosition(cursorRow, 4, 0, 0)
      .setOption('title', 'Conversions by Qualification')
      .setOption('width', 400)
      .setOption('height', 300)
      .build();
    sheet.insertChart(qChart);
  }

  // Auto-resize columns
  sheet.autoResizeColumns(1, 5);
}
