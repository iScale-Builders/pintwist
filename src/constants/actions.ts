/**
 * Action constants for Chrome extension message passing.
 * Used for communication between content script, background script, and popup.
 */

// Content script actions (received by content.ts)
export const ContentActions = {
  ENABLE_BAR: 'enableBar',
  DISABLE_BAR: 'disableBar',
  SHOW_OVERLAYS: 'showOverlays',
  HIDE_OVERLAYS: 'hideOverlays',
  UPDATE_THEME_COLOR: 'updateThemeColor',
} as const;

// Background script actions (received by background.ts)
export const BackgroundActions = {
  FETCH_PIN_DATA: 'fetchPinData',
  FETCH_BULK_PINS: 'fetchBulkPins',
  DOWNLOAD_IMAGE: 'downloadImage',
} as const;

// All actions combined for type safety
export const Actions = {
  ...ContentActions,
  ...BackgroundActions,
} as const;

// Type for all action values
export type ContentActionType = (typeof ContentActions)[keyof typeof ContentActions];
export type BackgroundActionType = (typeof BackgroundActions)[keyof typeof BackgroundActions];
export type ActionType = (typeof Actions)[keyof typeof Actions];
