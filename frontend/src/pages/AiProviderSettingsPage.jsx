import { useEffect, useState } from 'react';
import { useAuth } from '../context/AuthContext';
import {
  listAssistantSettings, saveAssistantSettings,
  listAssistantProviderConfigs, saveAssistantProviderConfig,
  testAssistantProviderConnection,
} from '../api/adminAssistant';
import ModelPicker from '../components/ModelPicker';
import ToastStack, { useToasts } from '../components/Toast';

// My Account > Konfigurasi Provider AI. Platform-admin only -- gerbang sebenarnya ada di backend
// (requirePlatformAdmin di adminAssistant.routes.js), ini cek kosmetik, pola sama
// OdooConnectionSettingsPage.jsx / AssistantAdminPage.jsx.
//
// Terpisah dari /admin/assistant (AssistantAdminPage.jsx): halaman itu menyimpan enabled/
// temperature/kuota (parameter bersama, satu slot). Halaman ini menyimpan model + API key MASING-
// MASING provider secara independen (assistant_provider_configs, 0012_assistant_provider_configs.sql)
// -- berganti "Provider Aktif" tidak menghapus konfigurasi provider lain.
//
// CR-049 menyusun ulang tampilannya di sekitar satu pertanyaan yang dulu paling sulit dijawab di
// sini: "permintaan asisten berikutnya diproses siapa?". Tiga radio button menjawabnya dengan
// setara padahal jawabannya tidak setara -- satu provider aktif, dua lainnya cadangan. Karena itu
// yang aktif punya kartunya sendiri di paling atas, dan perpindahannya lewat konfirmasi.
//
// Dua status yang tampil berdampingan di tiap kartu sengaja TIDAK digabung:
//   Aktif/Tidak aktif -> keputusan admin, mana yang melayani permintaan
//   Terhubung/…       -> hasil Test Connection terakhir, apa kata provider
// Kombinasinya yang informatif: "aktif + tidak terhubung" berarti asisten sedang rusak sekarang;
// "tidak aktif + terhubung" berarti provider itu siap dijadikan cadangan.

const PROVIDERS = [
  {
    key: 'gemini',
    label: 'Google (Gemini)',
    short: 'Gemini',
    mark: 'G',
    type: 'Cloud AI',
    description: 'Model multimodal Google. Butuh API key dari Google AI Studio.',
  },
  {
    key: 'claude',
    label: 'Anthropic (Claude)',
    short: 'Claude',
    mark: 'A',
    type: 'Cloud AI',
    description: 'Asisten Anthropic. Butuh API key dari console.anthropic.com.',
  },
  {
    key: 'ollama',
    label: 'Ollama (lokal / cloud)',
    short: 'Ollama',
    mark: 'O',
    type: 'Local AI',
    description: 'Model open-source yang berjalan di infrastruktur sendiri, atau lewat ollama.com.',
  },
];

function providerMeta(key) {
  return PROVIDERS.find((p) => p.key === key) || { key, label: key, short: key, mark: '?', type: '-' };
}

function formatDateTime(value) {
  if (!value) return null;
  return new Date(value).toLocaleString('id-ID', { dateStyle: 'medium', timeStyle: 'short' });
}

// Terjemahan health_status (migrasi 0016) ke badge. `not_configured` dan `null` dibedakan dengan
// sengaja: yang pertama berarti "tidak ada yang bisa diuji", yang kedua "belum pernah diuji" --
// dan cuma yang kedua yang bisa diperbaiki dengan menekan tombol Test Connection.
function healthBadge(config, requiresKey) {
  if (requiresKey && !config?.has_api_key) return { tone: 'neutral', label: 'Belum dikonfigurasi' };
  switch (config?.health_status) {
    case 'connected': return { tone: 'success', label: 'Terhubung' };
    case 'degraded': return { tone: 'warning', label: 'Terhubung, model bermasalah' };
    case 'error': return { tone: 'danger', label: 'Tidak terhubung' };
    default: return { tone: 'neutral', label: 'Belum diuji' };
  }
}

