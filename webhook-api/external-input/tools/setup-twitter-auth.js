const { TwitterApi } = require('twitter-api-v2');
const fs = require('fs');
const path = require('path');
const readline = require('readline');
require('dotenv').config({ path: path.join(__dirname, '../../.env') });

const TOKENS_PATH = path.join(__dirname, '../twitter-tokens.json');
const REDIRECT_URI = process.env.X_REDIRECT_URI || 'http://localhost';

async function main() {
    // Check for X_ prefixed variables first (user preference), then fallback to standard
    const clientId = process.env.X_CLIENT_ID || process.env.TWITTER_CLIENT_ID || process.env.TWITTER_API_KEY;
    const clientSecret = process.env.X_CLIENT_SECRET || process.env.TWITTER_CLIENT_SECRET || process.env.TWITTER_API_SECRET;

    if (!clientId || !clientSecret) {
        console.error('Error: Missing X_CLIENT_ID/X_CLIENT_SECRET (or TWITTER_*) in .env');
        process.exit(1);
    }

    console.log('\n--- Debug Config ---');
    console.log(`Client ID: ${clientId} (First 4 chars: ${clientId.substring(0, 4)}...)`);
    console.log(`Redirect URI: '${REDIRECT_URI}'`);
    console.log('--------------------');

    const client = new TwitterApi({ clientId, clientSecret });

    // Generate the auth link
    const { url, codeVerifier, state } = client.generateOAuth2AuthLink(
        REDIRECT_URI,
        { scope: ['tweet.read', 'users.read', 'offline.access', 'list.read'] }
    );

    console.log('\n--- Twitter OAuth2 Setup ---');
    console.log(`Using Client ID: ${clientId.substring(0, 4)}...`);
    console.log(`Using Redirect URI: ${REDIRECT_URI}`);
    console.log('\n1. Open this URL in your browser:');
    console.log('\n' + url + '\n');
    console.log('2. Authorize the app.');
    console.log(`3. You will be redirected to ${REDIRECT_URI}/?state=...&code=...`);
    console.log('4. Copy the "code" parameter value from the URL bar (everything after code= and before & or end of line).');
    console.log('   Do not copy the state parameter.');

    const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout
    });

    rl.question('\nPaste the code here: ', async (code) => {
        rl.close();
        try {
            console.log('Exchanging code for tokens...');
            const { client: loggedClient, accessToken, refreshToken, expiresIn } = await client.loginWithOAuth2({
                code: code.trim(),
                codeVerifier,
                redirectUri: REDIRECT_URI,
            });

            const tokens = {
                accessToken,
                refreshToken,
                expiresIn,
                obtainedAt: Date.now()
            };

            fs.writeFileSync(TOKENS_PATH, JSON.stringify(tokens, null, 2));
            console.log(`\nSuccess! Tokens saved to ${TOKENS_PATH}`);
            console.log('You can now restart the server to enable Twitter trends.');

        } catch (e) {
            console.error('\nError exchanging code:', e.message);
            if (e.data) console.error('Details:', e.data);
        }
    });
}

main();
