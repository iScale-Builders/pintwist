/**
 * Configuration constants for PinTwist extension.
 * Centralizes magic numbers for easier tuning and documentation.
 */

// Cache configuration
export const CACHE = {
  /** Time-to-live for cached pin metrics (1 hour in ms) */
  TTL: 60 * 60 * 1000,
  /** Maximum number of pins to keep in cache before cleanup */
  MAX_SIZE: 2000,
} as const;

// API request configuration
export const API = {
  /** Number of pins to fetch in each bulk request chunk */
  CHUNK_SIZE: 35,
  /** Delay between chunk requests to avoid rate limiting (ms) */
  CHUNK_DELAY: 40,
  /** Background script chunk size (slightly smaller for stability) */
  BACKGROUND_CHUNK_SIZE: 25,
  /** Maximum retries for failed API requests */
  MAX_RETRIES: 2,
} as const;

// Timing configuration
export const TIMING = {
  /** Delay before initializing observer after page load (ms) */
  OBSERVER_INIT_DELAY: 2000,
  /** Delay before re-initializing on URL change (ms) */
  URL_CHANGE_DELAY: 1000,
  /** Maximum wait time for DOM elements (ms) */
  MAX_WAIT: 5000,
  /** Interval for URL change detection (ms) */
  URL_CHECK_INTERVAL: 2000,
} as const;

// UI configuration
export const UI = {
  /** Default theme color */
  DEFAULT_THEME_COLOR: '#F48FB1',
} as const;
