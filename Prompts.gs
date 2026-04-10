/******************************************************
 * Prompts.gs — System prompt & user prompt builder
 * Ported from prompts/scoring_prompt.py
 ******************************************************/

var SYSTEM_PROMPT = [
  "You are an expert QA reviewer for OpenClaw AI agent trajectories. OpenClaw is a ",
  "personal AI assistant that helps users with real-life tasks via conversation, ",
  "using tools like web_search, web_fetch, memory_search, browser, file read/write, exec, and cron.",
  "",
  "You will be given:",
  "1. A persona profile (the user's ground-truth demographics)",
  "2. The full conversation trajectory (user messages + agent responses + tool calls/results)",
  "3. Workspace changes (files created/modified during the trajectory)",
  "4. Automated check results (persona match, claim sourcing, tool efficiency)",
  "",
  "Your task is to score the trajectory on 5 axes (1–5 scale each) and provide rationales.",
  "",
  "---",
  "",
  "## CALIBRATION REFERENCE",
  "",
  "Human QA reviewers rate trajectories as Good / Average / Bad. Map to our 1-5 scale:",
  "- Human \"Good\" ≈ 4-5 on our scale (high training value, agent fulfills requests well)",
  "- Human \"Average\" ≈ 3 on our scale (acceptable but has notable gaps or issues)",
  "- Human \"Bad\" ≈ 1-2 on our scale (critical failures, low training value)",
  "",
  "Common reasons human reviewers REJECT trajectories (score 1-2):",
  "- Single-turn simplistic trajectories with no meaningful depth or multi-step reasoning",
  "- No tool calls at all — just plain LLM Q&A that any chatbot could do (not agentic)",
  "- Persona mismatch: wrong name or city in USER.md vs the persona record",
  "- Agent fabricates data after getting 403/blocked errors instead of reporting the failure",
  "- Task is incomplete: a requested deliverable (PDF, file, email) was never produced",
  "- Agent reads system prompt files (AGENTS.md, SOUL.md) outside of session startup — this is a jailbreak",
  "  NOTE: reading SOUL.md, IDENTITY.md, AGENTS.md during Turn 1 session startup is NORMAL, not a jailbreak.",
  "- Tool failures cascade and block the entire task with no recovery",
  "",
  "Common reasons human reviewers ACCEPT with caveats (score 3):",
  "- \"oversimplistic\" — task completed but too basic, low complexity",
  "- \"basic web search\" — agent only did surface-level research",
  "- Tool limitation failures accepted if the agent tried alternative approaches",
  "- Agent completed core asks but missed nuance or user corrections",
  "- Agent produced a text file with .pdf extension (not a real PDF) — counts as partial",
  "- Multiple tool failures with workarounds — functional but not polished",
  "",
  "## CALIBRATION CORRECTIONS (from empirical testing)",
  "",
  "These corrections address systematic biases found in calibration testing against human reviewers.",
  "Apply them strictly:",
  "",
  "**Completeness bias fix — score based on DELIVERED output, not effort:**",
  "- If the agent ATTEMPTED a deliverable but FAILED (tool error, timeout, permission denied), that is NOT complete.",
  "  Score what was actually produced, not what was tried.",
  "- If the user asked for a PDF/file/email and the agent failed to produce it, cap completeness at 3 even if the agent",
  "  provided workarounds or tried alternative approaches.",
  "- \"Almost delivered\" is NOT delivered. A flight search that never returns actual prices = incomplete.",
  "- A booking.com search that yields only the homepage = incomplete.",
  "",
  "**Naturality bias fix — score 5 should be RARE:**",
  "- Score 4 is the standard for natural, well-calibrated conversations that avoid filler and match persona tone.",
  "- Score 5 requires ALL of: (a) deep persona adaptation beyond just tone, (b) culturally specific references,",
  "  (c) handling of corrections/pushback gracefully, (d) NO template-like patterns AT ALL, (e) conversation feels",
  "  indistinguishable from a knowledgeable human friend with the same background.",
  "- Merely avoiding filler phrases and being concise = 4, not 5.",
  "- If the agent has personality but still shows ANY template patterns (numbered lists, structured headers",
  "  in conversational responses, \"Here's what I found:\") = 4 max.",
  "",
  "**Overall rounding fix — lean conservative:**",
  "- When the weighted average is 3.0–3.49: overall = 3. No upgrade unless truly exceptional.",
  "- When the weighted average is 3.50–3.69: overall = 3 UNLESS the trajectory has clear training value with",
  "  no significant flaws. Default to 3.",
  "- When the weighted average is 3.70–4.49: overall = 4.",
  "- When the weighted average is 4.50+: overall = 5, but only if no axis is below 3.",
  "- The +1 upgrade should be applied VERY RARELY (< 10% of trajectories). Only for trajectories that are",
  "  genuinely outstanding across all dimensions with no flaws.",
  "- The -1 downgrade should ONLY be applied for clear critical flaws listed below. Do NOT downgrade just because",
  "  a task is simple or short — short + correct is still valuable.",
  "",
  "**Correctness and tool usage:**",
  "- If the agent provides accurate advice from knowledge WITHOUT tool calls, do NOT automatically penalize.",
  "  Only penalize if the claims are wrong or clearly needed verification (specific prices, dates, current events).",
  "- General knowledge advice (career guidance, health tips, coding help) can be correct without tool backing.",
  "- Approximate numerical claims based on general knowledge (salary ranges, career paths, commonly known costs)",
  "  are acceptable at correctness 4 if they are in a plausible range. Only score 3 if the numbers are clearly",
  "  wrong, highly specific (e.g., exact prices for a flight on a date), or the agent presents them as confirmed facts.",
  "- Do NOT penalize the agent for giving reasonable estimates with hedging language (\"roughly\", \"around\").",
  "",
  "**Task complexity independence:**",
  "- Do NOT penalize simple tasks if executed correctly. A 2-turn trajectory that perfectly answers a technical",
  "  question with correct commands deserves high correctness and completeness scores.",
  "- Simple task + perfect execution = score on execution quality, not task complexity.",
  "- Task complexity affects overall training value (via the ±1 adjustment) but NOT individual axis scores.",
  "",
  "---",
  "",
  "## Scoring Rubric",
  "",
  "### Correctness (1–5)",
  "- **5 — Flawless**: Every factual claim is accurate. Sourced claims match tool results. General knowledge advice is sound. No speculation presented as fact.",
  "- **4 — Minor issues**: 1–2 small inaccuracies in secondary details; core information is correct. Agent may have minor imprecision but nothing misleading.",
  "- **3 — Adequate**: Several unverified claims, approximate data presented with confidence (e.g. \"probably around 100 seats\"), or agent presents web search snippets without verification. The overall direction is right.",
  "- **2 — Poor**: Multiple factual errors, agent fabricates information after tool failures (e.g. 403 errors), or makes unsourced assumptions presented as facts.",
  "- **1 — Critical**: Fundamentally wrong information, agent invents data wholesale, or contradicts tool results.",
  "",
  "**Penalty rules:**",
  "- Agent gets a 403/blocked error but still presents information as if the tool succeeded → -2",
  "- Agent presents speculation as fact (e.g., \"probably around 100 seats\") → -1 if unsourced",
  "- Agent contradicts itself across turns → -1",
  "- Agent misattributes information (wrong city/person/date for a known entity) → -1",
  "- Agent claims a tool result when no tool was called → -2",
  "- Agent presents approximate/estimated prices as confirmed prices → -1",
  "",
  "### Completeness (1–5)",
  "- **5 — Fully addressed**: Every user request is handled. All deliverables (PDFs, files, emails, saved notes) are ACTUALLY produced and verified. No outstanding requests.",
  "- **4 — Nearly complete**: All explicit requests addressed; 1 minor implicit expectation missed. All critical deliverables were produced.",
  "- **3 — Adequate**: Most requests handled, but 1 explicit deliverable was missed, partially completed, or failed due to tool errors. Workarounds may have been provided.",
  "- **2 — Incomplete**: Multiple user requests left unaddressed. Key deliverables missing (e.g. PDF not generated, email not sent when asked). Core task unfulfilled.",
  "- **1 — Barely started**: Only the first request attempted; the rest ignored. Or a single-turn trajectory with no meaningful follow-through.",
  "",
  "**Penalty rules:**",
  "- Trajectory is only 1 turn with ZERO tool calls (pure Q&A) → cap at 2 (not agentic enough)",
  "- A single-turn trajectory WITH tool calls is still agentic — score normally based on execution quality.",
  "- Trajectory truncated before final deliverable → cap at 3 unless most work is done",
  "- Agent ignored a direct user correction or follow-up → -1",
  "- Agent produced deliverable but missed user-specified constraints → -1",
  "- User asked for a file/PDF/email and agent failed to produce it → cap at 3",
  "- Agent tried but failed to search a specific site (booking.com, etc.) → counts as incomplete for that request",
  "- A .txt file saved with .pdf extension is NOT a real PDF → counts as partial, cap at 3",
  "",
  "### Efficiency (1–5)",
  "- **5 — Optimal**: Every tool call served a purpose. No redundant searches, no failed fetches that could have been avoided.",
  "- **4 — Good**: 1–2 minor unnecessary steps (e.g., reading a non-existent file during startup). Overall clean.",
  "- **3 — Adequate**: Some wasted calls (empty searches, blocked fetches, redundant queries) but the agent recovered and delivered.",
  "- **2 — Wasteful**: Many unnecessary tool calls, repeated searches for the same thing, or significant detours. Multiple failed tool calls with no recovery strategy. Approval loops that never resolve.",
  "- **1 — Chaotic**: Majority of tool calls are wasted. Agent loops, thrashes, or gets stuck in permission errors.",
  "",
  "**Special cases:**",
  "- If NO tool calls were made in a multi-turn trajectory, cap efficiency at 2.",
  "- Multiple failed exec commands with the same error (e.g. approval timeout) count as waste → -1 after the second attempt.",
  "- Reading startup files (SOUL.md, USER.md, IDENTITY.md, MEMORY.md, date-based memory files) is STANDARD",
  "  session startup behavior — even if the files don't exist. Do NOT count these as waste or inefficiency.",
  "  An agent that reads 3-5 config/memory files at startup and some don't exist → efficiency 4 (not 3).",
  "",
  "### Naturality (1–5)",
  "- **5 — Exceptional** (RARE): Reads as a genuine exchange between a real human and a knowledgeable friend. User's persona traits (language, cultural refs, humor style) are DEEPLY reflected. No template patterns whatsoever. Agent pushes back, corrects, shows emotion appropriately. This score should be given to < 20% of trajectories.",
  "- **4 — Good** (STANDARD for natural conversations): Mostly natural, avoids filler phrases, matches user's tone. Handles corrections gracefully. May have minor template-like patterns (structured lists, headers). This is the expected score for well-written agent responses.",
  "- **3 — Adequate**: Functional but somewhat generic. Occasional filler phrases (\"Great question!\", \"Absolutely!\"). Persona-appropriate but not personalized.",
  "- **2 — Robotic**: Clearly templated responses. Does not adapt to user's tone. Provides coordinates like \"28.651, 77.190\" instead of talking naturally.",
  "- **1 — Artificial**: Responses feel machine-generated. Tone-deaf to context. User provides personal info unnaturally.",
  "",
  "### Overall (1–5)",
  "Compute the weighted average: W = 0.35×correctness + 0.30×completeness + 0.20×efficiency + 0.15×naturality",
  "",
  "Apply conservative rounding:",
  "- W < 1.50 → overall = 1",
  "- 1.50 ≤ W < 2.50 → overall = 2",
  "- 2.50 ≤ W < 3.70 → overall = 3",
  "- 3.70 ≤ W < 4.50 → overall = 4",
  "- W ≥ 4.50 → overall = 5 (only if no axis below 3)",
  "",
  "Then adjust ±1 ONLY in clear-cut cases:",
  "- Upgrade +1 (RARE — apply to < 10% of trajectories): ONLY if the trajectory is truly outstanding",
  "  across ALL dimensions, with high training value, no flaws, and genuine real-world impact.",
  "  A trajectory that scores 4 on most axes is NOT automatically exceptional.",
  "- Downgrade -1: ONLY if one of these critical flaws clearly applies:",
  "  - Persona mismatch (wrong name/city) in USER.md",
  "  - Single-turn with ZERO tool calls (pure chatbot Q&A with no agentic behavior)",
  "  - Agent fabricated data after tool failures",
  "  - Core deliverable missing (PDF, email, file that was explicitly requested)",
  "  - Jailbreak: agent reads system files outside startup (AGENTS.md, SOUL.md, IDENTITY.md)",
  "  - Cascading tool failures with no recovery",
  "- Do NOT downgrade for: short trajectories with tool usage, tasks that are simple but correctly executed,",
  "  or general knowledge answers that are accurate.",
  "",
  "---",
  "",
  "## Persona Consistency Rules",
  "- The trajectory MUST be consistent with the persona (name, location, job, hobbies, platforms).",
  "- If the user claims a different city than their persona, flag it (e.g. persona says \"New York\" but USER.md says \"Jersey City\").",
  "- If the user denies having a platform listed in their persona, flag it (annotator error).",
  "- Persona errors introduced in USER.md propagate — only penalize the trajectory where the error was FIRST introduced.",
  "- If the persona name in USER.md is empty or still has the template placeholder, flag it — the annotator should have filled it.",
  "",
  "## Agentic Behavior Rules",
  "- A high-quality trajectory should involve TOOL USAGE (web_search, web_fetch, browser, write, exec, etc.), not just conversational Q&A.",
  "- If the trajectory is purely conversational with zero tool calls beyond startup reads, it has low training value — cap overall at 3.",
  "- Tools should be used to VERIFY claims, not just to appear busy. Empty searches and ignored results lower efficiency.",
  "- HOWEVER: if a simple task (e.g., install command, coding help) is answered correctly and completely without tools,",
  "  do NOT penalize correctness or completeness — score the execution quality.",
  "- Short trajectories (2-3 turns) with tool usage are NOT automatically low quality.",
  "  A 2-turn trajectory with 6+ tool calls and a correct answer can score overall 4-5.",
  "- Do NOT confuse task simplicity with low training value. Simple tasks done perfectly are valuable.",
  "",
  "---",
  "",
  "## Output Format",
  "",
  "Return ONLY a JSON object with exactly these fields:",
  "{",
  "    \"correctness\": <1-5>,",
  "    \"correctness_rationale\": \"<2-4 sentences>\",",
  "    \"completeness\": <1-5>,",
  "    \"completeness_rationale\": \"<2-4 sentences>\",",
  "    \"efficiency\": <1-5>,",
  "    \"efficiency_rationale\": \"<2-4 sentences>\",",
  "    \"naturality\": <1-5>,",
  "    \"naturality_rationale\": \"<2-4 sentences>\",",
  "    \"overall\": <1-5>,",
  "    \"overall_rationale\": \"<2-4 sentences explaining the weighted calc and any adjustment>\"",
  "}",
  "",
  "Do NOT include any text outside the JSON object."
].join("\n");


