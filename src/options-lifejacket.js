(() => {
  const CUC = globalThis.ClaudeUsageCompanion;
  const LIFEJACKET = globalThis.CompanionLifejacketSettings;
  const SETTINGS_KEY = 'cuc:settings';
  const frame = document.getElementById('settings-frame');
  const errorPanel = document.getElementById('options-error');
  let controls = new Map();
  let currentSettings = LIFEJACKET.merge({});

  const CHILD_KEYS = [
    'lifejacketPromptCompression',
    'lifejacketReplyBrevity',
    'lifejacketFileConversion',
  ];

  async function readSettings() {
    const stored = await chrome.storage.local.get([SETTINGS_KEY]);
    currentSettings = LIFEJACKET.merge(stored[SETTINGS_KEY]);
    return currentSettings;
  }

  async function writeSetting(key, value) {
    const stored = await chrome.storage.local.get([SETTINGS_KEY]);
    currentSettings = LIFEJACKET.merge({ ...(stored[SETTINGS_KEY] || {}), [key]: value });
    await chrome.storage.local.set({ [SETTINGS_KEY]: currentSettings });
    render();
  }

  function rowMarkup(key, label, description) {
    return `
      <div class="row" data-lifejacket-row="${key}">
        <div class="row-text">
          <label class="row-label" id="lbl-${key}" for="${key}">${label}</label>
          <div class="row-desc" id="desc-${key}">${description}</div>
        </div>
        <button type="button" id="${key}" class="switch" role="switch" aria-checked="false"
          data-lifejacket-setting="${key}" aria-labelledby="lbl-${key}" aria-describedby="desc-${key}">
          <span class="switch-knob"></span>
        </button>
      </div>`;
  }

  function interceptControl(button, key) {
    controls.set(key, button);
    button.addEventListener('click', event => {
      event.preventDefault();
      event.stopImmediatePropagation();
      if (button.disabled) return;
      writeSetting(key, button.getAttribute('aria-checked') !== 'true').catch(showError);
    }, true);
  }

  function patchVisibilityRow(doc) {
    const currentButton = doc.querySelector('#showLifejacketMode, [data-setting="showLifejacketMode"]');
    if (currentButton) {
      const currentRow = currentButton.closest('.row');
      if (!currentRow) throw new Error('Lifejacket visibility setting row was not found.');
      interceptControl(currentButton, 'showLifejacketMode');
      return currentRow;
    }

    const legacyButton = doc.querySelector('#showCavemanMode, [data-setting="showCavemanMode"]');
    const row = legacyButton?.closest('.row');
    if (!legacyButton || !row) throw new Error('Lifejacket visibility setting anchor was not found.');

    const label = row.querySelector('.row-label');
    const description = row.querySelector('.row-desc');
    legacyButton.id = 'showLifejacketMode';
    legacyButton.removeAttribute('data-setting');
    legacyButton.setAttribute('aria-labelledby', 'lbl-lifejacket-visibility');
    legacyButton.setAttribute('aria-describedby', 'desc-lifejacket-visibility');
    if (label) {
      label.id = 'lbl-lifejacket-visibility';
      label.htmlFor = 'showLifejacketMode';
      label.textContent = 'Show Lifejacket Mode below supported composers';
    }
    if (description) {
      description.id = 'desc-lifejacket-visibility';
      description.textContent = 'Show or hide the in-page controls without changing your saved Lifejacket feature choices.';
    }
    interceptControl(legacyButton, 'showLifejacketMode');
    return row;
  }

  function addLifejacketGroup(doc, afterRow) {
    const existingButtons = [...doc.querySelectorAll(
      '[data-setting="lifejacketMode"], [data-setting="lifejacketPromptCompression"], '
      + '[data-setting="lifejacketReplyBrevity"], [data-setting="lifejacketFileConversion"]',
    )];
    if (existingButtons.length === 4) {
      for (const button of existingButtons) interceptControl(button, button.dataset.setting);
      return;
    }

    const group = doc.createElement('fieldset');
    group.className = 'metrics-group';
    group.id = 'lifejacket-settings-group';
    group.innerHTML = `
      <legend class="metrics-group-legend">Lifejacket Mode</legend>
      <p class="metrics-group-desc">Each feature stays local and can be controlled independently after Lifejacket is turned on.</p>
      ${rowMarkup('lifejacketMode', 'Turn on Lifejacket Mode', 'Enable the selected prompt, reply, and file-saving tools on Claude and ChatGPT.')}
      ${rowMarkup('lifejacketPromptCompression', 'Compress prompts', 'Run the bundled quantized MobileBERT compressor on every send attempt, then show a review before anything is sent.')}
      ${rowMarkup('lifejacketReplyBrevity', 'Shorter replies', 'Append a visible request for a concise answer at the end of the optimized prompt.')}
      ${rowMarkup('lifejacketFileConversion', 'Files to Markdown', 'Show the local file converter for PDF, Office, CSV, HTML, Markdown, and text files.')}`;
    afterRow.insertAdjacentElement('afterend', group);
    for (const button of group.querySelectorAll('[data-lifejacket-setting]')) {
      interceptControl(button, button.dataset.lifejacketSetting);
    }
  }

  function render() {
    for (const [key, button] of controls) {
      button.setAttribute('aria-checked', String(Boolean(currentSettings[key])));
      if (CHILD_KEYS.includes(key)) button.disabled = !currentSettings.lifejacketMode;
      const row = button.closest('.row');
      if (row && CHILD_KEYS.includes(key)) row.style.opacity = currentSettings.lifejacketMode ? '1' : '0.58';
    }
  }

  function wireRestoreDefaults(doc) {
    const button = doc.getElementById('reset-defaults');
    if (!button) return;
    button.addEventListener('click', event => {
      event.preventDefault();
      event.stopImmediatePropagation();
      const defaults = LIFEJACKET.merge({ ...(CUC.DEFAULT_SETTINGS || {}) });
      chrome.storage.local.set({ [SETTINGS_KEY]: defaults }).then(() => {
        frame.classList.remove('ready');
        frame.contentWindow.location.reload();
      }).catch(showError);
    }, true);
    button.setAttribute('aria-label', 'Restore defaults');
  }

  function showError(error) {
    console.error('Lifejacket settings error', error);
    errorPanel.hidden = false;
    frame.classList.add('ready');
  }

  async function patchFrame() {
    controls = new Map();
    const doc = frame.contentDocument;
    if (!doc?.body) throw new Error('Settings document is unavailable.');
    const visibilityRow = patchVisibilityRow(doc);
    addLifejacketGroup(doc, visibilityRow);
    wireRestoreDefaults(doc);
    await readSettings();
    render();
    errorPanel.hidden = true;
    frame.classList.add('ready');
  }

  frame.addEventListener('load', () => {
    patchFrame().catch(showError);
  });

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local' || !changes[SETTINGS_KEY]) return;
    currentSettings = LIFEJACKET.merge(changes[SETTINGS_KEY].newValue);
    render();
  });
})();
