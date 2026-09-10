import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { getAssistantConfig, sendFeedback, streamAssistantMessage } from '../../api/assistant';
import MessageList from './MessageList';
import Composer from './Composer';
import DraftConfirm from './DraftConfirm';

// Mode degradasi (Fase 1 poin 12): saat provider mati, widget TIDAK hilang dan tidak menampilkan
// error mentah -- ia berubah jadi menu tautan deterministik. Pengguna yang membuka asisten sedang
// mencari sesuatu; mengantarnya ke modul yang tepat tetap menyelesaikan tugasnya tanpa LLM.
const FALLBACK_LINKS = [
  { to: '/invoices', label: 'Invoice & outstanding' },
  { to: '/orders', label: 'Sales order' },
  { to: '/deliveries', label: 'Pengiriman' },
  { to: '/products', label: 'Riwayat pembelian' },
  { to: '/tickets', label: 'Tiket support' },
];

// Kode error yang berarti "asisten sedang tidak bisa dipakai sama sekali". Mode degradasi bersifat
// lengket sampai halaman dimuat ulang, jadi daftar ini sengaja SEMPIT -- mendorong pengguna ke menu
// tautan karena satu kegagalan sesaat berarti merampas asisten yang sebenarnya masih berfungsi.
//
// Yang SENGAJA tidak ada di sini, dan jangan ditambahkan:
//   assistant_rate_limited  -- asisten sehat, pengguna hanya perlu menunggu.
//   assistant_overloaded    -- model sedang sibuk. Sekali gagal layak diulang; kalau berulang,
//                              circuit breaker backend yang akan mengubahnya jadi
//                              assistant_unavailable -- dan barulah kita degradasi.
//   assistant_timeout       -- sama, tombol Ulangi lebih tepat daripada menyerah.
const DEGRADING_CODES = new Set(['assistant_unavailable', 'assistant_not_configured', 'network_unreachable']);

// Kegagalan konteks Odoo (odooContext.resolveIdentity), BUKAN kegagalan asisten: tidak ada yang
// rusak, akun ini memang belum punya jalan ke data pelanggan mana pun. Keduanya dijawab sebagai
// pesan asisten biasa -- bukan `setError` -- karena pesan error merah mengajak pengguna menekan
// "Ulangi", dan mengulang permintaan yang sama tidak akan pernah berhasil sampai konteksnya
// dibetulkan. BUG-29: `no_identity_mapping` dulu jatuh ke cabang else dan membocorkan pesan
// internal berbahasa Inggris ("No Odoo identity mapped for this company's connection") -- paling
// mudah kena di /admin/assistant, karena akun platform admin memang tidak dipetakan ke kontak
// Odoo mana pun (lihat kartu penjelasan sejenis di DashboardPage.jsx, BUG-25).
const CONTEXT_ANSWERS = {
  no_company_selected:
    'Perusahaan aktif belum dipilih. Pilih perusahaan dulu lewat pemilih di kanan atas, lalu tanyakan lagi.',
  no_identity_mapping:
    'Akun Anda belum dipetakan ke kontak Odoo pada perusahaan yang sedang aktif, jadi tidak ada '
    + 'data pelanggan yang bisa saya baca. Coba pilih perusahaan lain lewat pemilih di kanan atas '
    + '— kalau memang seharusnya perusahaan ini, minta platform admin memetakan akun Anda dulu.',
};

const FOCUSABLE = 'button:not([disabled]), input:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])';

let localIdCounter = 0;
const nextLocalId = () => { localIdCounter += 1; return `local-${localIdCounter}`; };

