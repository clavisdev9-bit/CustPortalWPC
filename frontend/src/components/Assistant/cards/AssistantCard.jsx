import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import StatusBadge from '../../StatusBadge';
import { CARD_TYPES, CARD_ROW_LIMIT } from './registry';

// Merender satu kartu data dari spesifikasi deklaratif di registry.js. Komponen ini memuat
// datanya SENDIRI dari endpoint portal -- tidak satu pun angka di sini berasal dari teks model.
export default function AssistantCard({ type, cardRef }) {
  const spec = CARD_TYPES[type];
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!spec) return undefined;
    let cancelled = false;
    setData(null);
    setError(null);
    spec
      .load(cardRef || {})
      .then((result) => { if (!cancelled) setData(result); })
      .catch((err) => { if (!cancelled) setError(err.message || 'Gagal memuat data'); });
    return () => { cancelled = true; };
    // cardRef adalah objek baru tiap render induk; JSON-nya yang stabil, bukan identitasnya.
  }, [spec, JSON.stringify(cardRef)]);

  // Jenis kartu yang tidak dikenal berarti backend lebih baru daripada bundle frontend yang
  // sedang berjalan. Diam lebih baik daripada kotak error: jawaban teksnya tetap berguna.
  if (!spec) return null;

  return (
    <div className="assistant-card">
      <div className="assistant-card__head">
        <span className="assistant-card__title">{spec.title}</span>
        <Link className="assistant-card__link" to={spec.link(cardRef || {})}>Buka</Link>
      </div>
      {error && <p className="assistant-card__error">{error}</p>}
      {!error && !data && <p className="assistant-card__loading">Memuat…</p>}
      {!error && data && <CardBody spec={spec} data={data} />}
    </div>
  );
}

function CardBody({ spec, data }) {
  if (spec.summary) {
    return (
      <div className="assistant-card__tiles">
        {spec.summary(data).map((tile) => (
          <div key={tile.label} className="assistant-card__tile">
            <span className="assistant-card__tile-label">{tile.label}</span>
            <span className="assistant-card__tile-value">{tile.value}</span>
          </div>
        ))}
      </div>
    );
  }

  if (spec.fields) {
    return (
      <dl className="assistant-card__fields">
        {spec.fields.map((field) => (
          <div key={field.label} className="assistant-card__field">
            <dt>{field.label}</dt>
            <dd>{field.status ? <StatusBadge status={field.get(data)} /> : (field.get(data) ?? '—')}</dd>
          </div>
        ))}
      </dl>
    );
  }

  const rows = Array.isArray(data) ? data : [];
  if (rows.length === 0) return <p className="assistant-card__empty">Tidak ada data.</p>;

  const shown = rows.slice(0, CARD_ROW_LIMIT);
  const hidden = rows.length - shown.length;

  return (
    <>
      <div className="assistant-card__scroll">
        <table className="assistant-card__table">
          <thead>
            <tr>{spec.columns.map((c) => <th key={c.label} className={c.numeric ? 'is-numeric' : undefined}>{c.label}</th>)}</tr>
          </thead>
          <tbody>
            {shown.map((row, i) => (
              <tr key={row.id ?? i}>
                {spec.columns.map((c) => (
                  <td key={c.label} className={c.numeric ? 'is-numeric' : undefined}>
                    {c.status ? <StatusBadge status={c.get(row)} /> : (c.get(row) ?? '—')}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {/* Pemotongan disebutkan, tidak disembunyikan: daftar terpotong yang tampak lengkap akan
          membuat pengguna menyimpulkan hal yang salah dari kartunya sendiri. */}
      {hidden > 0 && <p className="assistant-card__more">dan {hidden} lainnya — buka modulnya untuk daftar lengkap</p>}
    </>
  );
}
