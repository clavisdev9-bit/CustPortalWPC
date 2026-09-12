import { useEffect, useId, useMemo, useRef, useState } from 'react';

const MAX_VISIBLE = 8;

// Odoo XML-RPC mengembalikan Char kosong sebagai `false`, bukan ''/null -- `default_code` rutin
// bernilai false untuk produk tanpa internal reference, dan `?.` tidak menjaga itu (false?.x
// tetap mengevaluasi false.x). Semua pembacaan teks produk lewat sini.
const str = (v) => (typeof v === 'string' ? v : '');

export function productLabel(p) {
  if (!p) return '';
  const code = str(p.default_code);
  return code ? `[${code}] ${p.name}` : p.name;
}

// list_price juga bisa `false`; Number(false) = 0 jauh lebih jujur di layar daripada string
// "false" yang dihasilkan false.toLocaleString().
export function formatPrice(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n.toLocaleString() : '-';
}

// D-4: awalan menang atas "mengandung", supaya mengetik "ADM" tidak menaruh "Pompa ADM 200"
// di atas produk yang memang bernama "ADM".
function rank(product, q) {
  const name = str(product.name).toLowerCase();
  const code = str(product.default_code).toLowerCase();
  if (code.startsWith(q)) return 0;
  if (name.startsWith(q)) return 1;
  if (code.includes(q) || name.includes(q)) return 2;
  return -1;
}

