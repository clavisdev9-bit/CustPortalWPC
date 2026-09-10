import { apiFetch, apiFetchBlob } from './client';

export const listOrders = () => apiFetch('/orders');
export const getOrder = (id) => apiFetch(`/orders/${id}`);
export const getOrderPdfBlob = (id) => apiFetchBlob(`/orders/${id}/pdf`);
export const reorder = (id) => apiFetch(`/orders/${id}/reorder`, { method: 'POST' });
export const listOrderLines = (id) => apiFetch(`/orders/${id}/lines`);
export const listOrderMessages = (id) => apiFetch(`/orders/${id}/messages`);
export const postOrderMessage = (id, body) =>
  apiFetch(`/orders/${id}/messages`, { method: 'POST', body: { body } });
