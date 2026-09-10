import { useState } from 'react';
import { cancelDraft, confirmDraft, updateDraft } from '../../api/assistant';
import RichTextEditor from '../RichTextEditor';

// Panel konfirmasi aksi tulis (I-5). Ini satu-satunya tempat di seluruh alur asisten di mana
// eksekusi bisa dipicu, dan pemicunya adalah klik pengguna pada tombol di bawah -- bukan kalimat
// persetujuan di dalam percakapan. Karena itu panel ini menampilkan payload LENGKAP: pengguna
// harus bisa membaca persis apa yang akan terkirim sebelum menyetujuinya.

const DRAFT_FORMS = {
  create_ticket: {
    title: 'Draf tiket support',
    fields: [
      { key: 'name', label: 'Subjek', type: 'text' },
      { key: 'description', label: 'Uraian masalah', type: 'richtext' },
    ],
  },
  create_rma: {
    title: 'Draf permintaan retur (RMA)',
    fields: [
      {
        key: 'requested_action',
        label: 'Yang diminta',
        type: 'select',
        options: [['refund', 'Uang dikembalikan'], ['replacement', 'Barang diganti']],
      },
      { key: 'order_id', label: 'Nomor order (boleh dikosongkan)', type: 'number' },
      { key: 'reason', label: 'Alasan', type: 'richtext' },
    ],
  },
  create_warranty: {
    title: 'Draf klaim garansi',
    fields: [
      { key: 'serial_number', label: 'Nomor seri', type: 'text' },
      { key: 'issue_description', label: 'Kerusakan yang dialami', type: 'richtext' },
    ],
  },
};

export default function DraftConfirm({ draft, onSent, onDismiss }) {
  const form = DRAFT_FORMS[draft.action];
  const [values, setValues] = useState(draft.payload || {});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  // Jenis draf yang tidak dikenal berarti backend lebih baru daripada bundle yang sedang berjalan.
  // Menampilkan tombol Kirim untuk sesuatu yang tidak bisa kita render isinya akan meminta
  // persetujuan atas hal yang tidak terlihat -- persis yang alur ini ada untuk mencegah.
  if (!form) return null;

  const dirty = form.fields.some((f) => (values[f.key] ?? '') !== (draft.payload?.[f.key] ?? ''));

  function set(key, value) {
    setValues((prev) => ({ ...prev, [key]: value }));
  }

  async function send() {
    setBusy(true);
    setError(null);
    try {
      // Suntingan disimpan ke baris draf DULU, baru dikonfirmasi. Endpoint confirm sengaja
      // membaca payload dari DB, bukan dari body -- jadi tanpa langkah ini yang terkirim adalah
      // draf asli model, bukan versi yang barusan diperbaiki pengguna.
      if (dirty) {
        const cleaned = Object.fromEntries(
          form.fields
            .map((f) => [f.key, f.type === 'number' ? (values[f.key] === '' || values[f.key] == null ? undefined : Number(values[f.key])) : values[f.key]])
            .filter(([, v]) => v !== undefined && v !== '')
        );
        await updateDraft(draft.draft_id, cleaned);
      }
      const result = await confirmDraft(draft.draft_id);
      onSent(result);
    } catch (err) {
      setError(err.message || 'Gagal mengirim. Coba lagi.');
      setBusy(false);
    }
  }

  async function cancel() {
    setBusy(true);
    try {
      await cancelDraft(draft.draft_id);
    } catch {
      // Draf yang sudah kedaluwarsa atau terkirim tidak bisa dibatalkan lagi. Dari sudut pandang
      // pengguna hasilnya sama: panelnya hilang.
    }
    onDismiss();
  }

  return (
    <div className="assistant-draft" role="group" aria-label={form.title}>
      <div className="assistant-draft__head">
        <span className="assistant-draft__title">{form.title}</span>
        <span className="assistant-draft__badge">Belum terkirim</span>
      </div>

      <div className="assistant-draft__body">
        {form.fields.map((field) => (
          <label key={field.key} className="assistant-draft__field">
            <span>{field.label}</span>
            {field.type === 'richtext' && (
              <RichTextEditor value={values[field.key] ?? ''} onChange={(html) => set(field.key, html)} disabled={busy} />
            )}
            {field.type === 'select' && (
              <select value={values[field.key] ?? ''} onChange={(e) => set(field.key, e.target.value)} disabled={busy}>
                {field.options.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
              </select>
            )}
            {(field.type === 'text' || field.type === 'number') && (
              <input
                type={field.type}
                value={values[field.key] ?? ''}
                onChange={(e) => set(field.key, e.target.value)}
                disabled={busy}
              />
            )}
          </label>
        ))}
      </div>

      {error && <p className="assistant-draft__error" role="alert">{error}</p>}

      {/* Sengaja TIDAK menyebut estimasi waktu respons. Itu komitmen atas nama perusahaan, dan
          asisten tidak berwenang membuatnya (prompt sistem aturan 8). */}
      <p className="assistant-draft__note">Periksa dulu isinya. Anda bisa mengubahnya sebelum mengirim.</p>

      <div className="assistant-draft__actions">
        <button type="button" className="assistant-draft__send" onClick={send} disabled={busy}>
          {busy ? 'Mengirim…' : 'Kirim'}
        </button>
        <button type="button" onClick={cancel} disabled={busy}>Batal</button>
      </div>
    </div>
  );
}
