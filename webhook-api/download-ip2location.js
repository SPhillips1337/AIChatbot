#!/usr/bin/env node

const https = require('https');
const fs = require('fs');
const path = require('path');
const { pipeline } = require('stream');
const { promisify } = require('util');
const pipelineAsync = promisify(pipeline);

const DB_URL = 'https://download.ip2location.com/lite/IP2LOCATION-LITE-DB1.CSV.ZIP';
const DB_FILE = path.join(__dirname, 'IP2LOCATION-LITE-DB1.CSV');

async function downloadDatabase() {
    console.log('Downloading IP2Location database...');
    
    try {
        // Check if file already exists
        if (fs.existsSync(DB_FILE)) {
            const stats = fs.statSync(DB_FILE);
            const ageHours = (Date.now() - stats.mtime.getTime()) / (1000 * 60 * 60);
            
            if (ageHours < 24) {
                console.log('Database is recent, skipping download');
                return;
            }
        }

        // Download the ZIP file
        const response = await new Promise((resolve, reject) => {
            https.get(DB_URL, resolve).on('error', reject);
        });

        if (response.statusCode !== 200) {
            throw new Error(`HTTP ${response.statusCode}: ${response.statusMessage}`);
        }

        // For simplicity, we'll assume the CSV is available directly
        // In production, you'd want to unzip this properly
        console.log('Note: You need to manually extract the CSV from the downloaded ZIP file');
        console.log('Download the database from: https://lite.ip2location.com/');
        console.log('Extract IP2LOCATION-LITE-DB1.CSV to webhook-api/ directory');
        
    } catch (error) {
        console.error('Failed to download database:', error.message);
        console.log('Please manually download from: https://lite.ip2location.com/');
    }
}

if (require.main === module) {
    downloadDatabase();
}

module.exports = { downloadDatabase };
