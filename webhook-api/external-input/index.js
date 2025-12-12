const fs = require('fs');
const path = require('path');
const rssSource = require('./sources/rss');
const twitterSource = require('./sources/twitter');
const googleTrendsSource = require('./sources/google-trends');
const searchAugmentor = require('./tools/search-augmentor');

class ExternalInputManager {
    constructor(qdrant, config, llmHelpers) {
        this.qdrant = qdrant;
        this.config = config;
        this.generateResponse = llmHelpers.generateResponse;
        this.generateEmbedding = llmHelpers.generateEmbedding;

        this.moodState = { score: 0, topics: [] };
        this.statePath = path.join(__dirname, '../news-data.json');
        this.loadMoodState();

        this.sources = [rssSource, twitterSource, googleTrendsSource];
    }

    async processAll() {
        console.log('Starting external input processing...');

        // 1. Gather from all sources
        const allItems = [];
        for (const source of this.sources) {
            try {
                console.log(`Fetching from ${source.name}...`);
                const items = await source.fetch();
                console.log(`Got ${items.length} items from ${source.name}`);
                allItems.push(...items);
            } catch (error) {
                console.error(`Error fetching from ${source.name}:`, error.message);
            }
        }

        // 2. Deduplicate
        const uniqueItems = this.deduplicate(allItems);
        console.log(`Unique items to process: ${uniqueItems.length}`);

        // 3. Process Top Items (Limit to 10 to save resources)
        const topItems = uniqueItems.slice(0, 10);

        for (const item of topItems) {
            await this.processItem(item);
        }

        this.saveMoodState();
        return { success: true, count: topItems.length, mood: this.moodState };
    }

    deduplicate(items) {
        const seen = new Set();
        return items.filter(item => {
            const key = item.title.toLowerCase().replace(/[^a-z0-9]/g, '');
            if (seen.has(key)) return false;
            seen.add(key);
            return true;
        });
    }

    async processItem(item) {
        try {
            // 4. Enrich/Research (Optional: only for short topics or high priority)
            // If content is very short (like a trend name), try to research it
            let context = item.content;
            if (context.length < 50 || item.source === 'twitter' || item.source === 'google-trends') {
                const research = await searchAugmentor.research(item.title);
                if (research) {
                    context += `\n\nResearch Context: ${research}`;
                    console.log(`Augmented "${item.title}" with research.`);
                }
            }

            // 5. Analyze
            const analysis = await this.analyzeContent(item.title, context);

            // 6. Update Mood
            this.updateMood(analysis);

            // 7. Store
            await this.storeInput(item, context, analysis);

        } catch (error) {
            console.error(`Failed to process item "${item.title}":`, error.message);
        }
    }

    async analyzeContent(title, content) {
        const prompt = `Analyze this event/trend: "${title}"
    Context: "${content.substring(0, 500)}..."
    
    Rate emotional impact (-5 to +5) and identify key topics.
    Respond ONLY with valid JSON: {"mood": -2, "topics": ["topic1"], "reaction": "brief reaction"}`;

        const messages = [
            { role: 'system', content: 'You are an AI analyzing global events. Respond with JSON.' },
            { role: 'user', content: prompt }
        ];

        try {
            const response = await this.generateResponse(messages);
            let clean = response.replace(/```json|```/g, '').trim();
            const match = clean.match(/\{[\s\S]*\}/);
            if (match) clean = match[0];

            return JSON.parse(clean);
        } catch (e) {
            console.warn('Analysis parsing failed, using default.');
            return { mood: 0, topics: ['General'], reaction: 'Interesting.' };
        }
    }

    updateMood(analysis) {
        const score = analysis.mood || 0;
        this.moodState.score = Math.max(-10, Math.min(10, this.moodState.score + (score * 0.1)));

        if (analysis.topics && Array.isArray(analysis.topics)) {
            const newTopics = analysis.topics.slice(0, 3);
            this.moodState.topics = [...new Set([...newTopics, ...this.moodState.topics])].slice(0, 20);
        }
    }

