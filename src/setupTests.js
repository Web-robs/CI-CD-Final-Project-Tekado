import '@testing-library/jest-dom';

// Axios v1+ ships ESM entrypoints that Jest (in CRA v5) may not transform by default.
// Use a lightweight manual mock for unit tests.
jest.mock('axios');

