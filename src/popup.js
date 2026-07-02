// ===== PINTWIST FREE POPUP - LOCAL-ONLY CONTROLS =====

const appScreen = document.getElementById('app-screen');
const btnOff = document.getElementById('btn-off');
const btnOn = document.getElementById('btn-on');
const statusElement = document.getElementById('status');
const overlaysSection = document.getElementById('overlays-section');
const overlaysOff = document.getElementById('overlays-off');
const overlaysOn = document.getElementById('overlays-on');
const colorPicker = document.getElementById('color-picker');
const colorPresets = document.querySelectorAll('.color-preset');
const wordmarkFill = document.getElementById('popup-wordmark-fill');

try {
  const versionEl = document.getElementById('pintwist-version');
  if (versionEl) versionEl.textContent = chrome.runtime.getManifest().version;
} catch {
  /* non-fatal: version display is informational only */
}

render();

function render() {
  if (appScreen) appScreen.style.display = 'block';
  loadPreferences();
}

function loadPreferences() {
  // The popup only controls enable/overlays/theme-color. Dark/light mode is a
  // catalog-page feature (see catalog.js); the popup does not expose it.
  chrome.storage.sync.get(
    ['pintwist_enabled', 'pintwist_show_overlays', 'pintwist_theme_color'],
    (result) => {
      const isEnabled = result.pintwist_enabled !== false;
      const showOverlays = result.pintwist_show_overlays !== false;
      const themeColor = result.pintwist_theme_color || '#F48FB1';
      updateUI(isEnabled);
      updateOverlaysUI(showOverlays);
      applyThemeColor(themeColor);
      colorPicker.value = themeColor;
      updatePresetSelection(themeColor);
    }
  );
}

btnOff.addEventListener('click', () => {
  chrome.storage.sync.set({ pintwist_enabled: false }, () => {
    updateUI(false);
    notifyContentScript('disableBar');
  });
});

btnOn.addEventListener('click', () => {
  chrome.storage.sync.set({ pintwist_enabled: true }, () => {
    updateUI(true);
    notifyContentScript('enableBar');
  });
});

overlaysOff.addEventListener('click', () => {
  chrome.storage.sync.set({ pintwist_show_overlays: false }, () => {
    updateOverlaysUI(false);
    notifyContentScript('hideOverlays');
  });
});

overlaysOn.addEventListener('click', () => {
  chrome.storage.sync.set({ pintwist_show_overlays: true }, () => {
    updateOverlaysUI(true);
    notifyContentScript('showOverlays');
  });
});

colorPicker.addEventListener('input', (e) => {
  applyThemeColor(e.target.value);
  updatePresetSelection(e.target.value);
  notifyContentScript('updateThemeColor', e.target.value);
});

colorPicker.addEventListener('change', (e) => {
  chrome.storage.sync.set({ pintwist_theme_color: e.target.value });
});

colorPresets.forEach((preset) => {
  preset.addEventListener('click', () => {
    const color = preset.dataset.color;
    if (!color) return;
    colorPicker.value = color;
    applyThemeColor(color);
    updatePresetSelection(color);
    chrome.storage.sync.set({ pintwist_theme_color: color });
    notifyContentScript('updateThemeColor', color);
  });
});

function updateUI(isEnabled) {
  const themeColor =
    getComputedStyle(document.documentElement).getPropertyValue('--theme-color').trim() ||
    colorPicker.value;
  if (isEnabled) {
    btnOn.classList.add('active');
    btnOff.classList.remove('active');
    btnOn.style.background = themeColor;
    btnOn.style.borderColor = themeColor;
    btnOff.style.background = '';
    btnOff.style.borderColor = '';
    statusElement.classList.add('on');
    statusElement.classList.remove('off');
    statusElement.textContent = 'Bar will show on Pinterest pages';
    overlaysSection.classList.remove('visible');
  } else {
    btnOff.classList.add('active');
    btnOn.classList.remove('active');
    btnOff.style.background = themeColor;
    btnOff.style.borderColor = themeColor;
    btnOn.style.background = '';
    btnOn.style.borderColor = '';
    statusElement.classList.remove('on');
    statusElement.classList.add('off');
    statusElement.textContent = 'Bar is hidden';
    overlaysSection.classList.add('visible');
  }
}

function updateOverlaysUI(showOverlays) {
  const themeColor =
    getComputedStyle(document.documentElement).getPropertyValue('--theme-color').trim() ||
    colorPicker.value;
  if (showOverlays) {
    overlaysOn.classList.add('active');
    overlaysOff.classList.remove('active');
    overlaysOn.style.background = themeColor;
    overlaysOn.style.borderColor = themeColor;
    overlaysOff.style.background = '';
    overlaysOff.style.borderColor = '';
  } else {
    overlaysOff.classList.add('active');
    overlaysOn.classList.remove('active');
    overlaysOff.style.background = themeColor;
    overlaysOff.style.borderColor = themeColor;
    overlaysOn.style.background = '';
    overlaysOn.style.borderColor = '';
  }
}

function applyThemeColor(color) {
  document.documentElement.style.setProperty('--theme-color', color);
  if (wordmarkFill) wordmarkFill.setAttribute('fill', color);
  // Clear inline theming from ALL toggle/mode buttons first, then re-apply only
  // to the active one. Otherwise a button that was previously active keeps its
  // inline background and you can't tell which option (e.g. Dark vs Light) is
  // selected — both end up showing the theme color.
  document.querySelectorAll('.toggle-btn, .overlays-btn').forEach((btn) => {
    btn.style.background = '';
    btn.style.borderColor = '';
  });
  document.querySelectorAll('.toggle-btn.active, .overlays-btn.active').forEach((btn) => {
    btn.style.background = color;
    btn.style.borderColor = color;
  });
}

function updatePresetSelection(color) {
  colorPresets.forEach((preset) => {
    if (preset.dataset.color?.toLowerCase() === color.toLowerCase()) {
      preset.classList.add('active');
    } else {
      preset.classList.remove('active');
    }
  });
}

// Match a real Pinterest hostname (pinterest.com, its subdomains, and regional
// ccTLDs), not a loose "includes('pinterest')" substring that would also accept
// hosts like pinterest.evil.com. This only gates a best-effort tab message.
function isPinterestTabUrl(url) {
  try {
    const h = new URL(url).hostname.toLowerCase();
    return /(^|\.)pinterest\.[a-z]{2,3}(\.[a-z]{2})?$/.test(h);
  } catch {
    return false;
  }
}

function notifyContentScript(action, data) {
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    if (tabs[0]?.url && isPinterestTabUrl(tabs[0].url) && tabs[0].id !== undefined) {
      chrome.tabs.sendMessage(tabs[0].id, { action, data }, () => {
        if (chrome.runtime.lastError) {
          console.log('PinTwist Free: Tab message error - ' + chrome.runtime.lastError.message);
        }
      });
    }
  });
}