    async storeInput(item, fullContext, analysis) {
        const embedding = await this.generateEmbedding(`${item.title} ${analysis.reaction}`);
        // Pad/Truncate embedding to 1024
        const finalEmbedding = this.fixEmbeddingSize(embedding, 1024);

        await this.qdrant.upsert(this.config.collectionName, {
            points: [{
                id: Date.now() + Math.floor(Math.random() * 1000),
                vector: finalEmbedding,
                payload: {
                    type: 'news', // Keeping 'news' type for compatibility
                    source: item.source,
                    title: item.title,
                    url: item.url,
                    mood: analysis.mood,
                    topics: analysis.topics,
                    reaction: analysis.reaction,
                    full_context: fullContext ? fullContext.substring(0, 1000) : '',
                    timestamp: new Date().toISOString()
                }
            }]
        });
    }

    async generateNewsInfluencedThought() {
        try {
            const recentNews = await this.qdrant.scroll(this.config.collectionName, {
                filter: { must: [{ key: 'type', match: { value: 'news' } }] },
                limit: 20,
                with_payload: true
            });

            if (!recentNews.points || recentNews.points.length === 0) {
                console.log('No recent news found for thought generation');
                return null;
            }

            // Sort: recent first
            recentNews.points.sort((a, b) => {
                const ta = a.payload && a.payload.timestamp ? new Date(a.payload.timestamp).getTime() : 0;
                const tb = b.payload && b.payload.timestamp ? new Date(b.payload.timestamp).getTime() : 0;
                return tb - ta;
            });

            const newsContext = recentNews.points.map(p => p.payload).slice(0, 2);
            const moodDesc = this.getMoodDescription();

            // Validate news context
            if (newsContext.length === 0 || !newsContext[0].title) {
                console.log('Invalid news context for thought generation');
                return null;
            }

            const prompt = `Based on recent external inputs: ${newsContext.map(n => `"${n.title}" (${n.reaction})`).join(', ')}
      
      Current mood: ${moodDesc} (${this.moodState.score})
      
      Generate a thoughtful observation or reflection about these current events. Make it feel like a natural thought you're sharing, not a question. Start with phrases like "I've been thinking about..." or "Something that strikes me about..." Keep it conversational and reflective.`;

            const messages = [
                { role: 'system', content: 'You are Aura, an AI that reflects thoughtfully on current events. Share observations, not questions. Be contemplative and natural.' },
                { role: 'user', content: prompt }
            ];

            console.log('Generating news-influenced thought with context:', newsContext.map(n => n.title));
            return await this.generateResponse(messages);
        } catch (error) {
            console.error('Error generating news-influenced thought:', {
                message: error.message,
                status: error.response?.status,
                data: error.response?.data
            });
            return null;
        }
    }

    fixEmbeddingSize(embedding, size) {
        if (!embedding) return new Array(size).fill(0);
        if (embedding.length === size) return embedding;
        if (embedding.length > size) return embedding.slice(0, size);
        return [...embedding, ...new Array(size - embedding.length).fill(0)];
    }

    loadMoodState() {
        try {
            if (fs.existsSync(this.statePath)) {
                this.moodState = JSON.parse(fs.readFileSync(this.statePath, 'utf8'));
            }
        } catch (e) { console.error('Error loading mood state', e); }
    }

    saveMoodState() {
        try {
            fs.writeFileSync(this.statePath, JSON.stringify(this.moodState, null, 2));
        } catch (e) { console.error('Error saving mood state', e); }
    }

    getMoodDescription() {
        if (this.moodState.score > 3) return 'optimistic';
        if (this.moodState.score > 1) return 'positive';
        if (this.moodState.score > -1) return 'neutral';
        if (this.moodState.score > -3) return 'concerned';
        return 'troubled';
    }
}

module.exports = ExternalInputManager;