export default function ProductCombobox({
  products = [],
  value = null,
  onChange,
  onRequestUncataloged,
  existingIds,
  loading = false,
  disabled = false,
  inputId,
}) {
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const wrapRef = useRef(null);
  const listRef = useRef(null);
  const listboxId = useId();

  // `value` dimiliki halaman: begitu halaman mengosongkannya (sesudah Add line), teks input ikut
  // bersih. Inilah yang menutup M-3 -- tidak ada lagi kotak filter yang tertinggal isinya.
  //
  // Jebakannya: `value` juga menjadi null saat pengguna MENGETIK di atas pilihan lama
  // (handleChange memanggil onChange(null)). Menyamakan kedua kasus itu akan menghapus ketikan
  // yang baru saja diketik, satu karakter setelah dimulai. Pembedanya: kalau teks di input masih
  // persis label pilihan sebelumnya, pengosongan itu datang dari luar -- bukan dari ketikan.
  const prevValueRef = useRef(value);
  useEffect(() => {
    const prev = prevValueRef.current;
    prevValueRef.current = value;
    if (value) { setQuery(productLabel(value)); return; }
    if (prev && query === productLabel(prev)) setQuery('');
    // `query` sengaja TIDAK masuk dependensi: efek ini hanya boleh bereaksi pada perubahan
    // `value`. Memasukkannya membuatnya berjalan di setiap ketikan -- persis yang dihindari.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    // Fokus tanpa ketikan tetap memperlihatkan isi katalog -- supaya combobox ini masih bisa
    // dipakai seperti dropdown biasa oleh pengguna yang tidak mau mengetik.
    if (!q) return products;
    return products
      .map((p) => ({ p, r: rank(p, q) }))
      .filter((x) => x.r >= 0)
      .sort((a, b) => a.r - b.r || str(a.p.name).localeCompare(str(b.p.name)))
      .map((x) => x.p);
  }, [products, query]);

  const visible = matches.slice(0, MAX_VISIBLE);
  const overflow = matches.length - visible.length;
  const optionId = (i) => `${listboxId}-opt-${i}`;

  useEffect(() => {
    if (!open) return undefined;
    const onDocMouseDown = (e) => {
      if (!wrapRef.current?.contains(e.target)) close();
    };
    document.addEventListener('mousedown', onDocMouseDown);
    return () => document.removeEventListener('mousedown', onDocMouseDown);
    // `value` ikut dependensi karena close() membacanya untuk memulihkan teks input.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, value]);

  useEffect(() => {
    if (activeIndex < 0 || !listRef.current) return;
    listRef.current
      .querySelector(`#${CSS.escape(optionId(activeIndex))}`)
      ?.scrollIntoView({ block: 'nearest' });
  }, [activeIndex]);

  function close() {
    setOpen(false);
    setActiveIndex(-1);
    setQuery(productLabel(value)); // tutup tanpa memilih = teks kembali ke pilihan yang sah
  }

  function pick(product) {
    onChange?.(product);
    setQuery(productLabel(product));
    setOpen(false);
    setActiveIndex(-1);
  }

  function handleChange(e) {
    setQuery(e.target.value);
    setOpen(true);
    setActiveIndex(0);
    // Mengetik membatalkan pilihan sebelumnya. Tanpa ini, input memperlihatkan ketikan baru
    // sementara "Add line" masih memegang produk lama -- pelanggan memesan barang yang salah
    // tanpa satu pun tanda di layar.
    if (value) onChange?.(null);
  }

  function handleKeyDown(e) {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      if (!open) { setOpen(true); setActiveIndex(0); return; }
      const n = visible.length;
      if (!n) return;
      const delta = e.key === 'ArrowDown' ? 1 : -1;
      setActiveIndex((i) => (i + delta + n) % n);
      return;
    }
    if (e.key === 'Enter') {
      // Selalu tahan Enter di sini: combobox ini hidup di dalam <form onSubmit>, dan implicit
      // submission HTML akan mengirim request quotation yang belum selesai disusun (M-5).
      e.preventDefault();
      if (open && activeIndex >= 0 && visible[activeIndex]) pick(visible[activeIndex]);
      return;
    }
    if (e.key === 'Escape') { e.preventDefault(); close(); return; }
    if (e.key === 'Tab') close();
  }

  const q = query.trim();

  return (
    <div className="combobox" ref={wrapRef}>
      <input
        id={inputId}
        type="text"
        className="combobox__input"
        role="combobox"
        aria-expanded={open}
        aria-controls={listboxId}
        aria-autocomplete="list"
        aria-activedescendant={open && activeIndex >= 0 ? optionId(activeIndex) : undefined}
        autoComplete="off"
        placeholder={loading ? 'Memuat katalog produk...' : 'Ketik nama atau kode produk...'}
        value={query}
        disabled={disabled || loading}
        onChange={handleChange}
        onFocus={() => setOpen(true)}
        onKeyDown={handleKeyDown}
      />

      <span className="sr-only" role="status" aria-live="polite">
        {open ? `${matches.length} produk cocok` : ''}
      </span>

      {open && !loading && (
        <ul className="combobox__list" id={listboxId} role="listbox" ref={listRef}>
          {visible.map((p, i) => (
            <li
              key={p.id}
              id={optionId(i)}
              role="option"
              aria-selected={i === activeIndex}
              className={`combobox__option${i === activeIndex ? ' is-active' : ''}`}
              // onMouseDown, bukan onClick: click terjadi sesudah blur, dan blur sudah menutup
              // daftarnya lebih dulu -- kliknya hilang.
              onMouseDown={(e) => { e.preventDefault(); pick(p); }}
              onMouseEnter={() => setActiveIndex(i)}
            >
              <span className="combobox__option-main">
                {str(p.default_code) && <code className="combobox__code">{p.default_code}</code>}
                <span>{p.name}</span>
                {existingIds?.has(p.id) && <span className="combobox__tag">sudah di daftar</span>}
              </span>
              <span className="combobox__option-price num">{formatPrice(p.list_price)}</span>
            </li>
          ))}

          {!visible.length && (
            <li className="combobox__empty">
              Tidak ada produk yang cocok dengan &quot;{q}&quot;.
            </li>
          )}

          {overflow > 0 && (
            // D-3: daftarnya memang dipotong -- katakan, jangan diam-diam.
            <li className="combobox__more">+{overflow} produk lain cocok — persempit ketikan.</li>
          )}

          {q && onRequestUncataloged && (
            <li
              className="combobox__escape"
              onMouseDown={(e) => { e.preventDefault(); onRequestUncataloged(q); }}
            >
              + Minta produk &quot;{q}&quot; yang belum ada di katalog
            </li>
          )}
        </ul>
      )}
    </div>
  );
}
