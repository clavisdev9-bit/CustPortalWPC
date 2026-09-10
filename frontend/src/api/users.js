import { apiFetch } from './client';

export function listUsers(params = {}) {
  const qs = new URLSearchParams(params).toString();
  return apiFetch(`/users${qs ? `?${qs}` : ''}`);
}

export function createUser(body) {
  return apiFetch('/users', { method: 'POST', body });
}

export function updateUser(id, body) {
  return apiFetch(`/users/${id}`, { method: 'PATCH', body });
}

export function disableUser(id) {
  return apiFetch(`/users/${id}`, { method: 'DELETE' });
}
