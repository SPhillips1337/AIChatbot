const rateLimits = new Map();

// Cleanup expired entries every 5 minutes
setInterval(() => {
  const now = Date.now();
  for (const [key, limit] of rateLimits.entries()) {
    if (now > limit.resetTime) {
      rateLimits.delete(key);
    }
  }
}, 5 * 60 * 1000);

function rateLimit(maxRequests = 30, windowMs = 60000) {
  return (req, res, next) => {
    const key = req.headers['x-user-id'] || req.ip;
    const now = Date.now();
    
    if (!rateLimits.has(key)) {
      rateLimits.set(key, { count: 1, resetTime: now + windowMs });
      return next();
    }
    
    const limit = rateLimits.get(key);
    if (now > limit.resetTime) {
      limit.count = 1;
      limit.resetTime = now + windowMs;
      return next();
    }
    
    if (limit.count >= maxRequests) {
      return res.status(429).json({ error: 'Rate limit exceeded' });
    }
    
    limit.count++;
    next();
  };
}

module.exports = rateLimit;
