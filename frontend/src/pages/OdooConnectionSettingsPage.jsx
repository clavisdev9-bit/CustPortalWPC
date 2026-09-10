import { useEffect, useState, Fragment } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import {
  listOdooConnections, createOdooConnection, updateOdooConnection, checkOdooConnection,
  testOdooConnection, listOdooConnectionCompanies, syncOdooConnectionCompanies,
  rotateOdooConnectionWebhook, syncOdooConnectionUsers,
  disableOdooConnection, enableOdooConnection,
} from '../api/odooConnections';
import StatusBadge from '../components/StatusBadge';
import TableSkeleton from '../components/TableSkeleton';

// My Account > Setting > Koneksi Odoo. Platform-admin only -- the real gate is backend
// (requirePlatformAdmin), this check is cosmetic, same pattern as AssistantAdminPage.jsx.
//
// CR-044: menambah koneksi adalah wizard tiga langkah, bukan satu form simpan-lalu-uji.
// Kredensial divalidasi ke Odoo sungguhan DULU (tanpa menyimpan apa pun), baru company dipilih
// dari daftar yang dikembalikan pengecekan itu, baru konfigurasinya disimpan. Urutan ini bukan
// selera UI: backend menolak menyimpan koneksi yang Odoo-nya tidak menerimanya, jadi form yang
// menyimpan dulu memang tidak lagi punya jalur sukses.
const EMPTY_CRED = { url: '', username: '', auth_type: 'password', credential: '', database: '' };

const WIZARD_STEPS = [
  { key: 'credentials', label: 'Kredensial' },
  { key: 'companies', label: 'Pilih company' },
  { key: 'done', label: 'Selesai' },
];

// Field yang mengubah "portal ini bicara ke Odoo yang mana" -- kalau salah satunya disentuh saat
// edit, backend akan memvalidasi ulang ke Odoo (odooConnectionService.update), jadi tombol simpan
// di sini ikut dikunci sampai Check Connection berhasil. Tanpa itu admin baru tahu kredensialnya
// salah setelah menekan Simpan, yang persis kebiasaan lama yang dihapus CR-044.
const ODOO_FACING_FIELDS = ['url', 'database', 'username', 'credential'];

// StatusBadge's keyword rules don't match any of these three statuses (none contain "success",
// "pending", etc.) -- they'd all render as the same neutral gray pill, which defeats the point of
// telling "brand new" apart from "needs review" at a glance.
const SYNC_STATUS_LABEL = {
  provisioned: { tone: 'success', label: 'Baru dibuat' },
  already_provisioned: { tone: 'info', label: 'Sudah ada' },
  skipped_conflict: { tone: 'warning', label: 'Konflik email' },
  skipped_invalid_email: { tone: 'danger', label: 'Email tidak valid' },
};

function SyncStatusBadge({ status }) {
  const meta = SYNC_STATUS_LABEL[status] || { tone: 'neutral', label: status };
  return <span className={`pill pill--${meta.tone}`}>{meta.label}</span>;
}

// Dipakai dua tempat dengan bentuk data berbeda: hasil check-connection (res.company mentah, id
// numerik) dan baris odoo_companies tersimpan (odoo_company_id + is_active). Dinormalkan di sini
// supaya picker-nya satu komponen, bukan dua yang mirip.
function CompanyPicker({ companies, selected, onToggle }) {
  return (
    <ul className="company-picker">
      {companies.map((company) => (
        <li key={company.odooId}>
          <label className="company-picker__item">
            <input
              type="checkbox"
              checked={selected.includes(company.odooId)}
              onChange={() => onToggle(company.odooId)}
            />
            <span className="company-picker__name">{company.name}</span>
            {company.currency && <span className="pill pill--neutral">{company.currency}</span>}
          </label>
        </li>
      ))}
    </ul>
  );
}

const fromCheckResult = (companies) =>
  companies.map((c) => ({ odooId: c.id, name: c.name, currency: c.currency }));
const fromStoredRows = (rows) =>
  rows.map((c) => ({ odooId: c.odoo_company_id, name: c.name, currency: c.currency, isActive: c.is_active }));