export default function AssistantWidget() {
  const location = useLocation();
  const panelRef = useRef(null);
  const fabRef = useRef(null);
  const abortRef = useRef(null);

  const [config, setConfig] = useState(null);
  const [hidden, setHidden] = useState(false);
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState([]);
  const [streaming, setStreaming] = useState(null);
  const [toolRunning, setToolRunning] = useState(null);
  const [error, setError] = useState(null);
  const [degraded, setDegraded] = useState(false);
  const [conversationId, setConversationId] = useState(null);
  const [draft, setDraft] = useState('');
  const [lastMessage, setLastMessage] = useState(null);
  // Draf aksi tulis yang sedang menunggu keputusan pengguna. Satu saja: dua panel konfirmasi
  // sekaligus membuat "yang mana yang saya setujui" jadi ambigu, dan persetujuan yang ambigu
  // adalah persis yang alur ini ada untuk mencegah.
  const [pendingDraft, setPendingDraft] = useState(null);

  useEffect(() => {
    let cancelled = false;
    getAssistantConfig()
      .then((c) => {
        if (cancelled) return;
        setConfig(c);
        setDegraded(!c.enabled);
      })
      .catch((err) => {
        if (cancelled) return;
        // 403 = pengguna tidak punya 'assistant.use'. Widget disembunyikan sepenuhnya: tombol
        // melayang yang selalu menolak lebih buruk daripada tidak ada tombol sama sekali.
        if (err.status === 403) setHidden(true);
        else { setConfig({ enabled: false, starters: [] }); setDegraded(true); }
      });
    return () => { cancelled = true; };
  }, []);

  // Esc menutup panel, dan fokus dikembalikan ke FAB -- kalau tidak, fokus jatuh ke <body> dan
  // pengguna keyboard kehilangan tempatnya di halaman.
  const close = useCallback(() => {
    setOpen(false);
    fabRef.current?.focus();
  }, []);

  useEffect(() => {
    if (!open) return undefined;
    function onKeyDown(e) {
      if (e.key === 'Escape') {
        e.stopPropagation();
        close();
        return;
      }
      if (e.key !== 'Tab') return;

      // Jebakan Tab: panel ini adalah dialog melayang di atas seluruh portal, jadi Tab yang
      // keluar darinya akan menyusuri seluruh menu navigasi di belakangnya secara tak terlihat.
      const nodes = panelRef.current?.querySelectorAll(FOCUSABLE);
      if (!nodes || nodes.length === 0) return;
      const first = nodes[0];
      const last = nodes[nodes.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    }
    const node = panelRef.current;
    node?.addEventListener('keydown', onKeyDown);
    node?.querySelector('input')?.focus();
    return () => node?.removeEventListener('keydown', onKeyDown);
  }, [open, close, degraded]);

  // Pembatalan saat unmount: tanpa ini, stream yang masih berjalan akan memanggil setState pada
  // komponen yang sudah hilang setiap kali pengguna berpindah halaman saat jawaban mengalir.
  useEffect(() => () => abortRef.current?.abort(), []);

  const send = useCallback(async (text) => {
    setDraft('');
    setError(null);
    setLastMessage(text);
    setMessages((prev) => [...prev, { id: nextLocalId(), role: 'user', content: text, cards: [] }]);

    const controller = new AbortController();
    abortRef.current = controller;
    setStreaming({ content: '' });

    // Kartu giliran ini dikumpulkan di ref, bukan state: event `card` bisa tiba beberapa kali
    // sebelum `done`, dan membacanya kembali dari state di dalam callback yang sama akan
    // membaca nilai lama (closure) alih-alih yang baru saja ditambahkan.
    const pendingCards = [];

    try {
      await streamAssistantMessage({
        conversationId,
        message: text,
        locale: config?.default_locale || 'id',
        route: location.pathname,
        signal: controller.signal,
        onEvent: (event, data) => {
          switch (event) {
            case 'token':
              setStreaming((s) => ({ content: (s?.content || '') + data.delta }));
              break;
            case 'reset':
              // Giliran itu ternyata memanggil tool. Teks yang sudah mengalir adalah pemikiran
              // antara yang belum melewati penjagaan I-4 -- buang, jangan biarkan terbaca.
              setStreaming({ content: '' });
              break;
            case 'tool_call':
              setToolRunning(data.name);
              break;
            case 'card':
              pendingCards.push({ type: data.type, ref: data.ref });
              break;
            case 'draft':
              // Model TIDAK mengeksekusi apa pun -- ia baru menyiapkan draf. Yang muncul di sini
              // adalah panel konfirmasi; eksekusi terjadi kalau pengguna menekan Kirim di sana.
              setPendingDraft(data);
              break;
            case 'done':
              setMessages((prev) => [...prev, {
                id: nextLocalId(),
                serverId: data.message_id,
                role: 'assistant',
                content: data.content,
                cards: [...pendingCards],
                feedback: null,
              }]);
              setConversationId(data.conversation_id);
              break;
            case 'error':
              setError(data.message);
              if (DEGRADING_CODES.has(data.code)) setDegraded(true);
              break;
            default:
              break;
          }
        },
      });
    } catch (err) {
      if (err.name === 'AbortError') return;
      const contextAnswer = CONTEXT_ANSWERS[err.code];
      if (contextAnswer) {
        // Edge case Fase 1: asisten harus BERTANYA, bukan gagal diam-diam.
        setMessages((prev) => [...prev, {
          id: nextLocalId(),
          role: 'assistant',
          content: contextAnswer,
          cards: [],
        }]);
      } else {
        setError(err.message || 'Asisten sedang tidak bisa dihubungi.');
        if (DEGRADING_CODES.has(err.code)) setDegraded(true);
      }
    } finally {
      abortRef.current = null;
      setStreaming(null);
      setToolRunning(null);
    }
  }, [conversationId, config, location.pathname]);

  function stop() {
    abortRef.current?.abort();
  }

  // Nomor tiket di pesan ini berasal dari respons endpoint confirm -- hasil service yang
  // sebenarnya, bukan angka yang diketik model. Aturan I-4 tetap utuh.
  function handleDraftSent(result) {
    setPendingDraft(null);
    setMessages((prev) => [...prev, {
      id: nextLocalId(),
      role: 'assistant',
      content: `Sudah terkirim: ${result.label}.`,
      link: result.deep_link,
      cards: [],
    }]);
  }

  async function submitFeedback(message, rating) {
    // Optimistis: penilaian adalah isyarat sekali klik, dan menunggu round-trip untuk mengubah
    // warna tombol membuatnya terasa tidak merespons.
    setMessages((prev) => prev.map((m) => (m.id === message.id ? { ...m, feedback: rating } : m)));
    try {
      await sendFeedback(message.serverId, { rating });
    } catch {
      setMessages((prev) => prev.map((m) => (m.id === message.id ? { ...m, feedback: null } : m)));
    }
  }

  if (hidden || !config) return null;

  const busy = Boolean(streaming) || Boolean(toolRunning);

  return (
    <div className="assistant-widget">
      {open && (
        <div className="assistant-widget__panel" role="dialog" aria-modal="false" aria-label="Asisten Portal" ref={panelRef}>
          <div className="assistant-widget__header">
            <span>Asisten Portal</span>
            <button type="button" onClick={close} aria-label="Tutup asisten">×</button>
          </div>

          {degraded ? (
            <div className="assistant-widget__fallback">
              <p>Asisten sedang tidak tersedia. Data Anda tetap bisa dibuka langsung:</p>
              <ul>
                {FALLBACK_LINKS.map((link) => (
                  <li key={link.to}><Link to={link.to} onClick={close}>{link.label}</Link></li>
                ))}
              </ul>
            </div>
          ) : (
            <>
              <MessageList
                messages={messages}
                streaming={streaming}
                toolRunning={toolRunning}
                error={error}
                starters={config.starters || []}
                onStarter={send}
                onFeedback={submitFeedback}
              >
                {pendingDraft && (
                  <DraftConfirm
                    draft={pendingDraft}
                    onSent={handleDraftSent}
                    onDismiss={() => setPendingDraft(null)}
                  />
                )}
              </MessageList>
              <Composer
                value={draft}
                onChange={setDraft}
                onSubmit={send}
                onStop={stop}
                onRetry={() => lastMessage && send(lastMessage)}
                busy={busy}
                canRetry={Boolean(error && lastMessage)}
              />
            </>
          )}
        </div>
      )}

      <button
        ref={fabRef}
        type="button"
        className="assistant-widget__fab"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-label={open ? 'Tutup asisten' : 'Buka asisten'}
      >
        {open ? '×' : (
          <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M4 4h16v12H8l-4 4z" />
          </svg>
        )}
      </button>
    </div>
  );
}
