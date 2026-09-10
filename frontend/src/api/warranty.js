import { apiFetch } from './client';

export const listWarrantyClaims = () => apiFetch('/warranty');
export const getWarrantyClaim = (id) => apiFetch(`/warranty/${id}`);
export const createWarrantyClaim = (body) => apiFetch('/warranty', { method: 'POST', body });
export const lookupSerial = (serial) => apiFetch(`/warranty/lookup-serial?serial=${encodeURIComponent(serial)}`);
