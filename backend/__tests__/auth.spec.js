const express = require('express');
const bodyParser = require('body-parser');
const request = require('supertest');

const authRouter = require('../routes/auth');

jest.mock('bcryptjs');
jest.mock('jsonwebtoken');
jest.mock('../prismaClient', () => ({
  user: {
    findUnique: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
  },
}));

const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const prisma = require('../prismaClient');

describe('Auth API', () => {
  let app;

  beforeAll(() => {
    process.env.JWT_SECRET = 'testsecret';
    // default mocks
    bcrypt.genSalt.mockResolvedValue('salt');
    bcrypt.hash.mockImplementation((pw, salt) => Promise.resolve(`hashed-${pw}`));
    bcrypt.compare.mockImplementation((pw, hash) => Promise.resolve(hash === `hashed-${pw}`));
    jwt.sign.mockImplementation((payload, secret, opts, cb) => cb(null, 'jwt-token'));

    // mock prisma user methods
    prisma.user.findUnique = jest.fn();
    prisma.user.create = jest.fn();
    prisma.user.update = jest.fn();
  });

  beforeEach(() => {
    app = express();
    app.use(bodyParser.json());
    app.use('/api/auth', authRouter);
    jest.clearAllMocks();
  });

  describe('POST /api/auth/register', () => {
    it('200 → creates user and returns token', async () => {
      prisma.user.findUnique.mockResolvedValue(null);
      prisma.user.create.mockResolvedValue({ id: 1 });
      const res = await request(app)
        .post('/api/auth/register')
        .send({ name: 'Alice', email: 'alice@example.com', password: 'secret123' });
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ token: 'jwt-token' });
      // ensure password was hashed & user.save called
      expect(bcrypt.hash).toHaveBeenCalledWith('secret123', 'salt');
      expect(prisma.user.create).toHaveBeenCalled();
    });

    it('400 → validation errors', async () => {
      const res = await request(app)
        .post('/api/auth/register')
        .send({ email: 'bad', password: '123' });
      expect(res.status).toBe(400);
      expect(res.body.errors).toBeInstanceOf(Array);
    });

    it('400 → user exists', async () => {
      prisma.user.findUnique.mockResolvedValue({ id: 'x', email: 'a@b.com' });
      const res = await request(app)
        .post('/api/auth/register')
        .send({ name: 'Bob', email: 'a@b.com', password: 'abcdef' });
      expect(res.status).toBe(400);
      expect(res.body).toEqual({ msg: 'User already exists' });
    });
  });

  describe('POST /api/auth/login', () => {
    it('200 → valid creds', async () => {
      prisma.user.findUnique.mockResolvedValue({ id: 'uid', password: 'hashed-pass', emailVerified: true });
      const res = await request(app)
        .post('/api/auth/login')
        .send({ email: 'u@e.com', password: 'pass' });
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ token: 'jwt-token' });
    });

    it('400 → validation errors', async () => {
      const res = await request(app)
        .post('/api/auth/login')
        .send({ email: 'not-an-email' });
      expect(res.status).toBe(400);
      expect(res.body.errors).toBeInstanceOf(Array);
    });

    it('400 → no user', async () => {
      prisma.user.findUnique.mockResolvedValue(null);
      const res = await request(app)
        .post('/api/auth/login')
        .send({ email: 'x@y.com', password: 'doesntmatter' });
      expect(res.status).toBe(400);
      expect(res.body).toEqual({ msg: 'Invalid credentials' });
    });

    it('400 → wrong password', async () => {
      prisma.user.findUnique.mockResolvedValue({ id: 'uid', password: 'hashed-wrong', emailVerified: true });
      bcrypt.compare.mockResolvedValue(false);
      const res = await request(app)
        .post('/api/auth/login')
        .send({ email: 'u@e.com', password: 'pass' });
      expect(res.status).toBe(400);
      expect(res.body).toEqual({ msg: 'Invalid credentials' });
    });
  });

  describe('POST /api/auth/verify-email', () => {
    it('200 → email exists', async () => {
      prisma.user.findUnique.mockResolvedValue({ id: 'u1' });
      const res = await request(app).post('/api/auth/verify-email').send({ email: 'found@e.com' });
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ msg: 'Email is valid, you can proceed to reset your password' });
    });

    it('400 → validation error', async () => {
      const res = await request(app).post('/api/auth/verify-email').send({ email: 'bad' });
      expect(res.status).toBe(400);
      expect(res.body.errors).toBeInstanceOf(Array);
    });

    it('400 → not found', async () => {
      prisma.user.findUnique.mockResolvedValue(null);
      const res = await request(app).post('/api/auth/verify-email').send({ email: 'no@one.com' });
      expect(res.status).toBe(400);
      expect(res.body).toEqual({ msg: 'Invalid email. User not found' });
    });
  });

  describe('POST /api/auth/reset-password', () => {
    it('200 → reset success', async () => {
      prisma.user.findUnique.mockResolvedValue({ id: 'u1' });
      prisma.user.update.mockResolvedValue({});
      const res = await request(app)
        .post('/api/auth/reset-password')
        .send({ email: 'e@x.com', password: 'newpass123' });
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ msg: 'Password successfully reset' });
      expect(bcrypt.hash).toHaveBeenCalledWith('newpass123', 'salt');
      expect(prisma.user.update).toHaveBeenCalled();
    });

    it('400 → validation error', async () => {
      const res = await request(app)
        .post('/api/auth/reset-password')
        .send({ email: 'bad', password: '123' });
      expect(res.status).toBe(400);
      expect(res.body.errors).toBeInstanceOf(Array);
    });

    it('400 → user not found', async () => {
      prisma.user.findUnique.mockResolvedValue(null);
      const res = await request(app)
        .post('/api/auth/reset-password')
        .send({ email: 'no@one.com', password: 'abcdef' });
      expect(res.status).toBe(400);
      expect(res.body).toEqual({ msg: 'Invalid email. User not found' });
    });
  });
});
