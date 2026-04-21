# Pintwist — Install Instructions

Pintwist is a Chrome extension for Pinterest research. It overlays public pin metrics (saves, comments, date) on every pin and contributes anonymous pin data to a shared trend-detection dataset.

**Version:** 1.6.1
**Requires:** an iScaleLabs account (sign-in link shown on first open)

## Install

1. Download `pintwist.zip` and unzip it anywhere on your computer. You'll get a folder called `pintwist` containing `manifest.json`, `popup.html`, and subfolders (`js/`, `css/`, `images/`).
2. Open Chrome and go to `chrome://extensions` (paste in the address bar).
3. Toggle **Developer mode** ON (top-right corner).
4. Click **Load unpacked** and select the unzipped `pintwist` folder.
5. Pin the extension to your toolbar (puzzle icon → pin next to "PinTwist").
6. Click the Pintwist icon → **Sign in with iScaleLabs**. A tab opens for sign-in. After authenticating, return to Pinterest.

## First use

- Open any Pinterest page (home, search, board).
- A bar appears at the top with controls for sorting and filtering pins.
- Each pin gets an overlay showing saves, reactions, shares, and creation date.
- First time you open the popup, you'll see a yellow heads-up explaining that anonymous pin metrics are shared. Click **Got it** to dismiss (shown once).

## What is shared

**Yes:**
- Pinterest pin IDs you view
- Those pins' public metrics (saves, comments, reactions, date)
- The Pinterest URL you're browsing (search query, board, etc.)
- A random install ID generated on your device (not linked to your identity)

**No:**
- Your Pinterest account, login, or profile info
- Anything from sites other than pinterest.com
- Images, private boards, or personal pins

We collect data *from Pinterest*, not *about you*. Sharing is required; there is no opt-out. If you prefer not to contribute, please don't install the extension.

## Updating

1. Download the new `pintwist.zip`.
2. Replace the old unzipped folder with the new one at the same path.
3. Go to `chrome://extensions` and click the reload icon on the Pintwist card.

Chrome remembers the folder path; no re-install needed as long as you keep the folder in the same location.

## Troubleshooting

- **Bar or overlays don't appear.** Make sure you're signed in to iScaleLabs (popup should show your email). Refresh the Pinterest tab.
- **"Could not load extension" on install.** You probably selected the zip file or the wrong folder. Unzip first, then select the folder that directly contains `manifest.json`.
- **Popup shows sign-in button but sign-in doesn't work.** Clear cookies for `iscalelabs.com`, retry.
- **Data sharing banner comes back every time.** `chrome.storage.local` was cleared (common after extension reinstall). Click "Got it" again.
- **Something else broken.** Open `chrome://extensions`, find PinTwist, click "service worker" or "inspect views". Console will show errors. Report them.

## For power users

The extension is loaded unpacked — all source is right there in the folder.
- `js/content.js` runs on Pinterest pages
- `js/background.js` is the service worker (runs async)
- `popup.html` / `popup.js` is the toolbar popup

To see what's being sent, open `chrome://extensions` → PinTwist → "service worker" → "inspect views" → Network tab. You'll see `POST /functions/v1/ingest` batches on flush.
