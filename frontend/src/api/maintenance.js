import { apiFetch } from './client';

export const listMaintenanceRequests = () => apiFetch('/maintenance');
export const getMaintenanceRequest = (id) => apiFetch(`/maintenance/${id}`);
