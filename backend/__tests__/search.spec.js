const express = require('express');
const bodyParser = require('body-parser');
const request = require('supertest');

jest.mock('../prismaClient', () => ({
  product: {
    findMany: jest.fn(),
  },
}));
const prisma = require('../prismaClient');
const searchRouter = require('../routes/search');

beforeAll(() => {
  jest.spyOn(console, 'error').mockImplementation(() => {});
});

describe('Search API', () => {
  let app;

  beforeEach(() => {
    app = express();
    app.use(bodyParser.json());
    app.use('/api/search', searchRouter);
    jest.clearAllMocks();
  });

  it('200 → returns products matching the query', async () => {
    const fakeProducts = [
      { id: 1, name: 'FooBar', description: 'Test product', price: 10 },
      { id: 2, name: 'BarBaz', description: 'Another test', price: 20 },
    ];
    prisma.product.findMany.mockResolvedValue(fakeProducts);

    const res = await request(app).get('/api/search?q=bar');

    expect(res.status).toBe(200);
    expect(prisma.product.findMany).toHaveBeenCalledWith({
      where: {
        OR: [
          { name: { contains: 'bar', mode: 'insensitive' } },
          { description: { contains: 'bar', mode: 'insensitive' } },
        ],
      },
    });
    expect(res.body).toEqual(fakeProducts);
  });

  it('200 → returns all products when no query is provided', async () => {
    const allProducts = [
      { id: 1, name: 'Alpha', description: 'Desc A', price: 5 },
      { id: 2, name: 'Beta', description: 'Desc B', price: 15 },
    ];
    prisma.product.findMany.mockResolvedValue(allProducts);

    const res = await request(app).get('/api/search');

    expect(res.status).toBe(200);
    expect(prisma.product.findMany).toHaveBeenCalledWith({
      where: {},
    });
    expect(res.body).toEqual(allProducts);
  });

  it('500 → internal server error', async () => {
    prisma.product.findMany.mockRejectedValue(new Error('DB error'));

    const res = await request(app).get('/api/search?q=test');
    expect(res.status).toBe(500);
    expect(res.body).toEqual({ error: 'An error occurred during the search.' });
  });
});
