// The last stop for an error. A client's mistake (status below 500: a body that is not JSON or is too large, a refused origin)
// gets ONE log line without the error's message: for a body that could not be parsed, V8's message quotes the start of the
// body, and on the sign-in, reset and password routes that can be a password. Only real server errors log their stack.
function createErrorHandler({ logger = console, production = () => process.env.NODE_ENV === 'production' } = {}) {
  // Express knows an error handler by its four parameters, so `next` stays although it is not called.
  return (err, req, res, next) => {
    const status = Number(err.status || err.statusCode) || 500;
    if (status >= 400 && status < 500) {
      const path = String(req.originalUrl || req.url || '').split('?')[0];
      logger.warn(`${req.method} ${path} → ${status}${err.type ? ` (${err.type})` : ''}${err.publicMessage ? `: ${err.publicMessage}` : ''}`);
      return res.status(status).json({
        error: err.publicMessage || (production() ? 'That request could not be read.' : err.message),
      });
    }
    logger.error(err.stack);
    return res.status(status).json({
      error: err.publicMessage || (production() ? 'Internal server error' : err.message),
    });
  };
}

module.exports = { createErrorHandler };
