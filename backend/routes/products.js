require('dotenv').config();
const express = require('express');
const router = express.Router();
const prisma = require('../prismaClient');

const { queryById: queryPineconeById, queryByVector: queryPineconeByVector, fetchVectors: fetchPineconeVectors } = require('../pineconeClient');
const { ensureProductSyncedWithPinecone } = require('../services/pineconeSync');

const toIdString = value => {
  if (value && typeof value.toString === 'function') return value.toString();
  if (value === undefined || value === null) return '';
  return String(value);
};

const FALLBACK_POOL_LIMIT = 150;

const RANK_SORT = [
  { rating: 'desc' },
  { numReviews: 'desc' },
  { createdAt: 'desc' },
];

const normalizeProduct = product => ({
  id: product.id,
  name: product.name,
  description: product.description,
  price: Number(product.price),
  category: product.category,
  image: product.image,
  brand: product.brand,
  stock: product.stock,
  rating: product.rating,
  numReviews: product.numReviews,
  createdAt: product.createdAt,
});

const toNumericIds = ids => Array.from(ids).map(val => Number(val)).filter(Number.isFinite);

const buildWhereClause = (excludeIds, filter = {}) => {
  const where = {};
  const notInIds = toNumericIds(excludeIds || []);
  if (notInIds.length) {
    where.id = { notIn: notInIds };
  }

  if (filter.category) {
    if (Array.isArray(filter.category?.$in)) {
      where.category = { in: filter.category.$in };
    } else if (Array.isArray(filter.category?.in)) {
      where.category = { in: filter.category.in };
    } else {
      where.category = filter.category;
    }
  }

  return where;
};

const tokenize = text =>
  (text || '')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);

const jaccardSimilarity = (aTokens, bTokens) => {
  if (!aTokens.length || !bTokens.length) return 0;
  const setA = new Set(aTokens);
  const setB = new Set(bTokens);
  let intersection = 0;
  for (const token of setA) {
    if (setB.has(token)) intersection += 1;
  }
  const unionSize = new Set([...setA, ...setB]).size;
  return unionSize === 0 ? 0 : intersection / unionSize;
};

const priceAffinity = (base, candidate) => {
  if (typeof base.price !== 'number' || typeof candidate.price !== 'number') return 0;
  const diff = Math.abs(base.price - candidate.price);
  const maxPrice = Math.max(base.price, candidate.price, 1);
  return 1 - Math.min(diff / maxPrice, 1);
};

const computeSimilarityScore = (base, candidate) => {
  let score = 0;

  if (base.category && candidate.category && base.category === candidate.category) score += 3;
  if (base.brand && candidate.brand && base.brand === candidate.brand) score += 2;

  const nameSim = jaccardSimilarity(tokenize(base.name), tokenize(candidate.name));
  const descSim = jaccardSimilarity(tokenize(base.description), tokenize(candidate.description));

  score += nameSim * 3;
  score += descSim;
  score += priceAffinity(base, candidate) * 2;

  return score;
};

const buildCandidatePool = async (excludeIds, filter = {}) => {
  const primary = await prisma.product.findMany({
    where: buildWhereClause(excludeIds, filter),
    take: FALLBACK_POOL_LIMIT,
  });

  if (!filter.category || primary.length >= 5) {
    return primary;
  }

  const primaryIds = new Set([...(excludeIds || []), ...primary.map(doc => String(doc.id))]);
  const supplemental = await prisma.product.findMany({
    where: buildWhereClause(primaryIds, {}),
    take: FALLBACK_POOL_LIMIT,
  });

  const merged = new Map();
  for (const doc of [...primary, ...supplemental]) {
    merged.set(String(doc.id), doc);
  }
  return Array.from(merged.values());
};

const fetchBackupProducts = async (excludeIds, limit) => {
  const candidates = await prisma.product.findMany({
    where: buildWhereClause(excludeIds, {}),
    orderBy: RANK_SORT,
    take: limit,
  });

  if (candidates.length) {
    return candidates;
  }

  return prisma.product.findMany({
    orderBy: RANK_SORT,
    take: limit,
  });
};

