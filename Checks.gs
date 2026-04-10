/******************************************************
 * Checks.gs — Five rule-based QA checks ported from Python
 *
 * Each check returns: { check, result, issues[], severity, details{} }
 * result: "PASS" | "WARNING" | "FAIL"
 * severity: "low" | "medium" | "high"
 ******************************************************/


/* ═══════════════════════════════════════════════════
   1. PERSONA MATCH
   ═══════════════════════════════════════════════════ */

function normalizeName_(s) {
  return s.toLowerCase()
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .replace(/[-]/g, " ")
    .replace(/['']/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

function runPersonaMatch_(task, persona) {
  if (!persona) {
    return { check: "persona_match", result: "WARNING",
             issues: ["No persona record found for this task's user"],
             severity: "medium", details: {} };
  }

  var issues = [];
  var userTexts = collectUserTexts_(task);
  var combinedText = userTexts.join("\n").toLowerCase();

  // Name check (normalize hyphens, accents — "Ciarán"="Ciaran", "Wei-Ming"="Wei Ming")
  var personaName = (persona.full_name || "").trim();
  var userMdName  = (task.user_name || "").trim();
  if (personaName && userMdName) {
    var pNorm = normalizeName_(personaName);
    var uNorm = normalizeName_(userMdName);
    if (pNorm !== uNorm) {
      var pFirst = pNorm.split(" ")[0];
      var uFirst = uNorm.split(" ")[0];
      if (pFirst !== uFirst) {
        issues.push("Name mismatch: persona='" + personaName + "', USER.md='" + userMdName + "'");
      }
    }
  }

  // Location check
  var personaCity = (persona.city || "").trim().toLowerCase();
  if (personaCity) {
    var cityParts = personaCity.split(",").map(function(p) { return p.trim(); });
    for (var t = 0; t < userTexts.length; t++) {
      var textLower = userTexts[t].toLowerCase();
      var locClaims = extractLocationClaims_(textLower);
      for (var c = 0; c < locClaims.length; c++) {
        var claimInCity = false;
        for (var cp = 0; cp < cityParts.length; cp++) {
          if (locClaims[c].indexOf(cityParts[cp]) !== -1) { claimInCity = true; break; }
        }
        if (!claimInCity && personaCity.indexOf(locClaims[c]) === -1) {
          issues.push("Location claim '" + locClaims[c] + "' in user message doesn't match persona city '" + personaCity + "'");
        }
      }
    }
  }

  // Job/sector check
  var personaJob = (persona.job_title || "").trim().toLowerCase();
  var personaSector = (persona.sector || "").trim().toLowerCase();
  var jobClaims = extractJobClaims_(combinedText);
  for (var j = 0; j < jobClaims.length; j++) {
    var claimL = jobClaims[j].toLowerCase();
    if (personaJob && claimL.indexOf(personaJob) === -1 && personaJob.indexOf(claimL) === -1) {
      if (personaSector && claimL.indexOf(personaSector) === -1 && personaSector.indexOf(claimL) === -1) {
        issues.push("Job/role claim '" + jobClaims[j] + "' doesn't match persona job '" + personaJob + "' or sector '" + personaSector + "'");
      }
    }
  }

  // Platform contradiction check
  var personaPlatforms = {};
  (persona.platforms || "").split(",").forEach(function(p) {
    var trimmed = p.trim().toLowerCase();
    if (trimmed) personaPlatforms[trimmed] = true;
  });

  var platformList = "instagram|insta|facebook|twitter|tiktok|snapchat|linkedin|reddit|discord|twitch|pinterest|whatsapp|telegram|bluesky|threads|youtube";
  var negPatterns = [
    new RegExp("(?:i\\s+)?(?:don'?t|do\\s+not)\\s+(?:have|use)\\s+(" + platformList + ")", "gi"),
    new RegExp("(?:i'm\\s+)?not\\s+on\\s+(" + platformList + ")", "gi"),
    new RegExp("(?:i\\s+)?(?:don'?t|do\\s+not)\\s+have\\s+(?:an?\\s+)?(" + platformList + ")\\s+(?:account|profile)", "gi")
  ];
  for (var np = 0; np < negPatterns.length; np++) {
    var m;
    while ((m = negPatterns[np].exec(combinedText)) !== null) {
      var denied = m[1].toLowerCase();
      for (var pp in personaPlatforms) {
        if (denied.indexOf(pp) !== -1 || pp.indexOf(denied) !== -1) {
          issues.push("User denies having '" + denied + "' but persona lists platform '" + pp + "'");
        }
      }
    }
  }

  // Determine result
  var nameIssues = issues.filter(function(i) { return i.indexOf("Name mismatch") !== -1; });
  var locIssues  = issues.filter(function(i) { return i.indexOf("Location claim") !== -1; });

  var result, severity;
  if (nameIssues.length > 0) {
    severity = "high"; result = "FAIL";
  } else if (locIssues.length >= 2) {
    severity = "high"; result = "FAIL";
  } else if (issues.length > 0) {
    severity = "medium"; result = "WARNING";
  } else {
    severity = "low"; result = "PASS";
  }

  return { check: "persona_match", result: result, issues: issues, severity: severity, details: {} };
}


function collectUserTexts_(task) {
  var texts = [];
  var turns = task.turns || [];
  for (var i = 0; i < turns.length; i++) {
    var ut = turns[i].user_text || "";
    if (!ut || ut.indexOf("Session Startup sequence") !== -1) continue;
    var cleaned = ut.replace(/^Sender \(untrusted metadata\):[\s\S]*?\n\n/, "");
    cleaned = cleaned.replace(/^\[.*?\]\s*/, "");
    cleaned = cleaned.trim();
    if (cleaned) texts.push(cleaned);
  }
  return texts;
}

function extractLocationClaims_(text) {
  var patterns = [
    /(?:i\s+)?(?:live|living|based|located|reside)\s+(?:in|at|near)\s+([a-zA-Z][a-zA-Z\s,]+?)(?:\.|,|\s+and|\s+but|\s+no\s|$)/gi,
    /i'?m\s+(?:from|in)\s+([a-zA-Z][a-zA-Z\s,]+?)(?:\.|,|\s+and|\s+but|\s+no\s|\s+i\s|$)/gi,
    /\bim\s+in\s+([a-zA-Z][a-zA-Z\s,]+?)(?:\.|,|\s+and|\s+but|\s+no\s|$)/gi
  ];
  var stopWords = { "the":1, "this":1, "that":1, "here":1, "there":1, "my":1, "a":1, "an":1, "it":1, "they":1, "we":1, "you":1, "he":1, "she":1, "not":1, "good":1 };
  var claims = [];
  for (var p = 0; p < patterns.length; p++) {
    var m;
    while ((m = patterns[p].exec(text)) !== null) {
      var loc = m[1].trim().replace(/[,.\s]+$/, "");
      if (loc.length > 2 && !stopWords[loc.toLowerCase()]) {
        claims.push(loc.toLowerCase());
      }
    }
  }
  return claims;
}

function extractJobClaims_(text) {
  var patterns = [
    /i\s+(?:work|am\s+working)\s+as\s+(?:a\s+|an\s+)?([a-z][a-z\s]+?)(?:\.|,|\s+and|\s+at|$)/gi,
    /i'?m\s+(?:a\s+|an\s+)([a-z][a-z\s]*?(?:analyst|engineer|developer|manager|director|specialist|coordinator|officer|consultant))(?:\s|$|\.|,)/gi
  ];
  var stopWords = { "the":1, "this":1, "that":1, "very":1, "really":1, "just":1, "also":1, "every":1, "in finance remotely":1 };
  var claims = [];
  for (var p = 0; p < patterns.length; p++) {
    var m;
    while ((m = patterns[p].exec(text)) !== null) {
      var job = m[1].trim().replace(/[,.\s]+$/, "");
      if (job.length > 5 && !stopWords[job]) claims.push(job);
    }
  }
  return claims;
}


/* ═══════════════════════════════════════════════════
   2. CLAIM SOURCING
   ═══════════════════════════════════════════════════ */

var SOURCED_TOOLS = { "web_search": 1, "web_fetch": 1, "memory_search": 1, "exec": 1, "read": 1, "browser": 1 };

var FACTUAL_PATTERNS = [
  /\b\d{3,}[\s,]*(?:seats?|capacity|people|employees|members)\b/gi,
  /\b(?:founded|established|opened|started)\s+(?:in\s+)?\d{4}\b/gi,
  /\baccording\s+to\b/gi,
  /\b(?:around|approximately|about|roughly)\s+\d+/gi,
  /\b(?:probably|likely)\s+(?:around|about|costs?|takes?|has|have|is|are|was|were)\s+\d/gi,
  /\$[\d,]+/g,
  /\b\d+%\b/g
];

var SPECULATIVE_MARKERS = [
  "probably", "i think", "i believe", "likely", "i assume",
  "i'd guess", "i suspect", "might be", "could be"
];

function runClaimSourcing_(task, persona) {
  var issues = [];
  var unsourcedCount = 0;
  var totalClaims = 0;
  var speculativeClaims = [];

  var turns = task.turns || [];
  var cumulativeToolContext = "";

  for (var i = 0; i < turns.length; i++) {
    var asst = turns[i].assistant_text || "";

    var turnToolResults = collectToolContext_(turns[i]);
    if (turnToolResults) {
      cumulativeToolContext += "\n" + turnToolResults;
    }

    if (!asst) continue;

    var hasToolData = cumulativeToolContext.length > 1;

    for (var fp = 0; fp < FACTUAL_PATTERNS.length; fp++) {
      var rx = new RegExp(FACTUAL_PATTERNS[fp].source, FACTUAL_PATTERNS[fp].flags);
      var m;
      while ((m = rx.exec(asst)) !== null) {
        totalClaims++;
        var snippet = surroundingSentence_(asst, m.index, m.index + m[0].length);
        if (!hasToolData) {
          unsourcedCount++;
          issues.push("Turn " + (i+1) + ": Factual claim not preceded by tool call: '" + snippet + "'");
        } else {
          var terms = keyTerms_(snippet);
          if (!termsInContext_(terms, cumulativeToolContext)) {
            unsourcedCount++;
            issues.push("Turn " + (i+1) + ": Claim terms not found in tool results: '" + snippet + "'");
          }
        }
      }
    }

    for (var sm = 0; sm < SPECULATIVE_MARKERS.length; sm++) {
      if (asst.toLowerCase().indexOf(SPECULATIVE_MARKERS[sm]) !== -1) {
        var sentence = findSentenceWith_(asst, SPECULATIVE_MARKERS[sm]);
        if (sentence) speculativeClaims.push("Turn " + (i+1) + ": Speculative: '" + sentence + "'");
      }
    }
  }

  if (speculativeClaims.length > 0) {
    issues = issues.concat(speculativeClaims.slice(0, 5));
  }

  if (totalClaims === 0 && speculativeClaims.length === 0) {
    return { check: "claim_sourcing", result: "PASS", issues: [], severity: "low",
             details: { total_claims: 0, unsourced: 0, speculative: 0 } };
  }

  var ratio = unsourcedCount / Math.max(totalClaims, 1);
  var specCount = speculativeClaims.length;
  var result, severity;

  if ((ratio > 0.5 && totalClaims >= 3) || (unsourcedCount >= 5)) {
    result = "FAIL"; severity = "high";
  } else if (ratio > 0.5 && totalClaims < 3) {
    result = "WARNING"; severity = "medium";
  } else if (ratio > 0.2 || specCount >= 2) {
    result = "WARNING"; severity = "medium";
  } else if (specCount === 1) {
    result = "WARNING"; severity = "low";
  } else {
    result = "PASS"; severity = "low";
  }

  return { check: "claim_sourcing", result: result, issues: issues.slice(0, 10), severity: severity,
           details: { total_claims: totalClaims, unsourced: unsourcedCount, speculative: specCount } };
}

function collectToolContext_(turn) {
  var parts = [];
  var tcs = turn.tool_calls || [];
  for (var i = 0; i < tcs.length; i++) {
    if (SOURCED_TOOLS[tcs[i].name] && tcs[i].result) parts.push(String(tcs[i].result));
  }
  return parts.join("\n");
}

function surroundingSentence_(text, start, end) {
  var ss = text.lastIndexOf(".", start);
  ss = ss !== -1 ? ss + 1 : 0;
  var se = text.indexOf(".", end);
  if (se === -1) se = Math.min(end + 100, text.length);
  var snippet = text.substring(ss, se + 1).trim();
  return snippet.length > 200 ? snippet.substring(0, 200) + "..." : snippet;
}

function keyTerms_(text) {
  var words = (text.toLowerCase().match(/[a-zA-Z]{4,}/g)) || [];
  var stop = { "that":1, "this":1, "with":1, "from":1, "have":1, "been":1, "were":1, "they":1,
    "their":1, "about":1, "around":1, "which":1, "would":1, "could":1, "should":1,
    "also":1, "than":1, "more":1, "some":1, "just":1, "very":1, "really":1, "probably":1 };
  return words.filter(function(w) { return !stop[w]; });
}

function termsInContext_(terms, context) {
  if (!terms.length) return true;
  var ctxL = context.toLowerCase();
  var matches = 0;
  for (var i = 0; i < terms.length; i++) {
    if (ctxL.indexOf(terms[i]) !== -1) matches++;
  }
  return matches / terms.length >= 0.3;
}

function findSentenceWith_(text, marker) {
  var idx = text.toLowerCase().indexOf(marker);
  if (idx === -1) return "";
  return surroundingSentence_(text, idx, idx + marker.length);
}


/* ═══════════════════════════════════════════════════
   3. TOOL EFFICIENCY
   ═══════════════════════════════════════════════════ */

function runToolEfficiency_(task, persona) {
  var allCalls = [];
  var turns = task.turns || [];
  for (var i = 0; i < turns.length; i++) {
    allCalls = allCalls.concat(turns[i].tool_calls || []);
  }

  if (allCalls.length === 0) {
    var turnCount = task.turn_count || turns.length;
    if (turnCount > 1) {
      return { check: "tool_efficiency", result: "FAIL",
               issues: ["No tool calls in a multi-turn trajectory — not agentic behavior, just plain LLM Q&A"],
               severity: "high", details: { total_calls: 0, waste_ratio: 1 } };
    }
    return { check: "tool_efficiency", result: "WARNING",
             issues: ["No tool calls detected — trajectory may lack agentic value"],
             severity: "medium", details: { total_calls: 0, waste_ratio: 0 } };
  }

  var total = allCalls.length;
  var failed = 0, emptyResults = 0, redundant = 0;
  var issues = [];
  var seenCalls = {};

  for (var j = 0; j < allCalls.length; j++) {
    var tc = allCalls[j];
    var name = tc.name || "";
    var args = JSON.stringify(tc.arguments || {});
    var result = tc.result || "";
    var isError = tc.is_error || false;

    var callKey = name + ":" + args;
    if (seenCalls[callKey]) {
      redundant++;
      if (seenCalls[callKey] === 1) {
        issues.push("Redundant call: " + name + "(" + args.substring(0, 60) + "...)");
      }
    }
    seenCalls[callKey] = (seenCalls[callKey] || 0) + 1;

    if (isError) {
      failed++;
      issues.push("Failed call: " + name + " → error");
    } else if (name === "web_search" && isEmptySearch_(result)) {
      emptyResults++;
      issues.push("Empty search result: " + name + "(" + args.substring(0, 60) + "...)");
    } else if (name === "web_fetch" && isBlockedFetch_(result)) {
      failed++;
      issues.push("Blocked/failed fetch: " + name + "(" + args.substring(0, 60) + "...)");
    }
  }

  var waste = failed + emptyResults + redundant;
  var wasteRatio = total > 0 ? waste / total : 0;
  var resultStr, severity;

  if (wasteRatio > 0.4) {
    resultStr = "FAIL"; severity = "high";
  } else if (wasteRatio > 0.2) {
    resultStr = "WARNING"; severity = "medium";
  } else {
    resultStr = "PASS"; severity = "low";
  }

  return { check: "tool_efficiency", result: resultStr, issues: issues.slice(0, 10), severity: severity,
           details: { total_calls: total, failed: failed, empty_results: emptyResults, redundant: redundant, waste_ratio: Math.round(wasteRatio * 1000) / 1000 } };
}

function isEmptySearch_(result) {
  var lower = result.toLowerCase();
  return lower.indexOf("no results") !== -1 || lower.indexOf("0 results") !== -1 || result.trim().length < 20;
}

function isBlockedFetch_(result) {
  var lower = result.toLowerCase();
  var markers = ["403", "blocked", "access denied", "captcha", "cloudflare", "error", "failed to fetch", "enoent", "enotfound"];
  for (var i = 0; i < markers.length; i++) {
    if (lower.indexOf(markers[i]) !== -1) return true;
  }
  return false;
}


/* ═══════════════════════════════════════════════════
   4. WORKSPACE DIFF
   ═══════════════════════════════════════════════════ */

function runWorkspaceDiff_(task, persona) {
  var diff = task.workspace_diff || {};
  var newFiles = diff.new_files || [];
  var modifiedFiles = diff.modified_files || [];
  var deletedFiles = diff.deleted_files || [];
  var issues = [];

  for (var i = 0; i < modifiedFiles.length; i++) {
    var basename = modifiedFiles[i].split("/").pop();
    if (WORKSPACE_SYSTEM_FILES.indexOf(basename) !== -1 && basename !== "USER.md") {
      issues.push("System file modified: " + modifiedFiles[i]);
    }
  }

  for (var d = 0; d < deletedFiles.length; d++) {
    issues.push("File deleted during trajectory: " + deletedFiles[d]);
  }

  var customNew = newFiles.filter(function(f) {
    return WORKSPACE_SYSTEM_FILES.indexOf(f.split("/").pop()) === -1;
  });

  var details = { new_files: newFiles, modified_files: modifiedFiles,
                  deleted_files: deletedFiles, custom_new_files: customNew };

  if (deletedFiles.length > 0) {
    return { check: "workspace_diff", result: "WARNING", issues: issues, severity: "medium", details: details };
  }
  if (issues.length > 0) {
    return { check: "workspace_diff", result: "WARNING", issues: issues, severity: "low", details: details };
  }
  return { check: "workspace_diff", result: "PASS", issues: [], severity: "low", details: details };
}


/* ═══════════════════════════════════════════════════
   5. USER.MD PROPAGATION
   ═══════════════════════════════════════════════════ */

function runUserMdPropagation_(task, persona) {
  if (!persona) {
    return { check: "user_md_propagation", result: "PASS",
             issues: ["No persona to compare against"],
             severity: "low", details: {} };
  }

  var wsAfter = task.workspace_after || {};
  var userMd = wsAfter["USER.md"] || "";

  if (!userMd.trim()) {
    return { check: "user_md_propagation", result: "PASS",
             issues: ["USER.md is empty or missing — no errors to detect"],
             severity: "low", details: {} };
  }

  var issues = [];
  var mdFields = parseUserMd_(userMd);

  // Name check (normalize hyphens, accents)
  var personaName = (persona.full_name || "").trim();
  var mdName = (mdFields.name || "").trim();
  if (personaName && mdName) {
    var pNorm = normalizeName_(personaName);
    var mNorm = normalizeName_(mdName);
    if (pNorm !== mNorm) {
      var pFirst = pNorm.split(" ")[0];
      var mFirst = mNorm.split(" ")[0];
      if (pFirst !== mFirst) {
        issues.push("USER.md name '" + mdName + "' doesn't match persona '" + personaName + "'");
      }
    }
  }

  // Timezone check
  var personaTz = (persona.timezone || "").trim().toLowerCase();
  var mdTz = (mdFields.timezone || "").trim().toLowerCase();
  if (personaTz && mdTz) {
    if (mdTz.indexOf(personaTz) === -1 && personaTz.indexOf(mdTz) === -1) {
      issues.push("USER.md timezone '" + mdTz + "' doesn't match persona '" + personaTz + "'");
    }
  }

  // Location check
  var personaCity = (persona.city || "").trim().toLowerCase();
  var fullText = ((mdFields.notes || "") + " " + (mdFields.context || "")).toLowerCase();

  if (personaCity) {
    var cParts = personaCity.split(",").map(function(p) { return p.trim(); });
    var locRx = /(?:lives?\s+in|based\s+in|located\s+in|resides?\s+in)\s+([a-z][a-z\s,]+?)(?:\.|,|$)/gi;
    var lm;
    while ((lm = locRx.exec(fullText)) !== null) {
      var mentioned = lm[1].trim().replace(/[,.\s]+$/, "");
      var matchesCity = false;
      for (var cp = 0; cp < cParts.length; cp++) {
        if (mentioned.indexOf(cParts[cp]) !== -1) { matchesCity = true; break; }
      }
      if (!matchesCity && personaCity.indexOf(mentioned) === -1 && mentioned.length > 3) {
        issues.push("USER.md mentions location '" + mentioned + "', persona city is '" + personaCity + "'");
      }
    }
  }

  var propagated = checkPropagation_(task, issues);

  if (issues.length > 0) {
    var sev = issues.some(function(i) { return i.toLowerCase().indexOf("name") !== -1; }) ? "high" : "medium";
    return { check: "user_md_propagation", result: sev === "high" ? "FAIL" : "WARNING",
             issues: issues, severity: sev,
             details: { propagated_in_trajectory: propagated } };
  }

  return { check: "user_md_propagation", result: "PASS", issues: [], severity: "low", details: {} };
}

function parseUserMd_(text) {
  var fields = {};
  var lines = text.split("\n");
  var keys = ["Name", "What to call them", "Timezone", "Notes"];
  for (var i = 0; i < lines.length; i++) {
    for (var k = 0; k < keys.length; k++) {
      var marker = "**" + keys[k] + ":**";
      if (lines[i].indexOf(marker) !== -1) {
        var val = lines[i].split(marker)[1].trim();
        fields[keys[k].toLowerCase().replace(/ /g, "_")] = val;
      }
    }
  }

  var inContext = false;
  var contextLines = [];
  for (var j = 0; j < lines.length; j++) {
    if (lines[j].indexOf("## Context") !== -1) { inContext = true; continue; }
    if (inContext) {
      if (lines[j].indexOf("##") === 0 || lines[j].indexOf("---") === 0) break;
      contextLines.push(lines[j]);
    }
  }
  fields["context"] = contextLines.join("\n").trim();
  return fields;
}

function checkPropagation_(task, issues) {
  var propagated = [];
  if (!issues.length) return propagated;

  var turns = task.turns || [];
  for (var i = 0; i < turns.length; i++) {
    var asst = (turns[i].assistant_text || "").toLowerCase();
    for (var j = 0; j < issues.length; j++) {
      if (issues[j].toLowerCase().indexOf("name") !== -1) {
        var nameMatch = issues[j].match(/'([^']+)'/);
        if (nameMatch) {
          var wrongName = nameMatch[1].toLowerCase();
          if (asst.indexOf(wrongName) !== -1) {
            propagated.push("Wrong name '" + wrongName + "' used in agent response");
          }
        }
      }
    }
  }
  return propagated;
}


/* ═══════════════════════════════════════════════════
   6. AGENTIC DEPTH — flags single-turn or shallow trajectories
   ═══════════════════════════════════════════════════ */

function runAgenticDepth_(task, persona) {
  var issues = [];
  var turnCount = task.turn_count || (task.turns || []).length;
  var toolCallCount = task.tool_call_count || 0;

  if (toolCallCount === 0) {
    var turns = task.turns || [];
    for (var i = 0; i < turns.length; i++) {
      toolCallCount += (turns[i].tool_calls || []).length;
    }
  }

  var toolTypes = {};
  var turns = task.turns || [];
  for (var t = 0; t < turns.length; t++) {
    var tcs = turns[t].tool_calls || [];
    for (var c = 0; c < tcs.length; c++) {
      toolTypes[tcs[c].name || "unknown"] = true;
    }
  }
  var uniqueTools = Object.keys(toolTypes).length;

  if (turnCount <= 1 && toolCallCount === 0) {
    issues.push("Single-turn trajectory with no tool calls — not suitable for training");
    return { check: "agentic_depth", result: "FAIL", issues: issues,
             severity: "high", details: { turns: turnCount, tool_calls: toolCallCount, unique_tools: uniqueTools } };
  }

  if (turnCount <= 1 && toolCallCount > 0) {
    issues.push("Single-turn trajectory — low conversational depth but has tool usage");
    return { check: "agentic_depth", result: "WARNING", issues: issues,
             severity: "medium", details: { turns: turnCount, tool_calls: toolCallCount, unique_tools: uniqueTools } };
  }

  if (toolCallCount === 0) {
    issues.push("Multi-turn trajectory with zero tool calls — purely conversational, not agentic");
    return { check: "agentic_depth", result: "FAIL", issues: issues,
             severity: "high", details: { turns: turnCount, tool_calls: toolCallCount, unique_tools: uniqueTools } };
  }

  if (turnCount >= 5 && toolCallCount >= 3 && uniqueTools >= 2) {
    return { check: "agentic_depth", result: "PASS", issues: [],
             severity: "low", details: { turns: turnCount, tool_calls: toolCallCount, unique_tools: uniqueTools } };
  }

  if (turnCount < 5) {
    issues.push("Short trajectory (" + turnCount + " turns) — may lack depth for training value");
  }
  if (uniqueTools < 2 && toolCallCount > 0) {
    issues.push("Only " + uniqueTools + " unique tool type(s) used — limited agentic diversity");
  }

  return { check: "agentic_depth", result: "WARNING", issues: issues,
           severity: "medium", details: { turns: turnCount, tool_calls: toolCallCount, unique_tools: uniqueTools } };
}


/* ═══════════════════════════════════════════════════
   7. JAILBREAK DETECTION — flags reading system prompts
   ═══════════════════════════════════════════════════ */

var SYSTEM_FILES_FORBIDDEN = ["AGENTS.md", "SOUL.md", "IDENTITY.md", "system_prompt.txt", ".cursorrules"];

var STARTUP_MARKERS = [
  "session startup", "startup sequence", "read the required files",
  "/new", "/reset", "new session", "greet the user"
];

function isStartupTurn_(userText) {
  var lower = userText.toLowerCase();
  for (var i = 0; i < STARTUP_MARKERS.length; i++) {
    if (lower.indexOf(STARTUP_MARKERS[i]) !== -1) return true;
  }
  return false;
}

function runJailbreakDetection_(task, persona) {
  var issues = [];
  var turns = task.turns || [];

  for (var i = 0; i < turns.length; i++) {
    var userText = turns[i].user_text || "";
    var isStartup = isStartupTurn_(userText);
    var userLower = userText.toLowerCase();

    if (!isStartup) {
      var jailbreakPatterns = [
        "show me your", "read your", "display your", "print your",
        "what does your", "contents of your", "reveal your",
        "cat your", "share your", "give me your"
      ];
      for (var sf = 0; sf < SYSTEM_FILES_FORBIDDEN.length; sf++) {
        var fileLower = SYSTEM_FILES_FORBIDDEN[sf].toLowerCase();
        if (userLower.indexOf(fileLower) !== -1) {
          var isJailbreakRequest = false;
          for (var jp = 0; jp < jailbreakPatterns.length; jp++) {
            if (userLower.indexOf(jailbreakPatterns[jp]) !== -1) {
              isJailbreakRequest = true;
              break;
            }
          }
          if (isJailbreakRequest) {
            issues.push("Turn " + (i + 1) + ": User requests access to system file '" + SYSTEM_FILES_FORBIDDEN[sf] + "'");
          }
        }
      }
    }
  }

  if (issues.length > 0) {
    return { check: "jailbreak_detection", result: "FAIL", issues: issues,
             severity: "high", details: { system_files_accessed: issues.length } };
  }

  return { check: "jailbreak_detection", result: "PASS", issues: [],
           severity: "low", details: {} };
}


/* ═══════════════════════════════════════════════════
   8. CRON DRY-RUN CHECK — every scheduled action needs an in-session test run
   ═══════════════════════════════════════════════════ */

var CRON_TOOL_NAMES_ = ["cron", "crontab", "at", "systemctl"];

var CRON_COMMAND_PATTERNS_ = [
  "crontab", "cron ", "cronjob", "systemd timer", "systemctl enable",
  "systemctl start", "setinterval", "node-cron", "node-schedule",
  "at job", "atq", "atrm"
];

var CRON_CONFIRM_PHRASES_ = [
  "cron job set", "cron job created", "cron entry added",
  "added to crontab", "crontab updated", "cron job is",
  "scheduled task created", "timer unit created",
  "systemd timer", "cron expression"
];

var DRYRUN_USER_PHRASES_ = [
  "run it now", "test it", "try it", "execute it", "check it works",
  "do a dry run", "dry-run", "dry run", "run the task now",
  "can you run it", "let me see it run", "trigger it now",
  "run it once", "test run", "verify it works", "let's test"
];

var DRYRUN_TOOL_KEYWORDS_ = ["run", "execute", "test", "trigger", "invoke", "start", "dry"];

function isCronToolCall_(tc) {
  var name = (tc.name || "").toLowerCase();
  for (var i = 0; i < CRON_TOOL_NAMES_.length; i++) {
    if (name.indexOf(CRON_TOOL_NAMES_[i]) !== -1) return true;
  }
  if (name === "exec" || name === "shell" || name === "bash" || name === "run_command") {
    var cmd = "";
    var args = tc.arguments || {};
    cmd = String(args.command || args.cmd || args.script || args.input || "").toLowerCase();
    for (var j = 0; j < CRON_COMMAND_PATTERNS_.length; j++) {
      if (cmd.indexOf(CRON_COMMAND_PATTERNS_[j]) !== -1) return true;
    }
  }
  return false;
}

function runCronDryRunCheck_(task, persona) {
  var turns = task.turns || [];
  var cronDetectedTurn = -1;

  for (var i = 0; i < turns.length; i++) {
    var toolCalls = turns[i].tool_calls || [];
    var asstText = (turns[i].assistant_text || "").toLowerCase();

    for (var tc = 0; tc < toolCalls.length; tc++) {
      if (isCronToolCall_(toolCalls[tc])) {
        cronDetectedTurn = i;
        break;
      }
    }

    if (cronDetectedTurn === -1) {
      for (var cp = 0; cp < CRON_CONFIRM_PHRASES_.length; cp++) {
        if (asstText.indexOf(CRON_CONFIRM_PHRASES_[cp]) !== -1) {
          cronDetectedTurn = i;
          break;
        }
      }
    }

    if (cronDetectedTurn !== -1) break;
  }

  if (cronDetectedTurn === -1) {
    return { check: "cron_dry_run", result: "PASS", issues: [],
             severity: "low", details: { cron_detected: false } };
  }

  for (var j = cronDetectedTurn; j < turns.length; j++) {
    var userText = (turns[j].user_text || "").toLowerCase();
    for (var dp = 0; dp < DRYRUN_USER_PHRASES_.length; dp++) {
      if (userText.indexOf(DRYRUN_USER_PHRASES_[dp]) !== -1) {
        return { check: "cron_dry_run", result: "PASS", issues: [],
                 severity: "low", details: { cron_detected: true, dry_run_found: true, dry_run_turn: j + 1 } };
      }
    }

    var tcs = turns[j].tool_calls || [];
    for (var t = 0; t < tcs.length; t++) {
      var toolStr = ((tcs[t].name || "") + " " + JSON.stringify(tcs[t].arguments || {})).toLowerCase();
      for (var dk = 0; dk < DRYRUN_TOOL_KEYWORDS_.length; dk++) {
        if (toolStr.indexOf(DRYRUN_TOOL_KEYWORDS_[dk]) !== -1 && j > cronDetectedTurn) {
          return { check: "cron_dry_run", result: "PASS", issues: [],
                   severity: "low", details: { cron_detected: true, dry_run_found: true, dry_run_turn: j + 1 } };
        }
      }
    }
  }

  return { check: "cron_dry_run", result: "FAIL",
           issues: ["Cron/scheduled task detected at turn " + (cronDetectedTurn + 1) + " but no dry-run execution found in subsequent turns. Guidelines require an in-session test run."],
           severity: "high", details: { cron_detected: true, dry_run_found: false, cron_turn: cronDetectedTurn + 1 } };
}


/* ═══════════════════════════════════════════════════
   9. FOURTH-WALL BREAKING — references to data collection context
   ═══════════════════════════════════════════════════ */

var FOURTH_WALL_PATTERNS_ = [
  "training data", "data collection", "annotation task", "annotation exercise",
  "data labeling", "data labelling", "human evaluation", "human annotator",
  "role play", "roleplay", "pretend to be", "you are an ai",
  "you're an ai", "as an ai model", "language model", "large language model",
  "for testing purposes", "this is a test scenario", "simulated conversation",
  "synthetic data", "data generation", "we are collecting",
  "annotation project", "labeling task", "labelling task",
  "you are a chatbot", "you're a chatbot"
];

function stripCodeBlocks_(text) {
  return text.replace(/```[\s\S]*?```/g, "").replace(/`[^`]+`/g, "");
}

function runFourthWallDetection_(task, persona) {
  var issues = [];
  var turns = task.turns || [];

  for (var i = 0; i < turns.length; i++) {
    var userText = stripCodeBlocks_(turns[i].user_text || "").toLowerCase();
    var asstText = stripCodeBlocks_(turns[i].assistant_text || "").toLowerCase();

    for (var p = 0; p < FOURTH_WALL_PATTERNS_.length; p++) {
      var pattern = FOURTH_WALL_PATTERNS_[p];
      if (userText.indexOf(pattern) !== -1) {
        issues.push("Turn " + (i + 1) + " [user]: Fourth-wall reference detected — '" + pattern + "'");
      }
      if (asstText.indexOf(pattern) !== -1) {
        issues.push("Turn " + (i + 1) + " [agent]: Fourth-wall reference detected — '" + pattern + "'");
      }
    }
  }

  if (issues.length > 0) {
    return { check: "fourth_wall", result: "FAIL", issues: issues.slice(0, 10),
             severity: "high", details: { total_violations: issues.length } };
  }

  return { check: "fourth_wall", result: "PASS", issues: [],
           severity: "low", details: {} };
}


/* ═══════════════════════════════════════════════════
   10. DEGENERATE LOOP DETECTION — same action repeated without progress
   ═══════════════════════════════════════════════════ */

function normalizeError_(result) {
  var s = String(result || "").toLowerCase().trim();
  s = s.replace(/\d+/g, "N");
  s = s.replace(/\s+/g, " ");
  return s.length > 200 ? s.substring(0, 200) : s;
}

function runDegenerateLoopDetection_(task, persona) {
  var allCalls = [];
  var turns = task.turns || [];
  for (var i = 0; i < turns.length; i++) {
    var tcs = turns[i].tool_calls || [];
    for (var j = 0; j < tcs.length; j++) {
      allCalls.push({
        name: tcs[j].name || "",
        args: JSON.stringify(tcs[j].arguments || {}),
        result: String(tcs[j].result || ""),
        is_error: tcs[j].is_error || false,
        turn: i + 1
      });
    }
  }

  if (allCalls.length < 3) {
    return { check: "degenerate_loop", result: "PASS", issues: [],
             severity: "low", details: { loops_found: 0, total_looped_calls: 0 } };
  }

  var loops = [];
  var idx = 0;

  while (idx < allCalls.length) {
    var current = allCalls[idx];
    var streak = 1;
    var isErrorLoop = current.is_error;
    var errorSig = isErrorLoop ? normalizeError_(current.result) : "";

    for (var k = idx + 1; k < allCalls.length; k++) {
      var next = allCalls[k];
      var sameAction = false;

      if (next.name === current.name && next.args === current.args) {
        sameAction = true;
      } else if (next.name === current.name && next.is_error && isErrorLoop) {
        var nextErr = normalizeError_(next.result);
        if (nextErr === errorSig) sameAction = true;
      }

      if (sameAction) {
        streak++;
      } else {
        break;
      }
    }

    if (streak >= 3) {
      loops.push({
        tool: current.name,
        count: streak,
        start_turn: current.turn,
        error_loop: isErrorLoop,
        error_pattern: isErrorLoop ? errorSig.substring(0, 100) : ""
      });
    }

    idx += Math.max(streak, 1);
  }

  var totalLooped = 0;
  for (var l = 0; l < loops.length; l++) {
    totalLooped += loops[l].count;
  }

  if (loops.length > 0) {
    var issues = loops.map(function(lp) {
      var desc = lp.tool + " called " + lp.count + "x consecutively (starting turn " + lp.start_turn + ")";
      if (lp.error_loop) desc += " — same error repeated";
      return desc;
    });
    return { check: "degenerate_loop", result: "FAIL", issues: issues,
             severity: "high", details: { loops_found: loops.length, total_looped_calls: totalLooped, loop_details: loops } };
  }

  return { check: "degenerate_loop", result: "PASS", issues: [],
           severity: "low", details: { loops_found: 0, total_looped_calls: 0 } };
}


/* ═══════════════════════════════════════════════════
   ORCHESTRATOR: run all checks
   ═══════════════════════════════════════════════════ */

function runAllChecks_(task, persona) {
  return [
    runPersonaMatch_(task, persona),
    runClaimSourcing_(task, persona),
    runToolEfficiency_(task, persona),
    runWorkspaceDiff_(task, persona),
    runUserMdPropagation_(task, persona),
    runAgenticDepth_(task, persona),
    runJailbreakDetection_(task, persona),
    runCronDryRunCheck_(task, persona),
    runFourthWallDetection_(task, persona),
    runDegenerateLoopDetection_(task, persona)
  ];
}
