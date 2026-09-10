import { apiFetch } from './client';

export const getSpendingTrend = () => apiFetch('/analytics/spending-trend');
export const getOrderVolumeTrend = () => apiFetch('/analytics/order-volume-trend');
