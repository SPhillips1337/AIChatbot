const axios = require('axios');

class SearchAugmentor {
    constructor() {
        this.perplexicaUrl = process.env.PERPLEXICA_URL;
        this.searxngUrl = process.env.SEARXNG_URL;
    }

    async research(query) {
        if (this.perplexicaUrl) {
            return this.researchWithPerplexica(query);
        } else if (this.searxngUrl) {
            return this.researchWithSearxNG(query);
        }
        return null;
    }

    async researchWithPerplexica(query) {
        try {
            console.log(`Researching "${query}" via Perplexica...`);
            // Assuming Perplexica exposes an API. Common endpoint might be /api/search or similar.
            // Adjusting to a likely payload.
            const response = await axios.post(`${this.perplexicaUrl}/api/search`, {
                query: query,
                mode: 'copilot', // or 'routine'
            }, { timeout: 30000 });

            // Perplexica response structure varies, assuming it returns an answer or sources
            if (response.data && response.data.message) {
                return response.data.message;
            }
            return null;
        } catch (error) {
            console.error('Perplexica research failed, falling back:', error.message);
            // Fallback to SearxNG if available
            if (this.searxngUrl) return this.researchWithSearxNG(query);
            return null;
        }
    }

    async researchWithSearxNG(query) {
        try {
            console.log(`Researching "${query}" via SearxNG...`);
            const response = await axios.get(`${this.searxngUrl}/search`, {
                params: {
                    q: query,
                    format: 'json',
                    language: 'en'
                },
                timeout: 10000
            });

            if (response.data && response.data.results && response.data.results.length > 0) {
                // Synthesize a summary from top 3 results
                const topResults = response.data.results.slice(0, 3);
                const summary = topResults.map(r => `Source: ${r.title}\n${r.content}`).join('\n\n');
                return summary;
            }
            return null;
        } catch (error) {
            console.error('SearxNG research failed:', error.message);
            return null;
        }
    }
}

module.exports = new SearchAugmentor();
