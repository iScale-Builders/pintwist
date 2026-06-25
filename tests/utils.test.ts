import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { C } from './loadContent';

// These exercise the ACTUAL pure utility functions from js/content.js (loaded via the
// harness), not re-implementations — so drift in the shipped code is caught here instead
// of silently passing against a stale copy. (audit #6 phase 2)
const { escapeAttr, formatNumber, formatDate, getDaysAgo } = C;

describe('escapeAttr', () => {
  it('returns empty string for null', () => {
    expect(escapeAttr(null)).toBe('');
  });

  it('returns empty string for undefined', () => {
    expect(escapeAttr(undefined)).toBe('');
  });

  it('returns empty string for empty string', () => {
    expect(escapeAttr('')).toBe('');
  });

  it('escapes ampersand', () => {
    expect(escapeAttr('foo & bar')).toBe('foo &amp; bar');
  });

  it('escapes double quotes', () => {
    expect(escapeAttr('say "hello"')).toBe('say &quot;hello&quot;');
  });

  it('escapes single quotes', () => {
    expect(escapeAttr("it's")).toBe('it&#39;s');
  });

  it('escapes less than', () => {
    expect(escapeAttr('a < b')).toBe('a &lt; b');
  });

  it('escapes greater than', () => {
    expect(escapeAttr('a > b')).toBe('a &gt; b');
  });

  it('escapes all special characters together', () => {
    expect(escapeAttr('<script>"alert(\'xss\')&"</script>')).toBe(
      '&lt;script&gt;&quot;alert(&#39;xss&#39;)&amp;&quot;&lt;/script&gt;'
    );
  });

  it('handles normal strings without escaping', () => {
    expect(escapeAttr('hello world 123')).toBe('hello world 123');
  });
});

describe('formatNumber', () => {
  it('returns string for numbers under 1000', () => {
    expect(formatNumber(0)).toBe('0');
    expect(formatNumber(1)).toBe('1');
    expect(formatNumber(999)).toBe('999');
  });

  it('formats thousands with K suffix', () => {
    expect(formatNumber(1000)).toBe('1K');
    expect(formatNumber(1500)).toBe('1.5K');
    expect(formatNumber(10000)).toBe('10K');
    expect(formatNumber(999999)).toBe('1000K');
  });

  it('removes trailing .0 for clean K values', () => {
    expect(formatNumber(1000)).toBe('1K');
    expect(formatNumber(2000)).toBe('2K');
    expect(formatNumber(10000)).toBe('10K');
  });

  it('formats millions with M suffix', () => {
    expect(formatNumber(1000000)).toBe('1M');
    expect(formatNumber(1500000)).toBe('1.5M');
    expect(formatNumber(10000000)).toBe('10M');
  });

  it('removes trailing .0 for clean M values', () => {
    expect(formatNumber(1000000)).toBe('1M');
    expect(formatNumber(2000000)).toBe('2M');
  });

  it('handles edge cases around boundaries', () => {
    expect(formatNumber(999)).toBe('999');
    expect(formatNumber(1000)).toBe('1K');
    expect(formatNumber(999999)).toBe('1000K');
    expect(formatNumber(1000000)).toBe('1M');
  });
});

describe('formatDate', () => {
  it('formats valid ISO date string', () => {
    const result = formatDate('2024-01-15T10:30:00Z');
    // Result depends on locale, but should contain the parts
    expect(result).toContain('2024');
    expect(result).toContain('Jan');
    expect(result).toContain('15');
  });

  it('returns Invalid Date for unparseable strings (current behavior)', () => {
    // Note: The try/catch in formatDate doesn't catch invalid date parsing
    // because new Date('invalid') doesn't throw - it returns an Invalid Date object
    // This documents the actual current behavior
    expect(formatDate('not a date')).toBe('Invalid Date');
  });

  it('handles different date formats', () => {
    const result = formatDate('December 25, 2023');
    expect(result).toContain('2023');
    expect(result).toContain('Dec');
    expect(result).toContain('25');
  });
});

describe('getDaysAgo', () => {
  let mockDate: Date;

  beforeEach(() => {
    // Mock Date.now() to return a fixed timestamp
    mockDate = new Date('2024-06-15T12:00:00Z');
    vi.useFakeTimers();
    vi.setSystemTime(mockDate);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns TODAY for dates within same day', () => {
    expect(getDaysAgo('2024-06-15T00:00:00Z')).toBe('TODAY');
    expect(getDaysAgo('2024-06-15T11:00:00Z')).toBe('TODAY');
  });

  it('returns YESTERDAY for dates 1 day ago', () => {
    expect(getDaysAgo('2024-06-14T12:00:00Z')).toBe('YESTERDAY');
  });

  it('returns days with D suffix for 2-6 days ago', () => {
    expect(getDaysAgo('2024-06-13T12:00:00Z')).toBe('2D');
    expect(getDaysAgo('2024-06-10T12:00:00Z')).toBe('5D');
    expect(getDaysAgo('2024-06-09T12:00:00Z')).toBe('6D');
  });

  it('returns weeks with W suffix for 7-29 days ago', () => {
    expect(getDaysAgo('2024-06-08T12:00:00Z')).toBe('1W');
    expect(getDaysAgo('2024-06-01T12:00:00Z')).toBe('2W');
    expect(getDaysAgo('2024-05-17T12:00:00Z')).toBe('4W');
  });

  it('returns months with MO suffix for 30-364 days ago', () => {
    expect(getDaysAgo('2024-05-16T12:00:00Z')).toBe('1MO');
    expect(getDaysAgo('2024-03-15T12:00:00Z')).toBe('3MO');
    expect(getDaysAgo('2023-07-15T12:00:00Z')).toBe('11MO');
  });

  it('returns years with Y suffix for 365+ days ago', () => {
    expect(getDaysAgo('2023-06-15T12:00:00Z')).toBe('1Y');
    expect(getDaysAgo('2022-06-15T12:00:00Z')).toBe('2Y');
  });

  it('returns NaNY for invalid dates (current behavior - potential bug)', () => {
    // Note: The try/catch in getDaysAgo doesn't catch invalid date parsing
    // because new Date('invalid') doesn't throw - it returns NaN for getTime()
    // This documents the actual current behavior which should be fixed
    expect(getDaysAgo('invalid')).toBe('NaNY');
  });
});
