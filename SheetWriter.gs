/******************************************************
 * SheetWriter.gs — Optional score tracking in Google Sheet
 *
 * Appends one row per review to a tracking spreadsheet.
 * Set Script Property SCORES_SHEET_ID to enable.
 ******************************************************/

/**
 * Write a score row to the tracking sheet.
 * @param {Object} task - loaded task object
 * @param {Object} score - final score object with verdict
 */
function writeScoreRow_(task, score) {
  var sheetId = PropertiesService.getScriptProperties().getProperty("SCORES_SHEET_ID");
  Logger.log("SheetWriter: SCORES_SHEET_ID = " + sheetId);

  if (!sheetId) {
    Logger.log("SheetWriter: No sheet ID, creating new sheet...");
    createTrackingSheet();
    sheetId = PropertiesService.getScriptProperties().getProperty("SCORES_SHEET_ID");
    if (!sheetId) {
      Logger.log("SheetWriter: Failed to create sheet.");
      return;
    }
  }

  var ss;
  try {
    ss = SpreadsheetApp.openById(sheetId);
  } catch(e) {
    Logger.log("SheetWriter: Could not open sheet " + sheetId + ": " + e.message + ". Creating new...");
    createTrackingSheet();
    sheetId = PropertiesService.getScriptProperties().getProperty("SCORES_SHEET_ID");
    if (!sheetId) return;
    try {
      ss = SpreadsheetApp.openById(sheetId);
    } catch(e2) {
      Logger.log("SheetWriter: Still cannot open sheet: " + e2.message);
      return;
    }
  }

  var sheet = ss.getSheetByName("OpenClaw Reviews") || ss.getSheets()[0];
  Logger.log("SheetWriter: Writing to sheet tab '" + sheet.getName() + "', current rows: " + sheet.getLastRow());

  if (sheet.getLastRow() === 0 || sheet.getRange(1, 1).getValue() !== "Timestamp") {
    var headers = [
      "Timestamp", "Task ID", "User Name", "Verdict",
      "Correctness", "Completeness", "Efficiency", "Naturality", "Overall", "Weighted",
      "GT Correctness", "GT Completeness", "GT Efficiency", "GT Naturality", "GT Overall",
      "Checks Summary", "Doc URL"
    ];
    if (sheet.getLastRow() === 0) {
      sheet.getRange(1, 1, 1, headers.length).setValues([headers]).setFontWeight("bold");
      sheet.setFrozenRows(1);
    }
  }

  var gt = score.ground_truth || {};
  var checks = score.check_results || [];
  var checksSummary = checks.map(function(c) {
    return c.check + ":" + c.result;
  }).join(", ");

  var timestamp = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), "yyyy-MM-dd HH:mm:ss");
  var meta = task.metadata || {};

  var row = [
    timestamp,
    score.task_id || "",
    task.user_name || "Unknown",
    score.verdict || "",
    score.correctness || 0,
    score.completeness || 0,
    score.efficiency || 0,
    score.naturality || 0,
    score.overall || 0,
    score.weighted_score || 0,
    gt.correctness != null ? gt.correctness : "",
    gt.completeness != null ? gt.completeness : "",
    gt.efficiency != null ? gt.efficiency : "",
    gt.naturality != null ? gt.naturality : "",
    gt.overall != null ? gt.overall : "",
    checksSummary,
    score.doc_url || ""
  ];

  sheet.appendRow(row);
}


/**
 * Create a new tracking spreadsheet and save its ID.
 * Called from UI settings.
 * @returns {string} spreadsheet URL
 */
function createTrackingSheet() {
  var ss = SpreadsheetApp.create("OpenClaw QA Review Scores");
  var sheetId = ss.getId();
  PropertiesService.getScriptProperties().setProperty("SCORES_SHEET_ID", sheetId);
  return ss.getUrl();
}


/******************************************************
 * Issue Reporting — writes to a shared Reports sheet
 ******************************************************/

var REPORTS_SHEET_ID = "19rkvqd60VbkMV-csmwY_hM6mKVqWTibnCp0piTxF290";

/**
 * Submit an issue report from the UI.
 * @param {Object} report - { doc_link, description }
 * @returns {string} confirmation message
 */
function submitReport(report) {
  var ss;
  try {
    ss = SpreadsheetApp.openById(REPORTS_SHEET_ID);
  } catch(e) {
    throw new Error("Cannot open reports sheet. Check permissions: " + e.message);
  }

  var sheet = ss.getSheetByName("Reports");
  if (!sheet) {
    sheet = ss.insertSheet("Reports");
    var headers = ["Timestamp", "Doc Report Link", "Issue Description", "Resolved?"];
    sheet.getRange(1, 1, 1, headers.length).setValues([headers]).setFontWeight("bold");
    sheet.setFrozenRows(1);
    sheet.setColumnWidth(1, 160);
    sheet.setColumnWidth(2, 350);
    sheet.setColumnWidth(3, 500);
    sheet.setColumnWidth(4, 100);
  }

  var timestamp = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), "yyyy-MM-dd HH:mm:ss");
  var row = [timestamp, report.doc_link || "", report.description || "", "No"];
  sheet.appendRow(row);

  var lastRow = sheet.getLastRow();
  var resolvedCell = sheet.getRange(lastRow, 4);
  var rule = SpreadsheetApp.newDataValidation()
    .requireValueInList(["Yes", "No"], true)
    .setAllowInvalid(false)
    .build();
  resolvedCell.setDataValidation(rule);
  resolvedCell.setBackground("#fff3cd");

  return "Report #" + (lastRow - 1) + " submitted. Thank you!";
}
