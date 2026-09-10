import { apiFetch } from './client';

export const listRma = () => apiFetch('/rma');
export const getRma = (id) => apiFetch(`/rma/${id}`);
export const createRma = (body) => apiFetch('/rma', { method: 'POST', body });
