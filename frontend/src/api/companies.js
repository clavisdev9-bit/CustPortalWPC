import { apiFetch } from './client';

export function listCompanies() {
  return apiFetch('/companies');
}

export function getCurrentCompany() {
  return apiFetch('/companies/current');
}

export function switchCompany(companyId) {
  return apiFetch('/companies/switch', { method: 'POST', body: { company_id: companyId } });
}
