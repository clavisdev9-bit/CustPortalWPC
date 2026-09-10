import { apiFetch } from './client';

export const listRequests = () => apiFetch('/requests');
export const createRequest = (body) => apiFetch('/requests', { method: 'POST', body });
