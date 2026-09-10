import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import {
  listAssistantSettings, saveAssistantSettings,
  listAssistantPrompts, createAssistantPrompt, activateAssistantPrompt,
  listAssistantTools, saveAssistantTool,
} from '../api/adminAssistant';

// Admin UI minimal (Fase 1 poin 13): settings global, versi prompt, dan aktif/matikan tool.
// Cakupannya sengaja global (odoo_connection_id = null). Override per-connection sudah didukung
// backend dan skema DB-nya, tapi memilih connection di UI butuh daftar connection yang belum
// punya endpoint frontend-nya -- menambahkannya di sini akan memperluas Fase 1 ke wilayah
// admin/odoo-connections yang belum tersentuh sama sekali.
//
// Provider/Model/Base URL/API key TIDAK ada di form ini lagi -- pindah ke
// My Account > Konfigurasi Provider AI (AiProviderSettingsPage.jsx, assistant_provider_configs).
// Dua form yang sama-sama bisa menulis field yang sama adalah sumber kebenaran ganda; field itu
// masih dibaca dari assistant_settings sebagai fallback kompatibilitas-mundur oleh
// assistantConfigService.resolve, tapi tidak lagi ditulis dari sini.

const NUMERIC_FIELDS = new Set([
  'temperature', 'max_output_tokens', 'max_tool_iterations',
  'history_window', 'daily_message_quota', 'burst_per_minute',
]);

