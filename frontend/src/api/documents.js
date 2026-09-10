import { apiFetch, apiFetchBlob } from './client';

// resourceType matches the route prefix each resource mounts its own /:id/documents under
// (quotations, orders, invoices, deliveries) -- see src/services/documentService.js RESOURCE_MAP.
export const listDocuments = (resourceType, id) => apiFetch(`/${resourceType}/${id}/documents`);
export const getDocumentBlob = (resourceType, id, attachmentId) =>
  apiFetchBlob(`/${resourceType}/${id}/documents/${attachmentId}`);
