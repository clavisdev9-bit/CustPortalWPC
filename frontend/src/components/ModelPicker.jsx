import { useCallback, useEffect, useState } from 'react';
import { listAssistantProviderModels } from '../api/adminAssistant';

// CR-048. Pengganti kotak teks bebas untuk "Model" di Konfigurasi Provider AI.
//
// Kotak teks bebas menerima salah ketik tanpa protes, dan kegagalannya baru terlihat di layar
// pengguna saat asisten dipakai. Dropdown ini menutup jalur itu tanpa menghilangkan jalur manual,
// karena daftar yang benar hanya diketahui provider-nya: saat CR ini dikerjakan, dokumentasi
// Google belum memuat model yang API-nya sendiri sudah kembalikan.
//
// Tiga hal yang sengaja TIDAK disederhanakan:
//
// 1. Nilai yang sedang tersimpan selalu ikut muncul di daftar, walaupun provider tidak lagi
//    mendaftarkannya (ditandai "tidak ada di daftar provider"). Membuangnya berarti membuka
//    halaman ini akan diam-diam mengubah model yang sedang dipakai menjadi kosong -- dan
//    justru pada baris yang paling perlu dilihat admin saat asisten mendadak gagal.
// 2. Masih ada jalur manual (`allowManual`), karena provider merilis model lebih cepat daripada
//    endpoint list-nya kadang menampilkannya, dan admin tidak boleh terkunci menunggu deploy.
// 3. Sumber daftar selalu dinyatakan: "dari provider" atau "daftar cadangan" + alasannya. Daftar
//    cadangan yang menyamar sebagai daftar resmi adalah cara paling halus untuk membuat admin
//    memilih model yang sudah tidak ada.
const MANUAL = '__manual__';

export default function ModelPicker({ provider, value, onChange, disabled = false, allowManual = true, inputId, reloadKey }) {
  const [catalog, setCatalog] = useState(null);
  const [loading, setLoading] = useState(false);
  const [manual, setManual] = useState(false);

  const load = useCallback(async (refresh = false) => {
    setLoading(true);
    try {
      setCatalog(await listAssistantProviderModels(provider, { refresh }));
    } catch (err) {
      // Backend menjawab 200 walau providernya bermasalah, jadi ini hanya kena kalau portal-nya
      // sendiri yang gagal (mis. 429 dari burst limiter). Ditampilkan sebagai peringatan biasa:
      // field-nya tetap bisa dipakai lewat mode manual.
      setCatalog({ source: 'fallback', models: [], warning: err.message });
    } finally {
      setLoading(false);
    }
  }, [provider]);

  // BUG-33 (temuan `/code-review`). `reloadKey` = `updated_at` baris config. Backend membuang
  // cache katalognya begitu config disimpan, tapi tanpa dependensi ini komponennya tidak pernah
  // bertanya lagi -- jadi tepat setelah admin menempelkan API key yang benar, dropdown-nya masih
  // memperlihatkan daftar cadangan, dan kesimpulan yang wajar diambil admin adalah kuncinya masih
  // salah. refresh=false: cache backend sudah kosong, tidak perlu memaksa lewat burst limiter.
  useEffect(() => { load(false); }, [load, reloadKey]);

  const models = catalog?.models || [];
  const known = models.some((m) => m.id === value);
  const options = [...models];
  if (value && !known) options.push({ id: value, label: value, note: 'tidak ada di daftar provider' });

  const selectValue = manual ? MANUAL : value || '';

  return (
    <div className="model-picker">
      <select
        id={inputId}
        value={selectValue}
        disabled={disabled || loading}
        onChange={(e) => {
          if (e.target.value === MANUAL) { setManual(true); onChange(''); return; }
          setManual(false);
          onChange(e.target.value);
        }}
      >
        <option value="">{loading ? 'Memuat daftar model...' : '-- pilih model --'}</option>
        {options.map((m) => (
          <option key={m.id} value={m.id}>
            {m.label === m.id ? m.id : `${m.label} (${m.id})`}{m.note ? ` — ${m.note}` : ''}
          </option>
        ))}
        {allowManual && <option value={MANUAL}>Model lain (ketik manual)...</option>}
      </select>

      {manual && (
        <input
          className="model-picker__manual"
          value={value || ''}
          onChange={(e) => onChange(e.target.value)}
          placeholder="ketik id model persis seperti di dokumentasi provider"
          disabled={disabled}
          autoFocus
        />
      )}

      <div className="model-picker__meta">
        <span className={`pill pill--${catalog?.source === 'provider' ? 'success' : 'warning'}`}>
          {loading
            ? 'memuat'
            : catalog?.source === 'provider'
              ? `${models.length} model dari provider`
              : 'daftar cadangan'}
        </span>
        <button type="button" className="link-button" onClick={() => load(true)} disabled={disabled || loading}>
          Muat ulang
        </button>
        {catalog?.warning && <span className="muted">{catalog.warning}</span>}
      </div>
    </div>
  );
}