const fallbackSimilarProducts = async (product, limit = 5) => {
  const excludeIds = new Set([String(product.id)]);
  const filter = product.category ? { category: product.category } : {};
  const pool = await buildCandidatePool(excludeIds, filter);
  if (!pool.length) {
    const backups = await fetchBackupProducts(excludeIds, limit);
    if (backups.length) return backups.map(normalizeProduct);
    return [normalizeProduct(product)];
  }

  const scored = pool.map(candidate => ({ candidate, score: computeSimilarityScore(product, candidate) })).sort((a, b) => b.score - a.score);

  const results = [];
  const seen = new Set();
  for (const { candidate } of scored) {
    const key = String(candidate.id);
    if (seen.has(key)) continue;
    seen.add(key);
    results.push(candidate);
    if (results.length >= limit) break;
  }

  if (results.length) {
    return results.map(normalizeProduct);
  }

  const backups = await fetchBackupProducts(excludeIds, limit);
  if (backups.length) {
    return backups.map(normalizeProduct);
  }

  return [normalizeProduct(product)];
};

const fallbackRecommendationsForGroup = async (products, limit = 10) => {
  const excludeIds = new Set(products.map(p => String(p.id)));
  const categories = products.map(p => p.category).filter(Boolean);
  const filter = categories.length ? { category: { $in: Array.from(new Set(categories)) } } : {};
  const pool = await buildCandidatePool(excludeIds, filter);
  if (!pool.length) {
    const backups = await fetchBackupProducts(excludeIds, limit);
    if (backups.length) return backups.map(normalizeProduct);
    return products.map(normalizeProduct).slice(0, limit);
  }

  const scored = pool
    .map(candidate => {
      let bestScore = 0;
      for (const base of products) {
        bestScore = Math.max(bestScore, computeSimilarityScore(base, candidate));
      }
      return { candidate, score: bestScore };
    })
    .sort((a, b) => b.score - a.score);

  const results = [];
  const seen = new Set();
  for (const { candidate } of scored) {
    const key = String(candidate.id);
    if (seen.has(key)) continue;
    seen.add(key);
    results.push(candidate);
    if (results.length >= limit) break;
  }

  if (results.length) {
    return results.map(normalizeProduct);
  }

  const backups = await fetchBackupProducts(excludeIds, limit);
  if (backups.length) {
    return backups.map(normalizeProduct);
  }

  return products.map(normalizeProduct).slice(0, limit);
};

const loadNormalizedProductsByIds = async ids => {
  const uniqueIds = Array.from(new Set(ids.map(toIdString))).filter(Boolean);
  if (!uniqueIds.length) return [];

  const numericIds = uniqueIds.map(id => Number(id)).filter(Number.isFinite);
  if (!numericIds.length) return [];

  const docs = await prisma.product.findMany({ where: { id: { in: numericIds } } });
  const docMap = new Map(docs.map(doc => [doc.id.toString(), doc]));

  return uniqueIds
    .map(id => docMap.get(toIdString(id)))
    .filter(Boolean)
    .map(normalizeProduct);
};

const getVectorProductId = match => {
  if (!match) return null;
  if (match.metadata && (match.metadata.mongoId || match.metadata.id)) return match.metadata.mongoId || match.metadata.id;
  return match.id || null;
};

const pineconeSimilarRecommendations = async (product, limit = 5) => {
  const baseId = toIdString(product.pineconeId || product.id);
  if (!baseId) return [];

  try {
    let result;
    try {
      result = await queryPineconeById(baseId, limit + 3);
    } catch (err) {
      console.warn('Pinecone similar initial query failed, retrying after resync:', err.message || err);
    }

    if (!result || !Array.isArray(result.matches) || !result.matches.length) {
      try {
        await ensureProductSyncedWithPinecone(product);
        result = await queryPineconeById(baseId, limit + 3);
      } catch (err) {
        console.error('Pinecone similar re-sync failed:', err);
        return [];
      }
    }

    const matches = Array.isArray(result?.matches) ? result.matches : [];
    const seen = new Set([baseId]);
    const orderedIds = [];

    for (const match of matches) {
      const productId = getVectorProductId(match);
      if (!productId || seen.has(productId)) continue;
      seen.add(productId);
      orderedIds.push(productId);
      if (orderedIds.length >= limit) break;
    }

    return loadNormalizedProductsByIds(orderedIds);
  } catch (err) {
    console.error('Pinecone similar lookup failed:', err);
    return [];
  }
};

