import { describe, it, expect } from 'vitest';
import {
  standardPinData,
  videoPinData,
  storyPinData,
  storyPinWithVideoBlock,
  carouselPinData,
  closeupDescriptionPinData,
  imageSignaturePinData,
  directImageUrlPinData,
  minimalPinData,
  emptyPinData,
  pinWithZeroStats,
} from './fixtures/pinterest-api-responses';

import { C } from './loadContent';

// Exercises the ACTUAL extractMetrics from js/content.js (loaded via the harness),
// not a re-implementation — so drift is caught here. The shipped fn returns a superset
// of fields (title/description/displayImageUrl/…); the per-field assertions below are
// unaffected. (audit #6 phase 2)
const { extractMetrics } = C;

describe('extractMetrics', () => {
  describe('null/undefined data handling', () => {
    it('returns fetchFailed: true for null data', () => {
      const result = extractMetrics(null, 'test-pin-123');
      expect(result.fetchFailed).toBe(true);
      expect(result.pinID).toBe('test-pin-123');
      expect(result.saves).toBe(0);
      expect(result.reactions).toBe(0);
      expect(result.shares).toBe(0);
      expect(result.repins).toBe(0);
      expect(result.comments).toBe(0);
      expect(result.createdAt).toBeNull();
      expect(result.imageUrl).toBeNull();
      expect(result.isVideo).toBe(false);
    });

    it('returns fetchFailed: true for undefined data', () => {
      const result = extractMetrics(undefined, 'test-pin-456');
      expect(result.fetchFailed).toBe(true);
    });
  });

  describe('standard pin data', () => {
    it('extracts all metrics from standard pin', () => {
      const result = extractMetrics(standardPinData, 'standard-pin');
      expect(result.pinID).toBe('standard-pin');
      expect(result.saves).toBe(1500);
      expect(result.reactions).toBe(342);
      expect(result.shares).toBe(78);
      expect(result.repins).toBe(456);
      expect(result.comments).toBe(25);
      expect(result.createdAt).toBe('2024-01-15T10:30:00Z');
      expect(result.imageUrl).toBe('https://i.pinimg.com/originals/abc/def.jpg');
      expect(result.isVideo).toBe(false);
      expect(result.fetchFailed).toBe(false);
    });
  });

  describe('video pin detection', () => {
    it('detects video from videos property', () => {
      const result = extractMetrics(videoPinData, 'video-pin');
      expect(result.isVideo).toBe(true);
    });

    it('extracts video thumbnail as imageUrl', () => {
      const result = extractMetrics(videoPinData, 'video-pin');
      expect(result.imageUrl).toBe('https://i.pinimg.com/videos/thumbs/720p.jpg');
    });

    it('detects video from is_video flag', () => {
      const dataWithIsVideo = { is_video: true };
      const result = extractMetrics(dataWithIsVideo, 'is-video-pin');
      expect(result.isVideo).toBe(true);
    });

    it('detects video from story_pin_data with video block', () => {
      const result = extractMetrics(storyPinWithVideoBlock, 'story-video-pin');
      expect(result.isVideo).toBe(true);
    });
  });

  describe('story pin data', () => {
    it('extracts image from story_pin_data pages', () => {
      const result = extractMetrics(storyPinData, 'story-pin');
      expect(result.imageUrl).toBe('https://i.pinimg.com/story/page1.jpg');
    });

    it('extracts video thumbnail from story pin blocks', () => {
      const result = extractMetrics(storyPinWithVideoBlock, 'story-video-pin');
      expect(result.imageUrl).toBe('https://i.pinimg.com/story/video_thumb.jpg');
    });
  });

  describe('carousel pin data', () => {
    it('extracts image from first carousel slot', () => {
      const result = extractMetrics(carouselPinData, 'carousel-pin');
      expect(result.imageUrl).toBe('https://i.pinimg.com/carousel/slide1.jpg');
    });

    it('extracts correct engagement metrics', () => {
      const result = extractMetrics(carouselPinData, 'carousel-pin');
      expect(result.saves).toBe(2200);
      expect(result.reactions).toBe(567);
      expect(result.repins).toBe(890);
    });
  });

  describe('closeup description fallback', () => {
    it('extracts image from closeup_unified_description', () => {
      const result = extractMetrics(closeupDescriptionPinData, 'closeup-pin');
      expect(result.imageUrl).toBe('https://i.pinimg.com/closeup/image.jpg');
    });
  });

  describe('image signature fallback', () => {
    it('constructs image URL from image_signature', () => {
      const result = extractMetrics(imageSignaturePinData, 'sig-pin');
      expect(result.imageUrl).toBe('https://i.pinimg.com/originals/ab/cd/ef/abcdef1234567890.jpg');
    });
  });

  describe('direct image URL fallback', () => {
    it('uses image_url field as fallback', () => {
      const result = extractMetrics(directImageUrlPinData, 'direct-pin');
      expect(result.imageUrl).toBe('https://i.pinimg.com/direct/image.jpg');
    });
  });

  describe('minimal and empty data', () => {
    it('handles minimal data with defaults', () => {
      const result = extractMetrics(minimalPinData, 'minimal-pin');
      expect(result.saves).toBe(0);
      expect(result.reactions).toBe(0);
      expect(result.shares).toBe(0);
      expect(result.repins).toBe(0);
      expect(result.comments).toBe(0);
      expect(result.createdAt).toBe('2024-08-01T00:00:00Z');
      // Note: When no image fallbacks exist, imageUrl is undefined (not null)
      // This is because data?.image_url || data?.imageUrl returns undefined
      expect(result.imageUrl).toBeUndefined();
      expect(result.isVideo).toBe(false);
      expect(result.fetchFailed).toBe(false);
    });

    it('handles empty object', () => {
      const result = extractMetrics(emptyPinData, 'empty-pin');
      expect(result.saves).toBe(0);
      expect(result.createdAt).toBeNull();
      expect(result.fetchFailed).toBe(false);
    });

    it('handles zero stats correctly', () => {
      const result = extractMetrics(pinWithZeroStats, 'zero-pin');
      expect(result.saves).toBe(0);
      expect(result.comments).toBe(0);
      expect(result.shares).toBe(0);
      expect(result.imageUrl).toBe('https://i.pinimg.com/zero_stats.jpg');
    });
  });

  describe('image priority order', () => {
    it('prefers orig over other sizes', () => {
      const data = {
        images: {
          '736x': { url: 'https://i.pinimg.com/736x/image.jpg' },
          orig: { url: 'https://i.pinimg.com/originals/image.jpg' },
          '236x': { url: 'https://i.pinimg.com/236x/image.jpg' },
        },
      };
      const result = extractMetrics(data, 'priority-pin');
      expect(result.imageUrl).toBe('https://i.pinimg.com/originals/image.jpg');
    });

    it('falls back to 1200x when orig not available', () => {
      const data = {
        images: {
          '1200x': { url: 'https://i.pinimg.com/1200x/image.jpg' },
          '736x': { url: 'https://i.pinimg.com/736x/image.jpg' },
        },
      };
      const result = extractMetrics(data, 'fallback-pin');
      expect(result.imageUrl).toBe('https://i.pinimg.com/1200x/image.jpg');
    });
  });
});
