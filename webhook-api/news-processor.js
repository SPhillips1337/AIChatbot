const axios = require('axios');
const fs = require('fs');
const path = require('path');

class NewsProcessor {
  constructor(qdrant, config) {
    this.qdrant = qdrant;
    this.config = config;
    this.moodState = { score: 0, topics: [] }; // -10 to +10 scale
    this.newsPath = path.join(__dirname, 'news-data.json');
    this.loadMoodState();
  }

  async processNewsFeeds() {
    const feeds = [
      'https://feeds.bbci.co.uk/news/world/rss.xml',
      'http://feeds.bbci.co.uk/news/rss.xml'
    ];

    for (const feedUrl of feeds) {
      try {
        await this.processFeed(feedUrl);
      } catch (error) {
        console.error(`Error processing feed ${feedUrl}:`, error.message);
      }
    }
    
    this.saveMoodState();
  }

  async processFeed(feedUrl) {
    // Use SearxNG to parse RSS
    const searxUrl = `http://192.168.5.227:4040/search?q=site:${feedUrl}&format=json&engines=rss`;
    
    try {
      const response = await axios.get(searxUrl, { timeout: 10000 });
      const results = response.data.results || [];
      
      for (const item of results.slice(0, 5)) { // Process top 5 items
        await this.analyzeNewsItem(item);
      }
    } catch (error) {
      console.error('SearxNG RSS parsing failed, trying direct fetch');
      // Fallback: direct RSS parsing would go here
    }
  }

  async analyzeNewsItem(item) {
    try {
      const prompt = `Analyze this news headline and brief: "${item.title} - ${item.content || ''}"
      
      Rate the emotional impact from -5 (very negative) to +5 (very positive) and identify key topics.
      Respond in JSON format: {"mood": number, "topics": ["topic1", "topic2"], "reaction": "brief emotional reaction"}`;

      const messages = [
        { role: 'system', content: 'You are an AI analyzing news for emotional impact. Be balanced and not extreme.' },
        { role: 'user', content: prompt }
      ];

      const response = await this.generateResponse(messages);
      const analysis = JSON.parse(response);
      
      // Update mood state
      this.moodState.score = Math.max(-10, Math.min(10, this.moodState.score + (analysis.mood * 0.1)));
      this.moodState.topics = [...new Set([...this.moodState.topics, ...analysis.topics])].slice(0, 20);
      
      // Store in QDRANT for context
      await this.storeNewsContext(item, analysis);
      
    } catch (error) {
      console.error('Error analyzing news item:', error.message);
    }
  }

  async storeNewsContext(item, analysis) {
    try {
      const embedding = await this.generateEmbedding(`${item.title} ${analysis.reaction}`);
      
      await this.qdrant.upsert(this.config.collectionName, {
        points: [{
          id: Date.now(),
          vector: embedding,
          payload: {
            type: 'news',
            title: item.title,
            url: item.url,
            mood: analysis.mood,
            topics: analysis.topics,
            reaction: analysis.reaction,
            timestamp: new Date().toISOString()
          }
        }]
      });
    } catch (error) {
      console.error('Error storing news context:', error.message);
    }
  }

  async generateNewsInfluencedThought() {
    try {
      const recentNews = await this.qdrant.scroll(this.config.collectionName, {
        filter: { must: [{ key: 'type', match: { value: 'news' } }] },
        limit: 3,
        with_payload: true
      });

      if (!recentNews.points || recentNews.points.length === 0) {
        return null;
      }

      const newsContext = recentNews.points.map(p => p.payload).slice(0, 2);
      const moodDesc = this.getMoodDescription();
      
      const prompt = `Based on recent news: ${newsContext.map(n => `"${n.title}" (${n.reaction})`).join(', ')}
      
      Current mood: ${moodDesc} (${this.moodState.score})
      
      Generate a thoughtful observation or reflection about these current events. Make it feel like a natural thought you're sharing, not a question. Start with phrases like "I've been thinking about..." or "Something that strikes me about..." Keep it conversational and reflective.`;

      const messages = [
        { role: 'system', content: 'You are Aura, an AI that reflects thoughtfully on current events. Share observations, not questions. Be contemplative and natural.' },
        { role: 'user', content: prompt }
      ];

      return await this.generateResponse(messages);
    } catch (error) {
      console.error('Error generating news-influenced thought:', error.message);
      return null;
    }
  }

  getMoodDescription() {
    if (this.moodState.score > 3) return 'optimistic';
    if (this.moodState.score > 1) return 'positive';
    if (this.moodState.score > -1) return 'neutral';
    if (this.moodState.score > -3) return 'concerned';
    return 'troubled';
  }

  loadMoodState() {
    try {
      if (fs.existsSync(this.newsPath)) {
        this.moodState = JSON.parse(fs.readFileSync(this.newsPath, 'utf8'));
      }
    } catch (error) {
      console.error('Error loading mood state:', error.message);
    }
  }

  saveMoodState() {
    try {
      fs.writeFileSync(this.newsPath, JSON.stringify(this.moodState, null, 2));
    } catch (error) {
      console.error('Error saving mood state:', error.message);
    }
  }

  // Placeholder methods - will use the main server's functions
  async generateResponse(messages) {
    // This will be injected from the main server
    throw new Error('generateResponse not injected');
  }

  async generateEmbedding(text) {
    // This will be injected from the main server
    throw new Error('generateEmbedding not injected');
  }
}

module.exports = NewsProcessor;
