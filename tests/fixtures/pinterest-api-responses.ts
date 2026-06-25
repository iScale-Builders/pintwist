// Pinterest API response fixtures for testing extractMetrics function
// These represent the various data structures returned by Pinterest's API

export const standardPinData = {
  aggregated_pin_data: {
    aggregated_stats: {
      saves: 1500,
    },
    comment_count: 25,
  },
  reaction_counts: {
    1: 342, // reactions are indexed by type, 1 is the main reaction
  },
  share_count: 78,
  repin_count: 456,
  created_at: '2024-01-15T10:30:00Z',
  images: {
    orig: { url: 'https://i.pinimg.com/originals/abc/def.jpg' },
    '1200x': { url: 'https://i.pinimg.com/1200x/abc/def.jpg' },
    '736x': { url: 'https://i.pinimg.com/736x/abc/def.jpg' },
  },
};

export const videoPinData = {
  aggregated_pin_data: {
    aggregated_stats: {
      saves: 5000,
    },
    comment_count: 100,
  },
  reaction_counts: {
    1: 1200,
  },
  share_count: 250,
  repin_count: 800,
  created_at: '2024-02-20T15:45:00Z',
  is_video: true,
  videos: {
    video_list: {
      v720p: {
        url: 'https://v.pinimg.com/videos/720p.mp4',
        thumbnail: 'https://i.pinimg.com/videos/thumbs/720p.jpg',
      },
    },
  },
};

export const storyPinData = {
  aggregated_pin_data: {
    aggregated_stats: {
      saves: 750,
    },
    comment_count: 12,
  },
  reaction_counts: {
    1: 89,
  },
  share_count: 15,
  repin_count: 120,
  created_at: '2024-03-10T08:00:00Z',
  story_pin_data: {
    pages: [
      {
        image: {
          images: {
            orig: { url: 'https://i.pinimg.com/story/page1.jpg' },
            '1200x': { url: 'https://i.pinimg.com/story/page1_1200.jpg' },
          },
        },
      },
      {
        blocks: [
          {
            image: {
              images: {
                orig: { url: 'https://i.pinimg.com/story/block1.jpg' },
              },
            },
          },
        ],
      },
    ],
  },
};

export const storyPinWithVideoBlock = {
  aggregated_pin_data: {
    aggregated_stats: {
      saves: 300,
    },
    comment_count: 5,
  },
  reaction_counts: {},
  share_count: 8,
  repin_count: 45,
  created_at: '2024-04-01T12:00:00Z',
  story_pin_data: {
    pages: [
      {
        blocks: [
          {
            video: {
              video_list: {
                v480p: {
                  thumbnail: 'https://i.pinimg.com/story/video_thumb.jpg',
                },
              },
            },
          },
        ],
      },
    ],
  },
};

export const carouselPinData = {
  aggregated_pin_data: {
    aggregated_stats: {
      saves: 2200,
    },
    comment_count: 45,
  },
  reaction_counts: {
    1: 567,
  },
  share_count: 120,
  repin_count: 890,
  created_at: '2024-05-15T14:30:00Z',
  carousel_data: {
    carousel_slots: [
      {
        images: {
          orig: { url: 'https://i.pinimg.com/carousel/slide1.jpg' },
        },
      },
      {
        images: {
          '736x': { url: 'https://i.pinimg.com/carousel/slide2_736.jpg' },
        },
      },
    ],
  },
};

export const closeupDescriptionPinData = {
  aggregated_pin_data: {
    aggregated_stats: {
      saves: 100,
    },
    comment_count: 2,
  },
  reaction_counts: {},
  share_count: 5,
  repin_count: 20,
  created_at: '2024-06-01T09:00:00Z',
  closeup_unified_description: {
    images: {
      orig: { url: 'https://i.pinimg.com/closeup/image.jpg' },
    },
  },
};

export const imageSignaturePinData = {
  aggregated_pin_data: {
    aggregated_stats: {
      saves: 50,
    },
    comment_count: 1,
  },
  reaction_counts: {},
  share_count: 2,
  repin_count: 10,
  created_at: '2024-06-15T16:00:00Z',
  image_signature: 'abcdef1234567890',
};

export const directImageUrlPinData = {
  aggregated_pin_data: {
    aggregated_stats: {
      saves: 30,
    },
    comment_count: 0,
  },
  reaction_counts: {},
  share_count: 1,
  repin_count: 5,
  created_at: '2024-07-01T11:00:00Z',
  image_url: 'https://i.pinimg.com/direct/image.jpg',
};

export const minimalPinData = {
  // Only has required fields, tests default values
  created_at: '2024-08-01T00:00:00Z',
};

export const emptyPinData = {};

export const pinWithZeroStats = {
  aggregated_pin_data: {
    aggregated_stats: {
      saves: 0,
    },
    comment_count: 0,
  },
  reaction_counts: {},
  share_count: 0,
  repin_count: 0,
  created_at: '2024-09-01T00:00:00Z',
  images: {
    orig: { url: 'https://i.pinimg.com/zero_stats.jpg' },
  },
};
