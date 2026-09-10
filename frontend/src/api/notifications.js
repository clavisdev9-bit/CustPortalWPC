import { apiFetch } from './client';

export const listNotifications = (params = {}) => {
  const qs = new URLSearchParams(params).toString();
  return apiFetch(`/notifications${qs ? `?${qs}` : ''}`);
};
export const markNotificationRead = (id) => apiFetch(`/notifications/${id}/read`, { method: 'POST' });
export const markAllNotificationsRead = () => apiFetch('/notifications/read-all', { method: 'POST' });
