const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { check, validationResult } = require('express-validator');
const prisma = require('../prismaClient');
const authMiddleware = require('../middleware/auth');

const router = express.Router();
const JWT_SECRET = process.env.JWT_SECRET;

const normalizeEmail = email => String(email || '').trim().toLowerCase();

router.post(
  '/register',
  [
    check('name', 'Name is required').not().isEmpty(),
    check('email', 'Please include a valid email').isEmail(),
    check('password', 'Please enter a password with 6 or more characters').isLength({ min: 6 }),
  ],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { name, email, password } = req.body;
    const normalizedEmail = normalizeEmail(email);

    try {
      const existingUser = await prisma.user.findUnique({ where: { email: normalizedEmail } });
      if (existingUser) {
        return res.status(400).json({ msg: 'User already exists' });
      }

      const salt = await bcrypt.genSalt(10);
      const hashed = await bcrypt.hash(password, salt);

      const user = await prisma.user.create({
        data: {
          name,
          email: normalizedEmail,
          password: hashed,
          emailVerified: true,
          verificationCode: null,
          verificationCodeExpiresAt: null,
          verifiedAt: new Date(),
        },
      });

      const payload = { user: { id: user.id } };
      jwt.sign(payload, JWT_SECRET, { expiresIn: '48h' }, (err, token) => {
        if (err) throw err;
        return res.status(200).json({ token });
      });
    } catch (err) {
      console.error(err.message);
      res.status(500).send('Server error');
    }
  }
);

router.post(
  '/login',
  [check('email', 'Please include a valid email').isEmail(), check('password', 'Password is required').exists()],
  async (req, res) => {
    const errors = validationResult(req);

    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { email, password } = req.body;
    const normalizedEmail = normalizeEmail(email);

    try {
      const user = await prisma.user.findUnique({ where: { email: normalizedEmail } });

      if (!user) {
        return res.status(400).json({ msg: 'Invalid credentials' });
      }

      const isMatch = await bcrypt.compare(password, user.password);
      if (!isMatch) {
        return res.status(400).json({ msg: 'Invalid credentials' });
      }

      const payload = { user: { id: user.id } };

      jwt.sign(payload, JWT_SECRET, { expiresIn: '48h' }, (err, token) => {
        if (err) throw err;
        res.json({ token });
      });
    } catch (err) {
      console.error(err.message);
      res.status(500).send('Server error');
    }
  }
);

// Simple email existence check for reset flows
router.post('/verify-email', [check('email', 'Please include a valid email').isEmail()], async (req, res) => {
  const errors = validationResult(req);

  if (!errors.isEmpty()) {
    return res.status(400).json({ errors: errors.array() });
  }

  const { email } = req.body;
  const normalizedEmail = normalizeEmail(email);

  try {
    const user = await prisma.user.findUnique({ where: { email: normalizedEmail } });

    if (!user) {
      return res.status(400).json({ msg: 'Invalid email. User not found' });
    }

    res.json({ msg: 'Email is valid, you can proceed to reset your password' });
  } catch (err) {
    console.error(err.message);
    res.status(500).send('Server error');
  }
});

router.post(
  '/reset-password',
  [check('email', 'Please include a valid email').isEmail(), check('password', 'Please enter a password with 6 or more characters').isLength({ min: 6 })],
  async (req, res) => {
    const errors = validationResult(req);

    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { email, password } = req.body;
    const normalizedEmail = normalizeEmail(email);

    try {
      const user = await prisma.user.findUnique({ where: { email: normalizedEmail } });

      if (!user) {
        return res.status(400).json({ msg: 'Invalid email. User not found' });
      }

      const salt = await bcrypt.genSalt(10);
      const hashed = await bcrypt.hash(password, salt);
      await prisma.user.update({
        where: { email: normalizedEmail },
        data: { password: hashed },
      });

      res.json({ msg: 'Password successfully reset' });
    } catch (err) {
      console.error(err.message);
      res.status(500).send('Server error');
    }
  }
);

router.get('/users', authMiddleware, async (_req, res) => {
  try {
    const users = await prisma.user.findMany({
      select: {
        id: true,
        name: true,
        email: true,
        emailVerified: true,
        createdAt: true,
        verifiedAt: true,
      },
      orderBy: { createdAt: 'desc' },
    });

    res.json(users);
  } catch (err) {
    console.error(err.message);
    res.status(500).send('Server error');
  }
});

module.exports = router;
