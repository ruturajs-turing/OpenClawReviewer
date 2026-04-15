/******************************************************
 * Code.gs — Main orchestrator for OpenClaw QA Reviewer
 *
 * doGet: serve web app
 * runReview: full pipeline (checks + LLM + Doc)
 * runChecksOnly: rule-based checks without LLM
 * callLLM_: UrlFetchApp to OpenAI-compatible endpoint
 * Drive helpers: parseRef_, downloadZip_
 ******************************************************/


/* ═══════════ Config from Script Properties ═══════════ */

var LLM = {
  KEY:  PropertiesService.getScriptProperties().getProperty("OPENAI_API_KEY") || "",
  MODEL: PropertiesService.getScriptProperties().getProperty("OPENAI_MODEL") || "claude-opus-4-6",
  BASE: PropertiesService.getScriptProperties().getProperty("OPENAI_BASE_URL") || "https://api.anthropic.com/v1"
};

var SCORING_WEIGHTS = { correctness: 0.35, completeness: 0.30, efficiency: 0.20, naturality: 0.15 };


/* ═══════════ Web App Entry ═══════════ */

function doGet(e) {
  return HtmlService.createTemplateFromFile("index")
    .evaluate()
    .setTitle("OpenClaw QA Reviewer")
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

function include(filename) {
  return HtmlService.createHtmlOutputFromFile(filename).getContent();
}


/* ═══════════ Persona Registry (see PersonaData.gs) ═══════════ */
/* getPersonaList(), lookupPersona_() defined in PersonaData.gs */


/* ═══════════ Drive Helpers ═══════════ */

function parseRef_(raw) {
  raw = raw.trim();

  var idMatch = raw.match(/^[A-Za-z0-9_-]{25,}$/);
  if (idMatch) return { id: idMatch[0], resourceKey: "" };

  if (/drive\.google\.com\/file\/d\//i.test(raw)) {
    var id = (raw.match(/\/file\/d\/([A-Za-z0-9_-]{25,})/) || [])[1] || "";
    var rkRaw = (raw.match(/[?&]resourcekey=([^&]+)/i) || [])[1] || "";
    var rk = rkRaw ? decodeURIComponent(rkRaw) : "";
    if (!id) throw new Error("Could not parse file ID from link.");
    return { id: id, resourceKey: rk };
  }

  if (/drive\.google\.com\/open\?id=/i.test(raw)) {
    var oid = (raw.match(/[?&]id=([A-Za-z0-9_-]{25,})/) || [])[1] || "";
    if (oid) return { id: oid, resourceKey: "" };
  }

  throw new Error("Could not parse Drive link or file ID from input: " + raw.substring(0, 80));
}

function downloadZip_(ref) {
  var url = "https://www.googleapis.com/drive/v3/files/" + encodeURIComponent(ref.id) +
    "?alt=media&supportsAllDrives=true" +
    (ref.resourceKey ? "&resourceKey=" + encodeURIComponent(ref.resourceKey) : "");

  var res = UrlFetchApp.fetch(url, {
    method: "get",
    headers: { Authorization: "Bearer " + ScriptApp.getOAuthToken() },
    muteHttpExceptions: true
  });

  if (res.getResponseCode() !== 200) {
    throw new Error("Drive download HTTP " + res.getResponseCode() + ": " + res.getContentText().slice(0, 200));
  }

  var blob = res.getBlob();
  try { blob.setContentType("application/zip"); } catch(e) {}
  return blob;
}


/* ═══════════ LLM Call ═══════════ */

function isAnthropicKey_() {
  return LLM.KEY.indexOf("sk-ant-") === 0;
}

function callLLM_(userPrompt) {
  if (!LLM.KEY) throw new Error("Set Script Property OPENAI_API_KEY.");

  if (isAnthropicKey_()) {
    return callAnthropic_(userPrompt);
  }
  return callOpenAICompat_(userPrompt);
}

function callOpenAICompat_(userPrompt) {
  var payload = {
    model: LLM.MODEL,
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user",   content: userPrompt }
    ],
    temperature: 0.1,
    max_tokens: 8192
  };

  var baseUrl = LLM.BASE.replace(/\/+$/, "");
  var res = UrlFetchApp.fetch(baseUrl + "/chat/completions", {
    method: "post",
    contentType: "application/json",
    muteHttpExceptions: true,
    headers: { Authorization: "Bearer " + LLM.KEY },
    payload: JSON.stringify(payload)
  });

  var code = res.getResponseCode();
  var body = res.getContentText();
  if (code !== 200) throw new Error("LLM HTTP " + code + ": " + body.slice(0, 500));

  var data = JSON.parse(body);
  var content = "";
  if (data && data.choices && data.choices.length > 0 &&
      data.choices[0].message && data.choices[0].message.content) {
    content = data.choices[0].message.content;
  }
  return content.trim();
}

