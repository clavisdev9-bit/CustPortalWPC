import { useEffect, useRef, useState } from 'react';
import { listNotifications, markNotificationRead, markAllNotificationsRead } from '../api/notifications';

// Section 21's "tahap awal" real-time approach: the client polls every 30-60s rather than the
// backend running its own background job. Each call to GET /notifications also triggers a
// throttled server-side check for Odoo-side changes (see notificationService.checkForUpdates).
const POLL_INTERVAL_MS = 45_000;

// Controlled by the parent (AppShell) rather than owning its own open/closed state, so the
// sidebar's "Notifications" nav item -- which has no route of its own, see AppShell.jsx -- can
// open this same panel instead of duplicating a notifications page.
export default function NotificationBell({ open, onOpenChange }) {
  const [data, setData] = useState({ data: [], meta: { unread: 0 } });
  // BUG-33. Sebelumnya kegagalan di sini ditelan `catch {}` kosong: lonceng tetap menampilkan data
  // lama tanpa satu pun tanda bahwa isinya sudah basi. Karena widget ini yang paling sering memanggil
  // API (tiap 45 detik), ia juga yang paling sering menjadi permintaan pertama yang menemukan access
  // token kedaluwarsa -- jadi `401` di tab Network hampir selalu muncul di `/notifications`. Itu
  // normal dan langsung dipulihkan apiFetch. Yang TIDAK normal adalah kegagalan sesudah percobaan
  // ulang, dan dulu keduanya terlihat persis sama dari layar: sama-sama tidak ada apa-apa.
  //
  // Widget ini tetap tidak boleh menjatuhkan topbar -- error disimpan sebagai state, bukan dilempar.
  const [failure, setFailure] = useState(null);
  const mounted = useRef(true);

  async function refresh() {
    try {
      const next = await listNotifications({ page_size: 10 });
      if (!mounted.current) return;
      setData(next);
      setFailure(null);
    } catch (err) {
      if (!mounted.current) return;
      setFailure(err.message);
    }
  }

  useEffect(() => {
    mounted.current = true;
    refresh();
    const interval = setInterval(refresh, POLL_INTERVAL_MS);
    return () => {
      mounted.current = false;
      clearInterval(interval);
    };
  }, []);

  useEffect(() => {
    if (open) refresh();
  }, [open]);

  function toggle() {
    onOpenChange(!open);
  }

  async function handleMarkRead(id) {
    await markNotificationRead(id);
    await refresh();
  }

  async function handleMarkAllRead() {
    await markAllNotificationsRead();
    await refresh();
  }

  return (
    <div className="notification-bell">
      <button
        className="notification-bell__toggle"
        onClick={toggle}
        title={failure ? `Notifikasi tidak bisa dimuat: ${failure}` : undefined}
      >
        Notifications{data.meta.unread > 0 ? ` (${data.meta.unread})` : ''}
        {failure && <span aria-label="gagal memuat notifikasi"> !</span>}
      </button>
      {open && (
        <div className="notification-bell__panel">
          <div className="notification-bell__header">
            <span>Notifications</span>
            <button onClick={handleMarkAllRead}>Mark all read</button>
          </div>
          {failure && (
            <p className="error">
              Gagal memuat: {failure}{' '}
              <button type="button" className="link-button" onClick={refresh}>Coba lagi</button>
            </p>
          )}
          {data.data.length === 0 ? (
            <p className="muted">No notifications.</p>
          ) : (
            <ul>
              {data.data.map((n) => (
                <li key={n.id} className={n.read_at ? '' : 'notification-bell__unread'}>
                  <strong>{n.title}</strong>
                  {n.body && <div className="muted">{n.body}</div>}
                  {!n.read_at && <button onClick={() => handleMarkRead(n.id)}>Mark read</button>}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
