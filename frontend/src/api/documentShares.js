import { apiFetch, apiFetchForm, apiFetchBlob } from './client';

// Recipient (customer) side
export const listInbox = () => apiFetch('/documents');
export const downloadShared = (id) => apiFetchBlob(`/documents/${id}/download`);

// Sender (internal staff) side
export const listSent = () => apiFetch('/documents/sent');
export const searchRecipients = (q) =>
  apiFetch(`/documents/recipients/search?q=${encodeURIComponent(q || '')}`);
export const shareDocument = (formData) => apiFetchForm('/documents', formData);
export const revokeShare = (id) => apiFetch(`/documents/${id}/revoke`, { method: 'POST' });
