require('dotenv').config();
const prisma = require('../prismaClient');
const weaviateModule = require('weaviate-ts-client');
const weaviate = weaviateModule.default || weaviateModule;
const { ApiKey } = weaviateModule;

const { WEAVIATE_HOST, WEAVIATE_API_KEY } = process.env;

module.exports = async function syncWeaviate() {
  if (!WEAVIATE_HOST || !WEAVIATE_API_KEY) {
    console.log('ℹ️  Weaviate sync skipped: missing configuration');
    return;
  }

  const client = weaviate.client({
    scheme: 'https',
    host: WEAVIATE_HOST,
    apiKey: new ApiKey(WEAVIATE_API_KEY),
  });

  const toSync = await prisma.product.findMany({ where: { weaviateId: null } });
  console.log(`🔍 Found ${toSync.length} products to sync...`);

  for (const doc of toSync) {
    try {
      const resp = await client.graphql
        .get()
        .withClassName('Product')
        .withFields('_additional { id }')
        .withWhere({
          path: ['name'],
          operator: 'Equal',
          valueString: doc.name,
        })
        .withLimit(1)
        .do();

      const hits = resp.data.Get.Product;
      if (!hits.length) {
        console.warn(`⚠️  No Weaviate object found for name="${doc.name}"`);
        continue;
      }

      const wid = hits[0]._additional.id;
      await prisma.product.update({
        where: { id: Number(doc.id) },
        data: { weaviateId: wid },
      });

      console.log(`✅ Synced "${doc.name}" → ${wid}`);
    } catch (err) {
      console.error(`❌ Error syncing "${doc.name}":`, err.message || err);
    }
  }

  console.log('🎉 Weaviate sync complete.');
  await prisma.$disconnect();
};