function callAnthropic_(userPrompt) {
  var payload = {
    model: LLM.MODEL,
    system: SYSTEM_PROMPT,
    messages: [
      { role: "user", content: userPrompt }
    ],
    temperature: 0.1,
    max_tokens: 8192
  };

  var res = UrlFetchApp.fetch("https://api.anthropic.com/v1/messages", {
    method: "post",
    contentType: "application/json",
    muteHttpExceptions: true,
    headers: {
      "x-api-key": LLM.KEY,
      "anthropic-version": "2023-06-01"
    },
    payload: JSON.stringify(payload)
  });

  var code = res.getResponseCode();
  var body = res.getContentText();
  if (code !== 200) throw new Error("Anthropic HTTP " + code + ": " + body.slice(0, 500));

  var data = JSON.parse(body);
  var content = "";
  if (data && data.content && data.content.length > 0 && data.content[0].text) {
    content = data.content[0].text;
  }
  return content.trim();
}

function parseLlmJson_(text) {
  text = (text || "").trim();
  var match = text.match(/\{[\s\S]*\}/);
  if (match) {
    try { return JSON.parse(match[0]); } catch(e) { /* fall through */ }
  }
  return {};
}


/* ═══════════ Score Logic ═══════════ */

function buildScore_(taskId, llmScores, checkResults) {
  return {
    task_id: taskId,
    correctness:           parseInt(llmScores.correctness) || 0,
    correctness_rationale: llmScores.correctness_rationale || "",
    completeness:          parseInt(llmScores.completeness) || 0,
    completeness_rationale: llmScores.completeness_rationale || "",
    efficiency:            parseInt(llmScores.efficiency) || 0,
    efficiency_rationale:  llmScores.efficiency_rationale || "",
    naturality:            parseInt(llmScores.naturality) || 0,
    naturality_rationale:  llmScores.naturality_rationale || "",
    overall:               parseInt(llmScores.overall) || 0,
    overall_rationale:     llmScores.overall_rationale || "",
    check_results: checkResults
  };
}

function computeWeightedScore_(score) {
  return Math.round(
    (SCORING_WEIGHTS.correctness * score.correctness +
     SCORING_WEIGHTS.completeness * score.completeness +
     SCORING_WEIGHTS.efficiency * score.efficiency +
     SCORING_WEIGHTS.naturality * score.naturality) * 100
  ) / 100;
}

function computeVerdict_(score) {
  var personaFail = false;
  var criticalCorrectness = false;
  var agenticFail = false;
  var jailbreakFail = false;
  var fourthWallFail = false;
  var loopFail = false;
  var hasFailCheck = false;
  var checks = score.check_results || [];

  for (var i = 0; i < checks.length; i++) {
    if (checks[i].result === "FAIL") hasFailCheck = true;
    if (checks[i].check === "persona_match" && checks[i].result === "FAIL") personaFail = true;
    if (checks[i].check === "claim_sourcing" && checks[i].result === "FAIL" && checks[i].severity === "high") {
      var det = checks[i].details || {};
      if ((det.unsourced || 0) >= 3) criticalCorrectness = true;
    }
    if (checks[i].check === "agentic_depth" && checks[i].result === "FAIL") agenticFail = true;
    if (checks[i].check === "jailbreak_detection" && checks[i].result === "FAIL") jailbreakFail = true;
    if (checks[i].check === "fourth_wall" && checks[i].result === "FAIL") fourthWallFail = true;
    if (checks[i].check === "degenerate_loop" && checks[i].result === "FAIL") loopFail = true;
  }

  // Score thresholds — hard fails first
  if (score.completeness < 4) return "FAIL";
  if (score.naturality < 4) return "FAIL";
  if (score.correctness < 2) return "FAIL";
  if (score.efficiency < 2) return "FAIL";

  // Check-based immediate failures
  if (jailbreakFail) return "FAIL";
  if (fourthWallFail) return "FAIL";
  if (personaFail) return "FAIL";
  if (agenticFail) return "FAIL";
  if (loopFail) return "FAIL";
  if (score.overall <= 2) return "FAIL";
  if (criticalCorrectness && score.overall <= 3) return "FAIL";

  if (score.overall >= 3 && !hasFailCheck) return "PASS";
  if (score.overall >= 4) return "PASS";
  if (score.overall === 3 && hasFailCheck) return "CONDITIONAL";

  return "CONDITIONAL";
}