const pineconeGroupRecommendations = async (products, limit = 10) => {
  if (!products.length) return [];

  try {
    const baseIds = products.map(product => toIdString(product.pineconeId || product.id)).filter(Boolean);
    if (!baseIds.length) return [];

    const productMap = new Map(baseIds.map((id, idx) => [id, products[idx]]));

    let vectorMap = {};
    try {
      vectorMap = await fetchPineconeVectors(baseIds);
    } catch (err) {
      console.warn('Pinecone vector fetch failed:', err.message || err);
      vectorMap = {};
    }

    const missingIds = baseIds.filter(id => {
      const values = vectorMap?.[id]?.values;
      return !Array.isArray(values) || !values.length;
    });

    if (missingIds.length) {
      for (const id of missingIds) {
        const product = productMap.get(id);
        if (!product) continue;
        try {
          await ensureProductSyncedWithPinecone(product);
        } catch (err) {
          console.error('Pinecone re-sync for base product failed:', err);
        }
      }

      try {
        vectorMap = await fetchPineconeVectors(baseIds);
      } catch (err) {
        console.error('Pinecone vector refetch failed:', err);
        vectorMap = {};
      }
    }

    const vectors = baseIds.map(id => vectorMap?.[id]?.values).filter(vec => Array.isArray(vec) && vec.length);

    if (!vectors.length) return [];

    const dim = vectors[0].length;
    const centroid = Array(dim).fill(0);
    for (const vec of vectors) {
      for (let i = 0; i < dim; i += 1) centroid[i] += vec[i];
    }
    for (let i = 0; i < dim; i += 1) centroid[i] /= vectors.length;

    const { matches = [] } = await queryPineconeByVector(centroid, limit + baseIds.length + 3);
    const exclude = new Set(baseIds);
    const seen = new Set(baseIds);
    const orderedIds = [];
    for (const match of matches) {
      const productId = getVectorProductId(match);
      if (!productId || exclude.has(productId) || seen.has(productId)) continue;
      seen.add(productId);
      orderedIds.push(productId);
      if (orderedIds.length >= limit) break;
    }

    return loadNormalizedProductsByIds(orderedIds);
  } catch (err) {
    console.error('Pinecone group lookup failed:', err);
    return [];
  }
};

/**
 * @swagger
 * components:
 *   schemas:
 *     Product:
 *       type: object
 *       properties:
 *         id:
 *           type: string
 *           description: The auto-generated id of the product
 *         name:
 *           type: string
 *           description: The name of the product
 *         description:
 *           type: string
 *           description: The description of the product
 *         price:
 *           type: number
 *           description: The price of the product
 *         category:
 *           type: string
 *           description: The category of the product
 *         image:
 *           type: string
 *           description: The image URL of the product
 *         brand:
 *           type: string
 *           description: The brand of the product
 *         stock:
 *           type: number
 *           description: The available stock of the product
 *         rating:
 *           type: number
 *           description: The rating of the product
 *         numReviews:
 *           type: number
 *           description: The number of reviews of the product
 *         createdAt:
 *           type: string
 *           format: date-time
 *           description: The date and time the product was created
 *       example:
 *         id: "66d9e7ee8bf3a567a5efe26b"
 *         name: "Product Name"
 *         description: "Product Description"
 *         price: 19.99
 *         category: "Electronics"
 *         image: "https://example.com/product.jpg"
 *         brand: "Brand Name"
 *         stock: 10
 *         rating: 4.5
 *         numReviews: 10
 *         createdAt: "2022-01-01T00:00:00.000Z"
 */

/**
 * @swagger
 * /api/products:
 *   get:
 *     summary: Returns the list of all products
 *     tags: [Products]
 *     responses:
 *       200:
 *         description: The list of products
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items:
 *                 $ref: '#/components/schemas/Product'
 */
router.get('/', async (req, res) => {
  try {
    const products = await prisma.product.findMany();
    res.json(products.map(normalizeProduct));
  } catch (err) {
    res.status(500).send('Server error');
  }
});

/**
 * @swagger
 * /api/products/{id}/similar:
 *   get:
 *     summary: Get recommended similar products for a given product ID
 *     tags: [Products]
 *     parameters:
 *       - in: path
 *         name: id
 *         schema:
 *           type: string
 *         required: true
 *         description: The MongoDB product _id
 *     responses:
 *       200:
 *         description: A list of similar products
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items:
 *                 $ref: '#/components/schemas/Product'
 *       404:
 *         description: Product not found or not indexed for recommendations
 *       500:
 *         description: Server error
 */
router.get('/:id/similar', async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (Number.isNaN(id)) return res.status(400).json({ message: 'Invalid product id' });

    const prod = await prisma.product.findUnique({ where: { id } });
    if (!prod) {
      return res.status(404).json({ message: 'Product not found' });
    }

    let recommendations = await pineconeSimilarRecommendations(prod, 5);
    if (!recommendations.length) {
      recommendations = await fallbackSimilarProducts(prod);
    }

    res.json(recommendations);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Server error' });
  }
});

