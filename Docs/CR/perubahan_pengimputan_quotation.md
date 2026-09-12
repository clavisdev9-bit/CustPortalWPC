# Change Request — Perubahan Penginputan Quotation di `/requests`

- **Status**: Rancangan siap dieksekusi. **Belum ada kode yang ditulis.** Tidak ada pertanyaan
  pemblokir — Fase 1 boleh langsung dikerjakan; Fase 2 kondisional (lihat §10).
- **Tanggal**: 2026-09-12
- **Pemohon**: Client (temuan UAT atas layar `/requests`)
- **Dieksekusi oleh**: Claude Code / developer di VS Code
- **Layar terdampak**: `/requests` → "New request" → tipe **Request a quotation (sales order)**
- **Referensi visual**: tangkapan layar form *Order Lines* Odoo 18 yang dilampirkan pemohon —
  satu kolom **Product**, ketik `adm`, dropdown langsung menawarkan `ADM`, `ADM FEE`,
  `Create "adm"`, `Search More...`. Itulah interaksi yang diminta untuk ditiru di portal.
- **Dokumen terkait**:
  - [`../../system.md`](../../system.md) — arsitektur as-built (§10 API, §17 keterbatasan)
  - [`../../CLAUDE.md`](../../CLAUDE.md) — aturan keamanan #1/#2, konvensi styling & layering
  - [`../../cr.md`](../../cr.md) — log CR; catat hasil implementasi ini di sana sebagai CR baru
  - [`customer_portal_odoo18_customer_scoped_access.md`](customer_portal_odoo18_customer_scoped_access.md) — model scope yang tetap berlaku
- **Kode yang sudah dibaca & diverifikasi saat menyusun rancangan ini**:
  `frontend/src/pages/RequestsPage.jsx`, `frontend/src/api/products.js`,
  `frontend/src/components/ModelPicker.jsx`, `frontend/src/components/CompanySwitcher.jsx`,
  `frontend/src/styles/index.css`, `src/routes/products.routes.js`,
  `src/controllers/productController.js`, `src/services/productService.js`,
  `src/integrations/odoo/OdooProductService.js`, `src/services/customerRequestService.js`,
  `src/services/salesService.js`, `src/integrations/odoo/OdooSalesService.js`,
  `src/validators/customerRequestValidators.js`, `src/services/equipmentRateLimiter.js`,
  `api/openapi.yaml`

---

## Daftar Isi

