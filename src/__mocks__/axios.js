const axiosInstance = {
  interceptors: {
    request: { use: jest.fn() },
    response: { use: jest.fn() },
  },
  defaults: {
    baseURL: '',
  },
  get: jest.fn(),
  // Provide a safe default response so components that don't mock apiClient won't crash in tests.
  post: jest.fn(() => Promise.resolve({ data: { orderNumber: '123', items: [], total: 0 } })),
  put: jest.fn(),
  patch: jest.fn(),
  delete: jest.fn(),
};

const axios = {
  create: jest.fn((config) => {
    axiosInstance.defaults.baseURL = config?.baseURL || '';
    return axiosInstance;
  }),
  ...axiosInstance,
};

module.exports = axios;
