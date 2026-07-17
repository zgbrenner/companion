// Caveman Mode: cut token usage when quota is running low.
//
// Two halves:
//   1. CAVEMAN_INSTRUCTION — a compact, one-time per-conversation instruction
//      that makes Claude's RESPONSES maximally terse (delivery mechanism and
//      architecture decision documented below).
//   2. compressPrompt() — a conservative, deterministic, extractive-only
//      compressor for the user's OWN prompts, run 100% locally before send.
//      It only deletes/shortens known-filler constructions; it never
//      paraphrases, so it cannot drift meaning. This is also the benchmark
//      baseline against ML compressors (LLMLingua-2 class models) — see the
//      research notes in the repo PR/README before swapping it out.
//
// ---------------------------------------------------------------------------
// ARCHITECTURE DECISION — how the instruction reaches Claude (verified
// against platform.claude.com / docs.claude.com and support.claude.com
// help-center content, July 2026):
//
//   A. Direct injection (CHOSEN): the extension types the instruction into
//      the composer and sends it as a real turn (or prepends it to the first
//      message in a brand-new chat). Cost: ~100 tokens once per
//      conversation; afterwards it rides in conversation history like any
//      other message. Works mid-conversation, needs zero per-user setup, is
//      fully verifiable by the extension. Note on what's saved: for in-plan
//      usage, claude.ai consumes rolling 5-hour/weekly QUOTA rather than
//      dollars, so shorter outputs stretch quota directly — dollar savings
//      apply on top once usage credits kick in.
//
//   B. Skill-trigger hybrid (REJECTED, verified): claude.ai custom Skills
//      exist (Settings → Capabilities → code execution, Pro+ plans), but
//      triggering is MODEL-JUDGED from the skill's description — not a
//      deterministic keyword match — so a trigger phrase cannot guarantee
//      activation. When it does trigger, the full SKILL.md body is loaded
//      into context (and a re-trigger later can load it again), costing the
//      same or more than just sending the instruction. Plus a per-user
//      manual upload step the extension can neither perform nor verify.
//
//   C. Styles automation (REJECTED, verified): Styles are being DEPRECATED
//      and migrated into Skills (official help-center notice, June 2026;
//      preset styles retired). Building on a surface that is being removed,
//      with no supported programmatic switch, is a dead end.
//
//   Persistence caveat (official): claude.ai auto-compacts long
//   conversations (summarizes earlier context), and Anthropic's own docs
//   note that instruction recall decays for early-context instructions. So
//   a one-shot injection can fade in very long chats. Mitigation: the send
//   interceptor re-pins an ~10-token reminder into every Nth outgoing
//   message (visible in the preview — nothing is sent invisibly).
//
// ---------------------------------------------------------------------------
// INSTRUCTION WORDING — candidates drafted and compared (target 50–150
// tokens; every token is paid once, then ~0.1× in cached history):
//
//   Candidate 1 (~95 tokens): explicit list of banned behaviors + examples.
//     Rejected: examples added tokens without adding compliance.
//   Candidate 2 (~45 tokens): "reply in the fewest words that fully answer;
//     no preamble/filler/sign-offs." Rejected: lacked the persistence clause
//     and the substance-preservation guardrail, which matters — terse-mode
//     drift toward dropping caveats is the known failure mode.
//   Candidate 3 (~75 tokens): fewest-words core + explicit
//     persistence ("entire conversation"), explicit substance guardrail,
//     and explicit scope ("your responses, not mine"). Shipped in 0.9.x.
//   Candidate 4 (BELOW, ~105 tokens): candidate 3 plus the three verbosity
//     leaks it didn't plug — models under "no preamble" instructions still
//     (a) enumerate alternatives when one answer was asked for, (b)
//     re-explain things already established earlier in the chat, and (c)
//     decorate with emoji/headers. Each gets an explicit clause; measured
//     against candidate 3 the extra ~30 tokens pay for themselves within
//     one avoided alternatives-list. Chosen.
//
// The wording is deliberately grammatical-professional, NOT grunt-speak:
// the goal is filler-free business prose, not novelty.

