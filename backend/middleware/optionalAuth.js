const jwt = require('jsonwebtoken');

const JWT_SECRET = process.env.JWT_SECRET;

function extractToken(req) {
  const headerToken = req.header('x-auth-token');
  if (headerToken) return headerToken;

  const authHeader = req.header('authorization') || req.header('Authorization');
  if (!authHeader) return null;
  const match = String(authHeader).match(/^Bearer\s+(.+)$/i);
  return match ? match[1] : null;
}

module.exports = function optionalAuth(req, _res, next) {
  const token = extractToken(req);
  if (!token) return next();

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    req.user = decoded.user;
  } catch (err) {
    // Optional auth: ignore invalid/expired tokens and treat as guest.
    req.user = undefined;
  }

  return next();
};

