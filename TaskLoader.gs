/******************************************************
 * TaskLoader.gs — Parse OpenClaw task ZIP into structured task object
 *
 * Supports TWO export formats:
 *   Format A (task export): metadata.json, trajectory.jsonl,
 *            workspace/workspace/*, workspace_before/workspace/*
 *   Format B (full export): export-manifest.json, <uuid>.jsonl,
 *            workspace/*, workspace_before/*
 *
 * Returns a task object matching the Python pipeline shape.
 ******************************************************/

var WORKSPACE_SYSTEM_FILES = [
  "AGENTS.md", "SOUL.md", "USER.md", "IDENTITY.md",
  "HEARTBEAT.md", "TOOLS.md", "BOOTSTRAP.md"
];

var SKIP_DIRS = [".git", ".clawhub", ".openclaw", "sessions", "skills"];

/**
 * loadTaskFromEntries — main entry point
 * @param {Blob[]} entries - unzipped blobs from Utilities.unzip
 * @param {string} taskId - task folder name / ID
 * @returns {Object} structured task object
 */
function loadTaskFromEntries_(entries, taskId) {
  var metadataBlob = findEntry_(entries, /(^|\/)metadata\.json$/i);
  var manifestBlob = !metadataBlob ? findEntry_(entries, /(^|\/)export-manifest\.json$/i) : null;

  var trajectoryBlob = findEntry_(entries, /(^|\/)trajectory\.jsonl$/i);
  if (!trajectoryBlob) {
    trajectoryBlob = findTrajectoryJsonl_(entries);
  }

  var metadata = {};
  if (metadataBlob) {
    metadata = parseMetadata_(blobToText_(metadataBlob));
  } else if (manifestBlob) {
    metadata = parseExportManifest_(blobToText_(manifestBlob));
  }

  var turns = trajectoryBlob ? parseTrajectory_(blobToText_(trajectoryBlob)) : [];

  var format = detectWorkspaceFormat_(entries);
  var wsBefore, wsAfter;
  if (format === "nested") {
    wsBefore = loadWorkspaceEntries_(entries, /workspace_before\/workspace\//);
    wsAfter = loadWorkspaceEntries_(entries, /workspace\/workspace\//);
  } else {
    wsBefore = loadWorkspaceFlat_(entries, "workspace_before/");
    wsAfter = loadWorkspaceFlat_(entries, "workspace/");
  }

  var wsDiff = computeWorkspaceDiff_(wsBefore, wsAfter);
  var userName = extractUserName_(wsAfter) || extractUserName_(wsBefore);

  var toolCallCount = 0;
  for (var i = 0; i < turns.length; i++) {
    toolCallCount += (turns[i].tool_calls || []).length;
  }

  return {
    task_id: taskId,
    metadata: metadata,
    turns: turns,
    workspace_before: wsBefore,
    workspace_after: wsAfter,
    workspace_diff: wsDiff,
    user_name: userName,
    turn_count: turns.length,
    tool_call_count: toolCallCount
  };
}


/* ───── Metadata ───── */

function parseMetadata_(text) {
  if (!text) return {};
  try {
    var raw = JSON.parse(text);
  } catch (e) {
    return {};
  }

  var mi = raw.meta_info || raw;
  var rubrics = mi.rubrics || {};

  var taskTypeRaw = mi.task_type || [];
  var flatTypes = [];
  for (var i = 0; i < taskTypeRaw.length; i++) {
    if (Array.isArray(taskTypeRaw[i])) {
      flatTypes = flatTypes.concat(taskTypeRaw[i]);
    } else {
      flatTypes.push(String(taskTypeRaw[i]));
    }
  }

  return {
    task_type: flatTypes,
    task_description: mi.task_description || "",
    task_completion_status: mi.task_completion_status || "",
    ground_truth_scores: {
      correctness: rubrics.correctness || null,
      correctness_rationale: rubrics.correctness_rationale || "",
      completeness: rubrics.completeness || null,
      completeness_rationale: rubrics.completeness_rationale || "",
      efficiency: rubrics.efficiency || null,
      efficiency_rationale: rubrics.efficiency_rationale || "",
      naturality: rubrics.naturality || null,
      naturality_rationale: rubrics.naturality_rationale || "",
      overall: rubrics.overall || null,
      overall_rationale: rubrics.overall_rationale || ""
    }
  };
}

/**
 * Parse the newer export-manifest.json format.
 */
function parseExportManifest_(text) {
  if (!text) return {};
  try {
    var raw = JSON.parse(text);
  } catch (e) {
    return {};
  }
  return {
    task_type: [],
    task_description: "",
    task_completion_status: "",
    sandbox_id: raw.sandboxId || "",
    exported_at: raw.exportedAt || "",
    workspace_root: raw.workspaceRoot || "",
    ground_truth_scores: {}
  };
}

/**
 * Find a UUID-named .jsonl trajectory file (Format B).
 * Skips provider_http.jsonl and any files under logs/.
 */
function findTrajectoryJsonl_(entries) {
  for (var i = 0; i < entries.length; i++) {
    var name = String(entries[i].getName() || "");
    if (!name.match(/\.jsonl$/i)) continue;
    if (/provider/i.test(name)) continue;
    if (/\/logs\//i.test(name)) continue;
    if (/\/sessions\//i.test(name)) continue;
    return entries[i];
  }
  return null;
}

/**
 * Detect whether workspace files use nested (workspace/workspace/)
 * or flat (workspace/) layout.
 */
function detectWorkspaceFormat_(entries) {
  for (var i = 0; i < entries.length; i++) {
    var name = String(entries[i].getName() || "");
    if (/\/workspace\/workspace\//.test(name)) return "nested";
  }
  return "flat";
}

/**
 * Load workspace files from flat layout (workspace/FILE directly).
 * Strips the top-level folder + workspace/ or workspace_before/ prefix.
 */
function loadWorkspaceFlat_(entries, wsPrefix) {
  var files = {};
  var rxPrefix = new RegExp("(^|/)" + wsPrefix.replace(/[\/]/g, "\\/"), "i");

  for (var i = 0; i < entries.length; i++) {
    var name = String(entries[i].getName() || "");
    if (!rxPrefix.test(name)) continue;
    if (name.endsWith("/")) continue;

    // Exclude workspace_before/ when loading workspace/
    if (wsPrefix === "workspace/" && /workspace_before\//i.test(name)) continue;

    var shouldSkip = false;
    for (var s = 0; s < SKIP_DIRS.length; s++) {
      if (name.indexOf("/" + SKIP_DIRS[s] + "/") !== -1) {
        shouldSkip = true;
        break;
      }
    }
    // Also skip ${SANDBOX_WORKSPACE_ROOT} paths
    if (name.indexOf("${SANDBOX_WORKSPACE_ROOT}") !== -1) shouldSkip = true;
    if (shouldSkip) continue;

    var idx = name.indexOf(wsPrefix);
    if (idx === -1) continue;
    var relPath = name.substring(idx + wsPrefix.length);
    if (!relPath) continue;

    try {
      files[relPath] = entries[i].getDataAsString("UTF-8");
    } catch (e) {
      try {
        files[relPath] = entries[i].getDataAsString();
      } catch (e2) {}
    }
  }
  return files;
}


/* ───── Trajectory parsing ───── */

function parseTrajectory_(text) {
  if (!text) return [];

  var lines = text.split("\n");
  var events = [];
  for (var i = 0; i < lines.length; i++) {
    var line = lines[i].trim();
    if (!line) continue;
    try {
      events.push(JSON.parse(line));
    } catch (e) {
      // skip malformed lines
    }
  }

  var turns = [];
  var currentTurn = null;
  var pendingToolCalls = {};

  for (var j = 0; j < events.length; j++) {
    var evt = events[j];
    if (evt.type !== "message") continue;

    var msg = evt.message || {};
    var role = msg.role || "";
    var content = msg.content || [];
    if (typeof content === "string") {
      content = [{ type: "text", text: content }];
    }

    if (role === "user") {
      if (currentTurn !== null) {
        turns.push(currentTurn);
      }
      currentTurn = {
        user_text: extractText_(content),
        assistant_text: "",
        tool_calls: [],
        timestamp: evt.timestamp || ""
      };

    } else if (role === "assistant" && currentTurn !== null) {
      for (var k = 0; k < content.length; k++) {
        var block = content[k];
        if (block.type === "text") {
          if (currentTurn.assistant_text) currentTurn.assistant_text += "\n";
          currentTurn.assistant_text += (block.text || "");
        } else if (block.type === "toolCall") {
          var callId = block.id || "";
          var callInfo = {
            id: callId,
            name: block.name || "",
            arguments: block.arguments || {},
            result: null,
            is_error: false
          };
          pendingToolCalls[callId] = callInfo;
          currentTurn.tool_calls.push(callInfo);
        }
      }

    } else if (role === "toolResult" && currentTurn !== null) {
      var tcId = msg.toolCallId || "";
      var resultContent = msg.content || [];
      var isError = msg.isError || false;
      var resultText = Array.isArray(resultContent) ? extractText_(resultContent) : String(resultContent);

      if (pendingToolCalls[tcId]) {
        pendingToolCalls[tcId].result = resultText;
        pendingToolCalls[tcId].is_error = isError;
      }
    }
  }

  if (currentTurn !== null) {
    turns.push(currentTurn);
  }

  return turns;
}

function extractText_(contentBlocks) {
  var parts = [];
  for (var i = 0; i < contentBlocks.length; i++) {
    var block = contentBlocks[i];
    if (typeof block === "string") {
      parts.push(block);
    } else if (block && block.type === "text") {
      parts.push(block.text || "");
    }
  }
  return parts.join("\n");
}


/* ───── Workspace loading from ZIP entries ───── */

function loadWorkspaceEntries_(entries, prefixRx) {
  var files = {};
  for (var i = 0; i < entries.length; i++) {
    var name = entries[i].getName() || "";
    if (!prefixRx.test(name)) continue;

    var shouldSkip = false;
    for (var s = 0; s < SKIP_DIRS.length; s++) {
      if (name.indexOf("/" + SKIP_DIRS[s] + "/") !== -1) {
        shouldSkip = true;
        break;
      }
    }
    if (shouldSkip) continue;

    // Get relative path after workspace/workspace/ or workspace_before/workspace/
    var match = name.match(prefixRx);
    if (!match) continue;
    var relPath = name.substring(name.indexOf(match[0]) + match[0].length);
    if (!relPath) continue;
    // Skip directories
    if (name.endsWith("/")) continue;

    try {
      files[relPath] = entries[i].getDataAsString("UTF-8");
    } catch (e) {
      try {
        files[relPath] = entries[i].getDataAsString();
      } catch (e2) {
        // skip unreadable files
      }
    }
  }
  return files;
}

function computeWorkspaceDiff_(before, after) {
  var beforeKeys = Object.keys(before);
  var afterKeys = Object.keys(after);
  var beforeSet = {};
  var afterSet = {};
  for (var i = 0; i < beforeKeys.length; i++) beforeSet[beforeKeys[i]] = true;
  for (var j = 0; j < afterKeys.length; j++) afterSet[afterKeys[j]] = true;

  var newFiles = afterKeys.filter(function(k) { return !beforeSet[k]; }).sort();
  var deletedFiles = beforeKeys.filter(function(k) { return !afterSet[k]; }).sort();
  var modifiedFiles = beforeKeys.filter(function(k) {
    return afterSet[k] && before[k] !== after[k];
  }).sort();

  return {
    new_files: newFiles,
    deleted_files: deletedFiles,
    modified_files: modifiedFiles
  };
}

function extractUserName_(workspace) {
  var userMd = workspace["USER.md"] || "";
  var lines = userMd.split("\n");
  for (var i = 0; i < lines.length; i++) {
    if (lines[i].indexOf("**Name:**") !== -1) {
      var name = lines[i].split("**Name:**")[1].trim();
      if (name && name !== "_(optional)_") return name;
    }
  }
  return null;
}


/* ───── Shared utilities (reused from LLM Reviewer pattern) ───── */

function findEntry_(entries, rx) {
  for (var i = 0; i < entries.length; i++) {
    if (rx.test(String(entries[i].getName() || ""))) return entries[i];
  }
  return null;
}

function blobToText_(blob) {
  if (!blob) return "";
  try { return blob.getDataAsString("UTF-8"); } catch (_) { return blob.getDataAsString(); }
}
