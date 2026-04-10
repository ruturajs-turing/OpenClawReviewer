/******************************************************
 * DocBuilder.gs — Generate Google Doc review report
 *
 * Creates a formatted Google Doc with:
 *   - Header: task ID, user, timestamp, verdict badge
 *   - Score table: 5 axes + weighted + ground truth comparison
 *   - Rationale sections for each axis
 *   - Check results (PASS/FAIL/WARNING + issues)
 *   - Debug section with metadata and trajectory excerpt
 ******************************************************/

/**
 * Create the review report Google Doc.
 * @param {Object} task - loaded task object
 * @param {Object} score - final score object
 * @param {Object|null} persona - persona record
 * @returns {string} Google Doc URL
 */
function createReviewDoc_(task, score, persona) {
  var timestamp = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), "yyyy-MM-dd HH:mm:ss");
  var title = "OpenClaw Review — " + (score.task_id || "Unknown") + " — " + timestamp;

  var doc = DocumentApp.create(title);
  var body = doc.getBody();

  body.setMarginTop(36);
  body.setMarginBottom(36);
  body.setMarginLeft(50);
  body.setMarginRight(50);

  var HEADING = DocumentApp.ParagraphHeading;

  // ═══════ Title ═══════
  var titlePara = body.appendParagraph("OpenClaw QA Review Report");
  titlePara.setHeading(HEADING.HEADING1);
  titlePara.setForegroundColor("#1a73e8");

  body.appendParagraph("Generated: " + timestamp).setForegroundColor("#666666");
  body.appendParagraph("");

  // ═══════ Verdict Banner ═══════
  var verdictColor = score.verdict === "PASS" ? "#34a853" :
                     score.verdict === "FAIL" ? "#ea4335" : "#fbbc05";
  var verdictPara = body.appendParagraph("VERDICT: " + score.verdict);
  verdictPara.setHeading(HEADING.HEADING2);
  verdictPara.setForegroundColor(verdictColor);
  verdictPara.setBold(true);

  // ═══════ Task Info ═══════
  body.appendParagraph("Task Information").setHeading(HEADING.HEADING2);

  var meta = task.metadata || {};
  var infoItems = [
    ["Task ID",        score.task_id || "N/A"],
    ["User",           task.user_name || "Unknown"],
    ["Description",    meta.task_description || "N/A"],
    ["Task Type",      (meta.task_type || []).join(", ") || "N/A"],
    ["Completion",     meta.task_completion_status || "N/A"],
    ["Turns",          String(task.turn_count || 0)],
    ["Tool Calls",     String(task.tool_call_count || 0)]
  ];
  if (persona) {
    infoItems.push(["Persona", (persona.full_name || "") + " (" + (persona.persona_id || "") + ")"]);
    infoItems.push(["Persona City", persona.city || "N/A"]);
    infoItems.push(["Persona Job", persona.job_title || "N/A"]);
  }
  for (var ii = 0; ii < infoItems.length; ii++) {
    var p = body.appendParagraph(infoItems[ii][0] + ": ");
    p.appendText(infoItems[ii][1]);
    var firstPart = p.getChild(0);
    firstPart.setBold(true);
  }
  body.appendParagraph("");

  // ═══════ Score Table ═══════
  body.appendParagraph("Scores").setHeading(HEADING.HEADING2);

  var gt = score.ground_truth || {};
  var axes = ["correctness", "completeness", "efficiency", "naturality", "overall"];
  var hasGt = !!(gt.correctness || gt.completeness || gt.efficiency || gt.naturality || gt.overall);

  var numCols = hasGt ? 4 : 2;
  var table = body.appendTable();

  // Header row
  var headerRow = table.appendTableRow();
  headerRow.appendTableCell("Axis").setBackgroundColor("#e8eaed");
  headerRow.appendTableCell("Score").setBackgroundColor("#e8eaed");
  if (hasGt) {
    headerRow.appendTableCell("Ground Truth").setBackgroundColor("#e8eaed");
    headerRow.appendTableCell("Delta").setBackgroundColor("#e8eaed");
  }

  for (var a = 0; a < axes.length; a++) {
    var row = table.appendTableRow();
    row.appendTableCell(axes[a].charAt(0).toUpperCase() + axes[a].slice(1));
    row.appendTableCell(String(score[axes[a]] || 0));
    if (hasGt) {
      var gtVal = gt[axes[a]];
      row.appendTableCell(gtVal != null ? String(gtVal) : "—");
      if (gtVal != null) {
        var delta = (score[axes[a]] || 0) - gtVal;
        var deltaStr = delta > 0 ? "+" + delta : String(delta);
        var deltaCell = row.appendTableCell(deltaStr);
        if (delta > 0) deltaCell.setForegroundColor("#ea4335");
        else if (delta < 0) deltaCell.setForegroundColor("#34a853");
      } else {
        row.appendTableCell("—");
      }
    }
  }

  // Weighted score row
  var wRow = table.appendTableRow();
  wRow.appendTableCell("Weighted").setBold(true);
  wRow.appendTableCell(String(score.weighted_score || 0)).setBold(true);
  if (hasGt) {
    wRow.appendTableCell("—");
    wRow.appendTableCell("—");
  }

  body.appendParagraph("");

  // ═══════ Rationales ═══════
  body.appendParagraph("Rationales").setHeading(HEADING.HEADING2);

  for (var r = 0; r < axes.length; r++) {
    var axisName = axes[r].charAt(0).toUpperCase() + axes[r].slice(1);
    body.appendParagraph(axisName + " (" + (score[axes[r]] || 0) + "/5)").setHeading(HEADING.HEADING3);

    var rationale = score[axes[r] + "_rationale"] || "(no rationale)";
    body.appendParagraph("Generated: " + rationale);

    if (hasGt) {
      var gtRat = gt[axes[r] + "_rationale"] || "";
      if (gtRat) {
        var gtP = body.appendParagraph("Ground Truth: " + gtRat);
        gtP.setItalic(true);
        gtP.setForegroundColor("#666666");
      }
    }
    body.appendParagraph("");
  }

  // ═══════ Check Results ═══════
  body.appendParagraph("Automated Check Results").setHeading(HEADING.HEADING2);

  var checks = score.check_results || [];
  for (var ci = 0; ci < checks.length; ci++) {
    var chk = checks[ci];
    var statusColor = chk.result === "PASS" ? "#34a853" :
                      chk.result === "FAIL" ? "#ea4335" : "#fbbc05";
    var chkTitle = body.appendParagraph(chk.check + ": " + chk.result + " [" + chk.severity + "]");
    chkTitle.setHeading(HEADING.HEADING3);
    chkTitle.setForegroundColor(statusColor);

    var chkIssues = chk.issues || [];
    for (var cj = 0; cj < chkIssues.length; cj++) {
      body.appendListItem(chkIssues[cj]).setGlyphType(DocumentApp.GlyphType.BULLET);
    }

    var chkDet = chk.details || {};
    var detKeys = Object.keys(chkDet);
    if (detKeys.length > 0) {
      for (var dk = 0; dk < detKeys.length; dk++) {
        body.appendListItem(detKeys[dk] + ": " + JSON.stringify(chkDet[detKeys[dk]])).setGlyphType(DocumentApp.GlyphType.HOLLOW_BULLET);
      }
    }
    body.appendParagraph("");
  }

  // ═══════ Debug Section ═══════
  body.appendParagraph("Debug Information").setHeading(HEADING.HEADING2);

  body.appendParagraph("Metadata JSON:").setBold(true);
  var metaJson = JSON.stringify(task.metadata || {}, null, 2);
  if (metaJson.length > 3000) metaJson = metaJson.substring(0, 3000) + "\n... [truncated]";
  body.appendParagraph(metaJson).setFontFamily("Courier New").setFontSize(8);
  body.appendParagraph("");

  body.appendParagraph("Workspace Diff:").setBold(true);
  body.appendParagraph(JSON.stringify(task.workspace_diff || {}, null, 2)).setFontFamily("Courier New").setFontSize(8);
  body.appendParagraph("");

  // Trajectory excerpt (first 3 turns)
  body.appendParagraph("Trajectory Excerpt (first 3 turns):").setBold(true);
  var turns = task.turns || [];
  var excerpt = [];
  for (var ti = 0; ti < Math.min(3, turns.length); ti++) {
    excerpt.push("Turn " + (ti+1) + ":");
    excerpt.push("  User: " + (turns[ti].user_text || "").substring(0, 300));
    excerpt.push("  Agent: " + (turns[ti].assistant_text || "").substring(0, 300));
    excerpt.push("  Tool calls: " + (turns[ti].tool_calls || []).length);
    excerpt.push("");
  }
  body.appendParagraph(excerpt.join("\n")).setFontFamily("Courier New").setFontSize(8);

  doc.saveAndClose();
  return doc.getUrl();
}
