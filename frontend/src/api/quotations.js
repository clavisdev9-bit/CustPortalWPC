import { apiFetch, apiFetchBlob } from './client';

export const listQuotations = () => apiFetch('/quotations');
export const getQuotation = (id) => apiFetch(`/quotations/${id}`);
export const getQuotationPdfBlob = (id) => apiFetchBlob(`/quotations/${id}/pdf`);
export const approveQuotation = (id) => apiFetch(`/quotations/${id}/approve`, { method: 'POST' });
export const rejectQuotation = (id, reason) =>
  apiFetch(`/quotations/${id}/reject`, { method: 'POST', body: { reason } });
export const signQuotation = (id, signature, signedBy) =>
  apiFetch(`/quotations/${id}/sign`, { method: 'POST', body: { signature, signed_by: signedBy } });
export const listQuotationLines = (id) => apiFetch(`/quotations/${id}/lines`);
export const listQuotationMessages = (id) => apiFetch(`/quotations/${id}/messages`);
export const postQuotationMessage = (id, body) =>
  apiFetch(`/quotations/${id}/messages`, { method: 'POST', body: { body } });
