/******************************************************
 * SheetWriter.gs — Review score + issue tracking
 *
 * All reviews go to a single hardcoded Google Sheet.
 * First run auto-creates headers, formatting, and filters.
 ******************************************************/

var SCORES_SHEET_ID = "1EdzPEcrW7WBbNRxcFX69rmLx_rwC17q_wy4BXR5UTzA";
var REPORTS_SHEET_ID = "19rkvqd60VbkMV-csmwY_hM6mKVqWTibnCp0piTxF290";

var REVIEW_HEADERS = [
  "Timestamp", "Task ID", "User Name", "Verdict",
  "Correctness", "Completeness", "Efficiency", "Naturality", "Overall", "Weighted Score",
  "GT Correctness", "GT Completeness", "GT Efficiency", "GT Naturality", "GT Overall",
  "Cron Dry-Run", "Fourth-Wall", "Degenerate Loop", "Jailbreak",
  "Persona Match", "Claim Sourcing", "Tool Efficiency", "Workspace Diff",
  "USER.md Propagation", "Agentic Depth",
  "Checks Summary", "Task Description", "Doc URL"
];


/**
 * Write a review score row. Auto-sets up the sheet on first call.
 */
function writeScoreRow_(task, score) {
  Logger.log("SheetWriter: Starting writeScoreRow_");
  Logger.log("SheetWriter: SCORES_SHEET_ID = " + SCORES_SHEET_ID);

  var ss = SpreadsheetApp.openById(SCORES_SHEET_ID);
  Logger.log("SheetWriter: Opened spreadsheet: " + ss.getName());

  var sheet = ss.getSheetByName("Reviews");
  if (!sheet) {
    Logger.log("SheetWriter: No 'Reviews' tab found, using first sheet");
    var sheets = ss.getSheets();
    if (sheets.length > 0) {
      sheet = sheets[0];
    } else {
      sheet = ss.insertSheet("Reviews");
    }
    _setupReviewSheet(sheet);
  } else if (sheet.getLastRow() === 0 || sheet.getRange(1, 1).getValue() !== "Timestamp") {
    Logger.log("SheetWriter: 'Reviews' tab exists but needs setup");
    _setupReviewSheet(sheet);
  }

  var gt = score.ground_truth || {};
  var checks = score.check_results || [];

  var checkMap = {};
  var checkParts = [];
  for (var i = 0; i < checks.length; i++) {
    checkMap[checks[i].check] = checks[i].result;
    checkParts.push(checks[i].check + ":" + checks[i].result);
  }

  var timestamp = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), "yyyy-MM-dd HH:mm:ss");

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
    checkMap["cron_dry_run"] || "",
    checkMap["fourth_wall"] || "",
    checkMap["degenerate_loop"] || "",
    checkMap["jailbreak_detection"] || "",
    checkMap["persona_match"] || "",
    checkMap["claim_sourcing"] || "",
    checkMap["tool_efficiency"] || "",
    checkMap["workspace_diff"] || "",
    checkMap["user_md_propagation"] || "",
    checkMap["agentic_depth"] || "",
    checkParts.join(", "),
    score.task_description || "",
    score.doc_url || ""
  ];

  sheet.appendRow(row);
  Logger.log("SheetWriter: Row appended to row " + sheet.getLastRow());

  var lastRow = sheet.getLastRow();

  var verdict = score.verdict || "";
  if (verdict === "PASS") {
    sheet.getRange(lastRow, 4).setBackground("#d1fae5");
  } else if (verdict === "FAIL") {
    sheet.getRange(lastRow, 4).setBackground("#fee2e2");
  } else if (verdict === "CONDITIONAL") {
    sheet.getRange(lastRow, 4).setBackground("#fef3c7");
  }

  var checkCols = {P: 16, Q: 17, R: 18, S: 19, T: 20, U: 21, V: 22, W: 23, X: 24, Y: 25};
  for (var colIdx = 16; colIdx <= 25; colIdx++) {
    var val = sheet.getRange(lastRow, colIdx).getValue();
    if (val === "PASS") sheet.getRange(lastRow, colIdx).setBackground("#d1fae5");
    else if (val === "FAIL") sheet.getRange(lastRow, colIdx).setBackground("#fee2e2");
    else if (val === "WARNING") sheet.getRange(lastRow, colIdx).setBackground("#fef3c7");
  }
}


/**
 * One-time setup: headers, formatting, column widths, filter.
 */
function _setupReviewSheet(sheet) {
  if (!sheet) {
    var ss = SpreadsheetApp.openById(SCORES_SHEET_ID);
    sheet = ss.getSheetByName("Reviews");
    if (!sheet) {
      var sheets = ss.getSheets();
      sheet = sheets.length > 0 ? sheets[0] : ss.insertSheet("Reviews");
    }
  }
  try { sheet.setName("Reviews"); } catch(e) { /* already named or rename not allowed */ }

  sheet.getRange(1, 1, 1, REVIEW_HEADERS.length).setValues([REVIEW_HEADERS]);

  var headerRange = sheet.getRange(1, 1, 1, REVIEW_HEADERS.length);
  headerRange.setFontWeight("bold");
  headerRange.setBackground("#1a73e8");
  headerRange.setFontColor("#ffffff");
  headerRange.setWrap(false);
  headerRange.setHorizontalAlignment("center");

  sheet.setFrozenRows(1);
  sheet.setFrozenColumns(3);

  sheet.setColumnWidth(1, 160);   // Timestamp
  sheet.setColumnWidth(2, 120);   // Task ID
  sheet.setColumnWidth(3, 140);   // User Name
  sheet.setColumnWidth(4, 110);   // Verdict
  sheet.setColumnWidth(5, 100);   // Correctness
  sheet.setColumnWidth(6, 110);   // Completeness
  sheet.setColumnWidth(7, 90);    // Efficiency
  sheet.setColumnWidth(8, 90);    // Naturality
  sheet.setColumnWidth(9, 80);    // Overall
  sheet.setColumnWidth(10, 110);  // Weighted
  sheet.setColumnWidth(11, 110);  // GT Correctness
  sheet.setColumnWidth(12, 120);  // GT Completeness
  sheet.setColumnWidth(13, 100);  // GT Efficiency
  sheet.setColumnWidth(14, 100);  // GT Naturality
  sheet.setColumnWidth(15, 90);   // GT Overall
  sheet.setColumnWidth(16, 100);  // Cron Dry-Run
  sheet.setColumnWidth(17, 100);  // Fourth-Wall
  sheet.setColumnWidth(18, 120);  // Degenerate Loop
  sheet.setColumnWidth(19, 90);   // Jailbreak
  sheet.setColumnWidth(20, 110);  // Persona Match
  sheet.setColumnWidth(21, 110);  // Claim Sourcing
  sheet.setColumnWidth(22, 110);  // Tool Efficiency
  sheet.setColumnWidth(23, 120);  // Workspace Diff
  sheet.setColumnWidth(24, 130);  // USER.md Propagation
  sheet.setColumnWidth(25, 110);  // Agentic Depth
  sheet.setColumnWidth(26, 300);  // Checks Summary
  sheet.setColumnWidth(27, 350);  // Task Description
  sheet.setColumnWidth(28, 300);  // Doc URL

  sheet.getRange(1, 1, 1, REVIEW_HEADERS.length).createFilter();
}


/******************************************************
 * Issue Reporting — writes to a shared Reports sheet
 ******************************************************/

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
