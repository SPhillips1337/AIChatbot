const fs = require('fs');
const path = require('path');

class CountryBlocker {
    constructor() {
        // Load blocked countries from environment or use defaults
        const blockedList = process.env.BLOCKED_COUNTRIES || 'RU,KP,NG,CN,IR,SY,AF,MM,BY';
        this.blockedCountries = new Set(blockedList.split(',').map(c => c.trim()));
        
        this.ipRanges = [];
        this.loadDatabase();
        
        console.log(`Country blocker initialized. Blocked countries: ${Array.from(this.blockedCountries).join(', ')}`);
    }

    loadDatabase() {
        try {
            const dbPath = path.join(__dirname, 'IP2LOCATION-LITE-DB1.CSV');
            if (!fs.existsSync(dbPath)) {
                console.warn('IP2Location database not found. Country blocking disabled.');
                return;
            }

            const data = fs.readFileSync(dbPath, 'utf8');
            const lines = data.split('\n');
            
            for (const line of lines) {
                if (!line.trim()) continue;
                const parts = line.split(',').map(p => p.replace(/"/g, ''));
                if (parts.length >= 4) {
                    this.ipRanges.push({
                        start: parseInt(parts[0]),
                        end: parseInt(parts[1]),
                        country: parts[2]
                    });
                }
            }
            console.log(`Loaded ${this.ipRanges.length} IP ranges for country blocking`);
        } catch (error) {
            console.error('Failed to load IP2Location database:', error.message);
        }
    }

    ipToNumber(ip) {
        return ip.split('.').reduce((acc, octet) => (acc << 8) + parseInt(octet), 0) >>> 0;
    }

    getCountryCode(ip) {
        if (this.ipRanges.length === 0) return null;
        
        const ipNum = this.ipToNumber(ip);
        
        // Binary search for efficiency
        let left = 0;
        let right = this.ipRanges.length - 1;
        
        while (left <= right) {
            const mid = Math.floor((left + right) / 2);
            const range = this.ipRanges[mid];
            
            if (ipNum >= range.start && ipNum <= range.end) {
                return range.country;
            } else if (ipNum < range.start) {
                right = mid - 1;
            } else {
                left = mid + 1;
            }
        }
        
        return null;
    }

    isBlocked(ip) {
        if (ip === '127.0.0.1' || ip === '::1' || ip.startsWith('192.168.') || ip.startsWith('10.')) {
            return false; // Allow local IPs
        }

        const country = this.getCountryCode(ip);
        return country && this.blockedCountries.has(country);
    }

    middleware() {
        return (req, res, next) => {
            const clientIP = req.headers['x-forwarded-for']?.split(',')[0] || 
                           req.headers['x-real-ip'] || 
                           req.connection.remoteAddress || 
                           req.socket.remoteAddress;

            if (this.isBlocked(clientIP)) {
                const country = this.getCountryCode(clientIP);
                console.log(`Blocked access from ${clientIP} (${country})`);
                return res.status(403).json({
                    error: 'Access denied',
                    message: 'Service not available in your region'
                });
            }

            next();
        };
    }
}

module.exports = new CountryBlocker();
