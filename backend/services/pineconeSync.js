require('dotenv').config();

const { GoogleGenerativeAI } = require('@google/generative-ai');
const prisma = require('../prismaClient');
const { upsertVectors, deleteVectors } = require('../pineconeClient');

const namespace = process.env.PINECONE_NAMESPACE || '';

let embedModel;
const getEmbedModel = () => {
  if (embedModel) return embedModel;
  const { GOOGLE_AI_API_KEY } = process.env;
  if (!GOOGLE_AI_API_KEY) {
    throw new Error('GOOGLE_AI_API_KEY must be set to build Pinecone embeddings');
  }
  const genAI = new GoogleGenerativeAI(GOOGLE_AI_API_KEY);
  embedModel = genAI.getGenerativeModel({ model: 'models/text-embedding-004' });
  return embedModel;
};

const isPineconeConfigured = () =>
  Boolean(process.env.PINECONE_API_KEY && process.env.PINECONE_HOST);

const toPlainProduct = doc => {
  if (!doc) return null;
  if (typeof doc.toObject === 'function') return doc.toObject();
  return doc;
};

const buildVectorPayload = async (product, pineconeId) => {
  const text = `${product.name || ''}. ${product.description || ''}`.trim();
  if (!text) return null;
  const { embedding } = await getEmbedModel().embedContent(text);
  const values = embedding?.values;
  if (!Array.isArray(values) || !values.length) return null;
  return {
    id: pineconeId,
    values,
    metadata: {
      mongoId: pineconeId,
      name: product.name,
      category: product.category,
      brand: product.brand,
      price: typeof product.price === 'object' && product.price !== null ? Number(product.price) : product.price,
      image: product.image,
      createdAt: product.createdAt ? new Date(product.createdAt).toISOString() : null,
    },
  };
};

async function ensureProductSyncedWithPinecone(productDoc) {
  if (!isPineconeConfigured()) return false;
  const product = toPlainProduct(productDoc);
  const rawId = product?._id || product?.id;
  if (!product || rawId === undefined || rawId === null) return false;

  const pineconeId = (product.pineconeId || rawId).toString();
  const vectorPayload = await buildVectorPayload(product, pineconeId);
  if (!vectorPayload) return false;

  await upsertVectors([vectorPayload], namespace);

  if (productDoc) {
    try {
      productDoc.pineconeId = pineconeId;
    } catch (err) {
      // Ignore assignment issues on lean objects
    }
  }

  if (product.pineconeId !== pineconeId) {
    const numericId = Number(rawId);
    if (!Number.isNaN(numericId)) {
      try {
        await prisma.product.update({
          where: { id: numericId },
          data: { pineconeId },
        });
      } catch (err) {
        console.error('Prisma update for pineconeId failed:', err.message || err);
      }
    }

    // Optionally mirror to any legacy Mongo collections (not used once migration is complete)
  }

  return true;
}

async function removeProductFromPinecone(productId) {
  if (!isPineconeConfigured()) return false;
  if (!productId) return false;
  await deleteVectors([productId.toString()], namespace);
  return true;
}

module.exports = {
  ensureProductSyncedWithPinecone,
  removeProductFromPinecone,
};