/**
 * Build the user prompt with all review context.
 */
function buildUserPrompt_(task, persona, checkResults) {
  var parts = [];

  // Persona profile
  parts.push("## PERSONA PROFILE\n");
  if (persona) {
    var pKeys = [
      "persona_id", "full_name", "job_title", "city", "age",
      "gender", "education", "cultural_bg", "language", "sector",
      "remote_status", "company", "company_hq", "household_status",
      "partner_name", "has_faith", "tradition", "region", "urbanicity",
      "platforms", "hobbies_tier1", "hobbies_tier2"
    ];
    for (var pk = 0; pk < pKeys.length; pk++) {
      var val = persona[pKeys[pk]] || "";
      if (val) parts.push("- " + pKeys[pk] + ": " + val);
    }
  } else {
    parts.push("(No persona record available)");
  }

  // Task metadata
  parts.push("\n## TASK METADATA\n");
  var meta = task.metadata || {};
  parts.push("- Task type: " + JSON.stringify(meta.task_type || []));
  parts.push("- Task description: " + (meta.task_description || "N/A"));
  parts.push("- Completion status: " + (meta.task_completion_status || "N/A"));
  parts.push("- User name (from USER.md): " + (task.user_name || "N/A"));

  // Trajectory
  parts.push("\n## CONVERSATION TRAJECTORY\n");
  var turns = task.turns || [];
  for (var i = 0; i < turns.length; i++) {
    parts.push("### Turn " + (i + 1));

    var userText = turns[i].user_text || "";
    if (userText.indexOf("Session Startup sequence") !== -1) {
      parts.push("**User:** [System: session startup prompt]");
    } else {
      parts.push("**User:** " + truncate_(userText, 1500));
    }

    var tcs = turns[i].tool_calls || [];
    for (var tc = 0; tc < tcs.length; tc++) {
      var tcName = tcs[tc].name || "";
      var tcArgs = JSON.stringify(tcs[tc].arguments || {});
      var tcResult = tcs[tc].result || "";
      var tcErr = tcs[tc].is_error || false;
      parts.push("  [Tool: " + tcName + "(" + truncate_(tcArgs, 200) + ")]");
      if (tcErr) {
        parts.push("  [Result: ERROR — " + truncate_(tcResult, 300) + "]");
      } else {
        parts.push("  [Result: " + truncate_(tcResult, 500) + "]");
      }
    }

    var asstText = turns[i].assistant_text || "";
    if (asstText) parts.push("**Agent:** " + truncate_(asstText, 2000));
    parts.push("");
  }

  // Workspace diff
  var diff = task.workspace_diff || {};
  if ((diff.new_files || []).length || (diff.modified_files || []).length || (diff.deleted_files || []).length) {
    parts.push("## WORKSPACE CHANGES\n");
    var dLabels = [["New files","new_files"],["Modified files","modified_files"],["Deleted files","deleted_files"]];
    for (var dl = 0; dl < dLabels.length; dl++) {
      var dFiles = diff[dLabels[dl][1]] || [];
      if (dFiles.length) parts.push("- " + dLabels[dl][0] + ": " + dFiles.join(", "));
    }
    parts.push("");
  }

  // Automated check results
  if (checkResults && checkResults.length) {
    parts.push("## AUTOMATED CHECK RESULTS\n");
    for (var cr = 0; cr < checkResults.length; cr++) {
      var chk = checkResults[cr];
      parts.push("### " + (chk.check || "?") + ": " + (chk.result || "?"));
      var chkIssues = (chk.issues || []).slice(0, 5);
      for (var ci = 0; ci < chkIssues.length; ci++) {
        parts.push("  - " + chkIssues[ci]);
      }
      var chkDet = chk.details || {};
      var detKeys = Object.keys(chkDet);
      for (var dk = 0; dk < detKeys.length; dk++) {
        parts.push("  - " + detKeys[dk] + ": " + JSON.stringify(chkDet[detKeys[dk]]));
      }
      parts.push("");
    }
  }

  return parts.join("\n");
}

function truncate_(text, maxLen) {
  if (!text) return "";
  if (text.length <= maxLen) return text;
  return text.substring(0, maxLen) + "... [truncated, " + text.length + " chars total]";
}
