#!/usr/bin/env node

// Simple cron-style news processor
// Usage: node news-cron.js

const axios = require('axios');

async function triggerNewsUpdate() {
  try {
    console.log('Triggering news update...');
    
    // Call the news processing endpoint (we'll add this)
    const response = await axios.post('http://localhost:3000/api/process-news');
    console.log('News processing result:', response.data);
    
  } catch (error) {
    console.error('Error triggering news update:', error.message);
  }
}

// Run immediately
triggerNewsUpdate();
