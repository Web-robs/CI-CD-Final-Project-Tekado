const ORDER_STATUS_FLOW = [
  {
    code: 'ORDER_PLACED',
    label: 'Order placed',
    description: 'We received your order and secured the inventory in our warehouse.',
  },
  {
    code: 'PAYMENT_VERIFIED',
    label: 'Payment verified',
    description: 'Your payment cleared successfully and funds have been captured securely.',
  },
  {
    code: 'PICKING_ITEMS',
    label: 'Picking items',
    description: 'Our fulfillment team is picking each item and preparing the packaging.',
  },
  {
    code: 'QUALITY_CHECK',
    label: 'Quality assurance',
    description: 'Every component passes a quick diagnostics check before sealing the box.',
  },
  {
    code: 'PACKED_FOR_SHIPMENT',
    label: 'Packed for shipment',
    description: 'Packaging is sealed with tamper protection and awaiting carrier handoff.',
  },
  {
    code: 'HANDOFF_TO_CARRIER',
    label: 'Handed to carrier',
    description: 'Your parcel has been scanned by the carrier and is leaving our facility.',
  },
  {
    code: 'IN_TRANSIT',
    label: 'In transit',
    description: 'The shipment is moving through carrier hubs on the way to your region.',
  },
  {
    code: 'AT_LOCAL_DEPOT',
    label: 'Arrived locally',
    description: 'Your order reached the local distribution center and is being sorted.',
  },
  {
    code: 'OUT_FOR_DELIVERY',
    label: 'Out for delivery',
    description: 'A courier has your parcel on the truck and will attempt delivery today.',
  },
  {
    code: 'DELIVERED',
    label: 'Delivered',
    description: 'Delivery confirmed. Check your doorstep or reception area for the package.',
  },
  {
    code: 'DELIVERY_CONFIRMED',
    label: 'Delivery verified',
    description: 'Proof of delivery captured and your order is now closed. Enjoy your gear!',
  },
];

const ensureInitialStatus = order => {
  if (!order.statusHistory || !order.statusHistory.length) {
    const initial = ORDER_STATUS_FLOW[0];
    order.statusHistory = [
      {
        code: initial.code,
        label: initial.label,
        description: initial.description,
        enteredAt: new Date(),
      },
    ];
    order.statusIndex = 0;
  }
  return order;
};

const advanceStatus = order => {
  if (order.statusIndex >= ORDER_STATUS_FLOW.length - 1) {
    return { advanced: false, updates: [] };
  }

  const remaining = ORDER_STATUS_FLOW.length - 1 - order.statusIndex;
  const maxJump = Math.min(2, remaining);
  const jump = Math.max(1, Math.floor(Math.random() * (maxJump + 1)));
  const targetIndex = Math.min(order.statusIndex + jump, ORDER_STATUS_FLOW.length - 1);

  const updates = [];
  for (let i = order.statusIndex + 1; i <= targetIndex; i += 1) {
    const meta = ORDER_STATUS_FLOW[i];
    updates.push({
      code: meta.code,
      label: meta.label,
      description: meta.description,
      enteredAt: new Date(),
    });
  }

  if (updates.length) {
    order.statusHistory = [...(order.statusHistory || []), ...updates];
    order.statusIndex = targetIndex;
    return { advanced: true, updates };
  }

  return { advanced: false, updates: [] };
};

module.exports = {
  ORDER_STATUS_FLOW,
  ensureInitialStatus,
  advanceStatus,
};
