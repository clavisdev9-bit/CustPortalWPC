import { useCallback, useEffect, useRef, useState } from 'react';

// CR-048. Notifikasi hasil aksi yang muncul di dekat mata, bukan di ujung atas halaman.
//
// Sebelum ini satu-satunya umpan balik "tersimpan / gagal" adalah satu <p> di atas judul halaman.
// Di halaman Konfigurasi Provider AI, tombol Simpan ada ~1.5 layar di bawahnya: admin menekan
// Simpan, tidak ada apa pun yang berubah di sekitarnya, dan tidak punya cara membedakan
// "tersimpan" dari "request-nya gagal diam-diam". Itu keluhan yang memicu CR ini.
//
// Ditulis sendiri, bukan menambah dependency: CLAUDE.md meminta bertanya dulu sebelum menambah
// paket, dan yang dibutuhkan di sini -- antrean pendek, auto-dismiss, dua nada -- muat dalam satu
// file tanpa satu pun trade-off yang menarik untuk didelegasikan ke library.
//
// aria-live="polite" (bukan "assertive"): screen reader mengumumkannya setelah selesai membaca
// yang sedang dibaca, karena ini konfirmasi hasil, bukan peringatan yang memotong.

const DEFAULT_TTL_MS = 5000;

let nextId = 1;

// Hook, bukan context provider global: yang butuh toast sejauh ini satu halaman. Menaikkannya
// jadi provider di App.jsx baru sepadan kalau halaman kedua membutuhkannya -- dan bentuk API-nya
// (`push`) sudah sama, jadi pemindahan itu tidak akan menyentuh pemanggilnya.
export function useToasts(ttlMs = DEFAULT_TTL_MS) {
  const [toasts, setToasts] = useState([]);
  const timers = useRef(new Map());

  const dismiss = useCallback((id) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
    const timer = timers.current.get(id);
    if (timer) {
      clearTimeout(timer);
      timers.current.delete(id);
    }
  }, []);

  const push = useCallback((toast) => {
    const id = nextId++;
    // Error tidak ikut hilang sendiri: pesannya biasanya perlu dibaca ulang atau disalin, dan
    // notifikasi kegagalan yang lenyap setelah 5 detik adalah cara lain untuk tidak memberi tahu.
    const sticky = toast.tone === 'error';
    setToasts((prev) => [...prev.slice(-2), { id, sticky, ...toast }]);
    if (!sticky) timers.current.set(id, setTimeout(() => dismiss(id), ttlMs));
    return id;
  }, [dismiss, ttlMs]);

  useEffect(() => () => {
    for (const timer of timers.current.values()) clearTimeout(timer);
    timers.current.clear();
  }, []);

  return { toasts, push, dismiss };
}

export default function ToastStack({ toasts, onDismiss }) {
  if (!toasts.length) return null;
  return (
    <div className="toast-stack" role="status" aria-live="polite">
      {toasts.map((toast) => (
        <div key={toast.id} className={`toast toast--${toast.tone || 'info'}`}>
          <div className="toast__body">
            <strong className="toast__title">{toast.title}</strong>
            {toast.description && <span className="toast__description">{toast.description}</span>}
          </div>
          <button type="button" className="toast__close" onClick={() => onDismiss(toast.id)} aria-label="Tutup notifikasi">
            &times;
          </button>
        </div>
      ))}
    </div>
  );
}
