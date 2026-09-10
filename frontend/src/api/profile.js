import { apiFetch } from './client';

export const getProfile = () => apiFetch('/profile');
