import { apiFetch } from './client';

export const listAddresses = () => apiFetch('/addresses');
