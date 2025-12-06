const axios = require('axios');

class RSSSource {
    constructor() {
        this.name = 'RSS';
        this.feeds = [
            'https://feeds.bbci.co.uk/news/world/rss.xml',
            'http://feeds.bbci.co.uk/news/rss.xml'
        ];
    }

    async fetch() {
        const allItems = [];
        for (const feedUrl of this.feeds) {
            try {
                const items = await this.processFeed(feedUrl);
                allItems.push(...items);
            } catch (error) {
                console.error(`Error processing feed ${feedUrl}:`, error.message);
            }
        }
        return allItems;
    }

    async processFeed(feedUrl) {
        try {
            const response = await axios.get(feedUrl, { timeout: 10000 });
            const xmlData = response.data;

            const itemRegex = /<item[^>]*>([\s\S]*?)<\/item>/g;
            let match;
            const items = [];
            let count = 0;

            while ((match = itemRegex.exec(xmlData)) !== null && count < 10) {
                const itemXml = match[1];
                const title = this.extractXmlContent(itemXml, 'title');
                const description = this.extractXmlContent(itemXml, 'description');
                const link = this.extractXmlContent(itemXml, 'link');

                if (title && title.length > 5 && this.isValidTopic(title)) {
                    items.push({
                        title: title,
                        content: description || '',
                        url: link,
                        source: 'rss',
                        timestamp: new Date()
                    });
                    count++;
                }
            }
            return items;
        } catch (error) {
            console.error('RSS parsing failed:', error.message);
            return [];
        }
    }

    isValidTopic(title) {
        const lower = title.toLowerCase();
        return !lower.includes('hosting location') &&
            !lower.includes('wolfram|alpha') &&
            !lower.includes('bbci.co.uk') &&
            !lower.includes('hosting');
    }

    extractXmlContent(xml, tagName) {
        const cdataRegex = new RegExp(`<${tagName}[^>]*><!\\[CDATA\\[([\\s\\S]*?)\\]\\]><\\/${tagName}>`, 'i');
        const regularRegex = new RegExp(`<${tagName}[^>]*>([\\s\\S]*?)<\\/${tagName}>`, 'i');

        let match = xml.match(cdataRegex);
        if (match) return match[1].trim();

        match = xml.match(regularRegex);
        if (match) return match[1].replace(/<[^>]*>/g, '').trim();

        return null;
    }
}

module.exports = new RSSSource();
