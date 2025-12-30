// Popup logic for ON/OFF toggle and color picker

const btnOff = document.getElementById('btn-off') as HTMLButtonElement;
const btnOn = document.getElementById('btn-on') as HTMLButtonElement;
const statusElement = document.getElementById('status') as HTMLElement;
const overlaysSection = document.getElementById('overlays-section') as HTMLElement;
const overlaysOff = document.getElementById('overlays-off') as HTMLButtonElement;
const overlaysOn = document.getElementById('overlays-on') as HTMLButtonElement;
const colorPicker = document.getElementById('color-picker') as HTMLInputElement;
const colorPresets = document.querySelectorAll<HTMLElement>('.color-preset');
const wordmarkFill = document.getElementById('popup-wordmark-fill') as SVGPathElement | null;

// Load current state on popup open (sync for user preferences)
chrome.storage.sync.get(
  ['pintwist_enabled', 'pintwist_show_overlays', 'pintwist_theme_color'],
  (result) => {
    const isEnabled = result.pintwist_enabled !== false; // Default to ON
    const showOverlays = result.pintwist_show_overlays !== false; // Default to ON
    const themeColor = result.pintwist_theme_color || '#F48FB1';

    updateUI(isEnabled);
    updateOverlaysUI(showOverlays);
    applyThemeColor(themeColor);
    colorPicker.value = themeColor;
    updatePresetSelection(themeColor);
  }
);

// OFF button click
btnOff.addEventListener('click', () => {
  chrome.storage.sync.set({ pintwist_enabled: false }, () => {
    updateUI(false);
    notifyContentScript('disableBar');
  });
});

// ON button click
btnOn.addEventListener('click', () => {
  chrome.storage.sync.set({ pintwist_enabled: true }, () => {
    updateUI(true);
    notifyContentScript('enableBar');
  });
});

// Overlays OFF button
overlaysOff.addEventListener('click', () => {
  chrome.storage.sync.set({ pintwist_show_overlays: false }, () => {
    updateOverlaysUI(false);
    notifyContentScript('hideOverlays');
  });
});

// Overlays ON button
overlaysOn.addEventListener('click', () => {
  chrome.storage.sync.set({ pintwist_show_overlays: true }, () => {
    updateOverlaysUI(true);
    notifyContentScript('showOverlays');
  });
});

// Color picker change
colorPicker.addEventListener('input', (e) => {
  const target = e.target as HTMLInputElement;
  applyThemeColor(target.value);
  updatePresetSelection(target.value);
  notifyContentScript('updateThemeColor', target.value);
});

colorPicker.addEventListener('change', (e) => {
  const target = e.target as HTMLInputElement;
  chrome.storage.sync.set({ pintwist_theme_color: target.value });
});

// Color preset clicks
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

// Update UI based on bar state
function updateUI(isEnabled: boolean): void {
  // Get current theme color
  const themeColor =
    getComputedStyle(document.documentElement).getPropertyValue('--theme-color').trim() ||
    colorPicker.value;

  if (isEnabled) {
    btnOn.classList.add('active');
    btnOff.classList.remove('active');
    // Apply theme to ON, reset OFF
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
    // Apply theme to OFF, reset ON
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

// Update overlays toggle UI
function updateOverlaysUI(showOverlays: boolean): void {
  // Get current theme color
  const themeColor =
    getComputedStyle(document.documentElement).getPropertyValue('--theme-color').trim() ||
    colorPicker.value;

  if (showOverlays) {
    overlaysOn.classList.add('active');
    overlaysOff.classList.remove('active');
    // Apply theme to ON, reset OFF
    overlaysOn.style.background = themeColor;
    overlaysOn.style.borderColor = themeColor;
    overlaysOff.style.background = '';
    overlaysOff.style.borderColor = '';
  } else {
    overlaysOff.classList.add('active');
    overlaysOn.classList.remove('active');
    // Apply theme to OFF, reset ON
    overlaysOff.style.background = themeColor;
    overlaysOff.style.borderColor = themeColor;
    overlaysOn.style.background = '';
    overlaysOn.style.borderColor = '';
  }
}

// Apply theme color to popup UI
function applyThemeColor(color: string): void {
  document.documentElement.style.setProperty('--theme-color', color);

  // Update wordmark fill
  if (wordmarkFill) {
    wordmarkFill.setAttribute('fill', color);
  }

  // Update whichever buttons are currently active
  const activeButtons = document.querySelectorAll<HTMLElement>(
    '.toggle-btn.active, .overlays-btn.active'
  );
  activeButtons.forEach((btn) => {
    btn.style.background = color;
    btn.style.borderColor = color;
  });
}

// Update preset selection indicator
function updatePresetSelection(color: string): void {
  colorPresets.forEach((preset) => {
    if (preset.dataset.color?.toLowerCase() === color.toLowerCase()) {
      preset.classList.add('active');
    } else {
      preset.classList.remove('active');
    }
  });
}

// Notify content script
function notifyContentScript(action: string, data?: string): void {
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    if (tabs[0]?.url?.includes('pinterest') && tabs[0].id !== undefined) {
      chrome.tabs.sendMessage(tabs[0].id, { action, data }, () => {
        if (chrome.runtime.lastError) {
          console.log('PinTwist: Tab message error - ' + chrome.runtime.lastError.message);
        }
      });
    }
  });
}