function applyAdjustments_(score) {
  var checks = score.check_results || [];
  for (var i = 0; i < checks.length; i++) {
    var cr = checks[i];

    // Cron dry-run triggers on WARNING (medium severity, not a hard fail)
    if (cr.check === "cron_dry_run" && cr.result === "WARNING") {
      score.completeness = Math.max(1, score.completeness - 1);
      continue;
    }

    if (cr.result !== "FAIL") continue;

    if (cr.check === "persona_match" && cr.severity === "high") {
      score.correctness = Math.max(1, score.correctness - 2);
      score.overall = Math.max(1, score.overall - 1);
    } else if (cr.check === "claim_sourcing" && cr.severity === "high") {
      score.correctness = Math.max(1, score.correctness - 1);
    } else if (cr.check === "tool_efficiency") {
      score.efficiency = Math.max(1, score.efficiency - 1);
    } else if (cr.check === "user_md_propagation") {
      score.correctness = Math.max(1, score.correctness - 1);
    } else if (cr.check === "agentic_depth") {
      score.overall = Math.max(1, score.overall - 1);
      score.completeness = Math.max(1, score.completeness - 1);
    } else if (cr.check === "jailbreak_detection") {
      score.overall = Math.max(1, score.overall - 2);
      score.correctness = Math.max(1, score.correctness - 1);
    } else if (cr.check === "fourth_wall") {
      score.naturality = Math.max(1, score.naturality - 2);
      score.overall = Math.max(1, score.overall - 1);
    } else if (cr.check === "degenerate_loop") {
      score.efficiency = Math.max(1, score.efficiency - 1);
      score.overall = Math.max(1, score.overall - 1);
    }
  }
  return score;
}


/* ═══════════ Shared Pipeline Helpers ═══════════ */

function runPipeline_(entries, taskId, personaKey) {
  var metaBlob = findEntry_(entries, /(^|\/)metadata\.json$/i);
  if (metaBlob) {
    try {
      var rawMeta = JSON.parse(blobToText_(metaBlob));
      var mi = rawMeta.meta_info || rawMeta;
      if (mi.task_id) taskId = mi.task_id;
    } catch(e) {}
  }

  var task = loadTaskFromEntries_(entries, taskId);

  var persona = null;
  if (personaKey) {
    persona = (PERSONA_REGISTRY || {})[personaKey.toLowerCase()] || null;
  }
  if (!persona) persona = lookupPersona_(task);

  var checkResults = runAllChecks_(task, persona);
  var userPrompt = buildUserPrompt_(task, persona, checkResults);
  var rawResponse = callLLM_(userPrompt);
  var llmScores = parseLlmJson_(rawResponse);

  var score = buildScore_(taskId, llmScores, checkResults);
  score = applyAdjustments_(score);
  score.weighted_score = computeWeightedScore_(score);
  score.verdict = computeVerdict_(score);

  var gt = (task.metadata || {}).ground_truth_scores || {};
  score.ground_truth = gt;

  var docUrl = createReviewDoc_(task, score, persona);
  score.doc_url = docUrl;
  score.task_description = summarizeTask_(task);

  var jsonUrl = createReviewJson_(task, score, persona);
  score.json_url = jsonUrl;

  var sheetError = "";
  var sheetUrl = "";
  try {
    writeScoreRow_(task, score);
    sheetUrl = "https://docs.google.com/spreadsheets/d/" + SCORES_SHEET_ID;
  } catch(e) {
    sheetError = e.message || "Unknown sheet error";
    Logger.log("SheetWriter error: " + sheetError);
  }

  return {
    task_id: taskId,
    user_name: task.user_name || "Unknown",
    task_description: summarizeTask_(task),
    verdict: score.verdict,
    scores: {
      correctness: score.correctness,
      completeness: score.completeness,
      efficiency: score.efficiency,
      naturality: score.naturality,
      overall: score.overall,
      weighted: score.weighted_score
    },
    ground_truth: gt,
    checks: checkResults.map(function(c) {
      return { check: c.check, result: c.result, issues: c.issues.slice(0, 3), severity: c.severity };
    }),
    doc_url: docUrl,
    json_url: jsonUrl,
    sheet_url: sheetUrl,
    sheet_error: sheetError
  };
}

