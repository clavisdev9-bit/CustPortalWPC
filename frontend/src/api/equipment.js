import { apiFetch } from './client';

export const listEquipment = () => apiFetch('/equipment');
export const getEquipment = (id) => apiFetch(`/equipment/${id}`);
export const getEquipmentParts = (id) => apiFetch(`/equipment/${id}/parts`);
export const getDueReplacements = () => apiFetch('/equipment/due-replacements');
export const getEquipmentServiceHistory = (id) => apiFetch(`/equipment/${id}/service-history`);
export const listEquipmentCorrections = () => apiFetch('/equipment/corrections');
// equipment_id lives in the body, not the URL -- matches the backend's flat POST /equipment/corrections
// (see equipmentValidators.js for why: the same schema also serves the assistant draft flow).
export const createEquipmentCorrection = (body) => apiFetch('/equipment/corrections', { method: 'POST', body });
