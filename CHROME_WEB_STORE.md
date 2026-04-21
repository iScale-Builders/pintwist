# Chrome Web Store — PinTwist Submission Pack

Everything needed to submit PinTwist v1.6.1 to the Chrome Web Store. Copy-paste the blocks below into the corresponding fields in the developer console.

## 0. What you need from me vs you

| Item | Status |
|---|---|
| Extension zip `pintwist.zip` v1.6.1 | ✅ ready (921 KB, 11 files) |
| Store listing copy | ✅ in this doc |
| Permission justifications | ✅ in this doc |
| Privacy practices disclosures | ✅ in this doc |
| Privacy policy URL | ✅ `https://www.iscalelabs.com/privacy` |
| Terms URL | ✅ `https://www.iscalelabs.com/terms` |
| Support email | ✅ `contact@iscalelabs.com` |
| Homepage URL | ✅ `https://www.iscalelabs.com/apps` |
| **Developer account** ($5 one-time) | ❌ you create at [chrome.google.com/webstore/devconsole](https://chrome.google.com/webstore/devconsole) |
| **Screenshots** (1-5 at 1280×800) | ❌ you take on real Chrome with PinTwist active on Pinterest |
| **Small promo tile** 440×280 | ❌ optional but improves the listing |
| **Submission click** | ❌ you, once everything's pasted |

## 1. Store listing tab

### Item name (≤45 chars)
```
PinTwist — Pinterest Analytics
```

### Summary (≤132 chars)
```
See saves, comments, and creation dates on every Pinterest pin. Research niches faster with a live engagement overlay.
```

### Detailed description
Paste as-is. The first paragraph is what shows above the fold on the listing.

```
PinTwist overlays engagement metrics on every Pinterest pin so you can research niches and find trending designs faster. Save counts, comment counts, reaction counts, repin counts, and creation dates appear directly on pins as you browse — no clicking through, no tab-switching.

Built for print-on-demand designers, content creators, and anyone doing Pinterest-based research.

HOW IT WORKS
• Install the extension.
• Sign in with your free iScaleLabs account at iscalelabs.com.
• Browse Pinterest normally — engagement metrics appear on pins automatically.
• Sort, filter, and download pins directly from the overlay.

REQUIREMENTS
• A free iScaleLabs account (used as the sign-in mechanism; email address only, handled by Clerk).

FEATURES
• Real-time metric overlays on pins: saves, comments, reactions, repins, date, image download.
• Sort pins by any metric.
• Filter by save count, date range, and other metrics.
• Download high-resolution pin images.
• Works on all 30 regional Pinterest domains.
• Minimal footprint — no tracking scripts, no third-party ads, no data sold.

DATA COLLECTION (PLAIN ENGLISH)
PinTwist anonymously contributes the public engagement metrics of pins you view (saves, comments, date) to a shared dataset that powers trend detection for all users. We collect data from Pinterest, not from you. No identity is attached to the data; a random install ID is used for deduplication.

A one-time notice is shown in the popup on first use. Full details at https://www.iscalelabs.com/privacy.

SUPPORT
Questions, bug reports, feedback: contact@iscalelabs.com.
```

### Category
```
Productivity
```

### Language
```
English (United States)
```

## 2. Privacy tab

### Single purpose description
CWS asks what ONE thing the extension does. Avoid mentioning two features here.

```
PinTwist is a research tool for Pinterest creators: it overlays public engagement metrics on pins and contributes anonymous aggregate data to a shared trend-detection dataset.
```

### Permission justifications

Paste one by one into the dev console's "Justification" fields.

**Permission: `tabs`**
```
Used to detect when the active tab is a Pinterest page so the analytics bar and pin overlays are rendered only on Pinterest, and to close the temporary tab opened during the iScaleLabs sign-in flow once authentication completes.
```

**Permission: `storage`**
```
Stores a random anonymous install ID (UUID) used for deduplication, user preferences (bar visibility, overlay visibility, theme color), and a small offline queue of pin observations for when the network is temporarily unavailable. No personal data is stored here.
```

**Permission: `downloads`**
```
Powers the "Download" button on pin overlays, which saves the high-resolution image of a pin to the user's device. Only fires when the user explicitly clicks the download button.
```

**Permission: `cookies`**
```
Reads a single auth cookie (`__client_uat`) from iscalelabs.com to determine whether the user is signed in to their iScaleLabs account, and clears it on sign-out. No cookies are read from any other site.
```

### Host permission justifications

**Host: `*://*.pinterest.com/*` and 29 other regional TLDs (`.ca`, `.co.uk`, `.de`, etc.)**
```
Required to inject the engagement-metric overlays and the analytics bar on all Pinterest regional domains. Pinterest publishes the same service under 30 country-specific TLDs, each with its own cookies and pin IDs.
```

**Host: `*://*.pinimg.com/*`**
```
Pinterest's image CDN. Required so the "Download image" button can fetch the full-resolution source of a pin directly from Pinterest's CDN.
```

**Host: `https://tzuvthfkdguxisquxlnb.supabase.co/*`**
```
The PinTwist ingest endpoint. When a pin overlay renders, the background worker POSTs the pin's public metrics to this endpoint so they can be aggregated into the trend dataset. All writes go through an Edge Function with per-install rate limiting.
```

**Host: `*://*.iscalelabs.com/*`**
```
Sign-in happens on iscalelabs.com. The extension reads the auth-cookie presence to know whether the user is signed in, and opens an iscalelabs.com tab when the user clicks "Sign in."
```

**Host: `*://*.clerk.accounts.dev/*`**
```
Clerk (our authentication provider) serves its JavaScript SDK from this domain. The popup page loads the Clerk SDK to display the user's name and avatar, and to manage the sign-out action.
```

### Data collection / Privacy practices

For each data type, check the box if it applies, then select a purpose.

| Data type | Check? | Purpose |
|---|---|---|
| Personally identifiable information | ☐ no | — |
| Health information | ☐ no | — |
| Financial and payment information | ☐ no | — |
| Authentication information | ☑ yes | App functionality (sign-in state only — we read a cookie presence, not the token) |
| Personal communications | ☐ no | — |
| Location | ☐ no | — |
| Web history | ☐ no (we discard non-Pinterest URLs server-side before storage) | — |
| User activity | ☑ yes | App functionality, Analytics (which pins you view while on Pinterest — aggregated, anonymous) |
| Website content | ☑ yes | App functionality, Analytics (public pin metrics scraped from Pinterest pages) |

### Certifications (check all three)

- ☑ I do not sell or transfer user data to third parties outside of the approved use cases.
- ☑ I do not use or transfer user data for purposes that are unrelated to my item's single purpose.
- ☑ I do not use or transfer user data to determine creditworthiness or for lending purposes.

### Privacy policy URL
```
https://www.iscalelabs.com/privacy
```

## 3. Distribution tab

### Visibility
```
Public
```

### Regions
```
All regions
```
(PinTwist works on all Pinterest regional TLDs, so no country restriction.)

### Pricing
```
Free
```

## 4. Account tab

### Publisher name
```
iScaleLabs
```
(If your developer account is under a personal name, change the "Publisher display name" to iScaleLabs in the Account section.)

### Support email
```
contact@iscalelabs.com
```

### Website
```
https://www.iscalelabs.com/apps
```

## 5. Screenshots

Chrome Web Store requires 1 screenshot minimum, 5 max, at 1280×800 or 640×400.

**Shots to take:**

1. **Hero — pin overlay in action.** Pinterest search results page (e.g. `pinterest.com/search/pins/?q=boho+wall+art`) with PinTwist overlays showing metrics on 4-6 visible pins. Crop to 1280×800.

2. **Popup UI.** Click the PinTwist icon, screenshot the popup showing ON/OFF toggles + theme color picker + signed-in state.

3. **Analytics bar.** A Pinterest board or search page with the PinTwist bar docked at top (showing sort, filter, count).

4. **(Optional) Download feature.** Hover over a pin, show the "Download" button.

5. **(Optional) Before/after.** Split screenshot: left half = vanilla Pinterest, right half = with PinTwist overlays.

Tips: use a real Pinterest search in a popular niche (e.g. "boho wall art", "coffee mug designs") so the metrics are large + visible. Zoom your browser to 90% to get more pins per frame.

## 6. Walkthrough — submitting in the dev console

1. Go to [chrome.google.com/webstore/devconsole](https://chrome.google.com/webstore/devconsole). If first time, pay the $5 registration fee.
2. Click **New item** → upload `pintwist.zip` (at `workspace/apps/pintwist/pintwist.zip`).
3. Fill the **Store listing** tab using copy from section 1 above. Upload screenshots.
4. Fill the **Privacy** tab using copy from section 2. Paste each permission justification.
5. Fill the **Distribution** tab using section 3 — Public, All regions, Free.
6. Verify the **Account** tab has the support email / website from section 4.
7. Click **Submit for review** at the top right.

## 7. What to expect from review

**Typical timeline**: 1-7 business days. Sometimes same-day; occasionally longer if there's a backlog.

**Common rejection reasons + how we handle them:**

| Reason | Our mitigation |
|---|---|
| "Unused permission" | Trimmed `identity` in v1.6.1. Remaining permissions all justified. |
| "Single purpose violation" | Listing + single-purpose statement frame overlay + data contribution as one unified research tool, not two separate features. |
| "Data collection not disclosed" | First-launch banner in popup, store listing description paragraph, and privacy policy all say the same thing. |
| "Permission not justified" | One-sentence specific justifications ready for every permission + host match. |
| "Remote code" | We don't inject remote code into content scripts. Clerk SDK loads only in the popup (extension page), which is allowed under MV3. |
| "Login wall without clear notice" | The store listing explicitly says "Requirements: A free iScaleLabs account." |

**If rejected**: CWS sends an email with the specific issue. Reply / edit the listing / bump a new version. Reviews usually go faster the second time.

## 8. Post-approval checklist

Once approved and live:

- Update `iscalelabs.com/apps` — add a "Install from Chrome Web Store" button pointing at the listing URL
- Update `DISTRIBUTION.md` — say "install via Chrome Web Store" as the preferred path, keep unpacked-zip as fallback
- Monitor the dev console's **Feedback** and **Reviews** tabs
- Respond to user reviews via the console
- Watch for the **Violations** tab — CWS may silently email about policy issues post-approval

## 9. Future maintenance

Each new version:
1. Bump `manifest.json` + `package.json` version (e.g. 1.6.1 → 1.6.2)
2. `node build.cjs` → rebuilds `dist/`
3. Re-zip `dist/` → `pintwist.zip`
4. Upload via dev console → **Package** tab → **Upload new package**
5. Update store listing if features changed (same tab structure as original submission)
6. Click **Submit for review** again — re-reviews are typically faster
