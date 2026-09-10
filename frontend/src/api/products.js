import { apiFetch } from './client';

export const listProducts = () => apiFetch('/products');
export const getPurchaseHistory = () => apiFetch('/products/purchase-history');
export const getReorderSuggestions = () => apiFetch('/products/reorder-suggestions');