// CR-048. Kotak kunci API yang menyatakan keadaannya sendiri.
//
// Sebelumnya field ini selalu tampil kosong, baik kuncinya sudah tersimpan maupun belum -- satu-
// satunya petunjuk adalah teks abu-abu kecil di label. Kotak kosong pada halaman konfigurasi
// berarti "belum diisi" bagi hampir semua orang, jadi admin mengisi ulang kunci yang sebenarnya
// sudah benar, atau menyimpulkan penyimpanannya gagal.
//
// Yang ditampilkan hanya keberadaannya. Backend tidak pernah mengembalikan kuncinya dalam bentuk
// apa pun -- bukan potongannya, bukan panjangnya (lihat toProviderConfigDto di
// adminAssistantController.js) -- jadi titik-titik ini panjangnya tetap dan tidak menggambarkan
// isi kunci. Menampilkan empat karakter terakhir memang lazim di produk lain, tapi itu keputusan
// backend yang berbeda dan bukan bagian dari CR ini.
function SecretField({ label, hint, saved, updatedAt, value, onChange, placeholder, inputId }) {
  const [editing, setEditing] = useState(false);
  const showSaved = saved && !editing;

  // Sesudah form disimpan, baris config dimuat ulang dan `updatedAt` berubah -- itu sinyal yang
  // tepat untuk kembali ke tampilan "Tersimpan". Tanpa ini kotak input tetap terbuka dan kosong
  // sesudah menyimpan, yang persis kebingungan yang field ini ada untuk menghapus.
  useEffect(() => { setEditing(false); }, [updatedAt]);

  return (
    <div className="secret-field">
      <label htmlFor={inputId}>
        {label}
        {hint && <span className="muted"> {hint}</span>}
      </label>

      {showSaved ? (
        <div className="secret-field__saved">
          <span className="pill pill--success">Tersimpan</span>
          <span className="secret-field__mask" aria-label="Kunci API tersembunyi">••••••••••••••••</span>
          <button type="button" className="link-button" onClick={() => setEditing(true)}>Ganti</button>
          {updatedAt && (
            <span className="secret-field__hint">diperbarui {formatDateTime(updatedAt)}</span>
          )}
        </div>
      ) : (
        <>
          <input
            id={inputId}
            type="password"
            autoComplete="off"
            value={value}
            placeholder={placeholder}
            onChange={(e) => onChange(e.target.value)}
          />
          <span className="secret-field__hint">
            {saved
              ? 'Kunci lama masih berlaku sampai form ini disimpan. Kosongkan lalu simpan untuk menghapusnya.'
              : 'Belum ada kunci tersimpan untuk provider ini.'}
            {saved && (
              <>
                {' '}
                {/* `undefined`, bukan '': keduanya berbeda arti saat disimpan. '' berarti "hapus
                    kuncinya" (itu yang dijanjikan kalimat di atas), sedangkan Batal berarti
                    "tidak jadi menyentuhnya sama sekali". Mengirim '' di sini akan menghapus kunci
                    yang masih dipakai, tanpa satu pun konfirmasi. */}
                <button type="button" className="link-button" onClick={() => { setEditing(false); onChange(undefined); }}>Batal</button>
              </>
            )}
          </span>
        </>
      )}
    </div>
  );
}

// Konfirmasi pindah provider. Dibuat lokal, bukan komponen bersama, karena satu-satunya pemakainya
// halaman ini -- dan dialog generik yang benar (focus trap, restore focus, inert di belakang)
// adalah pekerjaan tersendiri yang tidak pantas ditebak sambil lalu. Yang minimal tapi wajib ada
// tetap dipasang: Escape menutup, klik latar menutup, dan fokus awal ke tombol batal.
function SwitchProviderModal({ from, to, onCancel, onConfirm, busy }) {
  useEffect(() => {
    function onKey(e) { if (e.key === 'Escape') onCancel(); }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onCancel]);

  return (
    <div className="modal-overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) onCancel(); }}>
      <div className="modal" role="dialog" aria-modal="true" aria-labelledby="switch-provider-title">
        <h2 className="modal__title" id="switch-provider-title">Ganti provider AI?</h2>
        <p className="muted">
          Semua permintaan asisten yang baru akan diproses oleh {providerMeta(to).short} setelah ini.
          Percakapan yang sudah ada tidak dihapus, dan konfigurasi {providerMeta(from).short} tetap tersimpan.
        </p>
        <div className="modal__switch">
          <span className={`provider-mark provider-mark--sm provider-mark--${from}`}>{providerMeta(from).mark}</span>
          <strong>{providerMeta(from).short}</strong>
          <span aria-hidden="true">&rarr;</span>
          <span className={`provider-mark provider-mark--sm provider-mark--${to}`}>{providerMeta(to).mark}</span>
          <strong>{providerMeta(to).short}</strong>
        </div>
        <div className="modal__actions">
          <button type="button" onClick={onCancel} disabled={busy} autoFocus>Batal</button>
          <button type="button" onClick={onConfirm} disabled={busy}>
            {busy ? 'Memindahkan...' : 'Ya, pindahkan'}
          </button>
        </div>
      </div>
    </div>
  );
}