function runChecksPipeline_(entries, taskId, personaKey) {
  var metaBlob = findEntry_(entries, /(^|\/)metadata\.json$/i);
  if (metaBlob) {
    try {
      var rawMeta = JSON.parse(blobToText_(metaBlob));
      var mi = rawMeta.meta_info || rawMeta;
      if (mi.task_id) taskId = mi.task_id;
    } catch(e) {}
  }

  var task = loadTaskFromEntries_(entries, taskId);

  var persona = null;
  if (personaKey) {
    persona = (PERSONA_REGISTRY || {})[personaKey.toLowerCase()] || null;
  }
  if (!persona) persona = lookupPersona_(task);

  var checkResults = runAllChecks_(task, persona);

  return {
    task_id: taskId,
    user_name: task.user_name || "Unknown",
    task_description: summarizeTask_(task),
    turn_count: task.turn_count,
    tool_call_count: task.tool_call_count,
    checks: checkResults.map(function(c) {
      return { check: c.check, result: c.result, issues: c.issues, severity: c.severity, details: c.details };
    })
  };
}


/* ═══════════ Main Review Pipeline ═══════════ */

/**
 * Full review from Drive link.
 */
function runReview(driveLink, personaKey) {
  var ref  = parseRef_(driveLink);
  var blob = downloadZip_(ref);
  var entries = Utilities.unzip(blob);
  var taskId = ref.id.substring(0, 12);
  return runPipeline_(entries, taskId, personaKey);
}

/**
 * Full review from uploaded ZIP (base64-encoded).
 */
function runReviewFromUpload(base64Data, fileName, personaKey) {
  var decoded = Utilities.base64Decode(base64Data);
  var blob = Utilities.newBlob(decoded, "application/zip", fileName || "upload.zip");
  var entries = Utilities.unzip(blob);
  var taskId = extractTaskIdFromFileName_(fileName);
  return runPipeline_(entries, taskId, personaKey);
}

/**
 * Checks only from Drive link (no LLM call).
 */
function runChecksOnly(driveLink, personaKey) {
  var ref  = parseRef_(driveLink);
  var blob = downloadZip_(ref);
  var entries = Utilities.unzip(blob);
  var taskId = ref.id.substring(0, 12);
  return runChecksPipeline_(entries, taskId, personaKey);
}

/**
 * Checks only from uploaded ZIP (no LLM call).
 */
function runChecksOnlyFromUpload(base64Data, fileName, personaKey) {
  var decoded = Utilities.base64Decode(base64Data);
  var blob = Utilities.newBlob(decoded, "application/zip", fileName || "upload.zip");
  var entries = Utilities.unzip(blob);
  var taskId = extractTaskIdFromFileName_(fileName);
  return runChecksPipeline_(entries, taskId, personaKey);
}

/**
 * Extract a meaningful task ID from the ZIP filename.
 * Handles both formats:
 *   Format A: "taskfolder.zip" → "taskfolder"
 *   Format B: "user-uuid-timestamp.zip" → the UUID portion
 */
function extractTaskIdFromFileName_(fileName) {
  var name = (fileName || "upload").replace(/\.zip$/i, "");
  var uuidMatch = name.match(/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i);
  if (uuidMatch) return uuidMatch[1];
  return name.substring(0, 40);
}


/* ═══════════ Task Description (LLM-based) ═══════════ */

/**
 * Use the LLM to generate a concise task description by analyzing
 * the full conversation trajectory. Falls back to metadata if available.
 */
