const config = require('../config');

/**
 * Error Handling Middleware
 * Provides centralized error handling and logging
 */

/**
 * Application Error class for structured error handling
 */
class AppError extends Error {
  constructor(message, statusCode = 500, code = 'INTERNAL_ERROR', details = null) {
    super(message);
    this.statusCode = statusCode;
    this.code = code;
    this.details = details;
    this.isOperational = true;
    
    Error.captureStackTrace(this, this.constructor);
  }
}

/**
 * Async error wrapper to catch async errors in route handlers
 * @param {Function} fn - Async function to wrap
 * @returns {Function} - Wrapped function
 */
function asyncHandler(fn) {
  return (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}

/**
 * 404 Not Found handler
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @param {Function} next - Express next function
 */
function notFoundHandler(req, res, next) {
  const error = new AppError(
    `Route ${req.originalUrl} not found`,
    404,
    'ROUTE_NOT_FOUND'
  );
  next(error);
}

/**
 * Global error handler middleware
 * @param {Error} err - Error object
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @param {Function} next - Express next function
 */
function globalErrorHandler(err, req, res, next) {
  // Log error details
  logError(err, req);

  // Handle different error types
  let error = { ...err };
  error.message = err.message;

  // Mongoose validation error
  if (err.name === 'ValidationError') {
    const message = Object.values(err.errors).map(val => val.message).join(', ');
    error = new AppError(message, 400, 'VALIDATION_ERROR');
  }

  // Mongoose duplicate key error
  if (err.code === 11000) {
    const field = Object.keys(err.keyValue)[0];
    const message = `Duplicate value for field: ${field}`;
    error = new AppError(message, 400, 'DUPLICATE_ERROR');
  }

  // JWT errors
  if (err.name === 'JsonWebTokenError') {
    error = new AppError('Invalid token', 401, 'INVALID_TOKEN');
  }

  if (err.name === 'TokenExpiredError') {
    error = new AppError('Token expired', 401, 'TOKEN_EXPIRED');
  }

  // Axios errors (external API calls)
  if (err.isAxiosError) {
    const message = err.response?.data?.message || 'External service error';
    const statusCode = err.response?.status || 502;
    error = new AppError(message, statusCode, 'EXTERNAL_SERVICE_ERROR');
  }

  // Default to 500 server error
  if (!error.statusCode) {
    error.statusCode = 500;
    error.code = 'INTERNAL_ERROR';
  }

  // Send error response
  const response = {
    error: error.message,
    code: error.code,
    timestamp: new Date().toISOString()
  };

  // Include additional details in development
  if (config.isDevelopment()) {
    response.stack = error.stack;
    response.details = error.details;
  }

  // Include request ID if available
  if (req.requestId) {
    response.requestId = req.requestId;
  }

  res.status(error.statusCode).json(response);
}

/**
 * Log error details
 * @param {Error} err - Error object
 * @param {Object} req - Express request object
 */
function logError(err, req) {
  const errorInfo = {
    timestamp: new Date().toISOString(),
    method: req.method,
    url: req.originalUrl,
    ip: req.ip,
    userAgent: req.get('User-Agent'),
    userId: req.account?.userId,
    error: {
      name: err.name,
      message: err.message,
      code: err.code,
      statusCode: err.statusCode,
      stack: err.stack
    }
  };

  if (config.isDevelopment()) {
    console.error('Error Details:', JSON.stringify(errorInfo, null, 2));
  } else {
    console.error('Error:', err.message, {
      code: err.code,
      statusCode: err.statusCode,
      url: req.originalUrl,
      userId: req.account?.userId
    });
  }

  // In production, you might want to send this to a logging service
  // like Winston, Sentry, or CloudWatch
}

/**
 * Handle unhandled promise rejections
 */
process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Rejection at:', promise, 'reason:', reason);
  // In production, you might want to gracefully shut down
  if (config.isProduction()) {
    process.exit(1);
  }
});

/**
 * Handle uncaught exceptions
 */
process.on('uncaughtException', (err) => {
  console.error('Uncaught Exception:', err);
  // In production, you should gracefully shut down
  if (config.isProduction()) {
    process.exit(1);
  }
});

module.exports = {
  AppError,
  asyncHandler,
  notFoundHandler,
  globalErrorHandler,
  logError
};