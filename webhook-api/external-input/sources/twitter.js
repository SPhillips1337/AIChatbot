const { TwitterApi } = require('twitter-api-v2');
const fs = require('fs');
const path = require('path');

const TOKENS_PATH = path.join(__dirname, '../twitter-tokens.json');

class TwitterSource {
    constructor() {
        this.name = 'Twitter';
    }

    async fetch() {
        let client;

        // 1. Try to load OAuth2 tokens
        if (fs.existsSync(TOKENS_PATH)) {
            try {
                const tokens = JSON.parse(fs.readFileSync(TOKENS_PATH, 'utf8'));

                // Initialize client with credentials + tokens
                const clientId = process.env.X_CLIENT_ID || process.env.TWITTER_CLIENT_ID || process.env.TWITTER_API_KEY;
                const clientSecret = process.env.X_CLIENT_SECRET || process.env.TWITTER_CLIENT_SECRET || process.env.TWITTER_API_SECRET;

                if (!clientId || !clientSecret) {
                    console.error('Twitter OAuth2 tokens found but Client ID/Secret missing in .env');
                    return [];
                }

                const authClient = new TwitterApi({ clientId, clientSecret });

                // Check if we need to refresh (simple check: if obtain time + expires < now)
                // Adding a 5-minute buffer
                const now = Date.now();
                const expiresAt = (tokens.obtainedAt || 0) + (tokens.expiresIn * 1000);

                if (now > expiresAt - 300000) {
                    console.log('Refreshing Twitter OAuth2 token...');
                    const { accessToken, refreshToken, expiresIn } = await authClient.refreshOAuth2Token(tokens.refreshToken);

                    // Save new tokens
                    const newTokens = {
                        accessToken,
                        refreshToken,
                        expiresIn,
                        obtainedAt: Date.now()
                    };
                    fs.writeFileSync(TOKENS_PATH, JSON.stringify(newTokens, null, 2));
                    client = new TwitterApi(accessToken);
                } else {
                    client = new TwitterApi(tokens.accessToken);
                }

            } catch (e) {
                console.error('Error loading/refreshing Twitter tokens:', e.message);
                // Fallthrough means client is null, try standard API Key method below
            }
        }

        // 2. Fallback to Standard API Key (App Context) if no OAuth2 client
        if (!client) {
            if (!process.env.TWITTER_API_KEY || !process.env.TWITTER_API_SECRET) {
                console.log('Twitter API keys missing and no OAuth2 tokens found.');
                return [];
            }
            // Note: This often fails for Trends on free tiers (403 Forbidden)
            client = new TwitterApi({
                appKey: process.env.TWITTER_API_KEY,
                appSecret: process.env.TWITTER_API_SECRET,
                accessToken: process.env.TWITTER_ACCESS_TOKEN,
                accessSecret: process.env.TWITTER_ACCESS_SECRET,
            });
        }

        try {
            // Fetch stats for debugging
            // const me = await client.v2.me();
            // console.log(`Twitter authenticated as @${me.data.username}`);

            // WOEID 1 is World. 23424977 is US.
            // v1.1 Trends endpoint (usually requires elevated access, but OAuth2 user context might allow it)
            const trends = await client.v1.trendsByPlace(1);

            if (!trends || !trends[0] || !trends[0].trends) {
                return [];
            }

            return trends[0].trends.slice(0, 10).map(t => ({
                title: t.name,
                content: `Trending on Twitter with ${t.tweet_volume || 'unknown'} tweets`,
                url: t.url,
                source: 'twitter',
                timestamp: new Date()
            }));

        } catch (error) {
            console.error('Error fetching Twitter trends:', error.message);
            if (error.code === 403) {
                console.error('NOTE: 403 Forbidden suggests API Access Level or Auth Type is insufficient for Trends.');
            }
            return [];
        }
    }
}

module.exports = new TwitterSource();
