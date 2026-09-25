const { audit } = require('./auditService');

/**
 * Route-level audit for simple mutations: records the action once the
 * response finishes successfully, with the (redacted) request body as the new
 * values and the route :id or created record's id as the entity.
 *
 * Used for lower-risk records (categories, suppliers, institutions, deliveries,
 * orders). Users, products, sales, stock and admin settings are audited inside
 * their handlers instead, with full before/after values.
 */
function auditRoute(action, entityType) {
  return (req, res, next) => {
    let body;
    const json = res.json.bind(res);
    res.json = (payload) => {
      body = payload;
      return json(payload);
    };
    res.on('finish', () => {
      if (res.statusCode >= 400) return;
      const created = body?.id ?? body?.payment?.id;
      audit(req, {
        action,
        entityType,
        entityId: req.params.id ?? created ?? null,
        newValues: req.method === 'DELETE' ? null : req.body,
        metadata: created && req.params.id ? { created_id: created } : undefined,
      }).catch(() => {});
    });
    next();
  };
}

module.exports = { auditRoute };
