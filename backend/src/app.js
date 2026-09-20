const path = require('path');
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');

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

const app = express();

const allowedOrigins = (process.env.CORS_ORIGINS || '').split(',').map((s) => s.trim()).filter(Boolean);

// crossOriginResourcePolicy relaxed so uploaded product photos can be loaded
// from the frontend's own origin (different port in dev, different host in prod)
app.use(helmet({ crossOriginResourcePolicy: { policy: 'cross-origin' } }));
app.use(cors({ origin: allowedOrigins.length ? allowedOrigins : true }));
app.use(morgan('dev'));
app.use(express.json());
app.use('/uploads', express.static(path.join(__dirname, '..', 'uploads')));

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

// Fallback error handler - keeps stack traces out of API responses
app.use((err, req, res, next) => {
  console.error(err);
  res.status(err.status || 500).json({ error: err.message || 'Internal server error' });
});

module.exports = app;