/**
 * @swagger
 * /api/products/recommendations:
 *   post:
 *     summary: Get recommendations based on multiple products
 *     tags: [Products]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               ids:
 *                 type: array
 *                 items:
 *                   type: string
 *                 description: Array of MongoDB product _id strings
 *             example:
 *               ids: ["607d1f77bcf86cd799439011","607d1f77bcf86cd799439022"]
 *     responses:
 *       200:
 *         description: A list of recommended products
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items:
 *                 $ref: '#/components/schemas/Product'
 *       400:
 *         description: Bad request (missing or invalid ids)
 *       500:
 *         description: Server error
 */
router.post('/recommendations', async (req, res) => {
  try {
    const { ids } = req.body;
    if (!Array.isArray(ids) || ids.length === 0) {
      return res.status(400).json({ message: 'Request body must have a non-empty array of ids' });
    }

    const numericIds = ids.map(id => Number(id)).filter(Number.isFinite);
    const docs = await prisma.product.findMany({ where: { id: { in: numericIds } } });
    if (docs.length === 0) {
      return res.status(400).json({ message: 'No products found for provided ids' });
    }

    let recommendations = await pineconeGroupRecommendations(docs, 10);
    if (!recommendations.length) {
      recommendations = await fallbackRecommendationsForGroup(docs);
    }

    res.json(recommendations);
  } catch (err) {
    console.error('Error in /recommendations:', err);
    res.status(500).json({ message: 'Server error' });
  }
});

/**
 * @swagger
 * /api/products/{id}:
 *   get:
 *     summary: Get a product by id
 *     tags: [Products]
 *     parameters:
 *       - in: path
 *         name: id
 *         schema:
 *           type: string
 *         required: true
 *         description: The product id
 *     responses:
 *       200:
 *         description: The product description by id
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Product'
 *       404:
 *         description: Product not found
 */
router.get('/:id', async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (Number.isNaN(id)) return res.status(400).json({ message: 'Invalid product id' });

    const product = await prisma.product.findUnique({ where: { id } });
    if (!product) {
      return res.status(404).send('Product not found');
    }
    res.json(normalizeProduct(product));
  } catch (err) {
    res.status(500).send('Server error');
  }
});

/**
 * @swagger
 * /api/products/category/{category}:
 *   get:
 *     summary: Get products by category
 *     tags: [Products]
 *     parameters:
 *       - in: path
 *         name: category
 *         schema:
 *           type: string
 *         required: true
 *         description: The product category
 *     responses:
 *       200:
 *         description: The products by category
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items:
 *                 $ref: '#/components/schemas/Product'
 */
router.get('/category/:category', async (req, res) => {
  try {
    const products = await prisma.product.findMany({ where: { category: req.params.category } });
    res.json(products.map(normalizeProduct));
  } catch (err) {
    res.status(500).send('Server error');
  }
});

/**
 * @swagger
 * /api/products/{id}/rating:
 *   put:
 *     summary: Update the product rating
 *     tags: [Products]
 *     parameters:
 *       - in: path
 *         name: id
 *         schema:
 *           type: string
 *         required: true
 *         description: The product id
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               rating:
 *                 type: number
 *                 description: The new rating for the product
 *     responses:
 *       200:
 *         description: The updated product
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Product'
 *       404:
 *         description: Product not found
 */
router.put('/:id/rating', async (req, res) => {
  try {
    const { rating } = req.body;
    const id = Number(req.params.id);
    if (Number.isNaN(id)) return res.status(400).json({ message: 'Invalid product id' });
    if (typeof rating !== 'number' || Number.isNaN(rating)) return res.status(400).json({ message: 'Invalid rating value' });

    const product = await prisma.product.findUnique({ where: { id } });

    if (!product) {
      return res.status(404).send('Product not found');
    }

    // Calculate new average rating
    const newNumReviews = (product.numReviews || 0) + 1;
    const newRatingSum = (product.rating || 0) * (product.numReviews || 0) + rating;
    const newAverageRating = newRatingSum / newNumReviews;

    const updated = await prisma.product.update({
      where: { id },
      data: {
        rating: newAverageRating,
        numReviews: newNumReviews,
      },
    });

    res.json(normalizeProduct(updated));
  } catch (err) {
    res.status(500).send('Server error');
  }
});

module.exports = router;
