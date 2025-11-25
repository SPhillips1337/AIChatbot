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
    try {
      // Direct RSS fetch and parse
      const response = await axios.get(feedUrl, { timeout: 10000 });
      const xmlData = response.data;
      
      // Extract items using regex
      const itemRegex = /<item[^>]*>([\s\S]*?)<\/item>/g;
      let match;
      let itemCount = 0;
      
      while ((match = itemRegex.exec(xmlData)) !== null && itemCount < 5) {
        const itemXml = match[1];
        
        const title = this.extractXmlContent(itemXml, 'title');
        const description = this.extractXmlContent(itemXml, 'description');
        const link = this.extractXmlContent(itemXml, 'link');
        
        if (title && title.length > 5 && 
            !title.includes('hosting location') && 
            !title.includes('Wolfram|Alpha') &&
            !title.includes('bbci.co.uk') &&
            !title.toLowerCase().includes('hosting')) {
          const item = {
            title: title,
            content: description || '',
            url: link
          };
          
          console.log(`Processing news: ${title.substring(0, 50)}...`);
          await this.analyzeNewsItem(item);
          itemCount++;
        }
      }
    } catch (error) {
      console.error('RSS parsing failed:', error.message);
    }
  }

  extractXmlContent(xml, tagName) {
    // Handle CDATA and regular content
    const cdataRegex = new RegExp(`<${tagName}[^>]*><!\\[CDATA\\[([\\s\\S]*?)\\]\\]><\\/${tagName}>`, 'i');
    const regularRegex = new RegExp(`<${tagName}[^>]*>([\\s\\S]*?)<\\/${tagName}>`, 'i');
    
    let match = xml.match(cdataRegex);
    if (match) return match[1].trim();
    
    match = xml.match(regularRegex);
    if (match) return match[1].replace(/<[^>]*>/g, '').trim();
    
    return null;
  }

  async analyzeNewsItem(item) {
    try {
      const prompt = `Analyze this news headline and brief: "${item.title} - ${item.content || ''}"
      
      Rate the emotional impact from -5 (very negative) to +5 (very positive) and identify key topics.
      Respond ONLY with valid JSON: {"mood": -2, "topics": ["topic1", "topic2"], "reaction": "brief reaction"}`;

      const messages = [
        { role: 'system', content: 'You are an AI analyzing news for emotional impact. Respond only with valid JSON. Be balanced and not extreme.' },
        { role: 'user', content: prompt }
      ];

      const response = await this.generateResponse(messages);
      
      // Clean and parse JSON response
      let cleanResponse = response.replace(/```json|```/g, '').trim();
      if (!cleanResponse.startsWith('{')) {
        // Extract JSON from response if wrapped in text
        const jsonMatch = cleanResponse.match(/\{[\s\S]*\}/);
        cleanResponse = jsonMatch ? jsonMatch[0] : '{"mood": 0, "topics": ["General"], "reaction": "Unable to analyze"}';
      }
      
      const analysis = JSON.parse(cleanResponse);
      
      // Validate analysis structure
      if (typeof analysis.mood !== 'number') analysis.mood = 0;
      if (!Array.isArray(analysis.topics)) analysis.topics = ['General'];
      if (typeof analysis.reaction !== 'string') analysis.reaction = 'No reaction available';
      
      // Update mood state
      this.moodState.score = Math.max(-10, Math.min(10, this.moodState.score + (analysis.mood * 0.1)));
      this.moodState.topics = [...new Set([...this.moodState.topics, ...analysis.topics])].slice(0, 20);
      
      // Store in QDRANT for context
      await this.storeNewsContext(item, analysis);
      
    } catch (error) {
      console.error('Error analyzing news item:', error.message);
      // Store with default analysis if parsing fails
      const defaultAnalysis = { mood: 0, topics: ['General'], reaction: 'Analysis failed' };
      await this.storeNewsContext(item, defaultAnalysis);
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
          limit: 20,
          with_payload: true
        });

        if (!recentNews.points || recentNews.points.length === 0) {
          return null;
        }

        // Sort by payload.timestamp descending to use the most recent items first
        recentNews.points.sort((a, b) => {
          const ta = a.payload && a.payload.timestamp ? new Date(a.payload.timestamp).getTime() : 0;
          const tb = b.payload && b.payload.timestamp ? new Date(b.payload.timestamp).getTime() : 0;
          return tb - ta;
        });

        const newsContext = recentNews.points.map(p => p.payload).slice(0, 2);
        console.log('Selected recent news for thought:', newsContext.map(n => n.title.substring(0, 80)));
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
        try {
          this.moodState = JSON.parse(fs.readFileSync(this.newsPath, 'utf8'));
        } catch (err) {
          console.error('Failed to read primary news file, will try fallback:', err.message);
          const os = require('os');
          const fallbackPath = path.join(os.tmpdir(), 'news-data.json');
          if (fs.existsSync(fallbackPath)) {
            try {
              this.moodState = JSON.parse(fs.readFileSync(fallbackPath, 'utf8'));
              this.newsPath = fallbackPath;
              console.log('Loaded mood state from fallback:', fallbackPath);
            } catch (e) {
              console.error('Failed to read fallback mood file:', e.message);
            }
          }
        }
        if (this.moodState && Array.isArray(this.moodState.topics)) {
          // Clean up unwanted topics
          this.moodState.topics = this.moodState.topics.filter(topic => 
            !topic.includes('Wolfram') && 
            !topic.includes('hosting') && 
            !topic.includes('Location') &&
            !topic.includes('Amsterdam')
          );
        } else {
          this.moodState.topics = this.moodState.topics || [];
        }
      }
    } catch (error) {
      console.error('Error loading mood state:', error.message);
    }
  }

  saveMoodState() {
    try {
      fs.writeFileSync(this.newsPath, JSON.stringify(this.moodState, null, 2));
    } catch (error) {
      console.error('Error saving mood state to', this.newsPath, error.message);
      try {
        const os = require('os');
        const fallbackPath = path.join(os.tmpdir(), 'news-data.json');
        fs.writeFileSync(fallbackPath, JSON.stringify(this.moodState, null, 2));
        this.newsPath = fallbackPath;
        console.log('Saved mood state to fallback path:', fallbackPath);
      } catch (e) {
        console.error('Failed to save mood state to fallback path:', e.message);
      }
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
