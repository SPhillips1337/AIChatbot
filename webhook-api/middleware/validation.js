/**
 * Request Validation Middleware
 * Provides common validation functions for API endpoints
 */

/**
 * Validates required fields in request body
 * @param {Array<string>} requiredFields - Array of required field names
 * @returns {Function} - Express middleware function
 */
function validateRequiredFields(requiredFields) {
  return (req, res, next) => {
    const missing = requiredFields.filter(field => {
      const value = req.body[field];
      return value === undefined || value === null || value === '';
    });

    if (missing.length > 0) {
      return res.status(400).json({
        error: 'Missing required fields',
        code: 'VALIDATION_ERROR',
        missing: missing
      });
    }

    next();
  };
}

/**
 * Validates request body against schema
 * @param {Object} schema - Validation schema
 * @returns {Function} - Express middleware function
 */
function validateSchema(schema) {
  return (req, res, next) => {
    const errors = [];

    for (const [field, rules] of Object.entries(schema)) {
      const value = req.body[field];

      // Check required fields
      if (rules.required && (value === undefined || value === null || value === '')) {
        errors.push(`${field} is required`);
        continue;
      }

      // Skip validation if field is not provided and not required
      if (value === undefined || value === null) {
        continue;
      }

      // Type validation
      if (rules.type && typeof value !== rules.type) {
        errors.push(`${field} must be of type ${rules.type}`);
        continue;
      }

      // String validations
      if (rules.type === 'string') {
        if (rules.minLength && value.length < rules.minLength) {
          errors.push(`${field} must be at least ${rules.minLength} characters long`);
        }
        if (rules.maxLength && value.length > rules.maxLength) {
          errors.push(`${field} must be no more than ${rules.maxLength} characters long`);
        }
        if (rules.pattern && !rules.pattern.test(value)) {
          errors.push(`${field} format is invalid`);
        }
      }

      // Number validations
      if (rules.type === 'number') {
        if (rules.min !== undefined && value < rules.min) {
          errors.push(`${field} must be at least ${rules.min}`);
        }
        if (rules.max !== undefined && value > rules.max) {
          errors.push(`${field} must be no more than ${rules.max}`);
        }
      }

      // Array validations
      if (rules.type === 'object' && Array.isArray(value)) {
        if (rules.minItems && value.length < rules.minItems) {
          errors.push(`${field} must have at least ${rules.minItems} items`);
        }
        if (rules.maxItems && value.length > rules.maxItems) {
          errors.push(`${field} must have no more than ${rules.maxItems} items`);
        }
      }

      // Custom validation function
      if (rules.validate && typeof rules.validate === 'function') {
        const customError = rules.validate(value);
        if (customError) {
          errors.push(`${field}: ${customError}`);
        }
      }
    }

    if (errors.length > 0) {
      return res.status(400).json({
        error: 'Validation failed',
        code: 'VALIDATION_ERROR',
        details: errors
      });
    }

    next();
  };
}

/**
 * Validates pagination parameters
 * @param {Object} options - Pagination options
 * @returns {Function} - Express middleware function
 */
function validatePagination(options = {}) {
  const { maxLimit = 100, defaultLimit = 20 } = options;

  return (req, res, next) => {
    let limit = parseInt(req.query.limit) || defaultLimit;
    let offset = parseInt(req.query.offset) || 0;

    if (limit < 1) limit = defaultLimit;
    if (limit > maxLimit) limit = maxLimit;
    if (offset < 0) offset = 0;

    req.pagination = { limit, offset };
    next();
  };
}

/**
 * Sanitizes input strings to prevent XSS
 * @param {Array<string>} fields - Fields to sanitize
 * @returns {Function} - Express middleware function
 */
function sanitizeInput(fields) {
  return (req, res, next) => {
    fields.forEach(field => {
      if (req.body[field] && typeof req.body[field] === 'string') {
        // Basic XSS prevention - remove script tags and javascript: protocols
        req.body[field] = req.body[field]
          .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
          .replace(/javascript:/gi, '')
          .replace(/on\w+\s*=/gi, '')
          .trim();
      }
    });
    next();
  };
}

/**
 * Rate limiting validation
 * @param {Object} options - Rate limiting options
 * @returns {Function} - Express middleware function
 */
function rateLimit(options = {}) {
  const { windowMs = 15 * 60 * 1000, maxRequests = 100 } = options;
  const requests = new Map();

  return (req, res, next) => {
    const key = req.ip || req.connection.remoteAddress;
    const now = Date.now();
    const windowStart = now - windowMs;

    // Clean old entries
    if (requests.has(key)) {
      const userRequests = requests.get(key).filter(time => time > windowStart);
      requests.set(key, userRequests);
    }

    const userRequests = requests.get(key) || [];
    
    if (userRequests.length >= maxRequests) {
      return res.status(429).json({
        error: 'Too many requests',
        code: 'RATE_LIMIT_EXCEEDED',
        retryAfter: Math.ceil(windowMs / 1000)
      });
    }

    userRequests.push(now);
    requests.set(key, userRequests);
    next();
  };
}

// Common validation schemas
const schemas = {
  chatMessage: {
    message: {
      required: true,
      type: 'string',
      minLength: 1,
      maxLength: 2000
    },
    userId: {
      required: true,
      type: 'string',
      minLength: 1
    }
  },

  userRegistration: {
    username: {
      required: true,
      type: 'string',
      minLength: 3,
      maxLength: 50,
      pattern: /^[a-zA-Z0-9_-]+$/
    },
    password: {
      required: true,
      type: 'string',
      minLength: 6,
      maxLength: 128
    }
  },

  factConfirmation: {
    key: {
      required: true,
      type: 'string',
      minLength: 1
    },
    value: {
      required: true,
      type: 'string',
      minLength: 1
    },
    confirmed: {
      required: true,
      type: 'boolean'
    }
  }
};

module.exports = {
  validateRequiredFields,
  validateSchema,
  validatePagination,
  sanitizeInput,
  rateLimit,
  schemas
};