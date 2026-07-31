(() => {
  const CUC = globalThis.ClaudeUsageCompanion;
  if (!CUC) return;
  if (globalThis.CompanionLifejacketSettings) return;

  const DEFAULTS = Object.freeze({
    lifejacketMode: false,
    showLifejacketMode: true,
    lifejacketPromptCompression: true,
    lifejacketReplyBrevity: true,
    lifejacketFileConversion: true,
    lifejacketKeepRatio: 0.65,
  });

  const originalMerge = typeof CUC.mergeSettings === 'function'
    ? CUC.mergeSettings.bind(CUC)
    : stored => ({ ...(CUC.DEFAULT_SETTINGS || {}), ...(stored || {}) });

  const own = (object, key) => Object.prototype.hasOwnProperty.call(object || {}, key);
  const boolFrom = (stored, key, fallback) => own(stored, key) ? Boolean(stored[key]) : fallback;

  function clampKeepRatio(value) {
    const number = Number(value);
    if (!Number.isFinite(number)) return DEFAULTS.lifejacketKeepRatio;
    return Math.min(0.85, Math.max(0.4, Math.round(number * 100) / 100));
  }

  function merge(stored) {
    const source = stored && typeof stored === 'object' ? stored : {};
    const base = originalMerge(source);
    const migratedMaster = own(source, 'lifejacketMode')
      ? Boolean(source.lifejacketMode)
      : own(source, 'cavemanMode')
        ? Boolean(source.cavemanMode)
        : DEFAULTS.lifejacketMode;
    const migratedVisibility = own(source, 'showLifejacketMode')
      ? Boolean(source.showLifejacketMode)
      : own(source, 'showCavemanMode')
        ? Boolean(source.showCavemanMode)
        : DEFAULTS.showLifejacketMode;

    return {
      ...base,
      lifejacketMode: migratedMaster,
      showLifejacketMode: migratedVisibility,
      lifejacketPromptCompression: boolFrom(
        source,
        'lifejacketPromptCompression',
        DEFAULTS.lifejacketPromptCompression,
      ),
      lifejacketReplyBrevity: boolFrom(
        source,
        'lifejacketReplyBrevity',
        DEFAULTS.lifejacketReplyBrevity,
      ),
      lifejacketFileConversion: boolFrom(
        source,
        'lifejacketFileConversion',
        DEFAULTS.lifejacketFileConversion,
      ),
      lifejacketKeepRatio: clampKeepRatio(source.lifejacketKeepRatio),
      // Keep the retired implementation inert even when legacy values remain
      // in storage. Lifejacket owns the visible UI and send interception.
      cavemanMode: false,
      showCavemanMode: false,
    };
  }

  Object.assign(CUC.DEFAULT_SETTINGS || {}, DEFAULTS, {
    cavemanMode: false,
    showCavemanMode: false,
  });
  CUC.mergeSettings = merge;

  globalThis.CompanionLifejacketSettings = Object.freeze({
    DEFAULTS,
    clampKeepRatio,
    merge,
  });
})();