function summarizeTask_(task) {
  var meta = task.metadata || {};
  if (meta.task_description) return meta.task_description;

  var turns = task.turns || [];
  if (turns.length === 0) return "";

  try {
    return summarizeWithLLM_(turns);
  } catch (e) {
    Logger.log("LLM summary failed, using fallback: " + e.message);
    return summarizeFallback_(turns);
  }
}

/**
 * Call the LLM with a condensed trajectory and ask for a task summary.
 */
function summarizeWithLLM_(turns) {
  var condensed = [];
  var charBudget = 6000;
  var used = 0;

  for (var i = 0; i < turns.length && used < charBudget; i++) {
    var userSnip = (turns[i].user_text || "").substring(0, 500);
    var asstSnip = (turns[i].assistant_text || "").substring(0, 500);

    var toolNames = [];
    var tc = turns[i].tool_calls || [];
    for (var t = 0; t < tc.length; t++) {
      if (tc[t].name) toolNames.push(tc[t].name);
    }

    var block = "Turn " + (i + 1) + ":\n" +
      "User: " + userSnip + "\n" +
      "Agent: " + asstSnip + "\n";
    if (toolNames.length > 0) {
      block += "Tools used: " + toolNames.join(", ") + "\n";
    }

    used += block.length;
    condensed.push(block);
  }

  var prompt =
    "Below is a condensed conversation between a user and an AI agent. " +
    "Analyze the ENTIRE conversation and write a clear, concise task description " +
    "(2-3 sentences) that explains:\n" +
    "1. What the user wanted to accomplish\n" +
    "2. What domain/topic the task covers\n" +
    "3. What the agent did to help (tools used, files created, etc.)\n\n" +
    "Ignore system metadata, sender prefixes, and JSON blocks — focus on the actual task.\n" +
    "Return ONLY the description text, nothing else.\n\n" +
    "--- CONVERSATION ---\n" +
    condensed.join("\n");

  var response = callLLM_(prompt);
  var summary = (response || "").trim();

  if (summary.length < 10) return "";
  if (summary.length > 500) summary = summary.substring(0, 497) + "...";
  return summary;
}

/**
 * Fallback: pick the most substantive cleaned user message from the trajectory.
 */
function summarizeFallback_(turns) {
  var best = "";
  var limit = Math.min(turns.length, 5);

  for (var i = 0; i < limit; i++) {
    var text = (turns[i].user_text || "").trim();
    text = text.replace(/Sender \(untrusted metadata\):\s*```[^`]*```/gi, "");
    text = text.replace(/Sender \(untrusted metadata\):[^\n]*/gi, "");
    text = text.replace(/```[\s\S]*?```/gi, "");
    text = text.replace(/\[.*?\d{4}[-/]\d{2}[-/]\d{2}.*?\]/g, "");
    text = text.replace(/\[(Mon|Tue|Wed|Thu|Fri|Sat|Sun)\s[^\]]*\]/gi, "");
    text = text.replace(/\{[^}]*"label"[^}]*\}/g, "");
    text = text.replace(/\{[^}]*"id"[^}]*\}/g, "");
    text = text.replace(/\n{3,}/g, "\n\n").trim();

    if (text.length > best.length) best = text;
  }

  if (best.length < 10) return "";
  if (best.length > 400) return best.substring(0, 397) + "...";
  return best;
}


/* ═══════════ Admin helpers ═══════════ */

function setApiKey(key) {
  PropertiesService.getScriptProperties().setProperty("OPENAI_API_KEY", key);
  LLM.KEY = key;
  return "API key saved.";
}

function setModel(model) {
  PropertiesService.getScriptProperties().setProperty("OPENAI_MODEL", model);
  LLM.MODEL = model;
  return "Model set to " + model;
}

function setBaseUrl(url) {
  PropertiesService.getScriptProperties().setProperty("OPENAI_BASE_URL", url);
  LLM.BASE = url;
  return "Base URL set to " + url;
}

function getConfig() {
  return {
    hasApiKey: !!LLM.KEY,
    model: LLM.MODEL,
    baseUrl: LLM.BASE,
    hasPersonas: Object.keys(PERSONA_REGISTRY || {}).length > 0
  };
}

function getPersonaRegistryRaw() {
  return JSON.stringify(PERSONA_REGISTRY || {});
}