export default function AssistantAdminPage() {
  const { user } = useAuth();
  const [form, setForm] = useState({});
  const [prompts, setPrompts] = useState([]);
  const [tools, setTools] = useState([]);
  const [draft, setDraft] = useState({ key: 'system', locale: 'id', body: '' });
  const [message, setMessage] = useState(null);
  const [error, setError] = useState(null);

  async function reload() {
    const [settingsRows, promptRows, toolRows] = await Promise.all([
      listAssistantSettings(), listAssistantPrompts(), listAssistantTools(),
    ]);
    const global = settingsRows.find((s) => s.odoo_connection_id === null) || null;
    setForm(global ? { ...global } : { enabled: false });
    setPrompts(promptRows);
    setTools(toolRows);
  }

  useEffect(() => {
    if (!user?.is_platform_admin) return;
    reload().catch((err) => setError(err.message));
  }, [user?.is_platform_admin]);

  if (!user?.is_platform_admin) {
    return <div className="card"><p>Halaman ini hanya untuk platform admin.</p></div>;
  }

  function field(name, value) {
    setForm((prev) => ({ ...prev, [name]: NUMERIC_FIELDS.has(name) ? Number(value) : value }));
  }

  async function run(action, successMessage) {
    setError(null);
    setMessage(null);
    try {
      await action();
      await reload();
      setMessage(successMessage);
    } catch (err) {
      setError(err.message);
    }
  }

  function submitSettings(e) {
    e.preventDefault();
    const body = { odoo_connection_id: null };
    for (const key of ['default_locale', ...NUMERIC_FIELDS]) {
      if (form[key] !== undefined && form[key] !== null && form[key] !== '') body[key] = form[key];
    }
    body.enabled = Boolean(form.enabled);

    run(() => saveAssistantSettings(body), 'Settings disimpan. Cache di-invalidasi.');
  }

  return (
    <div className="assistant-admin-page">
      <h1>Asisten Portal</h1>
      {error && <p className="error">{error}</p>}
      {message && <p className="success">{message}</p>}

      <section className="card">
        <h2>Settings (global)</h2>
        <p className="muted">
          Nilai di sini menimpa variabel <code>ASSISTANT_*</code> di env, termasuk tombol aktif.
          Baris per-connection (kalau ada) menimpa yang ini. Provider aktif, model, dan API key
          sekarang dikonfigurasi di <Link to="/settings/ai-provider">My Account &gt; Konfigurasi Provider AI</Link>.
        </p>
        <form onSubmit={submitSettings} className="form-grid">
          <label>
            Aktif
            <input type="checkbox" checked={Boolean(form.enabled)} onChange={(e) => field('enabled', e.target.checked)} />
          </label>
          {[...NUMERIC_FIELDS].map((name) => (
            <label key={name}>
              {name.replace(/_/g, ' ')}
              <input
                type="number"
                step={name === 'temperature' ? '0.05' : '1'}
                value={form[name] ?? ''}
                onChange={(e) => field(name, e.target.value)}
              />
            </label>
          ))}
          <label>
            Default locale
            <select value={form.default_locale || 'id'} onChange={(e) => field('default_locale', e.target.value)}>
              <option value="id">id</option>
              <option value="en">en</option>
            </select>
          </label>
          <button type="submit">Simpan settings</button>
        </form>
      </section>

      <section className="card">
        <h2>Prompt</h2>
        <p className="muted">
          Versi baru selalu dibuat non-aktif. Rollback = aktifkan versi lama. Perubahan berlaku
          pada pesan berikutnya, tanpa restart.
        </p>
        <div className="table-wrap">
          <table className="table--cards">
            <thead>
              <tr><th>Key</th><th>Locale</th><th>Versi</th><th>Aktif</th><th>Dibuat</th><th /></tr>
            </thead>
            <tbody>
              {prompts.map((p) => (
                <tr key={p.id}>
                  <td data-label="Key">{p.key}</td>
                  <td data-label="Locale">{p.locale}</td>
                  <td data-label="Versi">{p.version}</td>
                  <td data-label="Aktif">{p.is_active ? '✓' : ''}</td>
                  <td data-label="Dibuat">{String(p.created_at).slice(0, 10)}</td>
                  <td>
                    {!p.is_active && (
                      <button type="button" onClick={() => run(() => activateAssistantPrompt(p.id), `Versi ${p.version} diaktifkan.`)}>
                        Aktifkan
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <form
          className="form-grid"
          onSubmit={(e) => {
            e.preventDefault();
            run(() => createAssistantPrompt(draft), 'Versi baru dibuat (belum aktif).')
              .then(() => setDraft((d) => ({ ...d, body: '' })));
          }}
        >
          <label>
            Key
            <select value={draft.key} onChange={(e) => setDraft({ ...draft, key: e.target.value })}>
              <option value="system">system</option>
              <option value="refusal">refusal</option>
              <option value="starters">starters</option>
            </select>
          </label>
          <label>
            Locale
            <select value={draft.locale} onChange={(e) => setDraft({ ...draft, locale: e.target.value })}>
              <option value="id">id</option>
              <option value="en">en</option>
            </select>
          </label>
          <label>
            Isi
            <textarea rows={10} required value={draft.body} onChange={(e) => setDraft({ ...draft, body: e.target.value })} />
          </label>
          <button type="submit">Buat versi baru</button>
        </form>
      </section>

      <section className="card">
        <h2>Tool</h2>
        <p className="muted">
          Tool yang dimatikan tidak pernah dikirim ke model. Permission di bawah harus kode yang
          sudah ada di <code>portal_permissions</code>.
        </p>
        <div className="table-wrap">
          <table className="table--cards">
            <thead>
              <tr><th>Tool</th><th>Jenis</th><th>Permission</th><th>Aktif</th></tr>
            </thead>
            <tbody>
              {tools.map((t) => (
                <tr key={t.tool_name}>
                  <td data-label="Tool">{t.tool_name}</td>
                  <td data-label="Jenis">{t.kind}</td>
                  <td data-label="Permission">{t.permission_code}</td>
                  <td data-label="Aktif">
                    <input
                      type="checkbox"
                      checked={t.enabled}
                      aria-label={`Aktifkan ${t.tool_name}`}
                      onChange={(e) => run(
                        () => saveAssistantTool({
                          odoo_connection_id: null,
                          tool_name: t.tool_name,
                          permission_code: t.permission_code,
                          description_override: t.description_override,
                          enabled: e.target.checked,
                        }),
                        `${t.tool_name} ${e.target.checked ? 'diaktifkan' : 'dimatikan'}.`
                      )}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
