// ===== PINTWIST POPUP - STATUS SURFACE + LAUNCHER =====
// Does NOT run OAuth. Opens webapp for sign-in, reads state from Clerk.
import { createClerkClient } from '@clerk/chrome-extension/client';

const PUBLISHABLE_KEY = process.env.CLERK_PUBLISHABLE_KEY;
const SIGN_IN_URL = 'https://www.iscalelabs.com/extension-sign-in?source=pintwist';

// ===== DOM =====
const authScreen = document.getElementById('auth-screen');
const appScreen = document.getElementById('app-screen');
const signInBtn = document.getElementById('sign-in-btn');
const signOutBtn = document.getElementById('sign-out-btn');
const userName = document.getElementById('user-name');
const userAvatar = document.getElementById('user-avatar');

const btnOff = document.getElementById('btn-off');
const btnOn = document.getElementById('btn-on');
const statusElement = document.getElementById('status');
const overlaysSection = document.getElementById('overlays-section');
const overlaysOff = document.getElementById('overlays-off');
const overlaysOn = document.getElementById('overlays-on');
const colorPicker = document.getElementById('color-picker');
const colorPresets = document.querySelectorAll('.color-preset');
const wordmarkFill = document.getElementById('popup-wordmark-fill');

// ===== CLERK INIT =====
const clerk = createClerkClient({
  publishableKey: PUBLISHABLE_KEY,
  syncHost: 'https://www.iscalelabs.com',
});

clerk
  .load({
    allowedRedirectProtocols: ['chrome-extension:'],
  })
  .then(() => {
    clerk.addListener(render);
    render();
  });

// ===== RENDER =====
function render() {
  if (clerk.user) {
    authScreen.style.display = 'none';
    appScreen.style.display = 'block';

    const email = clerk.user.primaryEmailAddress?.emailAddress || '';
    const name = clerk.user.fullName || clerk.user.firstName || email;
    userName.textContent = name;

    if (clerk.user.imageUrl) {
      userAvatar.src = clerk.user.imageUrl;
      userAvatar.style.display = 'block';
    } else {
      userAvatar.style.display = 'none';
    }

    // Persist auth state and close any leftover sign-in tabs
    chrome.storage.local.set({
      pintwist_auth: { signedIn: true, updatedAt: Date.now() },
    });
    chrome.tabs.query({}, (tabs) => {
      tabs.forEach((tab) => {
        if (tab.url && tab.url.includes('extension-sign-in')) {
          chrome.tabs.remove(tab.id);
        }
      });
    });

    loadPreferences();
  } else {
    authScreen.style.display = 'flex';
    appScreen.style.display = 'none';
    chrome.storage.local.set({
      pintwist_auth: { signedIn: false, updatedAt: Date.now() },
    });
  }
}

// ===== SIGN IN / OUT =====
signInBtn.addEventListener('click', () => {
  chrome.tabs.create({ url: SIGN_IN_URL });
});

signOutBtn.addEventListener('click', () => {
  // Update UI and clear auth FIRST — before Clerk can redirect/kill the popup
  chrome.storage.local.set({
    pintwist_auth: { signedIn: false, updatedAt: Date.now() },
  });
  authScreen.style.display = 'flex';
  appScreen.style.display = 'none';

  // Clear Clerk session cookie directly — don't call clerk.signOut() as it crashes the popup
  chrome.cookies.remove({ url: 'https://www.iscalelabs.com', name: '__client_uat' });
  chrome.cookies.remove({ url: 'https://www.iscalelabs.com', name: '__session' });
});

// ===== PREFERENCES =====
function loadPreferences() {
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

// ===== TOGGLE HANDLERS =====
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

// ===== COLOR =====
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

// ===== UI HELPERS =====
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

function notifyContentScript(action, data) {
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
