import { apiFetch } from './client';

export const getDashboardSummary = () => apiFetch('/dashboard/summary');
