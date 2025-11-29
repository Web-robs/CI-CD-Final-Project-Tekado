const express = require('express');
const prisma = require('../prismaClient');
const { ORDER_STATUS_FLOW, ensureInitialStatus, advanceStatus } = require('../utils/orderStatus');

const router = express.Router();

const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * @swagger
 * /api/orders/track:
 *   post:
 *     summary: Get the current status of an order
 *     tags:
 *       - Orders
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - orderNumber
 *               - email
 *             properties:
 *               orderNumber:
 *                 type: string
 *                 example: FE-123456
 *               email:
 *                 type: string
 *                 format: email
 *     responses:
 *       200:
 *         description: Order status payload
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 orderNumber:
 *                   type: string
 *                 currentStatus:
 *                   type: object
 *                   properties:
 *                     code:
 *                       type: string
 *                     label:
 *                       type: string
 *                     description:
 *                       type: string
 *                     enteredAt:
 *                       type: string
 *                       format: date-time
 *                 statusHistory:
 *                   type: array
 *                   items:
 *                     $ref: '#/components/schemas/OrderStatus'
 *                 statusFlow:
 *                   type: array
 *                   items:
 *                     $ref: '#/components/schemas/OrderStatus'
 *       404:
 *         description: Order not found
 *       400:
 *         description: Validation error
 */

router.post('/track', async (req, res) => {
  try {
    const { orderNumber, email } = req.body || {};

    if (!orderNumber || !email) {
      return res.status(400).json({ error: 'Order number and email are required.' });
    }

    const normalizedOrderNumber = String(orderNumber).trim().toUpperCase();
    const normalizedEmail = String(email).trim().toLowerCase();

    if (!normalizedOrderNumber.startsWith('FE-')) {
      return res.status(400).json({ error: 'Invalid order number format.' });
    }

    if (!emailRegex.test(normalizedEmail)) {
      return res.status(400).json({ error: 'Invalid email format.' });
    }

    const order = await prisma.order.findUnique({
      where: { orderNumber: normalizedOrderNumber },
      include: {
        statusHistory: { orderBy: { enteredAt: 'asc' } },
        items: true,
      },
    });

    if (!order || order.email !== normalizedEmail) {
      return res.status(404).json({ error: 'Order not found. Double-check your email and order number.' });
    }

    const orderState = {
      statusIndex: order.statusIndex ?? 0,
      statusHistory: [...order.statusHistory],
    };

    const creates = [];
    if (!orderState.statusHistory.length) {
      ensureInitialStatus(orderState);
      creates.push(...orderState.statusHistory);
    }

    let advanced = false;
    if (orderState.statusIndex < ORDER_STATUS_FLOW.length - 1) {
      const shouldAdvance = orderState.statusHistory.length > 1 ? Math.random() < 0.75 : Math.random() < 0.35;
      if (shouldAdvance) {
        const { advanced: didAdvance, updates } = advanceStatus(orderState);
        advanced = didAdvance;
        creates.push(...updates);
      }
    }

    if (creates.length) {
      await prisma.order.update({
        where: { id: order.id },
        data: {
          statusIndex: orderState.statusIndex,
          statusHistory: {
            create: creates.map(entry => ({
              code: entry.code,
              label: entry.label,
              description: entry.description,
              enteredAt: entry.enteredAt || new Date(),
            })),
          },
        },
      });
    }

    const latestHistory = [...orderState.statusHistory].sort((a, b) => new Date(a.enteredAt) - new Date(b.enteredAt));

    const responsePayload = {
      orderNumber: order.orderNumber,
      email: order.email,
      currentStatus: latestHistory[latestHistory.length - 1],
      statusHistory: latestHistory,
      statusFlow: ORDER_STATUS_FLOW,
      total: Number(order.total),
      items: order.items,
      estimatedDelivery: order.estimatedDelivery,
      createdAt: order.createdAt,
      updatedAt: order.updatedAt,
    };

    res.json(responsePayload);
  } catch (error) {
    console.error('Error tracking order:', error);
    res.status(500).json({ error: 'Unable to fetch order status right now.' });
  }
});

module.exports = router;
