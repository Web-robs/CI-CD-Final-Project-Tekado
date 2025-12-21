import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';

jest.mock('../context/NotificationProvider', () => ({
  useNotifier: () => ({
    notify: jest.fn(),
  }),
}));

jest.mock('../services/apiClient', () => ({
  apiClient: {
    post: jest.fn(() => Promise.resolve({ data: { orderNumber: '123', items: [], total: 0 } })),
  },
  withRetry: jest.fn(fn => fn()),
}));

// Mock the CheckoutForm to simply render a button that calls onSubmit when clicked
jest.mock('../components/CheckoutForm', () => props => <button onClick={() => props.onSubmit({ email: 'test@example.com' })}>Submit Order</button>);

const Checkout = require('../pages/Checkout').default;

describe('<Checkout />', () => {
  it('renders the form initially', () => {
    render(
      <MemoryRouter initialEntries={['/checkout']}>
        <Routes>
          <Route path="/checkout" element={<Checkout cartItems={[]} />} />
          <Route path="/order-success" element={<div>Order success</div>} />
        </Routes>
      </MemoryRouter>
    );
    expect(screen.getByRole('button', { name: /submit order/i })).toBeInTheDocument();
  });

  it('shows loading spinner, then navigates to success', async () => {
    render(
      <MemoryRouter initialEntries={['/checkout']}>
        <Routes>
          <Route path="/checkout" element={<Checkout cartItems={[{ id: '1', _id: '1', name: 'Test Product', price: 100 }]} />} />
          <Route path="/order-success" element={<div>Order success</div>} />
        </Routes>
      </MemoryRouter>
    );

    // click the mock form's submit button
    fireEvent.click(screen.getByRole('button', { name: /submit order/i }));

    // loading spinner should appear
    expect(screen.getByRole('progressbar')).toBeInTheDocument();

    // after API completes, router should render the success route
    await waitFor(() => expect(screen.getByText(/order success/i)).toBeInTheDocument());
  });
});