function emptyForm(provider) {
  return {
    provider,
    model: '',
    base_url: '',
    ollama_target: 'auto',
    ollama_model_manual: '',
    base_url_cloud: '',
  };
}

export default function AiProviderSettingsPage() {
  const { user } = useAuth();
  const [activeProvider, setActiveProvider] = useState('ollama');
  const [activatedAt, setActivatedAt] = useState(null);
  // BUG-27 (resolution.md): asisten sempat mati tanpa ada satu pun sinyal yang terlihat di
  // halaman config provider -- toggle "Aktif" cuma ada di /admin/assistant lama, jadi admin yang
  // hanya membuka halaman ini tidak tahu konfigurasi yang barusan disimpan sebenarnya tidak
  // pernah dipakai. Status ini dibaca ulang tiap reload() supaya selalu mencerminkan DB, bukan
  // asumsi klien.
  const [assistantEnabled, setAssistantEnabled] = useState(null);
  const [togglingEnabled, setTogglingEnabled] = useState(false);
  const [configs, setConfigs] = useState({});
  const [forms, setForms] = useState({ claude: emptyForm('claude'), gemini: emptyForm('gemini'), ollama: emptyForm('ollama') });
  const [apiKeys, setApiKeys] = useState({});
  const [apiKeysCloud, setApiKeysCloud] = useState({});
  const [loading, setLoading] = useState(true);
  const [switchingProvider, setSwitchingProvider] = useState(false);
  const [switchTarget, setSwitchTarget] = useState(null);
  const [configuring, setConfiguring] = useState(null);
  const [testing, setTesting] = useState(null);
  const [message, setMessage] = useState(null);
  const [error, setError] = useState(null);
  const [savingProvider, setSavingProvider] = useState(null);
  // CR-048. Hasil simpan per provider, ditampilkan menempel pada tombolnya masing-masing.
  // Toast-nya sendiri hilang setelah beberapa detik; baris ini yang bertahan, supaya admin yang
  // kembali ke layar ini semenit kemudian masih bisa melihat form mana yang barusan tersimpan.
  const [saveResult, setSaveResult] = useState({});
  const { toasts, push: pushToast, dismiss: dismissToast } = useToasts();

  async function reload() {
    setLoading(true);
    setError(null);
    try {
      const [settingsRows, providerRows] = await Promise.all([
        listAssistantSettings(), listAssistantProviderConfigs(),
      ]);
      const globalSettings = settingsRows.find((s) => s.odoo_connection_id === null) || null;
      setActiveProvider(globalSettings?.provider || 'ollama');
      setActivatedAt(globalSettings?.provider_activated_at || null);
      setAssistantEnabled(Boolean(globalSettings?.enabled));

      const byProvider = {};
      const nextForms = {};
      for (const row of providerRows) {
        byProvider[row.provider] = row;
        nextForms[row.provider] = {
          provider: row.provider,
          model: row.model || '',
          base_url: row.base_url || '',
          ollama_target: row.ollama_target || 'auto',
          ollama_model_manual: row.ollama_model_manual || '',
          base_url_cloud: row.base_url_cloud || '',
        };
      }
      setConfigs(byProvider);
      setForms(nextForms);
      setApiKeys({});
      setApiKeysCloud({});
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (!user?.is_platform_admin) return;
    reload();
  }, [user?.is_platform_admin]);

  if (!user?.is_platform_admin) {
    return <div className="card"><p>Halaman ini hanya untuk platform admin.</p></div>;
  }

  async function confirmSwitch() {
    const provider = switchTarget;
    setSwitchingProvider(true);
    setError(null);
    setMessage(null);
    try {
      await saveAssistantSettings({ odoo_connection_id: null, provider });
      await reload();
      setSwitchTarget(null);
      setMessage('Provider aktif diperbarui.');
      pushToast({
        tone: 'success',
        title: 'Provider aktif diganti',
        description: `Permintaan asisten berikutnya diproses oleh ${providerMeta(provider).short}.`,
      });
    } catch (err) {
      setError(err.message);
      pushToast({ tone: 'error', title: 'Gagal mengganti provider aktif', description: err.message });
    } finally {
      setSwitchingProvider(false);
    }
  }

  async function toggleEnabled() {
    setTogglingEnabled(true);
    setError(null);
    setMessage(null);
    try {
      const next = !assistantEnabled;
      await saveAssistantSettings({ odoo_connection_id: null, enabled: next });
      setAssistantEnabled(next);
      setMessage(next ? 'Asisten diaktifkan.' : 'Asisten dimatikan.');
      pushToast({
        tone: 'success',
        title: next ? 'Asisten diaktifkan' : 'Asisten dimatikan',
        description: next ? 'Pengguna sudah bisa memakai chatbot.' : 'Chatbot berhenti melayani pengguna.',
      });
    } catch (err) {
      setError(err.message);
      pushToast({ tone: 'error', title: 'Gagal mengubah status asisten', description: err.message });
    } finally {
      setTogglingEnabled(false);
    }
  }

  // CR-049. Hasilnya tersimpan di baris config (health_*), jadi reload() sudah cukup untuk
  // memperbarui kartu -- tidak ada state hasil uji yang hidup hanya di klien dan hilang saat
  // halaman dimuat ulang.
  async function handleTest(provider) {
    setTesting(provider);
    setError(null);
    try {
      const result = await testAssistantProviderConnection(provider);
      await reload();
      const tone = result.status === 'connected' ? 'success' : result.status === 'error' ? 'error' : 'info';
      pushToast({ tone, title: `${providerMeta(provider).short}: ${result.status}`, description: result.message });
    } catch (err) {
      setError(err.message);
      pushToast({ tone: 'error', title: `Uji ${providerMeta(provider).short} gagal dijalankan`, description: err.message });
    } finally {
      setTesting(null);
    }
  }

  function field(provider, name, value) {
    setForms((prev) => ({ ...prev, [provider]: { ...prev[provider], [name]: value } }));
  }

  async function submitProvider(provider, e) {
    e.preventDefault();
    const label = providerMeta(provider).label;
    setSavingProvider(provider);
    setError(null);
    setMessage(null);
    setSaveResult((prev) => ({ ...prev, [provider]: null }));
    try {
      const form = forms[provider];
      const body = { provider };
      // `null`, bukan dilewati, saat kosong: melewatinya berarti "jangan sentuh", sehingga model
      // yang salah tidak akan pernah bisa dikosongkan lewat UI ini. Backend memang sudah
      // menerimanya sejak awal (`providerConfigSchema.model` nullable, kolomnya nullable) --
      // halaman inilah yang tidak pernah mengirimkannya.
      body.model = form.model === '' ? null : form.model;
      if (provider === 'ollama') {
        body.ollama_target = form.ollama_target;
        body.ollama_model_manual = form.ollama_model_manual || null;
        body.base_url = form.base_url || null;
        body.base_url_cloud = form.base_url_cloud || null;
      } else {
        body.base_url = form.base_url || null;
      }
      // `undefined` = field tidak disentuh sama sekali -> jangan kirim, backend membiarkan kunci
      // lama. String kosong = admin sengaja mengosongkannya -> kirim, backend menghapus kuncinya.
      // Versi sebelumnya memakai truthiness, jadi '' ikut tersaring dan penghapusan kunci yang
      // dijanjikan teks di SecretField tidak pernah benar-benar bisa dilakukan.
      if (apiKeys[provider] !== undefined) body.api_key = apiKeys[provider];
      if (provider === 'ollama' && apiKeysCloud[provider] !== undefined) body.api_key_cloud = apiKeysCloud[provider];

      const saved = await saveAssistantProviderConfig(body);
      await reload();
      // Yang dilaporkan adalah isi respons backend, bukan asumsi bahwa request-nya berhasil:
      // model yang tampil di notifikasi adalah model yang BENAR-BENAR tersimpan di baris itu.
      // Kalau keduanya berbeda, itu justru yang paling perlu dilihat admin.
      const detail = [
        saved?.model ? `model ${saved.model}` : 'model belum dipilih',
        body.api_key !== undefined ? 'API key diperbarui' : null,
        body.api_key_cloud !== undefined ? 'API key cloud diperbarui' : null,
      ].filter(Boolean).join(' · ');
      setSaveResult((prev) => ({ ...prev, [provider]: { tone: 'success', text: `Tersimpan — ${detail}`, at: new Date() } }));
      setMessage(`Konfigurasi ${label} disimpan.`);
      pushToast({ tone: 'success', title: `${label} tersimpan`, description: detail });
    } catch (err) {
      setSaveResult((prev) => ({ ...prev, [provider]: { tone: 'error', text: `Gagal disimpan: ${err.message}`, at: new Date() } }));
      setError(err.message);
      // Toast error tidak hilang sendiri (lihat Toast.jsx): pesan kegagalan yang lenyap setelah
      // lima detik adalah cara lain untuk tidak memberi tahu apa pun.
      pushToast({ tone: 'error', title: `${label} GAGAL disimpan`, description: err.message });
    } finally {
      setSavingProvider(null);
    }
  }

  // Baris status yang menempel di bawah tombol Simpan tiap form.
  function saveStatus(provider) {
    const result = saveResult[provider];
    if (savingProvider === provider) return <span className="muted">Menyimpan...</span>;
    if (!result) return null;
    return (
      <span className={result.tone === 'error' ? 'error' : 'success'}>
        {result.text} ({result.at.toLocaleTimeString('id-ID')})
      </span>
    );
  }

  // Model yang benar-benar dipakai runtime. Presedensinya harus sama dengan
  // assistantConfigService.resolveOllamaProviderFields -- menampilkan `model` saja akan berbohong
  // untuk Ollama yang memakai Model Manual.
  function effectiveModel(provider) {
    const config = configs[provider];
    return config?.ollama_model_manual || config?.model || null;
  }

  const active = providerMeta(activeProvider);
  const activeHealth = healthBadge(configs[activeProvider], activeProvider !== 'ollama');

  return (
    <div className="ai-provider-settings-page">
      <h1>Konfigurasi Provider AI</h1>
      <p className="muted">
        Kunci API tiap provider disimpan terpisah, jadi berganti provider tidak menghapus
        konfigurasi yang lain.
      </p>
      {error && <p className="error">{error}</p>}
      {message && <p className="success">{message}</p>}

      {!loading && (
        <p className={assistantEnabled ? 'success' : 'error'}>
          Status asisten: <strong>{assistantEnabled ? 'AKTIF' : 'TIDAK AKTIF'}</strong> -- konfigurasi
          provider di bawah tidak berpengaruh apa pun ke pengguna selama status ini nonaktif.{' '}
          <button type="button" onClick={toggleEnabled} disabled={togglingEnabled}>
            {assistantEnabled ? 'Matikan' : 'Aktifkan'} asisten
          </button>
        </p>
      )}

      <section className="provider-hero">
        <div className="provider-hero__main">
          <div className="provider-hero__label">Provider aktif</div>
          <div className="provider-hero__name">
            <span className={`provider-mark provider-mark--${active.key}`}>{active.mark}</span>
            {active.short}
            <span className="pill pill--success">Aktif</span>
            <span className={`pill pill--${activeHealth.tone}`}>{activeHealth.label}</span>
          </div>
          <p className="muted" style={{ margin: 0 }}>
            Permintaan asisten berikutnya diproses oleh {active.short}
            {effectiveModel(activeProvider) ? <> memakai model <strong>{effectiveModel(activeProvider)}</strong></> : ' (model belum dipilih)'}.
          </p>
          <p className="muted" style={{ margin: 'var(--s-2) 0 0' }}>
            {activatedAt
              ? `Aktif sejak ${formatDateTime(activatedAt)}.`
              : 'Waktu pengaktifan tidak tercatat -- provider ini dipilih sebelum pencatatan itu ada.'}
          </p>
        </div>
        <div className="provider-hero__aside">
          <span className={`provider-mark provider-mark--${active.key}`} style={{ width: 56, height: 56, fontSize: '1.5rem' }}>
            {active.mark}
          </span>
          <button type="button" onClick={() => handleTest(activeProvider)} disabled={testing === activeProvider}>
            {testing === activeProvider ? 'Menguji...' : 'Test Connection'}
          </button>
        </div>
      </section>

      <h2>Provider tersedia</h2>
      <div className="provider-grid">
        {PROVIDERS.map((p) => {
          const config = configs[p.key];
          const requiresKey = p.key !== 'ollama';
          const badge = healthBadge(config, requiresKey);
          const isActive = activeProvider === p.key;
          const model = effectiveModel(p.key);
          return (
            <article key={p.key} className={`provider-card${isActive ? ' provider-card--active' : ''}`}>
              <div className="provider-card__head">
                <span className={`provider-mark provider-mark--sm provider-mark--${p.key}`}>{p.mark}</span>
                <span className="provider-card__title">{p.short}</span>
              </div>
              <div className="provider-card__badges">
                <span className={`pill pill--${isActive ? 'success' : 'neutral'}`}>{isActive ? 'Aktif' : 'Tidak aktif'}</span>
                <span className={`pill pill--${badge.tone}`}>{badge.label}</span>
              </div>
              <p className="provider-card__note">{p.description}</p>
              <dl className="provider-card__rows">
                <div className="provider-card__row"><dt>Model</dt><dd>{model || '—'}</dd></div>
                <div className="provider-card__row"><dt>Tipe</dt><dd>{p.type}</dd></div>
                {p.key === 'ollama' && (
                  <div className="provider-card__row">
                    <dt>Endpoint</dt>
                    <dd>{config?.base_url || 'http://localhost:11434'}</dd>
                  </div>
                )}
                <div className="provider-card__row">
                  <dt>Terakhir diuji</dt>
                  <dd>
                    {config?.health_checked_at
                      ? `${formatDateTime(config.health_checked_at)}${config.health_latency_ms != null ? ` · ${config.health_latency_ms} ms` : ''}`
                      : 'belum pernah'}
                  </dd>
                </div>
              </dl>
              {/* health_error menyimpan pesan hasil pemeriksaan terakhir, termasuk saat hasilnya
                  sukses -- lihat komentar di assistantProviderTest. Ditampilkan apa adanya. */}
              {config?.health_error && <p className="provider-card__note">{config.health_error}</p>}
              <div className="provider-card__actions">
                <button type="button" onClick={() => handleTest(p.key)} disabled={testing === p.key}>
                  {testing === p.key ? 'Menguji...' : 'Test Connection'}
                </button>
                <button type="button" onClick={() => setConfiguring(configuring === p.key ? null : p.key)}>
                  {configuring === p.key ? 'Tutup' : 'Konfigurasi'}
                </button>
                {!isActive && (
                  <button type="button" onClick={() => setSwitchTarget(p.key)} disabled={switchingProvider}>
                    Aktifkan
                  </button>
                )}
              </div>
            </article>
          );
        })}
      </div>

      {configuring === 'claude' && (
        <section className="card">
          <h2>Anthropic (Claude)</h2>
          <form onSubmit={(e) => submitProvider('claude', e)} className="form-grid">
            <SecretField
              inputId="claude-api-key"
              label="API Key"
              hint="Kunci API Anthropic."
              saved={Boolean(configs.claude?.has_api_key)}
              updatedAt={configs.claude?.updated_at}
              value={apiKeys.claude || ''}
              onChange={(v) => setApiKeys((prev) => ({ ...prev, claude: v }))}
            />
            <label htmlFor="claude-model">
              Model
              <span className="muted"> Daftar ditanyakan langsung ke Anthropic memakai kunci di atas.</span>
            </label>
            <ModelPicker
              inputId="claude-model"
              provider="claude"
              reloadKey={configs.claude?.updated_at}
              value={forms.claude?.model || ''}
              onChange={(v) => field('claude', 'model', v)}
            />
            <div>
              <button type="submit" disabled={savingProvider === 'claude'}>Simpan Anthropic</button>
              <div style={{ marginTop: 'var(--s-2)' }}>{saveStatus('claude')}</div>
            </div>
          </form>
        </section>
      )}

      {configuring === 'gemini' && (
        <section className="card">
          <h2>Google (Gemini)</h2>
          <form onSubmit={(e) => submitProvider('gemini', e)} className="form-grid">
            <SecretField
              inputId="gemini-api-key"
              label="API Key"
              hint="Kunci API dari Google AI Studio."
              saved={Boolean(configs.gemini?.has_api_key)}
              updatedAt={configs.gemini?.updated_at}
              value={apiKeys.gemini || ''}
              onChange={(v) => setApiKeys((prev) => ({ ...prev, gemini: v }))}
            />
            <label htmlFor="gemini-model">
              Model
              <span className="muted">
                {' '}Daftar ditanyakan langsung ke Google memakai kunci di atas, jadi selalu sama dengan
                yang benar-benar tersedia untuk akun itu (rujukan: ai.google.dev/gemini-api/docs/models).
              </span>
            </label>
            <ModelPicker
              inputId="gemini-model"
              provider="gemini"
              reloadKey={configs.gemini?.updated_at}
              value={forms.gemini?.model || ''}
              onChange={(v) => field('gemini', 'model', v)}
            />
            <div>
              <button type="submit" disabled={savingProvider === 'gemini'}>Simpan Google</button>
              <div style={{ marginTop: 'var(--s-2)' }}>{saveStatus('gemini')}</div>
            </div>
          </form>
        </section>
      )}

      {configuring === 'ollama' && (
        <section className="card">
          <h2>Ollama (lokal / cloud)</h2>
          <form onSubmit={(e) => submitProvider('ollama', e)} className="form-grid">
            <label>
              Target
              <span className="muted"> Otomatis: model 'cloud' ke ollama.com kalau API Key Cloud terisi, kalau kosong diteruskan daemon lokal.</span>
              <select value={forms.ollama?.ollama_target || 'auto'} onChange={(e) => field('ollama', 'ollama_target', e.target.value)}>
                <option value="auto">Otomatis (dari tag model)</option>
                <option value="local">Lokal</option>
                <option value="cloud">Cloud</option>
              </select>
            </label>
            <label htmlFor="ollama-model">
              Model
              <span className="muted">
                {' '}Daftar diambil dari daemon-nya sendiri (`/api/tags`), jadi isinya adalah model yang
                memang sudah di-pull di sana -- bukan daftar tetap yang belum tentu ada.
              </span>
            </label>
            {/* allowManual=false: jalur manual Ollama sudah punya tempatnya sendiri di bawah
                (`ollama_model_manual`, kolom tersendiri dengan semantik resolusi sendiri di
                assistantConfigService). Dua kotak manual yang berebut arti adalah cara pasti
                membuat orang mengisi yang salah. */}
            <ModelPicker
              inputId="ollama-model"
              provider="ollama"
              reloadKey={configs.ollama?.updated_at}
              allowManual={false}
              value={forms.ollama?.model || ''}
              onChange={(v) => field('ollama', 'model', v)}
            />
            <label>
              Model Manual
              <span className="muted"> Kosongkan kalau memakai pilihan di atas. Diisi kalau modelmu belum ada di daftar.</span>
              <input
                value={forms.ollama?.ollama_model_manual || ''}
                onChange={(e) => field('ollama', 'ollama_model_manual', e.target.value)}
                placeholder="deepseek-r1"
              />
            </label>
            <SecretField
              inputId="ollama-api-key-cloud"
              label="API Key Cloud"
              hint="Opsional. Kosongkan kalau daemon lokal sudah 'ollama signin'. Buat kunci di ollama.com/settings/keys."
              saved={Boolean(configs.ollama?.has_api_key_cloud)}
              updatedAt={configs.ollama?.updated_at}
              value={apiKeysCloud.ollama || ''}
              onChange={(v) => setApiKeysCloud((prev) => ({ ...prev, ollama: v }))}
              placeholder="Bearer key dari ollama.com"
            />
            <label>
              URL Lokal
              <span className="muted"> Alamat daemon Ollama.</span>
              <input
                value={forms.ollama?.base_url || ''}
                onChange={(e) => field('ollama', 'base_url', e.target.value)}
                placeholder="http://localhost:11434"
              />
            </label>
            <label>
              URL Cloud
              <span className="muted"> Jarang diubah -- untuk gateway/proxy sendiri.</span>
              <input
                value={forms.ollama?.base_url_cloud || ''}
                onChange={(e) => field('ollama', 'base_url_cloud', e.target.value)}
                placeholder="https://ollama.com"
              />
            </label>
            <div>
              <button type="submit" disabled={savingProvider === 'ollama'}>Simpan Ollama</button>
              <div style={{ marginTop: 'var(--s-2)' }}>{saveStatus('ollama')}</div>
            </div>
          </form>
        </section>
      )}

      {switchTarget && (
        <SwitchProviderModal
          from={activeProvider}
          to={switchTarget}
          busy={switchingProvider}
          onCancel={() => { if (!switchingProvider) setSwitchTarget(null); }}
          onConfirm={confirmSwitch}
        />
      )}

      <ToastStack toasts={toasts} onDismiss={dismissToast} />
    </div>
  );
}
