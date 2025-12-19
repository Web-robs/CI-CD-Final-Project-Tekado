const express = require('express');
const { randomInt } = require('crypto');
const prisma = require('../prismaClient');
const { ORDER_STATUS_FLOW, ensureInitialStatus } = require('../utils/orderStatus');

const router = express.Router();

// Default: skip card validation for demo/dev; set SKIP_CARD_VALIDATION=false to enforce strict checks
const SKIP_CARD_VALIDATION = process.env.SKIP_CARD_VALIDATION !== 'false';

const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

async function generateOrderNumber() {
  for (let attempt = 0; attempt < 6; attempt += 1) {
    const candidate = `FE-${randomInt(100000, 999999)}`;
    // eslint-disable-next-line no-await-in-loop
    const exists = await prisma.order.findUnique({ where: { orderNumber: candidate } });
    if (!exists) {
      return candidate;
    }
  }
  return `FE-${Date.now()}`;
}

/**
 * @swagger
 * /api/checkout/create-order:
 *   post:
 *     summary: Create a new order
 *     description: Creates a new order with the provided details such as items, customer information, and payment details.
 *     tags:
 *       - Orders
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               items:
 *                 type: array
 *                 items:
 *                   type: object
 *                   properties:
 *                     productId:
 *                       type: string
 *                       description: The unique identifier of the product.
 *                     quantity:
 *                       type: integer
 *                       description: The number of items for this product.
 *               name:
 *                 type: string
 *                 description: Customer's name.
 *               email:
 *                 type: string
 *                 description: Customer's email address.
 *               shippingAddress:
 *                 type: string
 *                 description: Customer's shipping address.
 *               cardNumber:
 *                 type: string
 *                 description: Customer's card number.
 *               cardName:
 *                 type: string
 *                 description: Name on the customer's card.
 *               expiry:
 *                 type: string
 *                 description: Card expiry date in MM/YY format.
 *               cvc:
 *                 type: string
 *                 description: Card CVC.
 *     responses:
 *       201:
 *         description: Order created successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 message:
 *                   type: string
 *                 orderNumber:
 *                   type: string
 *                   example: FE-482913
 *                 estimatedDelivery:
 *                   type: string
 *                   format: date-time
 *                 statusHistory:
 *                   type: array
 *                   items:
 *                     $ref: '#/components/schemas/OrderStatus'
 *                 statusFlow:
 *                   type: array
 *                   items:
 *                     $ref: '#/components/schemas/OrderStatus'
 *                 items:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       productId:
 *                         type: string
 *                       name:
 *                         type: string
 *                       price:
 *                         type: number
 *                       quantity:
 *                         type: integer
 *                 total:
 *                   type: number
 *                   format: float
 *       400:
 *         description: Bad request - Missing or invalid fields
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 error:
 *                   type: string
 *                   description: Description of the error.
 *       500:
 *         description: Internal server error
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 error:
 *                   type: string
 *                   description: Description of the server error.
 */
router.post('/create-order', async (req, res) => {
  try {
    const { items, name, email, shippingAddress, cardNumber, cardName, expiry, cvc } = req.body;

    if (!Array.isArray(items) || !items.length || !name || !email || !shippingAddress || !cardNumber || !cardName || !expiry || !cvc) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    const trimmedEmail = String(email).trim();
    const trimmedName = String(name).trim();
    const trimmedAddress = String(shippingAddress).trim();

    if (!trimmedName || !trimmedAddress) {
      return res.status(400).json({ error: 'Name and shipping address are required.' });
    }

    if (!emailRegex.test(trimmedEmail)) {
      return res.status(400).json({ error: 'Invalid email format' });
    }

    const sanitizedCardNumber = String(cardNumber).replace(/\s+/g, '');
    const sanitizedExpiry = String(expiry).trim();
    const sanitizedCvc = String(cvc).trim();
    const trimmedCardName = String(cardName).trim();

    if (!SKIP_CARD_VALIDATION) {
      if (!trimmedCardName) {
        return res.status(400).json({ error: 'Name on card is required.' });
      }

      if (!/^\d{12,19}$/.test(sanitizedCardNumber)) {
        return res.status(400).json({ error: 'Invalid card number' });
      }

      if (!/^(0[1-9]|1[0-2])\/(?:\d{2}|\d{4})$/.test(sanitizedExpiry)) {
        return res.status(400).json({ error: 'Invalid expiry date' });
      }

      if (!/^\d{3,4}$/.test(sanitizedCvc)) {
        return res.status(400).json({ error: 'Invalid CVC' });
      }
    }

    const normalizedItems = [];
    for (const item of items) {
      const productId = Number(item?.productId ?? item?.id);
      const quantity = Number.isInteger(item?.quantity) && item.quantity > 0 ? item.quantity : 1;

      if (!Number.isInteger(productId) || productId <= 0) {
        return res.status(400).json({ error: 'Invalid product reference in order payload.' });
      }

      normalizedItems.push({
        productId,
        quantity,
      });
    }

    const productIds = [...new Set(normalizedItems.map(item => item.productId))];
    const products = await prisma.product.findMany({ where: { id: { in: productIds } } });

    if (products.length !== productIds.length) {
      return res.status(400).json({ error: 'One or more products are no longer available.' });
    }

    const productMap = new Map(products.map(product => [Number(product.id), product]));

    const orderItems = normalizedItems.map(item => {
      const product = productMap.get(item.productId);
      return {
        productId: product.id,
        name: product.name,
        price: Number(product.price),
        quantity: item.quantity,
        image: product.image,
      };
    });

    const orderTotal = orderItems.reduce((sum, item) => sum + item.price * item.quantity, 0);

    const orderNumber = await generateOrderNumber();
    const estimatedDelivery = new Date(Date.now() + randomInt(2, 6) * 24 * 60 * 60 * 1000);

    const orderData = {
      orderNumber,
      email: trimmedEmail.toLowerCase(),
      name: trimmedName,
      shippingAddress: trimmedAddress,
      total: orderTotal,
      statusIndex: 0,
      estimatedDelivery,
      items: {
        create: orderItems.map(item => ({
          productId: Number.isFinite(item.productId) ? item.productId : null,
          name: item.name,
          price: item.price,
          quantity: item.quantity,
          image: item.image,
        })),
      },
      statusHistory: {
        create: ensureInitialStatus({ statusHistory: [], statusIndex: 0 }).statusHistory,
      },
    };

    const order = await prisma.order.create({
      data: orderData,
      include: {
        items: true,
        statusHistory: { orderBy: { enteredAt: 'asc' } },
      },
    });

    res.status(201).json({
      message: 'Order created successfully!',
      orderNumber,
      estimatedDelivery,
      statusHistory: order.statusHistory,
      statusFlow: ORDER_STATUS_FLOW,
      items: order.items,
      total: Number(order.total),
    });
  } catch (error) {
    console.error('Error creating order:', error);
    res.status(500).json({ error: 'Failed to create order' });
  }
});

module.exports = router;
