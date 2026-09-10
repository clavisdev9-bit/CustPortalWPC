import { useEffect, useState } from 'react';
import { listCompanies, switchCompany, getCurrentCompany } from '../api/companies';

// Sama dengan TTL Toast (CR-048). Topbar bersifat persisten, jadi pesan yang tidak pernah hilang
// sendiri akan menemani pengguna melintasi setiap halaman -- dan tetap terbaca merah lama sesudah
// admin menyalakan kembali koneksinya, yaitu justru saat ia sudah tidak benar lagi.
const ERROR_TTL_MS = 5000;

export default function CompanySwitcher({ onCompanyChange }) {
  const [companies, setCompanies] = useState([]);
  const [current, setCurrent] = useState(null);
  const [loading, setLoading] = useState(true);
  // BUG-36: sejak `POST /companies/switch` bisa menjawab 503 (koneksi Odoo-nya dimatikan admin),
  // perpindahan company punya jalur gagal yang nyata dan pantas dilihat pengguna.
  const [error, setError] = useState(null);

  useEffect(() => {
    Promise.all([listCompanies(), getCurrentCompany()])
      .then(([list, cur]) => {
        setCompanies(list);
        setCurrent(cur);
      })
      .finally(() => setLoading(false));
  }, []);

  async function handleChange(e) {
    setError(null);
    try {
      const company = await switchCompany(e.target.value);
      setCurrent(company);
      // BUG-31: company yang berbeda bisa berarti KONEKSI Odoo yang berbeda, dengan modul terpasang
      // yang berbeda pula. Tanpa pemberitahuan ini, navigasi tetap memakai kapabilitas koneksi
      // sebelumnya sampai halaman dimuat ulang -- menu yang seharusnya muncul tetap hilang, dan
      // sebaliknya. Tidak ada full reload: state SPA lain (draf, panel terbuka) tidak perlu ikut hilang.
      onCompanyChange?.(company);
    } catch (err) {
      // Sesi TIDAK berpindah saat backend menolak, jadi `current` sengaja dibiarkan apa adanya:
      // `<select>` di bawah dikendalikan olehnya, dan render ulang yang dipicu setError() inilah
      // yang mengembalikan tampilan dropdown ke company yang benar-benar aktif. Menyetel `current`
      // ke pilihan yang gagal justru akan membuat layar berbohong tentang sesi yang sedang berjalan.
      setError(err.message || 'Tidak bisa berpindah ke perusahaan itu.');
    }
  }

  useEffect(() => {
    if (!error) return undefined;
    const timer = setTimeout(() => setError(null), ERROR_TTL_MS);
    return () => clearTimeout(timer);
  }, [error]);

  if (loading) return <div className="company-switcher company-switcher--empty">Loading companies...</div>;
  if (!companies.length) return <div className="company-switcher company-switcher--empty">No company assigned</div>;

  // Multi-Odoo (section 24) has been supported by the data model since Phase 1 -- group the
  // dropdown by connection only when it's actually relevant, so the common single-Odoo case
  // stays a plain flat list.
  const connectionNames = new Set(companies.map((c) => c.connection_name));
  const isMultiOdoo = connectionNames.size > 1;

  return (
    <div className="company-switcher-slot">
      <select className="company-switcher" value={current?.id || ''} onChange={handleChange}>
        {isMultiOdoo
          ? Array.from(connectionNames).map((connName) => (
              <optgroup key={connName} label={connName}>
                {companies
                  .filter((c) => c.connection_name === connName)
                  .map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
              </optgroup>
            ))
          : companies.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
      </select>
      {error && (
        <span className="company-switcher__error" role="alert" title={error}>
          {error}
        </span>
      )}
    </div>
  );
}
