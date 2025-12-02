const WebSocket = require('../webhook-api/node_modules/ws');
const url = 'ws://localhost:3000';
const userId = '2351d788-4fb9-4dcf-88a1-56f63e06f649';
const token = 'acec47b2f1f40b4c3126496c196bc6d9c120be5fce531493';

console.log('Connecting to', url);
const ws = new WebSocket(url);

ws.on('open', () => {
  console.log('open');
  ws.send(JSON.stringify({ type: 'auth', userId, token }));
  // don't send keepalives, just observe
});

ws.on('message', (data) => {
  try {
    const d = JSON.parse(data.toString());
    console.log('recv:', JSON.stringify(d));
  } catch (e) {
    console.log('recv (non-json):', data.toString());
  }
});

ws.on('close', () => console.log('closed'));
ws.on('error', (err) => console.error('err', err));

// Keep process alive
setTimeout(() => {
  console.log('done');
  process.exit(0);
}, 1000 * 60 * 10); // 10 minutes
