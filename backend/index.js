const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });

const express = require('express');
const cors = require('cors');
const client = require('prom-client');
const prisma = require('./prismaClient');
const seedDB = require('./seed/productSeeds');
const syncPinecone = require('./sync/syncPinecone');
const productRoutes = require('./routes/products');
const checkoutRoutes = require('./routes/checkout');
const orderRoutes = require('./routes/orders');
const authRoutes = require('./routes/auth');
const { setupSwaggerUi, setupSwaggerJson } = require('./docs/swagger');

// Create Express App
const app = express();
const PORT = process.env.PORT || 8000;

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// ---- Prometheus metrics setup ----
const register = new client.Registry();

// collect default Node.js + process metrics (CPU, memory, event loop, etc.)
client.collectDefaultMetrics({ register });

// Optional: simple HTTP request counter
const httpRequestCounter = new client.Counter({
  name: 'http_requests_total',
  help: 'Total number of HTTP requests',
  labelNames: ['method', 'route', 'status'],
  registers: [register],
});

app.use((req, res, next) => {
  res.on('finish', () => {
    httpRequestCounter.labels(req.method, req.path, res.statusCode).inc();
  });
  next();
});

// Simple healthcheck endpoint
app.get('/health', (req, res) => {
  res.status(200).json({ status: 'ok' });
});

// Kubernetes probes
app.get('/healthz', (_req, res) => {
  res.status(200).json({ status: 'ok' });
});

app.get('/readyz', async (_req, res) => {
  try {
    const timeoutMs = Number(process.env.READYZ_TIMEOUT_MS || 2000);
    await Promise.race([
      prisma.$queryRaw`SELECT 1`,
      new Promise((_, reject) => setTimeout(() => reject(new Error('readyz timeout')), timeoutMs)),
    ]);
    res.status(200).json({ status: 'ready' });
  } catch (_err) {
    res.status(503).json({ status: 'not_ready' });
  }
});

// Redirect root to /api-docs
app.get('/', (req, res) => {
  res.redirect('/api-docs');
});

// Expose /metrics endpoint for Prometheus
app.get('/metrics', async (req, res) => {
  try {
    res.set('Content-Type', register.contentType);
    res.end(await register.metrics());
  } catch (err) {
    res.status(500).end(err.toString());
  }
});

// Setup Swagger UI with customized title
setupSwaggerJson(app); // serves /api-docs/swagger.json
setupSwaggerUi(app);

// Routes
app.use('/api/products', productRoutes);
app.use('/api/checkout', checkoutRoutes);
app.use('/api/orders', orderRoutes);
app.use('/api/search', require('./routes/search'));
app.use('/api/auth', authRoutes);

async function bootstrap() {
  try {
    // Ensure DB is reachable before serving routes that depend on it.
    await prisma.$connect();

    // 1. Seed the database (only when necessary)
    const skipSeed = process.env.SKIP_SEED_ON_START === 'true';
    if (!skipSeed) {
      try {
        const forceSeed = process.env.FORCE_SEED_ON_START === 'true';
        const result = await seedDB({ force: forceSeed, skipIfExists: !forceSeed });
        if (result?.seeded) {
          console.log('🪴 Database seeded');
        } else if (result?.skipped) {
          console.log('🌱 Seed skipped (existing products retained)');
        }
      } catch (err) {
        console.error('❌ Seeding error:', err);
      }
    } else {
      console.log('🌱 SKIP_SEED_ON_START enabled. Existing products preserved.');
    }

    // 2. Sync with Pinecone (primary recommendation engine)
    const skipPinecone = process.env.SKIP_PINECONE_SYNC === 'true';
    const pineconeReady = process.env.PINECONE_API_KEY && process.env.PINECONE_HOST && process.env.GOOGLE_AI_API_KEY;
    if (skipPinecone || !pineconeReady) {
      console.log('ℹ️  Pinecone sync skipped (set PINECONE_API_KEY, PINECONE_HOST, GOOGLE_AI_API_KEY or unset SKIP_PINECONE_SYNC to enable).');
    } else {
      try {
        await syncPinecone();
        console.log('✅ Pinecone synced');
      } catch (err) {
        console.error('❌ Pinecone sync error (continuing with fallbacks):', err);
      }
    }

    // 3. Start Express server
    app.listen(PORT, '0.0.0.0', () => {
      console.log(`Server ready on port ${PORT}.`);
    });
  } catch (err) {
    console.error('❌ Startup error:', err);
    process.exit(1);
  }
}

bootstrap();

module.exports = app;
