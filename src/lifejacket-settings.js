(() => {
  const CUC = globalThis.ClaudeUsageCompanion;
  if (!CUC || globalThis.CompanionLifejacketSettings) return;

  const LIFEJACKET_DEFAULTS = Object.freeze({
    lifejacketMode: false,
    showLifejacketMode: true,
    lifejacketPromptCompression: true,
    lifejacketReplyBrevity: true,
    lifejacketFileConversion: true,
    lifejacketKeepRatio: 0.65,
  });
  const originalMerge = CUC.mergeSettings.bind(CUC);
  const previousDefaults = { ...(CUC.DEFAULT_SETTINGS || {}) };
  const extendedDefaults = Object.freeze({
    ...previousDefaults,
    ...LIFEJACKET_DEFAULTS,
  });

  function clampKeepRatio(value) {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) return LIFEJACKET_DEFAULTS.lifejacketKeepRatio;
    return Math.min(0.85, Math.max(0.4, parsed));
  }

  function merge(stored) {
    const source = stored && typeof stored === 'object' ? stored : {};
    const merged = {
      ...extendedDefaults,
      ...originalMerge(source),
      ...source,
    };

    // One-way migration from the pre-1.3 settings. Explicit Lifejacket values
    // always win, so upgrading never overwrites a choice made by the new UI.
    if (!Object.prototype.hasOwnProperty.call(source, 'lifejacketMode')
      && Object.prototype.hasOwnProperty.call(source, 'cavemanMode')) {
      merged.lifejacketMode = Boolean(source.cavemanMode);
    }
    if (!Object.prototype.hasOwnProperty.call(source, 'showLifejacketMode')
      && Object.prototype.hasOwnProperty.call(source, 'showCavemanMode')) {
      merged.showLifejacketMode = Boolean(source.showCavemanMode);
    }

    merged.lifejacketMode = Boolean(merged.lifejacketMode);
    merged.showLifejacketMode = merged.showLifejacketMode !== false;
    merged.lifejacketPromptCompression = merged.lifejacketPromptCompression !== false;
    merged.lifejacketReplyBrevity = merged.lifejacketReplyBrevity !== false;
    merged.lifejacketFileConversion = merged.lifejacketFileConversion !== false;
    merged.lifejacketKeepRatio = clampKeepRatio(merged.lifejacketKeepRatio);

    // The old provider-specific interceptors remain in their host adapters for
    // one compatibility release, but are forced inert. Lifejacket owns all new
    // prompt interception and file conversion behavior.
    merged.cavemanMode = false;
    merged.showCavemanMode = false;
    return merged;
  }

  CUC.DEFAULT_SETTINGS = extendedDefaults;
  CUC.mergeSettings = merge;

  // Provider adapters written before v1.3 capture this global at startup.
  // Supply an inert, local compatibility surface so the retired script no
  // longer needs to ship while those adapters are simplified incrementally.
  if (!globalThis.ClaudeUsageCompanionCaveman) {
    globalThis.ClaudeUsageCompanionCaveman = Object.freeze({
      CAVEMAN_INSTRUCTION: '',
      CAVEMAN_REMINDER: '',
      CAVEMAN_REMINDER_EVERY_N_RESPONSES: Number.MAX_SAFE_INTEGER,
      compressPrompt(value) {
        const text = String(value || '').trim();
        return {
          text,
          originalChars: text.length,
          compressedChars: text.length,
          savedPct: 0,
          changed: false,
        };
      },
    });
  }

  globalThis.CompanionLifejacketSettings = Object.freeze({
    defaults: LIFEJACKET_DEFAULTS,
    merge,
    clampKeepRatio,
  });
})();
