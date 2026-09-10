import { apiFetch, apiFetchForm, apiFetchBlob } from './client';

export const listInvoices = () => apiFetch('/invoices');
export const getOutstanding = () => apiFetch('/invoices/outstanding');
export const getInvoice = (id) => apiFetch(`/invoices/${id}`);
export const createPaymentLink = (id) => apiFetch(`/invoices/${id}/pay`, { method: 'POST' });
export const listPaymentProofs = (id) => apiFetch(`/invoices/${id}/payment-proof`);
export const getInvoicePdfBlob = (id) => apiFetchBlob(`/invoices/${id}/pdf`);

export function uploadPaymentProof(id, file, amount) {
  const form = new FormData();
  form.append('file', file);
  if (amount) form.append('amount', amount);
  return apiFetchForm(`/invoices/${id}/payment-proof`, form);
}
