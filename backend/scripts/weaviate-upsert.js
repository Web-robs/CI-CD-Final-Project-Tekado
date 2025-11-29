#!/usr/bin/env node

require('dotenv').config();
const prisma = require('../prismaClient');

const weaviateModule = require('weaviate-client');
const weaviate       = weaviateModule.default || weaviateModule;
const { generateUuid5, config } = weaviateModule;
const { ApiKey }      = weaviateModule;
const { getWeaviateClient } = require('../weaviateClient.js');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const {
  GOOGLE_AI_API_KEY,
  BATCH_SIZE = 50
} = process.env;

if (!GOOGLE_AI_API_KEY)  throw new Error('Missing GOOGLE_AI_API_KEY in .env');

async function main() {
  const genAI     = new GoogleGenerativeAI(GOOGLE_AI_API_KEY);
  const embedModel = genAI.getGenerativeModel({
    model: 'models/text-embedding-004'
  });

  const client     = await getWeaviateClient();
  const collection = client.collections.get('Product');

  const existing = await client.collections.listAll();
  if (!existing.some(c => c.name === 'Product')) {
    console.log('⚙️  Creating `Product` class');
    await client.collections.create({
      name: 'Product',
      vectorizerConfig: config.vectorizer.none(),
      properties: [
        { name: 'name',        dataType: [config.dataType.TEXT]   },
        { name: 'description', dataType: [config.dataType.TEXT]   },
        { name: 'price',       dataType: [config.dataType.NUMBER] },
        { name: 'category',    dataType: [config.dataType.TEXT]   },
        { name: 'image',       dataType: [config.dataType.TEXT]   },
        { name: 'brand',       dataType: [config.dataType.TEXT]   },
        { name: 'stock',       dataType: [config.dataType.NUMBER] },
        { name: 'rating',      dataType: [config.dataType.NUMBER] },
        { name: 'numReviews',  dataType: [config.dataType.NUMBER] },
        { name: 'createdAt',   dataType: [config.dataType.DATE]   },
      ],
    });
    console.log('✅ `Product` class created');
  } else {
    console.log('✅ `Product` class already exists');
  }

  const products = await prisma.product.findMany();
  const total    = products.length;
  console.log(`🔎 Found ${total} products to upsert`);

  const dataObjects = [];
  let done = 0;
  for (const doc of products) {
    const text = `${doc.name}: ${doc.description}`;
    let embedding;
    try {
      embedding = (await embedModel.embedContent(text)).embedding.values;
    } catch (e) {
      console.warn(`⚠️ Embedding failed for ${doc.id}`, e);
      continue;
    }

    dataObjects.push({
      uuid: generateUuid5('Product', (doc.pineconeId || doc.id).toString()),
      properties: {
        name:        doc.name,
        description: doc.description,
        price:       typeof doc.price === 'object' && doc.price !== null ? Number(doc.price) : doc.price,
        category:    doc.category,
        image:       doc.image,
        brand:       doc.brand,
        stock:       doc.stock,
        rating:      doc.rating,
        numReviews:  doc.numReviews,
        createdAt:   doc.createdAt ? new Date(doc.createdAt).toISOString() : null,
      },
      vector: embedding,
    });

    done++;
    console.log(`🔧 Embedded ${done}/${total}`);
  }

  for (let i = 0; i < dataObjects.length; i += Number(BATCH_SIZE)) {
    const chunk = dataObjects.slice(i, i + Number(BATCH_SIZE));
    await collection.data.insertMany(chunk);
    console.log(`✅ Upserted batch ${i / BATCH_SIZE + 1} (${chunk.length} items)`);
  }

  console.log('🎉 All products upserted');
  await prisma.$disconnect();
  process.exit(0);
}

main()
  .catch(async err => {
    console.error(err);
    await prisma.$disconnect();
    process.exit(1);
  });
