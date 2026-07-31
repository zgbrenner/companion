(() => {
  if (globalThis.CompanionLifejacketCore) return;

  const REPLY_BREVITY_SUFFIX = 'Reply briefly. Lead with the answer and keep every necessary fact, step, and caveat.';
  const MIN_RETENTION_RATIO = 0.4;

  const RANGE_RULES = [
    ['fenced-code', /```[\s\S]*?```/g],
    ['inline-code', /`[^`\n]+`/g],
    ['markdown-link', /\[[^\]\n]+\]\([^\s)]+(?:\s+"[^"]*")?\)/g],
    ['url', /\bhttps?:\/\/[^\s<>()]+/gi],
    ['email', /\b[\w.+-]+@[\w-]+(?:\.[\w-]+)+\b/g],
    ['double-quoted', /"(?:\\.|[^"\\\n])*"/g],
    ['single-quoted', /'(?:\\.|[^'\\\n]){2,}'/g],
    ['number-bearing', /\b[\p{L}_./:-]*\d[\p{L}\p{N}_./:+-]*\b/gu],
  ];

  function structuredLineReason(line) {
    const value = String(line || '').trim();
    if (!value) return null;
    if (/^(?:\{|\}|\[|\])[,;]?$/.test(value)) return 'structured-line';
    if (/^(?:\$|>|PS>)\s+\S/.test(value)) return 'shell-line';
    if (/^(?:curl|git|npm|pnpm|yarn|python|python3|node|deno|bun|docker|kubectl|gh)\s+/.test(value)) return 'shell-line';
    if (/^\|.*\|$/.test(value) || /^\s*\|?\s*:?-{3,}/.test(value)) return 'table-line';
    if (/^\s*[\w.-]+:\s+\S/.test(line) && !/[.!?]\s*$/.test(value)) return 'yaml-line';
    if (/^\s*[\[{].*[\]}],?\s*$/.test(line) || /"[^"\n]+"\s*:/.test(line)) return 'json-line';
    return null;
  }

  function collectProtectedRanges(text) {
    const ranges = [];
    const add = (start, end, reason) => {
      if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || end <= start) return;
      ranges.push({ start, end, reason });
    };

    for (const [reason, expression] of RANGE_RULES) {
      expression.lastIndex = 0;
      let match;
      while ((match = expression.exec(text))) {
        add(match.index, match.index + match[0].length, reason);
        if (match[0].length === 0) expression.lastIndex += 1;
      }
    }

    const lineExpression = /^.*$/gm;
    let lineMatch;
    while ((lineMatch = lineExpression.exec(text))) {
      const reason = structuredLineReason(lineMatch[0]);
      if (reason) add(lineMatch.index, lineMatch.index + lineMatch[0].length, reason);
      if (lineMatch[0].length === 0) lineExpression.lastIndex += 1;
    }

    ranges.sort((a, b) => a.start - b.start || b.end - a.end);
    const merged = [];
    for (const range of ranges) {
      const previous = merged[merged.length - 1];
      if (!previous || range.start > previous.end) {
        merged.push({ ...range, reasons: [range.reason] });
        continue;
      }
      previous.end = Math.max(previous.end, range.end);
      if (!previous.reasons.includes(range.reason)) previous.reasons.push(range.reason);
    }
    return merged;
  }

  function protectPrompt(value) {
    const original = String(value ?? '');
    const ranges = collectProtectedRanges(original);
    const segments = [];
    let cursor = 0;
    for (const range of ranges) {
      if (range.start > cursor) {
        segments.push({ type: 'text', text: original.slice(cursor, range.start) });
      }
      segments.push({
        type: 'protected',
        text: original.slice(range.start, range.end),
        reasons: [...range.reasons],
      });
      cursor = range.end;
    }
    if (cursor < original.length) segments.push({ type: 'text', text: original.slice(cursor) });
    if (segments.length === 0 && original) segments.push({ type: 'text', text: original });
    return {
      original,
      segments,
      protectedSpans: segments.filter(segment => segment.type === 'protected').map(segment => segment.text),
    };
  }

  function countNonWhitespace(value) {
    return String(value ?? '').replace(/\s/g, '').length;
  }

  function protectedSpanStatus(candidate, protectedSpans) {
    const spans = Array.isArray(protectedSpans) ? protectedSpans.filter(Boolean) : [];
    if (spans.some(span => !candidate.includes(span))) return 'missing';
    let cursor = 0;
    for (const span of spans) {
      const index = candidate.indexOf(span, cursor);
      if (index < 0) return 'reordered';
      cursor = index + span.length;
    }
    return 'ok';
  }

  function rejected(original, warning) {
    return {
      text: original,
      accepted: false,
      changed: false,
      savedPct: 0,
      warning,
    };
  }

  function finalizeCompression({
    original: originalValue,
    candidate: candidateValue,
    protectedSpans = [],
    minRetentionRatio = MIN_RETENTION_RATIO,
  } = {}) {
    const original = String(originalValue ?? '');
    const candidate = String(candidateValue ?? '').trim();
    if (!original.trim()) return rejected(original, 'The original prompt is empty.');
    if (!candidate) return rejected(original, 'The compressor returned an empty prompt.');

    const spanStatus = protectedSpanStatus(candidate, protectedSpans);
    if (spanStatus === 'missing') {
      return rejected(original, 'The compressed prompt dropped protected content, so the original was kept.');
    }
    if (spanStatus === 'reordered') {
      return rejected(original, 'The compressed prompt changed protected-content order, so the original was kept.');
    }

    const originalCount = countNonWhitespace(original);
    const candidateCount = countNonWhitespace(candidate);
    if (candidateCount > originalCount) {
      return rejected(original, 'Compression made the prompt larger, so the original was kept.');
    }
    const retention = originalCount > 0 ? candidateCount / originalCount : 1;
    if (retention < Math.max(0, Math.min(1, Number(minRetentionRatio) || MIN_RETENTION_RATIO))) {
      return rejected(original, 'The compressor removed too much content, so the original was kept.');
    }

    const originalTrimmed = original.trim();
    const changed = candidate !== originalTrimmed;
    const savedPct = originalCount > 0
      ? Math.max(0, Math.round((1 - candidateCount / originalCount) * 100))
      : 0;
    return {
      text: candidate,
      accepted: true,
      changed,
      savedPct,
      warning: changed ? null : 'The model found no safe, worthwhile reduction.',
    };
  }

  function appendReplySuffix(value, enabled) {
    const text = String(value ?? '').trim();
    if (!enabled || !text) return text;
    if (text.endsWith(REPLY_BREVITY_SUFFIX)) return text;
    return `${text}\n\n${REPLY_BREVITY_SUFFIX}`;
  }

  globalThis.CompanionLifejacketCore = Object.freeze({
    REPLY_BREVITY_SUFFIX,
    MIN_RETENTION_RATIO,
    appendReplySuffix,
    collectProtectedRanges,
    countNonWhitespace,
    finalizeCompression,
    protectPrompt,
    protectedSpanStatus,
    structuredLineReason,
  });
})();
