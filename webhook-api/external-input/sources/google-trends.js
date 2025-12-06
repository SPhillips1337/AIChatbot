const googleTrends = require('google-trends-api');

class GoogleTrendsSource {
    constructor() {
        this.name = 'GoogleTrends';
    }

    async fetch() {
        try {
            // Fetch daily trends for US (default)
            const results = await googleTrends.dailyTrends({
                geo: 'US',
            });

            if (results.trim().startsWith('<')) {
                console.warn('Google Trends returned HTML (likely rate limited/blocked). Skipping.');
                return [];
            }

            const parsed = JSON.parse(results);
            const days = parsed.default.trendingSearchesDays;

            if (!days || days.length === 0) return [];

            // Get top trends from the most recent day
            const trends = days[0].trendingSearches.slice(0, 10);

            return trends.map(t => ({
                title: t.title.query,
                content: `${t.formattedTraffic} searches. ${t.articles[0] ? t.articles[0].title : ''}`,
                url: t.articles[0] ? t.articles[0].url : '',
                source: 'google-trends',
                timestamp: new Date()
            }));

        } catch (error) {
            console.error('Error fetching/parsing Google Trends:', error.message);
            return [];
        }
    }
}

module.exports = new GoogleTrendsSource();
