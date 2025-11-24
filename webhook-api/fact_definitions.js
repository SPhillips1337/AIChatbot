// Structured fact definitions for Aura's discovery/questions system
// Each fact can include optional `regex` for deterministic extraction,
// `templates` for discovery questions, `priority` (higher -> ask earlier),
// and `sensitivity` to help control asking/visibility.

module.exports = [
  {
    key: 'name',
    label: 'name',
    priority: 10,
    sensitivity: 'low',
    requiredConfidence: 0.9,
    regex: /\b(?:my name is|i(?:'m| am) called|call me|you can call me)\s+([A-Za-z][A-Za-z\s'\-]{1,40})/i,
    examples: ['Alice', 'Carlos', 'Priya', 'Mohammed', 'Sam'],
    templates: [
      "What should I call you?",
      "I don't think I know your name — what do you like me to call you?",
      "How should I address you?"
    ]
  },
  {
    key: 'pronouns',
    label: 'pronouns',
    priority: 9,
    sensitivity: 'low',
    examples: ['he/him', 'she/her', 'they/them', 'xe/xem'],
    // No robust regex here — prefer explicit short answers, NLP helpful
    templates: [
      "Which pronouns do you prefer (e.g., he/him, she/her, they/them)?",
      "Do you have preferred pronouns I should use for you?"
    ]
  },
  {
    key: 'timezone',
    label: 'timezone',
    priority: 8,
    sensitivity: 'low',
    examples: ['Europe/London', 'America/New_York', 'Asia/Kolkata', 'UTC'],
    templates: [
      "What timezone are you in, or which city are you in so I can get the time right?",
      "Which timezone should I use when thinking about your day?"
    ]
  },
  {
    key: 'city',
    label: 'city',
    priority: 7,
    sensitivity: 'low',
    regex: /\b(?:i live in|i'm from|i am from|i live near|i'm in)\s+([A-Za-z\s\-]{2,60})/i,
    examples: ['London', 'New York', 'Mumbai', 'Sydney'],
    templates: [
      "Where are you based (city or town)?",
      "Which city do you live in?"
    ]
  },
  {
    key: 'occupation',
    label: 'occupation',
    priority: 6,
    sensitivity: 'medium',
    regex: /\b(?:i work as|my job is|i'm a|i am a)\s+([A-Za-z\s]{2,60})/i,
    examples: ['software engineer', 'teacher', 'student', 'designer'],
    templates: [
      "What do you do for work or study?",
      "What's your occupation or main focus these days?"
    ]
  },
  {
    key: 'favorite_music',
    label: 'favorite music',
    priority: 4,
    sensitivity: 'low',
    examples: ['rock', 'jazz', 'classical', 'pop', 'hip hop'],
    templates: [
      "Do you have a favorite music artist or genre?",
      "What kind of music do you usually listen to?"
    ]
  },
  {
    key: 'favorite_food',
    label: 'favorite food',
    priority: 4,
    sensitivity: 'low',
    examples: ['pizza', 'sushi', 'pasta', 'curry'],
    templates: [
      "What's your favorite food or dish?",
      "Is there a meal you always enjoy?"
    ]
  },
  {
    key: 'favorite_color',
    label: 'favorite color',
    priority: 2,
    sensitivity: 'low',
    examples: ['blue', 'green', 'red', 'purple', 'black'],
    templates: [
      "Do you have a favorite color?",
      "What color do you tend to like the most?"
    ]
  },
  {
    key: 'preferred_contact_time',
    label: 'preferred contact time',
    priority: 5,
    sensitivity: 'low',
    examples: ['morning', 'evening', 'afternoon'],
    templates: [
      "Is there a time of day that works best for you to chat?",
      "When are you usually available for a quick chat?"
    ]
  },
  {
    key: 'communication_style',
    label: 'communication style',
    priority: 3,
    sensitivity: 'low',
    examples: ['short', 'detailed', 'concise', 'verbose'],
    templates: [
      "Do you prefer short replies or more detailed explanations?",
      "Would you like shorter answers or longer, more detailed ones?"
    ]
  },
  {
    key: 'birthday',
    label: 'birthday',
    priority: 1,
    sensitivity: 'high',
    examples: ['1990-01-01', 'June 5', 'May'],
    templates: [
      "Would you like me to remember your birthday? (optional)",
      "If you're comfortable, when's your birthday?"
    ]
  }
];
