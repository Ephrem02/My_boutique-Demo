const crypto = require('crypto');

// Gives every request an id (echoed in X-Request-Id) that links audit rows,
// notification events and server logs for the same request. A client-sent id
// is only reused if it's a short plain token, so it can't smuggle anything
// into logs.
const SAFE_ID = /^[A-Za-z0-9-]{8,64}$/;

function requestContext(req, res, next) {
  const incoming = req.get('X-Request-Id');
  req.requestId = incoming && SAFE_ID.test(incoming) ? incoming : crypto.randomUUID();
  res.setHeader('X-Request-Id', req.requestId);
  next();
}

module.exports = { requestContext };
