import { apiFetch } from './client';

export const listSubscriptions = () => apiFetch('/subscriptions');
export const getSubscription = (id) => apiFetch(`/subscriptions/${id}`);
export const requestRenew = (id, note) => apiFetch(`/subscriptions/${id}/renew`, { method: 'POST', body: { note } });
export const requestUpgrade = (id, note) => apiFetch(`/subscriptions/${id}/upgrade`, { method: 'POST', body: { note } });
export const requestDowngrade = (id, note) =>
  apiFetch(`/subscriptions/${id}/downgrade`, { method: 'POST', body: { note } });
export const requestClose = (id, note) => apiFetch(`/subscriptions/${id}/close`, { method: 'POST', body: { note } });
