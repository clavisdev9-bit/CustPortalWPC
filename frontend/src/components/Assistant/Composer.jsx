import { useRef } from 'react';

export default function Composer({ value, onChange, onSubmit, onStop, onRetry, busy, canRetry }) {
  const inputRef = useRef(null);

  function handleSubmit(e) {
    e.preventDefault();
    if (busy || !value.trim()) return;
    onSubmit(value.trim());
    inputRef.current?.focus();
  }

  return (
    <form className="assistant-widget__composer" onSubmit={handleSubmit}>
      <input
        ref={inputRef}
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="Tulis pertanyaan Anda…"
        aria-label="Pesan untuk asisten"
        // Input SENGAJA tidak di-disable saat sibuk: elemen yang disabled kehilangan fokus,
        // dan fokus yang lompat keluar panel merusak jebakan Tab di AssistantWidget. Yang
        // dicegah adalah pengirimannya (handleSubmit), bukan pengetikannya -- pengguna tetap
        // bisa menyiapkan pertanyaan berikutnya sambil menunggu.
        readOnly={busy}
      />
      {busy ? (
        <button type="button" onClick={onStop} aria-label="Hentikan jawaban">Stop</button>
      ) : (
        <button type="submit" disabled={!value.trim()}>Kirim</button>
      )}
      {!busy && canRetry && (
        <button type="button" className="assistant-widget__retry" onClick={onRetry} aria-label="Coba lagi">
          Ulangi
        </button>
      )}
    </form>
  );
}