1. [Ringkasan & keputusan singkat](#1-ringkasan--keputusan-singkat)
2. [Kondisi saat ini (as-built)](#2-kondisi-saat-ini-as-built)
3. [Masalah konkret yang diperbaiki](#3-masalah-konkret-yang-diperbaiki)
4. [Keputusan desain (D-1 … D-7)](#4-keputusan-desain-d-1--d-7)
5. [Invarian yang tidak boleh dilanggar (INV-1 … INV-4)](#5-invarian-yang-tidak-boleh-dilanggar-inv-1--inv-4)
6. [Rancangan UI: anatomi, state, keyboard, aksesibilitas](#6-rancangan-ui-anatomi-state-keyboard-aksesibilitas)
7. [Kontrak komponen `ProductCombobox`](#7-kontrak-komponen-productcombobox)
8. [Implementasi referensi](#8-implementasi-referensi)
9. [CSS](#9-css)
10. [Fase 2 (kondisional): pencarian sisi server](#10-fase-2-kondisional-pencarian-sisi-server)
11. [File manifest](#11-file-manifest)
12. [Verifikasi & acceptance criteria](#12-verifikasi--acceptance-criteria)
13. [Anti-pattern: jangan lakukan ini](#13-anti-pattern-jangan-lakukan-ini)
14. [Pertanyaan terbuka](#14-pertanyaan-terbuka)

---

## 1. Ringkasan & keputusan singkat

Permintaan: form pembuatan quotation di `/requests` memakai **dua field untuk satu keputusan**
("Filter products" lalu "Product"), dan itu tidak ramah. Client meminta satu field **Product**
dengan autocomplete seperti Odoo.

Keputusan:

| | Keputusan |
|---|---|
| **Ganti** | Dua field (`Filter products` + `<select>` Product) → **satu combobox** `Product` dengan dropdown hasil pencarian |
| **Komponen** | Komponen baru `frontend/src/components/ProductCombobox.jsx`, bukan library pihak ketiga |
| **Sumber data Fase 1** | Katalog yang **sudah** diambil `listProducts()` saat halaman dibuka — penyaringan di klien. **Nol** perubahan backend, **nol** panggilan Odoo tambahan |
| **Sumber data Fase 2** | `GET /products?search=&limit=` sisi server — **hanya** dikerjakan kalau ambang di §10.1 terlampaui |
| **Bonus dalam cakupan** | Escape hatch "produk tidak ada di katalog" dari dalam dropdown (meniru `Create "adm"`), qty bisa diedit langsung di tabel baris, dan perbaikan Enter-di-Qty yang saat ini mengirim request lebih awal |
| **Di luar cakupan** | Harga pricelist per-pelanggan, gambar produk di dropdown, penyimpanan draf quotation di portal DB, perubahan apa pun pada `sale.order` yang dibuat di Odoo |

Tidak ada dependency baru. Tidak ada migrasi. Tidak ada permission baru. Fase 1 murni frontend.

---

## 2. Kondisi saat ini (as-built)

### 2.1 Alur data

```
RequestsPage.jsx  ──GET /products──►  productController.list
                                        └─ productService.listProducts(userId, currentCompanyId)
                                             └─ resolveOdooContext  →  OdooProductService.listProducts
                                                  └─ search_read('product.product',
                                                       [sale_ok=true, company_id in (false, <company>)],
                                                       [id, name, default_code, list_price,
                                                        qty_available, uom_id])        ← TANPA limit

RequestsPage.jsx  ──POST /requests──►  customerRequestController.create
                                        └─ customerRequestService.createRequest
                                             └─ salesService.createQuotationRequest
                                                  └─ OdooSalesService.createQuotation
                                                       └─ create('sale.order', { partner_id, company_id,
                                                            order_line: [[0,0,{ product_id, product_uom_qty }]] })
```

Dua hal penting dari jalur di atas, keduanya **tidak boleh berubah** oleh CR ini:

1. Seluruh katalog sudah dimuat sekali di `useEffect` saat halaman dibuka
   (`RequestsPage.jsx:44-47`). Artinya autocomplete sisi klien **tidak menambah satu pun**
   panggilan Odoo — datanya sudah ada di memori browser.
2. Yang benar-benar dikirim ke Odoo dari setiap baris hanyalah **`product_id` dan `qty`**
   (`OdooSalesService.js:139`). `product_name` dan `default_code` di payload hanya teks tampilan
   untuk tabel "My requests" di portal.

### 2.2 UI saat ini

`RequestsPage.jsx:147-186`, di dalam `<div className="line-item-picker">`:

| Field | Elemen | Perilaku |
|---|---|---|
| Filter products | `<input type="text">` → state `productFilter` | Menyaring `products` lewat `useMemo` `filteredProducts` |
| Product | `<select>` → state `pickProductId` | Menampilkan **hasil filter** sebagai `<option>` |
| Qty | `<input type="number">` → state `pickQty` | — |
| — | `<button type="button">Add line</button>` | `handleAddLine()` menambah/menjumlahkan baris |

`filteredProducts` (`RequestsPage.jsx:49-62`) sudah memuat satu penjagaan yang **wajib dibawa**
ke kode baru, beserta komentarnya: Odoo XML-RPC mengembalikan Char kosong sebagai `false`
(bukan `''`/`null`), sehingga `p.default_code?.toLowerCase()` tetap melempar — `?.` hanya
menjaga `null`/`undefined`. Penjagaannya adalah cek `typeof x === 'string'`.

---

## 3. Masalah konkret yang diperbaiki

| # | Masalah | Akibat yang terlihat pengguna |
|---|---|---|
| M-1 | Dua field untuk satu keputusan | Pengguna mengetik di "Filter products", lalu harus **pindah** ke field lain untuk memilih. Hubungan sebab-akibat antar dua kotak itu tidak terlihat sampai dicoba. |
| M-2 | `<select>` menampilkan seluruh katalog saat filter kosong | Daftar panjang; di mobile menjadi picker layar-penuh yang harus digulir jauh. |
| M-3 | Filter tidak nempel ke pilihan | Setelah `Add line`, `pickProductId` direset tapi `productFilter` **tidak** (`RequestsPage.jsx:86-87`) — kotak filter masih berisi kata kunci lama sementara dropdown sudah kosong pilihan. Terbaca seperti macet. |
| M-4 | Tidak ada jalan keluar saat barang tidak ketemu | Pengguna yang mengetik nama barang dan tidak menemukannya harus tahu sendiri bahwa ada tipe request kedua di dropdown "Type" di atas. |
| M-5 | Enter di kolom Qty mengirim seluruh request | Picker berada **di dalam** `<form onSubmit={handleSubmit}>` dan `Add line` bertipe `button`. Implicit submission HTML berarti Enter di Qty memicu submit form — request terkirim dengan baris seadanya, tanpa baris yang sedang diketik. |
| M-6 | Qty baris yang sudah masuk tidak bisa diubah | Satu-satunya cara mengoreksi qty adalah `Remove` lalu ulangi pencarian produknya dari nol. |

M-5 adalah bug fungsional, bukan sekadar UX. Tercakup di sini karena berada persis di kode yang
memang sedang dibongkar.

---

## 4. Keputusan desain (D-1 … D-7)

### D-1 — Combobox sendiri, bukan library

Repo ini sengaja berdependensi sedikit, dan CLAUDE.md mewajibkan bertanya sebelum menambah
dependency. Combobox satu-pilihan adalah ~150 baris. `react-select`/`downshift` membawa bundel
dan sistem styling sendiri yang harus dilawan supaya tunduk pada token `index.css`. Tulis sendiri.

### D-2 — Fase 1 menyaring di klien, sumbernya katalog yang sudah dimuat

Katalog **sudah** diambil seluruhnya hari ini. Menambah endpoint pencarian di Fase 1 berarti
menambah panggilan Odoo per ketikan untuk masalah yang murni tampilan — sekaligus memaksa
rate limiter baru (CLAUDE.md: endpoint mahal wajib bawa pembatasnya sendiri) demi nol manfaat
yang terasa. Penyaringan klien juga **instan** (tanpa latensi jaringan), yang justru membuat
autocomplete terasa seperti Odoo.

Ambang kapan keputusan ini gugur dan Fase 2 wajib dikerjakan: §10.1.

### D-3 — Dropdown memotong hasil di 8 baris + baris hitungan sisa

Odoo sendiri memotong di 8 dan menawarkan `Search More...`. Portal memotong di 8 juga, tetapi
sisanya tidak dibuatkan modal pencarian (itu layar baru, di luar permintaan) melainkan satu baris
non-interaktif: *"+N produk lain cocok — persempit ketikan."* Ini jujur (pengguna tahu daftarnya
terpotong) tanpa menambah layar.

### D-4 — Peringkat hasil: awalan dulu, baru mengandung

Urutan: (1) `default_code` diawali kata kunci, (2) `name` diawali kata kunci, (3) sisanya yang
mengandung kata kunci — masing-masing diurut alfabetis. Tanpa ini, mengetik `ADM` bisa
menempatkan "Pompa Sedot ADM-200" di atas produk yang benar-benar bernama "ADM".

### D-5 — Escape hatch di kaki dropdown, meniru `Create "adm"`

Saat ada ketikan, baris terakhir dropdown menawarkan:
**`+ Minta produk "<ketikan>" yang belum ada di katalog`**. Mengkliknya **tidak** membuat produk
di Odoo (portal tidak punya dan tidak boleh punya wewenang itu). Ia memindahkan form ke tipe
`request_product` dengan `productNote` sudah terisi ketikan tadi — persis jalur yang sudah ada
hari ini, hanya kini ditemukan tanpa harus tahu duluan. Ini jawaban portal atas M-4 dan padanan
yang jujur untuk `Create "adm"` milik Odoo.

### D-6 — Qty bisa diedit di tabel baris

Kolom Qty di tabel baris menjadi `<input type="number">`. Mengosongkannya tidak langsung
menghapus baris (itu kehilangan data karena salah pencet); baris hanya hilang lewat `Remove`.
Qty `<= 0` atau bukan angka memblokir submit.

### D-7 — Tombol `Add line` tetap ada

Combobox + Enter di Qty sudah cukup untuk pengguna keyboard, tetapi tombol yang terlihat adalah
satu-satunya penanda bagi pengguna mouse bahwa memilih produk **belum** berarti barangnya masuk.
Tombol tetap, hanya perilakunya diperjelas (`disabled` sampai produk terpilih dan qty valid).

---

## 5. Invarian yang tidak boleh dilanggar (INV-1 … INV-4)

**INV-1 — Teks bebas tidak pernah menjadi baris quotation.**
Sebuah baris hanya boleh lahir dari objek produk yang dipilih dari daftar katalog (punya `id`
Odoo yang nyata). Ketikan yang tidak cocok dengan produk mana pun hanya punya satu tujuan sah:
`request_product`. Validator `quotationLineSchema` sudah mewajibkan `product_id` positif
(`customerRequestValidators.js:4`) — jangan pernah melonggarkannya, mis. dengan menambah field
`product_label` bebas.

**INV-2 — Identitas tetap diturunkan server-side.**
CR ini tidak menambah parameter apa pun yang berbau identitas. Kalau Fase 2 dikerjakan, query
string yang boleh ada hanya `search` dan `limit`. **Tidak** ada `partner_id`, `company_id`,
`pricelist_id`, atau `connection_id` dari klien — CLAUDE.md aturan #1.

**INV-3 — Yang dikirim ke Odoo tetap hanya `product_id` + `qty`.**
`product_name`/`default_code` di payload request adalah teks tampilan portal. Jangan mengirimkan
nama dari klien sebagai `name` baris `sale.order.line`: itu menjadikan label yang dikendalikan
klien tertulis ke dokumen penjualan sungguhan.

**INV-4 — Permission tidak berubah.**
`GET /products` tetap `product.view`, `POST /requests` tetap `request.create`. Jangan mengarang
kode permission baru (CLAUDE.md aturan #3). Kalau Fase 2 menambah query param pada endpoint yang
sudah ada, permission-nya ikut yang sudah ada.

---

## 6. Rancangan UI: anatomi, state, keyboard, aksesibilitas

### 6.1 Sebelum → sesudah

```
SEBELUM
┌─────────────────────────┬───────────────────────────────────┬────────┬────────────┐
│ Filter products         │ Product                           │ Qty    │            │
│ [Search by name/code… ] │ [ Select a product…          ▾ ]  │ [ 1 ]  │ [Add line] │
└─────────────────────────┴───────────────────────────────────┴────────┴────────────┘

SESUDAH
┌────────────────────────────────────────────────────┬────────┬────────────┐
│ Product                                            │ Qty    │            │
│ [ adm|                                          ⌄] │ [ 1 ]  │ [Add line] │
│ ┌────────────────────────────────────────────────┐ │        │            │
│ │ [ADM]    ADM                      Rp 1.500.000 │ │        │            │
│ │ [ADM-F]  ADM FEE                  Rp   250.000 │ │        │            │
│ │ [PMP-02] Pompa ADM 200  (sudah di daftar)      │ │        │            │
│ │────────────────────────────────────────────────│ │        │            │
│ │ +2 produk lain cocok — persempit ketikan.      │ │        │            │
│ │ + Minta produk "adm" yang belum ada di katalog │ │        │            │
│ └────────────────────────────────────────────────┘ │        │            │
└────────────────────────────────────────────────────┴────────┴────────────┘
```

### 6.2 State internal komponen

| State | Isi | Catatan |
|---|---|---|
| `query` | string yang sedang diketik | Sumber kebenaran teks di input |
| `open` | boolean | Dropdown terbuka |
| `activeIndex` | number, `-1` = belum ada | Baris yang disorot keyboard |
| `selected` (prop `value`) | objek produk atau `null` | Dimiliki halaman, bukan komponen |

Aturan sinkronisasi yang gampang salah: begitu pengguna mengetik lagi setelah memilih, pilihan
**batal** (`onChange(null)`). Kalau tidak, input menampilkan ketikan baru sementara `Add line`
diam-diam masih memegang produk lama — persis kelas bug yang membuat pelanggan memesan barang
yang salah.

### 6.3 State tampilan dropdown

| Kondisi | Yang ditampilkan |
|---|---|
| Katalog sedang dimuat | Input `disabled` dengan placeholder *"Memuat katalog produk…"* |
| Katalog gagal dimuat | Input `disabled` + pesan error yang **sudah ada** hari ini (`productsError`), tidak dipindah ke dalam dropdown |
| `query` kosong, input difokuskan | 8 produk pertama + baris hitungan sisa. Fokus **selalu** membuka dropdown — ini yang membuatnya tetap terasa seperti `<select>` bagi yang tidak mau mengetik |
| Ada hasil | Maks. 8 opsi + baris hitungan sisa + baris escape hatch (D-5) |
| Tidak ada hasil | *"Tidak ada produk yang cocok dengan \"adm\"."* + baris escape hatch |
| Produk sudah ada di `lines` | Opsi tetap bisa dipilih (memilihnya menambah qty, perilaku `handleAddLine` yang sudah ada), diberi penanda kecil *"sudah di daftar"* |

### 6.4 Keyboard

| Tombol | Aksi |
|---|---|
| ketik apa saja | Buka dropdown, saring, `activeIndex` kembali ke 0 |
| `ArrowDown` / `ArrowUp` | Pindah sorotan, berputar di ujung. `ArrowDown` saat tertutup = buka |
| `Enter` | Pilih baris tersorot. Kalau tertutup/tidak ada sorotan: **jangan** submit form — `e.preventDefault()` |
| `Escape` | Tutup dropdown, kembalikan teks input ke label pilihan terakhir (atau kosong) |
| `Tab` | Tutup dropdown, jangan pilih apa pun, fokus lanjut ke Qty |
| klik di luar | Tutup, sama seperti `Escape` |

**Wajib:** `Enter` di input Qty harus memanggil `handleAddLine()`, bukan mengirim form (M-5).
Pola: `onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); handleAddLine(); } }}`.

### 6.5 Aksesibilitas

Pola ARIA combobox (WAI-ARIA APG), tanpa kompromi:

- Input: `role="combobox"`, `aria-expanded`, `aria-controls={listboxId}`,
  `aria-activedescendant={optionId(activeIndex)}`, `aria-autocomplete="list"`, `autoComplete="off"`.
- Daftar: `<ul role="listbox" id={listboxId}>`, tiap baris `<li role="option" id=… aria-selected=…>`.
- Baris hitungan sisa dan baris "tidak ada hasil" **bukan** `role="option"` (tidak bisa dipilih).
- Jumlah hasil diumumkan lewat satu `<span className="sr-only" role="status" aria-live="polite">`
  berisi mis. *"3 produk cocok"* — tanpa ini pengguna screen reader tidak tahu daftar berubah.
- Opsi dipilih lewat `onMouseDown` + `preventDefault()`, bukan `onClick`: `click` terjadi setelah
  `blur`, dan `blur` sudah menutup dropdown lebih dulu sehingga kliknya hilang.
- Sorotan aktif digulirkan ke tampak: `element.scrollIntoView({ block: 'nearest' })`.

Kelas `.sr-only` **belum ada** di `index.css` per hari ini — tambahkan sekali di §9, dan jangan
pakai `display:none` (screen reader mengabaikannya).

---

## 7. Kontrak komponen `ProductCombobox`

```jsx
<ProductCombobox
  products={products}             // array hasil GET /products (boleh kosong)
  value={pickProduct}             // objek produk terpilih atau null — dimiliki halaman
  onChange={setPickProduct}       // (product|null) => void
  onRequestUncataloged={(q) => …} // D-5: pengguna menekan escape hatch dengan ketikan q
  existingIds={existingIds}       // Set<number> untuk penanda "sudah di daftar"
  loading={productsLoading}
  disabled={Boolean(productsError)}
  inputId="quotation-product"     // supaya <label htmlFor> di halaman tetap benar
/>
```

Catatan kontrak:

- Komponen **tidak** melakukan fetch sendiri. Halaman yang memiliki data (sama seperti
  `CompanySwitcher` memiliki datanya). Ini yang membuat Fase 2 nanti hanya mengubah halaman,
  bukan komponen — kecuali penambahan dua prop opsional di §10.3.
- Komponen **tidak** menyimpan produk terpilih di state-nya sendiri. `value` datang dari luar,
  supaya `handleAddLine()` bisa mengosongkannya setelah baris masuk — dan M-3 hilang, karena
  tidak ada lagi kotak filter terpisah yang bisa tertinggal isinya.
- Harga diformat lewat helper bersama, bukan `p.list_price?.toLocaleString()` mentah:
  `list_price` bisa datang sebagai `false` dari XML-RPC, dan `false.toLocaleString()` menghasilkan
  string `"false"` di layar (tidak melempar — jadi kegagalannya diam).

---

## 8. Implementasi referensi

Kode di bawah adalah acuan, bukan tempelan buta — sesuaikan penamaan dengan berkas sekitarnya.
Komentar `//` di sini menjelaskan **kenapa** dan layak ikut masuk ke kode (CLAUDE.md).

### 8.1 `frontend/src/components/ProductCombobox.jsx` (baru)

```jsx
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
```

### 8.2 Perubahan di `frontend/src/pages/RequestsPage.jsx`

**Dihapus:** state `productFilter`, state `pickProductId`, dan seluruh `useMemo`
`filteredProducts` (pindah ke dalam komponen, **termasuk komentarnya** soal `false`).

**Ditambah:**

```jsx
const [pickProduct, setPickProduct] = useState(null);   // objek produk, bukan id string
const [productsLoading, setProductsLoading] = useState(true);
const existingIds = useMemo(() => new Set(lines.map((l) => l.product_id)), [lines]);
```

`productsLoading` disetel `false` di `.finally()` pemanggilan `listProducts()` yang sudah ada
(`RequestsPage.jsx:44-47`) — sekarang kedua cabangnya (sukses/gagal) perlu diketahui, bukan hanya
cabang gagal.

`handleAddLine` tidak lagi mencari produk dari id string:

```jsx
function handleAddLine() {
  const qty = Number(pickQty);
  // INV-1: hanya objek produk dari katalog yang boleh jadi baris. Tidak ada jalur di mana
  // ketikan bebas berakhir sebagai sale.order.line.
  if (!pickProduct || !(qty > 0)) return;
  setLines((prev) => { /* ... logika gabung-qty yang sudah ada, memakai pickProduct ... */ });
  setPickProduct(null);
  setPickQty('1');
}
```

D-5 — escape hatch memindahkan tipe request, bukan membuat produk:

```jsx
function handleRequestUncataloged(q) {
  // Portal tidak boleh membuat product.product di Odoo. Yang bisa dilakukan di sini persis
  // jalur yang sudah ada: catat permintaannya sebagai request_product supaya Sales menindak.
  setType('request_product');
  setProductNote((prev) => (prev.trim() ? prev : q));
  setPickProduct(null);
}
```

Markup picker:

```jsx
<div className="line-item-picker">
  <label style={{ flex: '3 1 380px' }} htmlFor="quotation-product">
    Product
    <ProductCombobox
      inputId="quotation-product"
      products={products}
      value={pickProduct}
      onChange={setPickProduct}
      onRequestUncataloged={handleRequestUncataloged}
      existingIds={existingIds}
      loading={productsLoading}
      disabled={Boolean(productsError)}
    />
  </label>
  <label style={{ flex: '0 1 110px' }}>
    Qty
    <input
      type="number" min="0.01" step="any" value={pickQty}
      onChange={(e) => setPickQty(e.target.value)}
      // M-5: tanpa ini, Enter di sini mengirim seluruh request quotation lebih awal.
      onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); handleAddLine(); } }}
    />
  </label>
  <button type="button" onClick={handleAddLine} disabled={!pickProduct || !(Number(pickQty) > 0)}>
    Add line
  </button>
</div>
```

D-6 — qty di tabel baris:

```jsx
<td data-label="Qty" className="num">
  <input
    type="number" min="0.01" step="any" className="line-qty-input"
    value={l.qty}
    onChange={(e) => setLines((prev) => prev.map((x) =>
      x.product_id === l.product_id ? { ...x, qty: e.target.value } : x))}
  />
</td>
```

Karena nilai qty kini bisa sementara kosong/tidak valid saat diketik, `estimatedTotal` dan
`canSubmit` harus memakai `Number(l.qty)`:

```jsx
const estimatedTotal = useMemo(
  () => lines.reduce((sum, l) => sum + (Number(l.qty) || 0) * (Number(l.list_price) || 0), 0),
  [lines]
);

const canSubmit = type === 'request_quotation'
  ? lines.length > 0 && lines.every((l) => Number(l.qty) > 0)
  : productNote.trim().length > 0;
```

dan `handleSubmit` mengirim `qty: Number(qty)`. Validator backend memakai
`z.coerce.number().positive()` sehingga angka berbentuk string tetap lolos — jangan bersandar
pada itu; kirim angka.

---

## 9. CSS

Tambahkan di `frontend/src/styles/index.css`, tepat sesudah blok `.line-item-picker`
(sekitar baris 820) supaya berkasnya tetap berkelompok per fitur. **Token saja** — jangan hardcode
warna, supaya dark mode dan tema brand ikut benar otomatis (CLAUDE.md).

```css
/* ------------------------------------------------ PRODUCT COMBOBOX (CR-0XX) --
   Menggantikan pasangan "Filter products" + <select> di /requests. Dropdown-nya
   position:absolute di atas .line-item-picker, jadi tinggi barisnya tidak melompat
   saat daftar terbuka. */
.combobox { position: relative; }
.combobox__input { width: 100%; }

.combobox__list {
  position: absolute; z-index: 30; inset-inline: 0; top: calc(100% + var(--s-1));
  max-height: 19rem; overflow-y: auto;
  list-style: none; margin: 0; padding: var(--s-1);
  background: var(--color-surface);
  border: 1px solid var(--color-border-strong);
  border-radius: var(--radius-sm);
  box-shadow: var(--shadow-md);
}

.combobox__option {
  display: flex; align-items: center; justify-content: space-between; gap: var(--s-3);
  padding: var(--s-2) var(--s-3);
  border-radius: var(--radius-sm);
  font-size: 0.85rem; cursor: pointer;
}
/* Sorotan keyboard dan hover memakai kelas yang sama supaya tidak pernah ada dua baris
   yang terlihat "aktif" sekaligus (mouse di satu baris, panah di baris lain). */
.combobox__option.is-active { background: var(--color-primary-tint); }
.combobox__option-main { display: flex; align-items: center; gap: var(--s-2); min-width: 0; }
.combobox__option-main > span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.combobox__option-price { color: var(--color-text-soft); font-variant-numeric: tabular-nums; flex: none; }

.combobox__code {
  font-family: var(--font-mono); font-size: 0.75rem; flex: none;
  padding: 1px var(--s-1);
  background: var(--color-surface-inset);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-sm);
}
.combobox__tag {
  flex: none; font-size: 0.7rem; color: var(--color-muted);
  border: 1px solid var(--color-border); border-radius: var(--radius-full);
  padding: 0 var(--s-2);
}

.combobox__empty,
.combobox__more { padding: var(--s-2) var(--s-3); font-size: 0.8rem; color: var(--color-muted); }

.combobox__escape {
  margin-top: var(--s-1); padding: var(--s-2) var(--s-3);
  border-top: 1px solid var(--color-border);
  font-size: 0.82rem; color: var(--color-primary); cursor: pointer;
}
.combobox__escape:hover { background: var(--color-primary-tint); }

.line-qty-input { width: 6.5rem; text-align: right; }

/* Utilitas: teks khusus screen reader. Bukan display:none -- itu justru menyembunyikannya juga
   dari screen reader, sehingga jumlah hasil tidak pernah terumumkan. */
.sr-only {
  position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px;
  overflow: hidden; clip-path: inset(50%); white-space: nowrap; border: 0;
}
```

Blok `[data-theme="dark"]` di `index.css` mendefinisikan ulang token, dan seluruh CSS di atas
hanya memakai token — jadi tidak ada aturan dark-mode tambahan yang perlu ditulis. Tetap **wajib
diverifikasi dengan mata** (§12), khususnya `--color-primary-tint` di atas `--color-surface` gelap.

---

## 10. Fase 2 (kondisional): pencarian sisi server

**Jangan kerjakan bagian ini bersama Fase 1.** Ini rencana matang untuk saat ambangnya terlampaui,
bukan pekerjaan hari ini.

### 10.1 Pemicu

Kerjakan Fase 2 kalau **salah satu** benar di Odoo pelanggan sungguhan:

- `GET /products` mengembalikan **> 2.000** baris, atau
- payload responsnya **> 1 MB**, atau
- waktu muat `/requests` yang dirasakan > 2 detik karena panggilan itu.

Cara mengukur, tanpa menulis kode apa pun: buka `/requests`, tab Network, lihat baris `products`
(ukuran + waktu). Catat angkanya di `cr.md` saat memutuskan.

### 10.2 Kontrak endpoint

Endpoint yang sudah ada diberi query param, bukan route baru (INV-4 — permission ikut yang ada):

```
GET /products?search=<string, maks 100 char>&limit=<1..50, default 20>
```

- Validasi Zod di validator produk (file baru di `src/validators/`), dipakai di **controller**,
  bukan di service — konvensi repo.
- `productService.listProducts(userId, currentCompanyId, { search, limit })` meneruskan ke
  `OdooProductService.listProducts`, yang menambahkan ke domain yang **sudah ada**:
  `'|', ['name', 'ilike', search], ['default_code', 'ilike', search]` plus `{ limit }`.
  Domain `sale_ok` + `company_id` yang sekarang **tidak boleh** dilonggarkan (CLAUDE.md aturan #2).
- Tanpa `search`, perilakunya persis seperti hari ini (kompatibel mundur — `ProductsPage` dan
  pemanggil lain tidak ikut berubah).
- Perbarui `api/openapi.yaml` pada `/products` (sekitar baris 1786): dua `parameters` baru +
  catatan bahwa hasilnya terpotong `limit`.

### 10.3 Yang berubah di frontend

`ProductCombobox` menerima dua prop opsional saja — `remote` dan `onSearch(query)`. Kalau `remote`
benar, komponen berhenti menyaring sendiri dan memanggil `onSearch` **setelah debounce 250–300 ms**
serta membuang hasil yang datang terlambat (balapan respons: ketikan "a" bisa kembali sesudah
"adm" — pakai penghitung permintaan atau `AbortController`). Sisa komponennya — keyboard, ARIA,
escape hatch — tidak berubah sama sekali.

### 10.4 Rate limiting (wajib, bukan opsional)

Pencarian sisi server berarti satu panggilan Odoo per jeda ketikan. CLAUDE.md: endpoint baru yang
mahal wajib membawa pembatasnya sendiri. Tiru `src/services/equipmentRateLimiter.js` apa adanya
(burst in-memory per `portalUserId`, `WINDOW_MS = 60_000`, sweeper `unref()`) dengan kuota lebih
longgar — mis. `MAX_PER_WINDOW = 30`, karena pemakaiannya memang meledak-ledak saat mengetik.
Berlakukan **hanya** pada permintaan yang membawa `search`, supaya pemuatan katalog biasa tidak
ikut terbatasi. Tambahkan barisnya di CLAUDE.md § "Keterbatasan yang diketahui" — pembatas ini
per-proses, sama seperti yang lain.

---

## 11. File manifest

### Fase 1 — frontend saja

| File | Aksi | Isi |
|---|---|---|
| `frontend/src/components/ProductCombobox.jsx` | **baru** | §8.1 |
| `frontend/src/pages/RequestsPage.jsx` | ubah | §8.2 — buang `productFilter`/`pickProductId`/`filteredProducts`, pasang combobox, escape hatch, qty inline, perbaikan Enter |
| `frontend/src/styles/index.css` | ubah | §9 — blok `.combobox`, `.line-qty-input`, utilitas `.sr-only` |
| `cr.md` | ubah | Satu entri CR baru (nomor berikutnya sesudah CR-054), format sama seperti entri yang sudah ada: Tanggal / Terkait / File diubah / Perubahan / Alasan / Dampak / Diuji oleh |

**Tidak** berubah di Fase 1: seluruh `src/**` (backend), `api/openapi.yaml`, `database/**`,
`package.json`. Kalau sebuah perubahan backend terasa perlu untuk menyelesaikan Fase 1, berhenti —
itu tanda rancangan ini sedang dilanggar, bukan tanda rancangannya kurang.

### Fase 2 — hanya kalau §10.1 terpicu

`src/integrations/odoo/OdooProductService.js`, `src/services/productService.js`,
`src/controllers/productController.js`, `src/routes/products.routes.js`, validator produk (baru),
`src/services/productSearchRateLimiter.js` (baru), `api/openapi.yaml`,
`frontend/src/api/products.js`, `frontend/src/components/ProductCombobox.jsx`,
`CLAUDE.md` (§ Keterbatasan yang diketahui).

---

## 12. Verifikasi & acceptance criteria

Belum ada test runner di repo ini dan CR ini murni UI — verifikasinya manual, dijalankan dengan
`npm run dev` lalu buka `http://localhost:5173/requests`. Setiap baris harus lulus sebelum CR
ditutup.

| # | Langkah | Diharapkan |
|---|---|---|
| AC-1 | Buka `/requests`, pilih tipe "Request a quotation" | Hanya ada **satu** field Product. Tidak ada lagi "Filter products". |
| AC-2 | Klik field Product tanpa mengetik | Dropdown terbuka berisi maks. 8 produk + baris hitungan sisa |
| AC-3 | Ketik `adm` (atau kode nyata di Odoo lokal) | Hasil menyempit; yang namanya/kodenya **diawali** kata kunci ada di atas (D-4) |
| AC-4 | Panah bawah/atas lalu Enter | Produk tersorot terpilih; **form tidak terkirim** |
| AC-5 | Enter di kolom Qty | Baris ditambahkan; **form tidak terkirim** (M-5) |
| AC-6 | Sesudah `Add line` | Field Product kosong dan siap diketik lagi — tidak ada sisa kata kunci di mana pun (M-3) |
| AC-7 | Pilih produk yang sudah ada di tabel, `Add line` lagi | Qty baris tergabung (bukan baris kedua), dan opsi itu bertanda "sudah di daftar" |
| AC-8 | Ubah qty langsung di tabel ke `0`, lalu kosongkan | Tombol submit nonaktif; baris tidak hilang sendiri (D-6) |
| AC-9 | Ketik kata kunci yang tidak ada, tekan baris escape hatch | Form pindah ke "Request a product not in the catalog" dengan ketikan tadi sudah terisi (D-5) |
| AC-10 | Escape saat dropdown terbuka, lalu Tab | Dropdown tertutup, teks kembali ke pilihan sah, fokus pindah ke Qty |
| AC-11 | Klik di luar dropdown | Tertutup; tidak ada pilihan yang berubah |
| AC-12 | Kirim quotation berisi 2 baris, buka `/quotations` | Draft quotation muncul dengan produk & qty yang benar — bukti bahwa `product_id` tetap jalur satu-satunya (INV-1/INV-3) |
| AC-13 | Uji dengan produk yang `default_code`-nya kosong di Odoo | Tidak ada error di console; label tampil tanpa kurung siku (jebakan `false` XML-RPC) |
| AC-14 | Aktifkan dark mode (ThemeToggle) | Dropdown, sorotan aktif, dan chip kode tetap terbaca |
| AC-15 | Lebar viewport 375px | Dropdown tidak keluar layar; `.line-item-picker` tetap membungkus rapi |
| AC-16 | Navigasi hanya dengan keyboard dari awal form sampai submit | Tidak ada jebakan fokus; setiap opsi terbaca screen reader sebagai option dalam listbox |
| AC-17 | `cd frontend && npm run build` | Lulus tanpa error |

Catatan: `node scripts/check-auth-refresh.mjs` **tidak** relevan di sini (CR ini tidak menyentuh
`frontend/src/api/client.js`). Skrip verifikasi asisten dan equipment juga tidak — tidak ada tool
asisten yang menyentuh jalur ini.

---

## 13. Anti-pattern: jangan lakukan ini

1. **Menyimpan ketikan bebas sebagai baris quotation.** Tidak ada `product_label`, `custom_name`,
   atau `product_id: null` pada `lines`. Teks bebas hanya boleh jadi `request_product` (INV-1).
2. **Membuat `product.product` di Odoo dari portal** karena escape hatch "mirip `Create "adm"`".
   Odoo membolehkan itu untuk staf internal; pelanggan bukan staf internal.
3. **Menambah `react-select`/`downshift`/`cmdk`** tanpa bertanya lebih dulu (CLAUDE.md § Dependency).
4. **Membiarkan komponen mem-fetch sendiri.** Data dimiliki halaman; kalau tidak, Fase 2 harus
   membongkar komponennya lagi.
5. **Menambah endpoint pencarian di Fase 1** "karena sekalian". Itu menambah jalur panggilan Odoo
   baru + rate limiter baru untuk masalah yang murni tampilan.
6. **Warna hardcode** di CSS baru. Token saja, atau dark mode diam-diam rusak.
7. **`onClick` pada opsi dropdown.** Harus `onMouseDown` + `preventDefault()` — kalau tidak, blur
   menutup daftar sebelum klik mendarat, dan gejalanya "kadang-kadang tidak bisa diklik".
8. **Menghapus komentar `false` XML-RPC** yang sekarang ada di `filteredProducts`. Pindahkan
   bersama kodenya; itu jejak jebakan nyata, bukan basa-basi.
9. **Mengubah `POST /requests` atau validatornya.** Bentuk payload tidak berubah sedikit pun oleh
   CR ini — kalau terasa perlu berubah, ada yang salah di frontend.

---

## 14. Pertanyaan terbuka

Tidak memblokir Fase 1; jawab sebelum memutuskan Fase 2.

- **Q-1 — Berapa besar katalog `sale_ok` di Odoo produksi pelanggan?** Angka ini satu-satunya
  penentu apakah §10 dikerjakan. Diukur seperti di §10.1.
- **Q-2 — Perlukah dropdown menandai stok (`qty_available` sudah ikut diambil hari ini)?**
  Sengaja tidak ditampilkan: stok gudang pada permintaan quotation gampang salah baca sebagai
  janji ketersediaan. Kalau client menginginkannya, itu tambahan kecil di `.combobox__option` —
  tapi harus disertai label jelas bahwa itu stok saat ini, bukan komitmen.
- **Q-3 — Apakah dropdown perlu menaruh produk yang pernah dibeli pelanggan di puncak?**
  `GET /products/reorder-suggestions` sudah ada dan bisa menjadi bagian "Sering Anda pesan" saat
  ketikan masih kosong. Nilainya nyata, tapi itu fitur tersendiri — di luar permintaan ini.
