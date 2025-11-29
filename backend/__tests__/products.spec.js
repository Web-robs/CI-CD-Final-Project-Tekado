const express = require('express');
const bodyParser = require('body-parser');
const request = require('supertest');

jest.mock('../prismaClient', () => ({
  product: {
    findMany: jest.fn(),
    findUnique: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    delete: jest.fn(),
  },
}));
const prisma = require('../prismaClient');

jest.mock('weaviate-ts-client', () => {
  const chain = {
    withClassName: () => chain,
    withFields:    () => chain,
    withWhere:     () => chain,
    withNearVector:() => chain,
    withNearObject:() => chain,
    withLimit:     () => chain,
    do: async () => ({ data: { Get: { Product: [] } } }),
  };

  // client factory returns an object with .graphql.get()
  function client() {
    return { graphql: { get: () => chain } };
  }

  return {
    client,
    ApiKey: class MockApiKey {},
    default: { client }
  };
});

const productsRouter = require('../routes/products');

describe('Products API', () => {
  let app;

  beforeEach(() => {
    app = express();
    app.use(bodyParser.json());
    app.use('/api/products', productsRouter);
    jest.clearAllMocks();
  });

  describe('GET /api/products', () => {
    it('200 → returns all products formatted with id', async () => {
      const fakeDocs = [
        { id: 1, name: 'A', price: 10 },
        { id: 2, name: 'B', price: 20 },
      ];
      prisma.product.findMany.mockResolvedValue(fakeDocs);

      const res = await request(app).get('/api/products');
      expect(res.status).toBe(200);
      expect(res.body).toEqual(fakeDocs);
    });

    it('500 → server error', async () => {
      prisma.product.findMany.mockRejectedValue(new Error('db fail'));
      const res = await request(app).get('/api/products');
      expect(res.status).toBe(500);
      expect(res.text).toBe('Server error');
    });
  });

  describe('GET /api/products/:id', () => {
    it('200 → returns product when found', async () => {
      const fakeProduct = { id: 123, name: 'X', price: 5 };
      prisma.product.findUnique.mockResolvedValue(fakeProduct);

      const res = await request(app).get('/api/products/123');
      expect(res.status).toBe(200);
      expect(res.body).toEqual(fakeProduct);
    });

    it('404 → product not found', async () => {
      prisma.product.findUnique.mockResolvedValue(null);
      const res = await request(app).get('/api/products/doesnotexist');
      expect(res.status).toBe(404);
      expect(res.text).toBe('Product not found');
    });

    it('500 → server error', async () => {
      prisma.product.findUnique.mockRejectedValue(new Error('oops'));
      const res = await request(app).get('/api/products/123');
      expect(res.status).toBe(500);
      expect(res.text).toBe('Server error');
    });
  });

  describe('GET /api/products/category/:category', () => {
    it('200 → returns products in category', async () => {
      const catProds = [{ id: 1, name: 'Foo' }, { id: 2, name: 'Bar' }];
      prisma.product.findMany.mockResolvedValue(catProds);

      const res = await request(app).get('/api/products/category/testcat');
      expect(res.status).toBe(200);
      expect(res.body).toEqual(catProds);
      expect(prisma.product.findMany).toHaveBeenCalledWith({ where: { category: 'testcat' } });
    });

    it('500 → server error', async () => {
      prisma.product.findMany.mockRejectedValue(new Error('db error'));
      const res = await request(app).get('/api/products/category/anything');
      expect(res.status).toBe(500);
      expect(res.text).toBe('Server error');
    });
  });

  describe('PUT /api/products/:id/rating', () => {
    it('200 → updates rating when product exists', async () => {
      const original = {
        id: 1,
        rating: 4,
        numReviews: 2,
      };
      prisma.product.findUnique.mockResolvedValue(original);
      const updated = { ...original, rating: 13 / 3, numReviews: 3 };
      prisma.product.update.mockResolvedValue(updated);

      const res = await request(app)
        .put('/api/products/1/rating')
        .send({ rating: 5 });

      // newAverage = (4*2 + 5) / 3 = 13/3 ≈ 4.333...
      expect(res.status).toBe(200);
      expect(res.body).toEqual({
        id: 1,
        rating: expect.closeTo(13 / 3, 5),
        numReviews: 3,
      });
    });

    it('404 → product not found', async () => {
      prisma.product.findUnique.mockResolvedValue(null);
      const res = await request(app)
        .put('/api/products/999/rating')
        .send({ rating: 1 });
      expect(res.status).toBe(404);
      expect(res.text).toBe('Product not found');
    });

    it('500 → server error', async () => {
      prisma.product.findUnique.mockResolvedValue({ id: 10, rating: 1, numReviews: 0 });
      prisma.product.update.mockRejectedValue(new Error('fail'));
      const res = await request(app)
        .put('/api/products/10/rating')
        .send({ rating: 2 });
      expect(res.status).toBe(500);
      expect(res.text).toBe('Server error');
    });
  });
});
