import { apiFetch, apiFetchForm } from './client';

export const listDeliveries = () => apiFetch('/deliveries');
export const getDelivery = (id) => apiFetch(`/deliveries/${id}`);
export const getTracking = (id) => apiFetch(`/deliveries/${id}/tracking`);

export function confirmDelivery(id, { notes, file }) {
  const form = new FormData();
  if (notes) form.append('notes', notes);
  if (file) form.append('signature', file);
  return apiFetchForm(`/deliveries/${id}/confirm`, form);
}
