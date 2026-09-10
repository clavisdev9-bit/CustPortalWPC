import { apiFetch } from './client';

export const listContacts = () => apiFetch('/contacts');