(() => {
  const CAVEMAN_INSTRUCTION = [
    "Maximum-brevity mode is ON for this entire conversation — every turn, no exceptions, even as the chat gets long.",
    "Lead with the answer, in the fewest words that fully and accurately resolve my request. Cut all preamble, question-restatement, filler, hedging, praise, meta-commentary, and closing offers or sign-offs.",
    "Give the single best answer; mention alternatives only when I ask for options or the choice genuinely depends on something I haven't told you. Never re-explain what this conversation already covered.",
    "Plain, grammatical, professional prose. Prefer tight lists or tables over paragraphs when they carry the same information in less space. No emoji, headers, or decorative formatting unless I ask.",
    "Brevity never overrides correctness: keep every fact, number, step, and caveat that matters — cut words, not substance.",
    "This governs only your replies, never my messages."
  ].join(" ");

  // Re-pinned into every Nth outgoing message (long chats get compacted and
  // early instructions lose salience — see persistence caveat above).
  const CAVEMAN_REMINDER = "(Still in maximum-brevity mode: lead with the answer, fewest words that fully and accurately resolve this — no preamble, alternatives, filler, or sign-off.)";
  const CAVEMAN_REMINDER_EVERY_N_RESPONSES = 12;

  // ---- Prompt compression (rule-based, extractive-only) -------------------
  //
  // Design rules:
  //   • Deletion/canonical-shortening only — never reorder, never reword
  //     beyond fixed phrase→shorter-phrase maps.
  //   • Protected regions are never touched: code fences, inline code,
  //     quoted strings, URLs, emails.
  //   • Conservative by construction: when a rule risks changing meaning,
  //     it stays out of the list. Readability beats ratio.

  const PROTECT_PATTERNS = [
    /```[\s\S]*?```/g,          // fenced code blocks
    /`[^`\n]+`/g,               // inline code
    /"[^"\n]{2,}"/g,            // double-quoted strings
    /'[^'\n]{2,}'/g,            // single-quoted strings
    /\bhttps?:\/\/[^\s)]+/gi,   // URLs
    /\b[\w.+-]+@[\w-]+\.[\w.]+\b/g // emails
  ];

  // Ordered: multi-word openers first, then phrase shorteners, then single
  // fillers. All are case-insensitive and word-boundary anchored.
  const OPENER_RULES = [
    [/^(?:hi|hello|hey|good (?:morning|afternoon|evening))(?:\s+\w+)?[,!.\s]+/i, ""],
    [/^(?:hope you(?:'re| are) (?:doing )?well[,!.\s]+)/i, ""]
  ];

  const PHRASE_RULES = [
    // Politeness / request scaffolding → imperative
    [/\bi was wondering if (?:you could|you can|you would)\s*/gi, ""],
    [/\b(?:could|can|would|will) you (?:please\s+)?/gi, ""],
    [/\bwould you mind\s+/gi, ""],
    [/\bplease (?:go ahead and|feel free to)\s+/gi, ""],
    [/\bi(?:'d| would) (?:like|love) (?:you to|to see you)\s+/gi, ""],
    [/\bi (?:want|need) you to\s+/gi, ""],
    [/\bit would be (?:great|helpful|awesome) if you could\s+/gi, ""],
    [/\bif (?:possible|you can),?\s+/gi, ""],
    [/\bplease\b[,]?\s*/gi, ""],
    [/\bthanks? (?:in advance|so much|a lot)[,!.]?\s*/gi, ""],
    [/\bthank you[,!.]?\s*$/gi, ""],
    [/\bi(?:'d| would) (?:really |greatly )?appreciate (?:it|that|your help)[,!.]?\s*/gi, ""],

    // Verbose constructions → canonical short forms
    [/\bin order to\b/gi, "to"],
    [/\bas well as\b/gi, "and"],
    [/\bin addition(?: to that)?,?\s*/gi, "also "],
    [/\bdue to the fact that\b/gi, "because"],
    [/\bbecause of the fact that\b/gi, "because"],
    [/\bin the event that\b/gi, "if"],
    [/\bin the near future\b/gi, "soon"],
    [/\bat this point in time\b/gi, "now"],
    [/\bat the present time\b/gi, "now"],
    [/\bfor the purpose of\b/gi, "for"],
    [/\bwith (?:regard|regards|respect) to\b/gi, "about"],
    [/\bin regards to\b/gi, "about"],
    [/\ba large number of\b/gi, "many"],
    [/\bthe majority of\b/gi, "most"],
    [/\bmake a decision\b/gi, "decide"],
    [/\btake into (?:consideration|account)\b/gi, "consider"],
    [/\bthe fact that\b/gi, "that"],
    [/\bon a daily basis\b/gi, "daily"],
    [/\bon a regular basis\b/gi, "regularly"],
    [/\bin the process of\b/gi, ""],

    // Hedges and fillers — pure deletions
    [/\b(?:just|really|very|quite|basically|actually|literally|honestly|obviously|simply|essentially|definitely)\s+/gi, ""],
    [/\b(?:kind of|sort of|pretty much|more or less)\s+/gi, ""],
    [/\b(?:as you (?:may )?know|to be honest|needless to say|it goes without saying that)[,]?\s*/gi, ""],
    [/\b(?:i think that|i believe that|i feel like|it seems (?:to me )?(?:like|that))\s+/gi, ""],
    [/\b(?:it(?:'s| is) worth noting that|note that|keep in mind that)\s+/gi, ""]
  ];

  // Placeholders are NUL-fenced: NUL can't be typed into a prompt, is a
  // non-word character (so the word-boundary-anchored rules still behave at
  // region edges), and none of tidy()'s whitespace/punctuation rules can
  // touch it. Written as escaped \u0000 (not raw bytes) so this file stays
  // plain text for git/grep/reviewers.
  function protectRegions(text) {
    const slots = [];
    let output = text;
    for (const pattern of PROTECT_PATTERNS) {
      output = output.replace(pattern, match => {
        const key = `\u0000CUC${slots.length}\u0000`;
        slots.push(match);
        return key;
      });
    }
    return { output, slots };
  }

  function restoreRegions(text, slots) {
    return text.replace(/\u0000CUC(\d+)\u0000/g, (_, index) => slots[Number(index)] ?? "");
  }

  function tidy(text) {
    return text
      .replace(/[ \t]{2,}/g, " ")
      .replace(/ ([,.;:!?])/g, "$1")
      .replace(/\( /g, "(")
      .replace(/ \)/g, ")")
      .replace(/,{2,}/g, ",")
      .replace(/(^|[.!?]\s+),\s*/g, "$1")
      // Two rules colliding can double a connective ("Also, also consider…").
      .replace(/\b(also|and|but|so|that)[,]?\s+\1\b/gi, "$1")
      .replace(/\n{3,}/g, "\n\n")
      .trim();
  }

  // Words that legitimately start a question. A sentence that ends in "?"
  // but starts with none of these was almost certainly a stripped politeness
  // wrapper ("Could you summarize X?" → "Summarize X?") — flip it to ".".
  const INTERROGATIVE_STARTERS = /^(?:who|whom|whose|what|which|when|where|why|how|is|are|was|were|am|do|does|did|can|could|will|would|should|shall|may|might|must|have|has|had|isn't|aren't|don't|doesn't|didn't|won't|wouldn't|shouldn't|couldn't)\b/i;

  function fixOrphanedQuestionMarks(text) {
    return text.replace(/(^|[.!?]\s+)([^.!?\n]+)\?/g, (match, boundary, sentence) => {
      // A sentence starting with a protected-region placeholder is opaque
      // here — the hidden text may itself be interrogative, so leave it be.
      if (sentence.trimStart().startsWith("\u0000")) return match;
      if (INTERROGATIVE_STARTERS.test(sentence.trim())) return match;
      return `${boundary}${sentence}.`;
    });
  }

  // Rules that strip sentence openers can leave "review the contract" where
  // "Review the contract" should be — re-capitalize sentence starts, but only
  // the very first alphabetical character of each sentence (never touching
  // protected slots, which are restored afterwards).
  function recapitalize(text) {
    return text.replace(/(^|[.!?]\s+)([a-z])/g, (m, boundary, letter) => `${boundary}${letter.toUpperCase()}`);
  }

  function compressPrompt(text) {
    const original = String(text || "");
    if (!original.trim()) {
      return { text: original, originalChars: 0, compressedChars: 0, savedPct: 0, changed: false };
    }

    const { output: shielded, slots } = protectRegions(original);
    let working = shielded;
    for (const [pattern, replacement] of OPENER_RULES) {
      working = working.replace(pattern, replacement);
    }
    for (const [pattern, replacement] of PHRASE_RULES) {
      working = working.replace(pattern, replacement);
    }
    working = fixOrphanedQuestionMarks(recapitalize(tidy(working)));
    let result = restoreRegions(working, slots).trim();

    // Safety valve: if the rules somehow gutted the prompt (>60% removed),
    // something matched too aggressively for this text — fall back to the
    // original rather than send a mangled prompt.
    if (result.length < original.trim().length * 0.4) {
      result = original.trim();
    }

    const originalChars = original.trim().length;
    const compressedChars = result.length;
    const savedPct = originalChars > 0
      ? Math.max(0, Math.round((1 - compressedChars / originalChars) * 100))
      : 0;
    return {
      text: result,
      originalChars,
      compressedChars,
      savedPct,
      changed: result !== original.trim()
    };
  }

  globalThis.ClaudeUsageCompanionCaveman = {
    CAVEMAN_INSTRUCTION,
    CAVEMAN_REMINDER,
    CAVEMAN_REMINDER_EVERY_N_RESPONSES,
    compressPrompt
  };
})();