export default function OdooConnectionSettingsPage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [connections, setConnections] = useState([]);
  const [companiesByConnection, setCompaniesByConnection] = useState({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  // --- Wizard "Tambah koneksi baru" -------------------------------------------------------
  const [step, setStep] = useState('credentials');
  const [cred, setCred] = useState(EMPTY_CRED);
  const [checking, setChecking] = useState(false);
  const [checkError, setCheckError] = useState(null);
  // Bukan error: Odoo terjangkau, tapi nama database-nya belum bisa ditentukan sendiri.
  const [checkNotice, setCheckNotice] = useState(null);
  const [checkResult, setCheckResult] = useState(null);
  const [askDatabase, setAskDatabase] = useState(false);
  const [selectedCompanies, setSelectedCompanies] = useState([]);
  const [connectionName, setConnectionName] = useState('');
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState(null);
  const [savedConnection, setSavedConnection] = useState(null);

  const [editingId, setEditingId] = useState(null);
  const [editForm, setEditForm] = useState(null);
  // Nilai awal, supaya PATCH hanya membawa field yang benar-benar berubah -- backend memvalidasi
  // ulang ke Odoo begitu salah satu field Odoo-facing ikut terkirim, jadi mengirim form utuh
  // membuat sekadar ganti nama pun menelepon Odoo (dan memakan jatah burst limiter).
  const [editOriginal, setEditOriginal] = useState(null);
  const [editSubmitting, setEditSubmitting] = useState(false);
  const [editError, setEditError] = useState(null);
  const [editChecking, setEditChecking] = useState(false);
  const [editMessage, setEditMessage] = useState(null);
  // Koneksi tersimpan sudah pernah diverifikasi; kunci baru turun saat field Odoo-nya disentuh.
  const [editVerified, setEditVerified] = useState(true);

  // Per-row feedback for the Test Connection / Sync Companies buttons, keyed by connection id.
  const [rowBusy, setRowBusy] = useState({});
  const [rowMessage, setRowMessage] = useState({});

  // Satu picker terbuka pada satu waktu: { connectionId, companies, selected }.
  const [companySelection, setCompanySelection] = useState(null);
  const [selectionSaving, setSelectionSaving] = useState(false);

  // BUG-23: webhook_url is only ever returned by create/rotate, never by GET -- with no way to
  // see it in this page, platform admins had no path to actually paste it into Odoo, so
  // POST /users worked (manual) but Odoo-side auto-provisioning could never be configured.
  // Kept in memory only, cleared on reload, matching the backend's own "shown once" contract.
  const [webhookUrls, setWebhookUrls] = useState({});
  const [webhookBusyId, setWebhookBusyId] = useState(null);

  // BUG-24: results of the last "Sync Users from Odoo" run, keyed by connection id. Kept in
  // memory only (like webhookUrls) -- this is a point-in-time report of what the sync just did,
  // not stored state; re-open Users Management (/users) to see the persisted result.
  const [userSyncResults, setUserSyncResults] = useState({});
  const [userSyncBusyId, setUserSyncBusyId] = useState(null);

  async function reload() {
    setLoading(true);
    setError(null);
    try {
      const rows = await listOdooConnections();
      setConnections(rows);
      // allSettled, not all -- one connection's company list failing to load (e.g. deleted
      // moments after the list above resolved) shouldn't blank the column for every other row.
      const companyLists = await Promise.allSettled(rows.map((c) => listOdooConnectionCompanies(c.id)));
      const map = {};
      rows.forEach((c, i) => { map[c.id] = companyLists[i].status === 'fulfilled' ? companyLists[i].value : []; });
      setCompaniesByConnection(map);
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

  function resetWizard() {
    setStep('credentials');
    setCred(EMPTY_CRED);
    setCheckError(null);
    setCheckNotice(null);
    setCheckResult(null);
    setAskDatabase(false);
    setSelectedCompanies([]);
    setConnectionName('');
    setSaveError(null);
    setSavedConnection(null);
  }

  // Nama koneksi tidak ditanyakan di langkah kredensial (flow-nya hanya URL/username/password),
  // jadi diusulkan dari apa yang sudah diketahui setelah pengecekan -- tetap bisa diubah admin.
  function suggestName(result) {
    if (result.companies.length === 1) return result.companies[0].name;
    return result.database || new URL(cred.url).hostname;
  }

  async function handleCheck(e) {
    e.preventDefault();
    setChecking(true);
    setCheckError(null);
    setCheckNotice(null);
    try {
      const result = await checkOdooConnection({
        url: cred.url.trim(),
        username: cred.username.trim(),
        auth_type: cred.auth_type,
        credential: cred.credential,
        ...(cred.database.trim() ? { database: cred.database.trim() } : {}),
      });
      setCheckResult(result);
      if (result.status === 'database_required') {
        // Cabang ketiga yang tidak ada di diagram: server terjangkau, kredensial belum sempat
        // diuji sama sekali karena database-nya belum jelas. Bukan "Credential OK? NO".
        setAskDatabase(true);
        setCheckNotice(
          result.databases && result.databases.length > 1
            ? `Odoo ${result.odoo_version} melayani ${result.databases.length} database -- pilih salah satu, lalu cek lagi.`
            : `Odoo ${result.odoo_version} tidak mengizinkan daftar database dibaca (list_db = False). Isi nama database-nya, lalu cek lagi.`
        );
        return;
      }
      setSelectedCompanies(result.companies.map((c) => c.id));
      setConnectionName(suggestName(result));
      setStep('companies');
    } catch (err) {
      setCheckError(err.message);
    } finally {
      setChecking(false);
    }
  }

  async function handleSaveConfiguration(e) {
    e.preventDefault();
    setSaving(true);
    setSaveError(null);
    try {
      const created = await createOdooConnection({
        name: connectionName.trim(),
        url: cred.url.trim(),
        database: checkResult.database,
        username: cred.username.trim(),
        auth_type: cred.auth_type,
        credential: cred.credential,
        company_ids: selectedCompanies,
      });
      setSavedConnection(created);
      // Sama seperti tombol rotate: webhook_url hanya ada di respons ini, tidak pernah di GET.
      setWebhookUrls((w) => ({ ...w, [created.id]: created.webhook_url }));
      // Kredensial tidak perlu tinggal di state setelah tersimpan terenkripsi di backend.
      setCred((c) => ({ ...c, credential: '' }));
      setStep('done');
      await reload();
    } catch (err) {
      setSaveError(err.message);
    } finally {
      setSaving(false);
    }
  }

  function toggleWizardCompany(odooId) {
    setSelectedCompanies((ids) => (ids.includes(odooId) ? ids.filter((i) => i !== odooId) : [...ids, odooId]));
  }

  function startEdit(connection) {
    const loaded = {
      name: connection.name,
      url: connection.url,
      database: connection.database,
      username: connection.username,
      auth_type: connection.auth_type,
      credential: '',
    };
    setEditingId(connection.id);
    setEditForm(loaded);
    setEditOriginal(loaded);
    setEditError(null);
    setEditMessage(null);
    setEditVerified(true);
  }

  function cancelEdit() {
    setEditingId(null);
    setEditForm(null);
    setEditOriginal(null);
    setEditError(null);
    setEditMessage(null);
    setEditVerified(true);
  }

  function patchEditForm(patch) {
    setEditForm((f) => ({ ...f, ...patch }));
    if (Object.keys(patch).some((k) => ODOO_FACING_FIELDS.includes(k))) {
      setEditVerified(false);
      setEditMessage(null);
    }
  }

  // Kredensial kosong = "pakai yang tersimpan": backend mendekripsinya lewat connection_id, jadi
  // admin bisa memverifikasi perubahan URL/database/username tanpa mengetik ulang password.
  async function handleEditCheck() {
    setEditChecking(true);
    setEditMessage(null);
    try {
      const result = await checkOdooConnection({
        connection_id: editingId,
        url: editForm.url.trim(),
        username: editForm.username.trim(),
        auth_type: editForm.auth_type,
        ...(editForm.database.trim() ? { database: editForm.database.trim() } : {}),
        ...(editForm.credential ? { credential: editForm.credential } : {}),
      });
      if (result.status === 'database_required') {
        setEditMessage({ tone: 'error', text: 'Nama database belum bisa ditentukan otomatis -- isi field Database, lalu cek lagi.' });
        return;
      }
      setEditForm((f) => ({ ...f, database: result.database }));
      setEditVerified(true);
      setEditMessage({ tone: 'success', text: `Terhubung. Odoo ${result.odoo_version}, database "${result.database}", ${result.companies.length} company.` });
    } catch (err) {
      setEditMessage({ tone: 'error', text: `Koneksi gagal: ${err.message}` });
    } finally {
      setEditChecking(false);
    }
  }

  async function handleEditSubmit(e) {
    e.preventDefault();
    setEditSubmitting(true);
    setEditError(null);
    try {
      const body = {};
      for (const key of ['name', 'url', 'database', 'username', 'auth_type']) {
        if (editForm[key] !== editOriginal[key]) body[key] = editForm[key];
      }
      // Kosong berarti "tidak diubah" -- pola yang sama dengan field API key di AssistantAdminPage.
      if (editForm.credential) body.credential = editForm.credential;
      if (Object.keys(body).length === 0) {
        cancelEdit();
        return;
      }
      await updateOdooConnection(editingId, body);
      cancelEdit();
      await reload();
    } catch (err) {
      setEditError(err.message);
    } finally {
      setEditSubmitting(false);
    }
  }

  async function handleTest(id) {
    setRowBusy((b) => ({ ...b, [id]: 'test' }));
    setRowMessage((m) => ({ ...m, [id]: null }));
    try {
      const result = await testOdooConnection(id);
      setRowMessage((m) => ({ ...m, [id]: { tone: 'success', text: `Terhubung. Versi Odoo: ${result.odoo_version}` } }));
    } catch (err) {
      setRowMessage((m) => ({ ...m, [id]: { tone: 'error', text: `Koneksi gagal: ${err.message}` } }));
    } finally {
      setRowBusy((b) => ({ ...b, [id]: null }));
      await reload();
    }
  }

  // Menarik daftar terbaru dari Odoo (tanpa mengubah pilihan yang ada), lalu membuka picker-nya
  // dengan pilihan sekarang ter-centang -- "Select Company" untuk koneksi yang sudah terlanjur ada.
  async function handleSync(id) {
    setRowBusy((b) => ({ ...b, [id]: 'sync' }));
    setRowMessage((m) => ({ ...m, [id]: null }));
    try {
      const companies = await syncOdooConnectionCompanies(id);
      setCompanySelection({
        connectionId: id,
        companies: fromStoredRows(companies),
        selected: companies.filter((c) => c.is_active).map((c) => c.odoo_company_id),
      });
      setRowMessage((m) => ({
        ...m,
        [id]: {
          tone: 'success',
          text: `Sinkronisasi selesai. ${companies.length} company ditemukan -- centang yang dipakai portal, lalu simpan pilihan.`,
        },
      }));
    } catch (err) {
      setRowMessage((m) => ({ ...m, [id]: { tone: 'error', text: `Sinkronisasi gagal: ${err.message}` } }));
    } finally {
      setRowBusy((b) => ({ ...b, [id]: null }));
      await reload();
    }
  }

  async function handleSaveCompanySelection() {
    const { connectionId, selected } = companySelection;
    setSelectionSaving(true);
    try {
      const companies = await syncOdooConnectionCompanies(connectionId, selected);
      const active = companies.filter((c) => c.is_active);
      setCompanySelection(null);
      setRowMessage((m) => ({
        ...m,
        [connectionId]: {
          tone: 'success',
          text: `Pilihan company disimpan: ${active.map((c) => c.name).join(', ')}.`,
        },
      }));
      await reload();
    } catch (err) {
      setRowMessage((m) => ({ ...m, [connectionId]: { tone: 'error', text: `Gagal menyimpan pilihan: ${err.message}` } }));
    } finally {
      setSelectionSaving(false);
    }
  }

  function toggleSelectionCompany(odooId) {
    setCompanySelection((s) => ({
      ...s,
      selected: s.selected.includes(odooId) ? s.selected.filter((i) => i !== odooId) : [...s.selected, odooId],
    }));
  }

  async function handleSyncUsers(id) {
    setUserSyncBusyId(id);
    setUserSyncResults((r) => ({ ...r, [id]: null }));
    setRowMessage((m) => ({ ...m, [id]: null }));
    try {
      const results = await syncOdooConnectionUsers(id);
      setUserSyncResults((r) => ({ ...r, [id]: results }));
      const provisioned = results.filter((row) => row.status === 'provisioned').length;
      const already = results.filter((row) => row.status === 'already_provisioned').length;
      const conflict = results.filter((row) => row.status === 'skipped_conflict').length;
      const invalidEmail = results.filter((row) => row.status === 'skipped_invalid_email').length;
      setRowMessage((m) => ({
        ...m,
        [id]: {
          tone: invalidEmail > 0 ? 'error' : 'success',
          text: `Sinkronisasi user selesai. ${provisioned} baru, ${already} sudah ada, ${conflict} konflik, ${invalidEmail} email tidak valid (lihat detail di bawah).`,
        },
      }));
    } catch (err) {
      setRowMessage((m) => ({ ...m, [id]: { tone: 'error', text: `Sinkronisasi user gagal: ${err.message}` } }));
    } finally {
      setUserSyncBusyId(null);
    }
  }

  // Migrasi 0015. Satu-satunya cara menghentikan pemakaian koneksi tanpa menghapusnya -- dan
  // menghapus memang tidak bisa selama koneksi itu masih punya user terpetakan.
  //
  // Konfirmasinya menyebut jumlah user yang terdampak, bukan sekadar "Anda yakin?": mematikan
  // koneksi membuat setiap halaman milik mereka menjawab 503 seketika, dan itu satu-satunya angka
  // yang menentukan apakah tindakan ini wajar atau bencana. Jumlahnya dari daftar user yang sudah
  // ada di klien? Tidak -- halaman ini tidak memuatnya, jadi yang dipakai adalah kalimat apa
  // adanya. (Backend mencatat angka pastinya ke audit log.)
  async function handleToggleEnabled(c) {
    const disabling = c.is_enabled !== false;
    if (disabling) {
      const proceed = window.confirm(
        `Nonaktifkan koneksi "${c.name}"?\n\nSemua user portal yang terpetakan ke koneksi ini langsung tidak bisa melihat data apa pun (invoice, order, tiket, equipment) sampai koneksi dinyalakan lagi. Koneksinya sendiri tidak dihapus, dan pemetaan user tetap utuh.`
      );
      if (!proceed) return;
    }
    setRowBusy((b) => ({ ...b, [c.id]: 'enable' }));
    setRowMessage((m) => ({ ...m, [c.id]: null }));
    try {
      await (disabling ? disableOdooConnection(c.id) : enableOdooConnection(c.id));
      setRowMessage((m) => ({
        ...m,
        [c.id]: {
          tone: 'success',
          text: disabling
            ? 'Koneksi dinonaktifkan. Portal berhenti memakainya; Test Connection tetap bisa dijalankan untuk memastikan perbaikan sebelum diaktifkan lagi.'
            : 'Koneksi diaktifkan kembali. Kalau ada user Odoo yang dibuat selama koneksi mati, jalankan Sync Users from Odoo untuk menyusulkannya.',
        },
      }));
    } catch (err) {
      setRowMessage((m) => ({ ...m, [c.id]: { tone: 'error', text: `Gagal mengubah status pemakaian: ${err.message}` } }));
    } finally {
      setRowBusy((b) => ({ ...b, [c.id]: null }));
      await reload();
    }
  }

  async function handleRotateWebhook(id, connectionName_) {
    const hadOne = Boolean(webhookUrls[id]);
    const proceed = window.confirm(
      hadOne
        ? `Ganti webhook URL untuk "${connectionName_}"? URL/secret yang lama langsung tidak valid -- pastikan Automation Rule di Odoo diperbarui dengan URL baru segera setelah ini.`
        : `Buat webhook URL untuk "${connectionName_}"? URL ini dipakai Odoo untuk auto-provisioning user portal saat Portal Access diberikan.`
    );
    if (!proceed) return;
    setWebhookBusyId(id);
    setRowMessage((m) => ({ ...m, [id]: null }));
    try {
      const { webhook_url } = await rotateOdooConnectionWebhook(id);
      setWebhookUrls((w) => ({ ...w, [id]: webhook_url }));
    } catch (err) {
      setRowMessage((m) => ({ ...m, [id]: { tone: 'error', text: `Gagal membuat webhook URL: ${err.message}` } }));
    } finally {
      setWebhookBusyId(null);
    }
  }

  async function copyWebhookUrl(url) {
    try {
      await navigator.clipboard.writeText(url);
    } catch {
      // Clipboard API can be unavailable (insecure context, permission denied) -- the URL is
      // still selectable/visible in the input below, so this isn't fatal.
    }
  }

  const stepIndex = WIZARD_STEPS.findIndex((s) => s.key === step);

  return (
    <div className="odoo-connection-page">
      <h1>Setting &rsaquo; Koneksi Odoo</h1>
      <p className="muted">
        Konfigurasi koneksi ke instance Odoo. Hanya platform admin yang bisa melihat halaman ini --
        kredensial tidak pernah ditampilkan lagi setelah disimpan. Koneksi baru hanya tersimpan
        setelah Odoo benar-benar menerima kredensialnya, jadi tidak ada baris koneksi yang belum
        pernah terbukti bekerja.
      </p>
      <p className="muted">
        Menyambungkan koneksi di sini <b>tidak</b> otomatis mengisi menu User Management
        (<code>/users</code>) dengan user dari Odoo. Portal user baru dibuat lewat dua jalur saja:
        manual lewat form di <code>/users</code>, atau otomatis lewat webhook Odoo saat kontak
        diberi &quot;Portal Access&quot; di sana -- ambil URL-nya lewat tombol &quot;Buat/Ganti
        Webhook URL&quot; di tabel bawah, lalu pasang sebagai Automation Rule di Odoo.
      </p>

      {error && <p className="error">{error}</p>}

      <section className="card odoo-wizard">
        <h2>Tambah koneksi baru</h2>
        <ol className="odoo-wizard__steps">
          {WIZARD_STEPS.map((s, i) => (
            <li
              key={s.key}
              className={[
                'odoo-wizard__step',
                i === stepIndex ? 'odoo-wizard__step--current' : '',
                i < stepIndex ? 'odoo-wizard__step--done' : '',
              ].filter(Boolean).join(' ')}
            >
              <span className="odoo-wizard__step-num">{i < stepIndex ? '✓' : i + 1}</span>
              {s.label}
            </li>
          ))}
        </ol>

        {step === 'credentials' && (
          <form onSubmit={handleCheck} className="form-grid">
            <label>
              Odoo URL
              <input
                required
                type="url"
                value={cred.url}
                onChange={(e) => setCred({ ...cred, url: e.target.value })}
                placeholder="https://odoo.contoh.co.id/"
              />
            </label>
            <label>
              Username
              <input
                required
                value={cred.username}
                onChange={(e) => setCred({ ...cred, username: e.target.value })}
                placeholder="admin@contoh.co.id"
              />
            </label>
            <label>
              Password / API Key
              <input
                required
                type="password"
                autoComplete="off"
                value={cred.credential}
                onChange={(e) => setCred({ ...cred, credential: e.target.value })}
              />
            </label>
            <label>
              Jenis kredensial
              <select value={cred.auth_type} onChange={(e) => setCred({ ...cred, auth_type: e.target.value })}>
                <option value="password">Password</option>
                <option value="api_key">API Key</option>
              </select>
            </label>
            {/* Hanya muncul kalau Odoo-nya tidak bisa memberi tahu sendiri nama database-nya --
                dalam kasus umum (satu database, list_db aktif) admin tidak pernah melihat field ini. */}
            {askDatabase && (
              <label>
                Database
                {checkResult?.databases?.length ? (
                  <select
                    required
                    value={cred.database}
                    onChange={(e) => setCred({ ...cred, database: e.target.value })}
                  >
                    <option value="">-- pilih database --</option>
                    {checkResult.databases.map((db) => <option key={db} value={db}>{db}</option>)}
                  </select>
                ) : (
                  <input
                    required
                    value={cred.database}
                    onChange={(e) => setCred({ ...cred, database: e.target.value })}
                    placeholder="nama database Odoo"
                  />
                )}
              </label>
            )}
            <button type="submit" disabled={checking}>{checking ? 'Memeriksa...' : 'Check Connection'}</button>
          </form>
        )}
        {step === 'credentials' && checkNotice && <p className="muted">{checkNotice}</p>}
        {step === 'credentials' && checkError && (
          <p className="error">Koneksi gagal: {checkError} — perbaiki isian di atas lalu coba lagi.</p>
        )}

        {step === 'companies' && checkResult && (
          <form onSubmit={handleSaveConfiguration} className="form-grid">
            <p className="success">
              Kredensial diterima Odoo {checkResult.odoo_version} (database &quot;{checkResult.database}&quot;).
              Belum ada yang disimpan sampai tombol di bawah ditekan.
            </p>
            <dl className="check-summary">
              <div><dt>URL</dt><dd>{cred.url}</dd></div>
              <div><dt>Database</dt><dd>{checkResult.database}</dd></div>
              <div><dt>Username</dt><dd>{cred.username}</dd></div>
              <div><dt>Versi Odoo</dt><dd>{checkResult.odoo_version}</dd></div>
            </dl>
            <label>
              Nama koneksi
              <input required value={connectionName} onChange={(e) => setConnectionName(e.target.value)} />
            </label>
            <fieldset>
              <legend>Company yang dipakai portal</legend>
              <p className="muted">
                Company yang tidak dicentang tetap ikut tersimpan tapi ditandai non-aktif: user
                Odoo di company itu tidak akan didudukkan ke sana otomatis saat provisioning.
                Pilihan ini bisa diubah lagi lewat tombol Sync Companies.
              </p>
              <CompanyPicker
                companies={fromCheckResult(checkResult.companies)}
                selected={selectedCompanies}
                onToggle={toggleWizardCompany}
              />
            </fieldset>
            <div className="button-row">
              <button type="submit" disabled={saving || selectedCompanies.length === 0}>
                {saving ? 'Menyimpan...' : 'Save Configuration'}
              </button>
              <button type="button" onClick={() => setStep('credentials')} disabled={saving}>Kembali</button>
            </div>
            {selectedCompanies.length === 0 && (
              <p className="muted">Pilih minimal satu company sebelum menyimpan.</p>
            )}
            {saveError && <p className="error">{saveError}</p>}
          </form>
        )}

        {step === 'done' && savedConnection && (
          <div className="form-grid" style={{ maxWidth: 'none' }}>
            <p className="success">
              Koneksi &quot;{savedConnection.name}&quot; tersimpan dan berstatus connected
              ({savedConnection.companies.filter((c) => c.is_active).length} company aktif).
            </p>
            {webhookUrls[savedConnection.id] && (
              <label>
                Webhook URL untuk auto-provisioning user (dari Odoo &quot;Portal Access&quot;) --
                tersimpan hanya sampai halaman ini dimuat ulang, salin sekarang:
                <div className="button-row">
                  <input
                    readOnly
                    value={webhookUrls[savedConnection.id]}
                    onFocus={(e) => e.target.select()}
                    style={{ flex: 1, minWidth: 320 }}
                  />
                  <button type="button" onClick={() => copyWebhookUrl(webhookUrls[savedConnection.id])}>Salin</button>
                </div>
              </label>
            )}
            <div className="button-row">
              <button type="button" onClick={() => navigate('/')}>Ke Dashboard</button>
              <button type="button" onClick={resetWizard}>Tambah koneksi lain</button>
            </div>
          </div>
        )}
      </section>

      {editForm && (
        <section className="card">
          <h2>Edit koneksi</h2>
          <form onSubmit={handleEditSubmit} className="form-grid">
            <label>
              Nama
              <input required value={editForm.name} onChange={(e) => patchEditForm({ name: e.target.value })} />
            </label>
            <label>
              URL
              <input required type="url" value={editForm.url} onChange={(e) => patchEditForm({ url: e.target.value })} />
            </label>
            <label>
              Database
              <input required value={editForm.database} onChange={(e) => patchEditForm({ database: e.target.value })} />
            </label>
            <label>
              Username
              <input required value={editForm.username} onChange={(e) => patchEditForm({ username: e.target.value })} />
            </label>
            <label>
              Auth type
              <select value={editForm.auth_type} onChange={(e) => patchEditForm({ auth_type: e.target.value })}>
                <option value="password">password</option>
                <option value="api_key">api_key</option>
              </select>
            </label>
            <label>
              Credential <span className="muted">(kosongkan jika tidak ingin mengubah)</span>
              <input
                type="password"
                autoComplete="off"
                value={editForm.credential}
                onChange={(e) => patchEditForm({ credential: e.target.value })}
              />
            </label>
            <div className="button-row">
              <button type="button" onClick={handleEditCheck} disabled={editChecking}>
                {editChecking ? 'Memeriksa...' : 'Check Connection'}
              </button>
              <button type="submit" disabled={editSubmitting || !editVerified}>
                {editSubmitting ? 'Menyimpan...' : 'Simpan perubahan'}
              </button>
              <button type="button" onClick={cancelEdit}>Batal</button>
            </div>
            {!editVerified && (
              <p className="muted">
                URL/database/username/credential berubah — jalankan Check Connection dulu sebelum menyimpan.
              </p>
            )}
          </form>
          {editMessage && <p className={editMessage.tone === 'error' ? 'error' : 'success'}>{editMessage.text}</p>}
          {editError && <p className="error">{editError}</p>}
        </section>
      )}

      <section className="card">
        <h2>Koneksi terdaftar</h2>
        {loading ? (
          <TableSkeleton cols={10} />
        ) : connections.length === 0 ? (
          <p className="muted">Belum ada koneksi Odoo yang dikonfigurasi.</p>
        ) : (
          <div className="table-wrap">
            <table className="table--cards">
              <thead>
                <tr>
                  <th>Nama</th>
                  <th>URL</th>
                  <th>Database</th>
                  <th>Username</th>
                  <th>Auth type</th>
                  <th>Status</th>
                  <th>Versi Odoo</th>
                  <th>Terakhir dicek</th>
                  <th>Company aktif</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {connections.map((c) => {
                  const companies = companiesByConnection[c.id] || [];
                  const activeCompanies = companies.filter((co) => co.is_active);
                  const inactiveCount = companies.length - activeCompanies.length;
                  return (
                    <Fragment key={c.id}>
                      <tr>
                        <td data-label="Nama">{c.name}</td>
                        <td data-label="URL">{c.url}</td>
                        <td data-label="Database">{c.database}</td>
                        <td data-label="Username">{c.username}</td>
                        <td data-label="Auth type">{c.auth_type}</td>
                        {/* Dua fakta yang berbeda, sengaja tampil berdampingan (migrasi 0015):
                            StatusBadge = apa kata Odoo pada kontak terakhir (ditulis otomatis),
                            pil "Nonaktif" = keputusan admin apakah portal boleh memakainya.
                            Kombinasi "connected + Nonaktif" bukan kontradiksi -- itu justru
                            keadaan yang dicari sebelum menyalakan koneksi kembali. */}
                        <td data-label="Status">
                          <StatusBadge status={c.status} />
                          {c.is_enabled === false && (
                            <span className="pill pill--danger" style={{ marginLeft: 'var(--s-2)' }}>Nonaktif</span>
                          )}
                        </td>
                        <td data-label="Versi Odoo">{c.odoo_version || '-'}</td>
                        <td data-label="Terakhir dicek">
                          {c.last_checked_at ? String(c.last_checked_at).slice(0, 19).replace('T', ' ') : '-'}
                        </td>
                        <td data-label="Company aktif">
                          {activeCompanies.map((co) => co.name).join(', ') || '-'}
                          {inactiveCount > 0 && <span className="muted"> (+{inactiveCount} non-aktif)</span>}
                        </td>
                        <td className="button-row">
                          <button type="button" onClick={() => handleTest(c.id)} disabled={!!rowBusy[c.id]}>
                            {rowBusy[c.id] === 'test' ? 'Menguji...' : 'Test Connection'}
                          </button>
                          <button
                            type="button"
                            onClick={() => handleSync(c.id)}
                            disabled={!!rowBusy[c.id] || c.status !== 'connected' || c.is_enabled === false}
                            title={
                              c.is_enabled === false
                                ? 'Koneksi dinonaktifkan -- aktifkan dulu (backend menolak dengan 409)'
                                : c.status !== 'connected'
                                  ? 'Test Connection dulu sampai berhasil'
                                  : 'Tarik daftar company terbaru, lalu pilih mana yang dipakai portal'
                            }
                          >
                            {rowBusy[c.id] === 'sync' ? 'Sinkronisasi...' : 'Sync Companies'}
                          </button>
                          <button
                            type="button"
                            onClick={() => handleSyncUsers(c.id)}
                            disabled={userSyncBusyId === c.id || c.status !== 'connected' || c.is_enabled === false}
                            title={
                              c.is_enabled === false
                                ? 'Koneksi dinonaktifkan -- aktifkan dulu (backend menolak dengan 409)'
                                : c.status !== 'connected'
                                  ? 'Test Connection dulu sampai berhasil'
                                  : 'Impor semua kontak Odoo dengan akses Portal (res.users share=true) ke User Management'
                            }
                          >
                            {userSyncBusyId === c.id ? 'Sinkronisasi...' : 'Sync Users from Odoo'}
                          </button>
                          <button type="button" onClick={() => startEdit(c)}>Edit</button>
                          <button
                            type="button"
                            onClick={() => handleToggleEnabled(c)}
                            disabled={!!rowBusy[c.id]}
                            title={
                              c.is_enabled === false
                                ? 'Portal memakai koneksi ini lagi'
                                : 'Portal berhenti memakai koneksi ini -- user yang terpetakan padanya tidak bisa melihat data sampai diaktifkan lagi. Barisnya tidak dihapus.'
                            }
                          >
                            {rowBusy[c.id] === 'enable'
                              ? 'Menyimpan...'
                              : c.is_enabled === false ? 'Aktifkan' : 'Nonaktifkan'}
                          </button>
                          <button
                            type="button"
                            onClick={() => handleRotateWebhook(c.id, c.name)}
                            disabled={webhookBusyId === c.id}
                            title="Dipakai Odoo untuk auto-provisioning user portal (Portal Access) -- lihat Docs/ops/odoo_connection.md"
                          >
                            {webhookBusyId === c.id ? 'Membuat...' : webhookUrls[c.id] ? 'Ganti Webhook URL' : 'Buat Webhook URL'}
                          </button>
                        </td>
                      </tr>
                      {(rowMessage[c.id] || c.status === 'error') && (
                        <tr>
                          <td colSpan={10}>
                            {rowMessage[c.id] ? (
                              <p className={rowMessage[c.id].tone === 'error' ? 'error' : 'success'}>{rowMessage[c.id].text}</p>
                            ) : (
                              <p className="error">Percobaan terakhir gagal: {c.last_error}</p>
                            )}
                          </td>
                        </tr>
                      )}
                      {companySelection?.connectionId === c.id && (
                        <tr>
                          <td colSpan={10}>
                            <fieldset>
                              <legend>Company yang dipakai portal</legend>
                              <CompanyPicker
                                companies={companySelection.companies}
                                selected={companySelection.selected}
                                onToggle={toggleSelectionCompany}
                              />
                              <div className="button-row" style={{ marginTop: 'var(--s-3)' }}>
                                <button
                                  type="button"
                                  onClick={handleSaveCompanySelection}
                                  disabled={selectionSaving || companySelection.selected.length === 0}
                                >
                                  {selectionSaving ? 'Menyimpan...' : 'Simpan pilihan'}
                                </button>
                                <button type="button" onClick={() => setCompanySelection(null)} disabled={selectionSaving}>
                                  Batal
                                </button>
                              </div>
                            </fieldset>
                          </td>
                        </tr>
                      )}
                      {userSyncResults[c.id] && (
                        <tr>
                          <td colSpan={10}>
                            <div className="table-wrap">
                              <table className="table--cards">
                                <thead>
                                  <tr><th>Email</th><th>Nama</th><th>Odoo Partner ID</th><th>Hasil</th></tr>
                                </thead>
                                <tbody>
                                  {userSyncResults[c.id].map((row) => (
                                    <tr key={row.odoo_partner_id}>
                                      <td data-label="Email">{row.email}</td>
                                      <td data-label="Nama">{row.name}</td>
                                      <td data-label="Odoo Partner ID">{row.odoo_partner_id}</td>
                                      <td data-label="Hasil"><SyncStatusBadge status={row.status} /></td>
                                    </tr>
                                  ))}
                                  {userSyncResults[c.id].length === 0 && (
                                    <tr><td colSpan={4} className="muted">Tidak ada kontak Odoo dengan akses Portal ditemukan.</td></tr>
                                  )}
                                </tbody>
                              </table>
                            </div>
                          </td>
                        </tr>
                      )}
                      {webhookUrls[c.id] && (
                        <tr>
                          <td colSpan={10}>
                            <div className="form-grid" style={{ maxWidth: 'none' }}>
                              <label>
                                Webhook URL untuk auto-provisioning user (dari Odoo &quot;Portal Access&quot;) -- tersimpan
                                hanya sampai halaman ini dimuat ulang, salin sekarang:
                                <div className="button-row">
                                  <input readOnly value={webhookUrls[c.id]} onFocus={(e) => e.target.select()} style={{ flex: 1, minWidth: 320 }} />
                                  <button type="button" onClick={() => copyWebhookUrl(webhookUrls[c.id])}>Salin</button>
                                </div>
                              </label>
                              <p className="muted">
                                Pasang di Odoo: buat <b>Automation Rule</b> pada model kontak, trigger saat Portal
                                Access diberikan, aksi &quot;Send a Webhook Notification&quot; ke URL di atas. Odoo
                                tidak mengirim header custom lewat aksi ini -- URL di atas sudah cukup untuk autentikasi.
                                Mengganti URL ini lagi (tombol &quot;Ganti Webhook URL&quot;) langsung membuat URL lama gagal.
                              </p>
                            </div>
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
