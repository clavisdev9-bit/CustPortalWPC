import { useEffect, useRef } from 'react';
import { Link } from 'react-router-dom';
import AssistantCard from './cards/AssistantCard';

// aria-live="polite" ada di elemen yang SAMA sepanjang hidup panel, bukan dipasang pada tiap
// pesan baru: screen reader hanya mengumumkan perubahan di dalam region yang sudah ada saat
// perubahan terjadi. Region yang ikut lahir bersama pesannya tidak pernah terbaca.
export default function MessageList({ messages, streaming, toolRunning, error, starters, onStarter, onFeedback, children }) {
  const endRef = useRef(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: 'end' });
    // `children` dihitung sebagai Boolean, bukan node itu sendiri -- node baru setiap render
    // akan membuat efek ini jalan tiap kali, membanting scroll ke bawah walau pengguna sedang
    // menggulir baca pesan lama.
  }, [messages, streaming, Boolean(children)]);

  const empty = messages.length === 0 && !streaming;

  return (
    <div className="assistant-widget__messages" role="log" aria-live="polite" aria-atomic="false">
      {empty && (
        <div className="assistant-widget__starters">
          <p className="assistant-widget__empty">
            Tanyakan tentang invoice, pesanan, pengiriman, atau riwayat pembelian Anda.
          </p>
          {starters.map((s) => (
            <button key={s} type="button" className="assistant-widget__starter" onClick={() => onStarter(s)}>
              {s}
            </button>
          ))}
        </div>
      )}

      {messages.map((m) => (
        <div key={m.id} className={`assistant-widget__turn assistant-widget__turn--${m.role}`}>
          {m.content && <div className={`assistant-widget__msg assistant-widget__msg--${m.role}`}>{m.content}</div>}

          {(m.cards || []).map((card, i) => (
            <AssistantCard key={`${card.type}-${i}`} type={card.type} cardRef={card.ref} />
          ))}

          {/* Deep link ke record yang baru dibuat lewat aksi tulis. Dirender sebagai Link, bukan
              ditulis model ke dalam teks -- url yang diketik model bisa salah atau dikarang. */}
          {m.link && (
            <Link className="assistant-widget__result-link" to={m.link}>Buka detailnya</Link>
          )}

          {/* Feedback hanya pada pesan asisten yang sudah tersimpan (punya id server). Balasan
              yang masih mengalir belum punya baris di assistant_messages untuk ditautkan. */}
          {m.role === 'assistant' && m.serverId && (
            <div className="assistant-widget__feedback">
              <button
                type="button"
                aria-label="Jawaban ini membantu"
                aria-pressed={m.feedback === 1}
                className={m.feedback === 1 ? 'is-active' : undefined}
                onClick={() => onFeedback(m, 1)}
              >
                👍
              </button>
              <button
                type="button"
                aria-label="Jawaban ini tidak membantu"
                aria-pressed={m.feedback === -1}
                className={m.feedback === -1 ? 'is-active' : undefined}
                onClick={() => onFeedback(m, -1)}
              >
                👎
              </button>
            </div>
          )}
        </div>
      ))}

      {toolRunning && (
        <div className="assistant-widget__status">Mengambil data {toolRunning}…</div>
      )}
      {streaming && !streaming.content && !toolRunning && (
        <div className="assistant-widget__msg assistant-widget__msg--assistant">…</div>
      )}
      {streaming?.content && (
        <div className="assistant-widget__msg assistant-widget__msg--assistant">{streaming.content}</div>
      )}

      {error && <div className="assistant-widget__error" role="alert">{error}</div>}

      {/* Draf konfirmasi dirender DI DALAM area scroll ini, bukan sebagai saudara tetap di luar
          panel. Panel punya max-height keras; kalau draf ditaruh di luar, isinya (termasuk tombol
          Kirim) bisa terpotong diam-diam saat gabungan riwayat pesan + draf lebih tinggi dari
          panel. Di sini kelebihan tinggi tinggal jadi scroll -- bukan hilang. */}
      {children}

      <div ref={endRef} />
    </div>
  );
}
