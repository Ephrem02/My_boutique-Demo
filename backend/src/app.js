const path = require('path');
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const cookieParser = require('cookie-parser');
const rateLimit = require('express-rate-limit');

const { AppError } = require('./utils/AppError');
const { reportError } = require('./utils/errorReporter');
const { requestContext } = require('./middleware/requestContext');
const authRoutes = require('./routes/authRoutes');
const stockRoutes = require('./routes/stockRoutes');
const categoryRoutes = require('./routes/categoryRoutes');
const productRoutes = require('./routes/productRoutes');
const supplierRoutes = require('./routes/supplierRoutes');
const supplierDeliveryRoutes = require('./routes/supplierDeliveryRoutes');
const salesRoutes = require('./routes/salesRoutes');
const returnRoutes = require('./routes/returnRoutes');
const institutionRoutes = require('./routes/institutionRoutes');
const institutionOrderRoutes = require('./routes/institutionOrderRoutes');
const reportsRoutes = require('./routes/reportsRoutes');
const uploadRoutes = require('./routes/uploadRoutes');
const notificationRoutes = require('./routes/notificationRoutes');
const adminRoutes = require('./routes/adminRoutes');

const app = express();

// Behind a reverse proxy (nginx, a load balancer), set TRUST_PROXY to the
// number of proxy hops (usually 1) so req.ip is the real client address -
// audit logs and IP rate limits depend on it. Unset = direct connections.
const trustProxy = process.env.TRUST_PROXY;
if (trustProxy) app.set('trust proxy', /^d+$/.test(trustProxy) ? Number(trustProxy) : trustProxy);

const allowedOrigins = (process.env.CORS_ORIGINS || '').split(',').map((s) => s.trim()).filter(Boolean);
if (!allowedOrigins.length) {
  console.warn('CORS_ORIGINS is not set - no origin will be allowed to call this API with credentials.');
}

// crossOriginResourcePolicy relaxed so uploaded product photos can be loaded
// from the frontend's own origin (different port in dev, different host in prod)
app.use(requestContext);
app.use(helmet({ crossOriginResourcePolicy: { policy: 'cross-origin' } }));
// credentials:true is required so the browser sends the auth cookie; that
// only ever pairs with an explicit origin allowlist, never a wildcard.
app.use(cors({ origin: allowedOrigins, credentials: true }));
if (process.env.NODE_ENV !== 'test') app.use(morgan('dev'));
app.use(express.json());
app.use(cookieParser());
app.use('/uploads', express.static(path.join(__dirname, '..', 'uploads')));

// General ceiling on API traffic; auth gets a much tighter limit below.
const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: Number(process.env.API_RATE_LIMIT) || 300,
  standardHeaders: true,
  legacyHeaders: false,
});
app.use('/api', apiLimiter);

app.get('/health', (req, res) => res.json({ status: 'ok' }));

app.use('/api/uploads', uploadRoutes);
app.use('/api/auth', authRoutes);
app.use('/api/stock', stockRoutes);
app.use('/api/categories', categoryRoutes);
app.use('/api/products', productRoutes);
app.use('/api/suppliers', supplierRoutes);
app.use('/api/supplier-deliveries', supplierDeliveryRoutes);
app.use('/api/sales', salesRoutes);
app.use('/api/returns', returnRoutes);
app.use('/api/institutions', institutionRoutes);
app.use('/api/institution-orders', institutionOrderRoutes);
app.use('/api/reports', reportsRoutes);
app.use('/api/notifications', notificationRoutes);
app.use('/api/admin', adminRoutes);

// Fallback error handler - only an AppError's own message ever reaches the
// client; anything else (a DB error, a bug) is logged here and replaced with
// a generic message, so no stack trace or raw exception text leaks out.
app.use((err, req, res, next) => {
  if (err instanceof AppError) {
    return res.status(err.status).json({ error: err.message });
  }
  // Malformed ids/dates in the URL (e.g. /api/sales/abc) are client errors
  if (err.code === '22P02' || err.code === '22007' || err.code === '22008') {
    return res.status(400).json({ error: 'Invalid value in request' });
  }
  if (err.type === 'entity.parse.failed') {
    return res.status(400).json({ error: 'Malformed JSON body' });
  }
  reportError(err, req);
  res.status(500).json({ error: 'Internal server error' });
});

module.exports = app;
