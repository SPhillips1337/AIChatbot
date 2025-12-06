require('dotenv').config();

console.log('--- Environment Debug ---');
console.log('Current Directory:', process.cwd());
console.log('Variables loaded:');
const keys = [
    'TWITTER_API_KEY',
    'TWITTER_API_SECRET',
    'TWITTER_ACCESS_TOKEN',
    'PERPLEXICA_URL',
    'SEARXNG_URL',
    'GOOGLE_TRENDS_API_KEY',
    'X_CLIENT_ID',
    'X_CLIENT_SECRET',
    'X_REDIRECT_URI'
];

keys.forEach(k => {
    if (process.env[k]) {
        const val = process.env[k];
        const masked = val.length > 5 ? val.substring(0, 5) + '...' : '***';
        console.log(`${k}: [FOUND] (${masked})`);
    } else {
        console.log(`${k}: [MISSING]`);
    }
});
console.log('-------------------------');
