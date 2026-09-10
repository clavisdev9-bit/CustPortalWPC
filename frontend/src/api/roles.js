import { apiFetch } from './client';

export function listRoles() {
  return apiFetch('/roles');
}
