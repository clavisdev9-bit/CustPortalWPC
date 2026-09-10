# Implementation Spec — Customer Population (Installed Base Registry)

- **Status**: Draft analisis + rancangan. **Belum ada kode yang ditulis. Ada 6 pertanyaan yang
  butuh jawaban client sebelum Fase 1 boleh dimulai** (lihat §2.4 dan §3).
- **Prepared as**: Hasil analisis requirement + rancangan teknis, untuk direview client dan
  dieksekusi oleh Claude Code / developer.
- **Date**: 2026-08-30
- **Related documents**:
  - [`system.md`](../../system.md) — arsitektur as-built (§6 keamanan, §7 Odoo layer, §8 model data, §10 API)
  - [`customer_portal_odoo18_customer_scoped_access.md`](customer_portal_odoo18_customer_scoped_access.md) — model identity/scope yang WAJIB tetap berlaku
  - [`customer_portal_ai_assistant.md`](customer_portal_ai_assistant.md) — kontrak tool registry asisten (§7) yang dipakai ulang di §13
  - [`Final_Technical_Specification.md`](../../Final_Technical_Specification.md) — baseline arsitektur
  - [`customer_population_sample_data.xlsx`](customer_population_sample_data.xlsx) — data contoh + kamus data + template import.
    Sheet `07_Rekomendasi` berisi formula hidup yang memperagakan §9 di atas data §5, bukan angka mati.
- **Current state referenced** (dibaca langsung dari repo, sudah diverifikasi):
  `src/services/odooContext.js`, `src/integrations/odoo/OdooMaintenanceService.js`,
  `src/integrations/odoo/OdooProductService.js`, `src/integrations/odoo/OdooDeliveryService.js`,
  `src/integrations/odoo/OdooWarrantyService.js`, `src/integrations/odoo/OdooPartnerService.js`,
  `src/services/productService.js`, `src/services/maintenanceService.js`,
  `src/services/rmaService.js`, `src/services/warrantyService.js`,
  `src/services/assistant/toolRegistry.js`, `src/services/assistant/tools/products.js`,
  `database/migrations/0005_phase5_rma_warranty.sql`, `database/migrations/0009_document_shares.sql`,
  `database/seeds/0001_permissions_and_roles.sql`, `frontend/src/components/AppShell.jsx`

> **Tujuan dokumen ini**: menjadi satu-satunya acuan implementasi, cukup presisi untuk dikerjakan
> tanpa menebak, dan cukup eksplisit soal *yang belum diketahui* supaya tidak ada asumsi diam-diam
> yang baru ketahuan salah saat UAT. Setiap pola kode di bawah diambil dari file yang sudah ada
> di repo ini.

---

## Daftar Isi

1. [Ringkasan eksekutif & tiga temuan yang mengubah rancangan](#1-ringkasan-eksekutif--tiga-temuan-yang-mengubah-rancangan)
2. [Analisis requirement](#2-analisis-requirement)
3. [Keputusan desain (D-1 … D-6)](#3-keputusan-desain-d-1--d-6)
4. [Invarian yang tidak boleh dilanggar (IB-1 … IB-5)](#4-invarian-yang-tidak-boleh-dilanggar-ib-1--ib-5)
5. [Model data konseptual — tiga lapis](#5-model-data-konseptual--tiga-lapis)
6. [Pemetaan fisik ke Odoo](#6-pemetaan-fisik-ke-odoo)
7. [Yang tetap tinggal di portal DB](#7-yang-tetap-tinggal-di-portal-db)
8. [Strategi akuisisi & kesegaran data](#8-strategi-akuisisi--kesegaran-data)
9. [Mesin rekomendasi upsell (deterministik)](#9-mesin-rekomendasi-upsell-deterministik)
10. [Kontrak API](#10-kontrak-api)
11. [File manifest backend](#11-file-manifest-backend)
12. [Permukaan frontend](#12-permukaan-frontend)
13. [Integrasi Asisten Portal](#13-integrasi-asisten-portal)
14. [Permission & seed](#14-permission--seed)
15. [NFR: budget panggilan Odoo, degradasi, error](#15-nfr-budget-panggilan-odoo-degradasi-error)
16. [Verifikasi](#16-verifikasi)
17. [Roadmap fase & acceptance criteria](#17-roadmap-fase--acceptance-criteria)
18. [Risiko & mitigasi](#18-risiko--mitigasi)
19. [KPI bisnis & metrik kualitas data](#19-kpi-bisnis--metrik-kualitas-data)
20. [Rekomendasi paket dokumentasi sistem](#20-rekomendasi-paket-dokumentasi-sistem)
21. [Anti-pattern: jangan lakukan ini](#21-anti-pattern-jangan-lakukan-ini)

---

## 1. Ringkasan eksekutif & tiga temuan yang mengubah rancangan

Client meminta "data customer population": registry mesin milik pelanggan sampai ke detail
sparepart satuan terkecil, dengan empat benefit yang semuanya menyebut **sales** sebagai penerima
manfaat.

Analisis atas requirement itu terhadap arsitektur CustPortalCRM menghasilkan tiga temuan yang
mengubah bentuk rancangan secara mendasar. Ketiganya harus disepakati lebih dulu — ini penentu
bentuk sistem, bukan detail implementasi.

### Temuan 1 — Penerima manfaat yang diminta bukan pengguna aplikasi ini

Keempat benefit menyebut *sales*. CustPortalCRM adalah **customer self-service portal**: seluruh
invariannya justru dibangun untuk menjamin satu user login hanya melihat datanya sendiri.
Aturan #1 CLAUDE.md ("identitas customer selalu diturunkan server-side dari `req.user`") dan
aturan #2 ("setiap query Odoo terkunci ke partner + company") adalah kebalikan persis dari yang
dibutuhkan seorang sales — yang justru harus melihat **banyak** pelanggan sekaligus dan
membandingkan antar mereka.

Artinya permintaan ini bukan satu fitur, melainkan **satu aset data dengan dua permukaan konsumsi**:

| | Aset / permukaan | Audiens | Rumah yang benar |
|---|---|---|---|
| **A** | Installed Base Registry (datanya sendiri) | — | **Odoo** (system of record) |
| **B1** | Tampilan 360 per pelanggan untuk upselling | Sales (internal) | **Odoo** (form `res.partner`) |
| **B2** | "My Equipment" — self-service | Pelanggan | **CustPortalCRM** |

Rekomendasi: bangun **A** sekali di Odoo; **B1** didapat nyaris gratis karena sales sudah bekerja
di Odoo; **B2** adalah pekerjaan portal yang sebenarnya. Membangun B1 di dalam portal berarti
membuat jalur autentikasi kedua yang menembus dua aturan keamanan inti — lihat D-1 untuk biaya
dan bentuknya kalau client tetap menginginkannya.

### Temuan 2 — Benefit #2 bukan data installed base, melainkan master data

"History pembelian sparepart sehingga dapat upselling untuk segera upgrade sparepart tersebut"
tidak dapat dijawab oleh registry unit, sekomplit apa pun registry itu. Untuk tahu sebuah part
"sudah waktunya diganti" dibutuhkan tiga bahan, dan hanya satu yang sudah ada:

| Bahan | Ada sekarang? | Sumber |
|---|---|---|
| Riwayat beli part per pelanggan | **Ya** | `sale.order.line` — sudah dipakai `productService.getPurchaseHistory` |
| Matriks kompatibilitas part ↔ model mesin | **Tidak** | master data baru |
| Interval penggantian per part (bulan / jam operasi) | **Tidak** | master data baru |

Ini pola kegagalan yang paling sering terjadi pada proyek installed base: registry unit selesai
dibangun, terlihat mengesankan, lalu menghasilkan **nol** rekomendasi upsell karena master data
servisnya tidak pernah dibuat. Karena itu §5 memisahkan tegas **data instance** (unit milik
pelanggan) dari **master data servis** (katalog part + interval + jalur upgrade), dan §17
menempatkan master data sebagai fase yang berdiri sendiri, bukan lampiran dari fase registry.

Kata "upgrade" di benefit #2 juga menyiratkan kebutuhan keempat yang sering terlewat:
**supersession** — part lama digantikan versi yang lebih baik. Itu dimodelkan eksplisit di §6
(`x_superseded_by_id`); tanpanya "upgrade" hanya bisa dilakukan lewat ingatan masing-masing sales.

### Temuan 3 — "Satuan terkecil" perlu batas yang bisa dipertahankan

"Sampai ke satuan terkecil" secara harfiah berarti setiap baut. Biaya akuisisi dan pemeliharaan
data naik eksponensial per lapis kedalaman, sementara nilai upsell-nya jatuh ke nol untuk komponen
yang tidak pernah dijual terpisah.

Rekomendasi batas yang tegas dan mudah diaudit:

> **Sebuah komponen masuk registry jika dan hanya jika ia punya SKU yang bisa dipesan pelanggan.**
> Tidak punya `product.product` sendiri = tidak masuk registry.

Aturan ini menyelaraskan kedalaman data dengan tujuan komersialnya, bisa diverifikasi otomatis,
dan menghentikan perdebatan cakupan tanpa menebak-nebak. Lihat D-3.

### Bentuk akhir yang direkomendasikan

```
                    ODOO (system of record)
  ┌──────────────────────────────────────────────────────────┐
  │  maintenance.equipment  (+ field Studio)                 │
  │    └─ hierarki induk→anak  = unit → modul → part         │
  │  product.template (+ field Studio)                       │
  │    └─ interval servis, kompatibilitas, supersession      │
  │  sale.order / stock.move.line / stock.lot  ← sumber seed │
  └───────────┬──────────────────────────────┬───────────────┘
              │ dibaca sales langsung        │ XML-RPC, terkunci partner+company
              │ (tab di form pelanggan)      │
              ▼                              ▼
        SALES (B1) — gratis          CustPortalCRM (B2)
                                     /equipment · Asisten · due-replacement
```

Portal DB **tidak menyimpan salinan registry**. Ia hanya menambah dua hal: seed permission, dan
tabel *permintaan koreksi data* dari pelanggan (§7) — mengikuti pola stopgap `rma_requests`.

---

## 2. Analisis requirement

### 2.1 Pemetaan benefit → kapabilitas → data

Setiap benefit yang client sebut diterjemahkan ke kapabilitas konkret, lalu ke data yang harus ada.
Kolom "Lapis" merujuk §5, kolom "Fase" merujuk §17.

| # | Benefit (kata client) | Kapabilitas konkret | Data yang dibutuhkan | Lapis | Fase |
|---|---|---|---|---|---|
| 1 | Sales tahu detail product → upselling | Unit 360: daftar mesin pelanggan + konfigurasi as-built + status | Unit, model, serial, tanggal pasang, lokasi, pohon komponen | L1 + L2 | 1, 3 |
| 2 | History pembelian sparepart → upsell upgrade | Daftar part jatuh tempo + jalur supersession | Riwayat beli part, interval penggantian, `superseded_by` | Master + L3 | 2 |
| 3 | Sales terlihat profesional, paham keinginan customer | Riwayat servis per unit dalam satu layar | Tiket / RMA / klaim garansi / maintenance request yang tertaut ke unit | L1 + relasi | 3 |
| 4 | Sales memberi info apa yang customer butuhkan | Rekomendasi proaktif + notifikasi jatuh tempo | Hasil mesin rekomendasi (§9) | Derived | 2, 4 |

Yang perlu disadari dari tabel ini: **benefit 1 dan 3 dipenuhi oleh registry; benefit 2 dan 4
dipenuhi oleh master data servis.** Kalau proyek hanya mengerjakan registry, dua dari empat benefit
tidak akan terwujud — dan justru dua yang paling langsung menghasilkan pendapatan.

### 2.2 Glosarium & pemetaan istilah

Istilah client ↔ istilah industri ↔ nama di kode. Konsistensi ini penting supaya dokumen bisnis
dan kode tidak berbicara dua bahasa yang berbeda.

| Istilah client | Istilah industri | Nama di kode / UI |
|---|---|---|
| Customer population | Installed base / population data / fleet | domain `equipment`; UI pelanggan **"My Equipment"** |
| Mesin | Unit / asset | `maintenance.equipment` dengan `x_parent_equipment_id = false` |
| Detail sparepart | Component / serviceable part | `maintenance.equipment` anak, atau baris katalog servis |
| Satuan terkecil | Lowest serviceable item (LSI) | dibatasi D-3: harus punya SKU |
| Upgrade sparepart | Supersession / retrofit | `x_superseded_by_id` |

Catatan penting untuk client: di sebagian industri "population data" mencakup **mesin merek
kompetitor** yang dipakai pelanggan (untuk conquest selling). Itu pertanyaan cakupan yang sangat
besar — datanya tidak bisa diturunkan dari transaksi sama sekali dan harus disurvei manual.
Lihat Q-2 di §2.4.

### 2.3 Yang sudah ada di sistem dan bisa dipakai ulang

Rancangan ini sengaja tidak memulai dari nol. Yang sudah terpasang:

| Sudah ada | File | Dipakai untuk |
|---|---|---|
| Pembacaan `maintenance.request` terkunci partner | `src/integrations/odoo/OdooMaintenanceService.js` | Riwayat servis per unit (§10, benefit #3). Sudah membaca `equipment_id` — tinggal dibalik arah bacanya |
| Konvensi field customer via Studio | `CUSTOMER_FIELD = 'x_studio_customer'` di file yang sama | Preseden penamaan field owner di `maintenance.equipment` (§6) |
| Riwayat pembelian per pelanggan | `OdooProductService.getPurchaseHistory` | Bahan #1 mesin rekomendasi (§9) |
| Agregasi frekuensi order | `productService.getReorderSuggestions` | Pola agregasi di service layer, ditiru §9 |
| Lookup serial ke `stock.lot` | `OdooWarrantyService.lookupSerial` | Penautan unit ↔ lot saat backfill (§8) |
| Ekspansi keluarga partner | `OdooPartnerService.findFamilyIds` (pakai `commercial_partner_id`) | Preseden untuk D-4 |
| Registry tool asisten + guard invarian | `src/services/assistant/toolRegistry.js`, `scripts/check-assistant-invariants.js` | Tool baru §13 otomatis ikut terjaga |
| Pola stopgap portal-DB + mirror ke helpdesk | `rmaService.js`, `warrantyService.js`, migrasi `0005` | Permintaan koreksi data (§7) |

### 2.4 Ambiguitas yang harus dijawab client

Enam pertanyaan berikut mengubah arsitektur, bukan sekadar detail. Q-1 sampai Q-3 memblokir Fase 1.

| ID | Pertanyaan | Kenapa memblokir | Default kalau tidak dijawab |
|---|---|---|---|
| **Q-1** | Sales akan bekerja di Odoo atau di portal? | Menentukan apakah perlu jalur autentikasi kedua di portal (D-1). Selisih usahanya besar | Sales di Odoo |
| **Q-2** | Apakah population mencakup mesin **merek kompetitor** milik pelanggan? | Kalau ya, data tidak bisa diturunkan dari transaksi sama sekali → butuh proses survei + entri manual + PIC-nya | Tidak — hanya mesin yang kita jual |
| **Q-3** | Apakah addon Python bisa di-deploy ke Odoo target, atau hanya Studio? | Menentukan apakah hierarki + field baru dibuat sebagai model kustom atau field Studio (D-2). Catatan: untuk RMA/garansi dulu **tidak bisa** deploy addon (migrasi `0005`) | Hanya Studio |
| **Q-4** | Berapa dalam pohon komponen yang benar-benar dipakai sales? | Menentukan apakah L2 (§5) perlu dibangun sama sekali | 2 level: unit → part yang bisa diservis |
| **Q-5** | Siapa pemilik master data interval servis, dan seberapa sering direview? | Tanpa pemilik yang bernama, master data membusuk dalam 6 bulan dan mesin rekomendasi berubah jadi berbahaya | Product Manager, review kuartalan |
| **Q-6** | Apakah pelanggan boleh melihat seluruh pohon komponen mesinnya? | Sebagian principal menganggap BOM sebagai IP yang tidak dibuka ke pelanggan | Ya, tapi hanya part yang bisa diservis (D-3) |

### 2.5 Asumsi yang dipakai dokumen ini

Rancangan di bawah dibangun di atas asumsi berikut. Kalau salah satu terbukti salah, bagian yang
terdampak disebut eksplisit supaya tidak perlu membaca ulang seluruh dokumen.

| ID | Asumsi | Kalau salah, yang terdampak |
|---|---|---|
| A-1 | App **Maintenance** terpasang di Odoo target | §6 seluruhnya — perlu model kustom sebagai gantinya. Diuji Fase 0 |
| A-2 | Mesin dijual dengan tracking **serial/lot** (`stock.lot`) | §8 backfill kehilangan sumber utamanya → entri manual. Diuji Fase 0 |
| A-3 | Odoo versi 17/18 (`stock.lot`, bukan `stock.production.lot`) | Nama field di §6/§8 (`quantity` vs `qty_done`). Sudah dikonfirmasi dari repo — kode existing memakai `stock.lot` |
| A-4 | Odoo Studio tersedia (bisa membuat field `x_*`) | Sama dengan Q-3 → semua master data pindah ke portal DB dan sales kehilangan aksesnya |
| A-5 | Plan Odoo = **Custom** (External API aktif) | Seluruh integrasi. Sudah tercatat sebagai batasan diketahui di CLAUDE.md |
| A-6 | Satu unit mesin = satu serial unik | D-5 (atribusi) jadi jauh lebih sulit; registry harus berbasis kuantitas, bukan unit |

---

## 3. Keputusan desain (D-1 … D-6)

### D-1 · Sales tetap bekerja di Odoo; portal hanya melayani pelanggan

**Keputusan**: registry hidup di Odoo, sehingga tampilan 360 untuk sales adalah **tab di form
`res.partner` Odoo** — bukan halaman baru di CustPortalCRM.

**Alasan**: benefit #1, #3, #4 menuntut sales melihat data lintas pelanggan. Portal ini tidak
punya konsep "staff yang boleh melihat banyak pelanggan" selain `is_platform_admin`, yang
mem-*bypass* seluruh RBAC (`src/middleware/requirePermission.js:11`) dan karena itu sama sekali
tidak layak dipakai sebagai peran sales. Memakainya berarti setiap sales bisa membaca seluruh
data seluruh pelanggan tanpa batas.

**Biaya kalau client tetap ingin sales di portal (Opsi B)** — cakupan tambahan yang harus
dianggarkan terpisah, bukan bonus:

1. Tabel `staff_account_assignments (staff_user_id, odoo_connection_id, partner_id)` — penugasan
   eksplisit account manager ke pelanggan. Tanpa ini, "sales" berarti "semua pelanggan".
2. Fungsi baru `resolveStaffScope(userId)` di `odooContext.js` yang **tidak boleh** memakai ulang
   `resolveOdooContext` — ia mengembalikan *himpunan* partner, bukan satu partner.
3. Middleware `requireStaffScope(partnerIdParam)` yang memverifikasi partner yang diminta ada di
   himpunan penugasan. Ini akan menjadi satu-satunya tempat di seluruh sistem di mana id partner
   boleh datang dari request — jadi ia butuh audit trail sendiri dan test-nya sendiri.
4. Namespace route terpisah `/staff/*` dengan `authenticate` + `requireStaffScope`; tidak boleh
   berbagi controller dengan route pelanggan.
5. `scripts/check-assistant-invariants.js` perlu aturan tambahan supaya tool asisten tidak pernah
   menyentuh jalur staff.

Kalau Opsi B dipilih, ia menjadi Fase 5 di §17 dan wajib melewati review keamanan tersendiri.

### D-2 · Registry disimpan di Odoo, bukan portal DB

**Keputusan**: seluruh data instance dan master data servis hidup di Odoo. Portal DB tidak
menyimpan salinannya.

**Alasan**: prinsip inti CLAUDE.md menyelesaikan ini tanpa ambiguitas — *"Portal mengelola siapa
customer dan apa yang boleh. Odoo mengelola apa yang dimiliki customer."* Installed base adalah
definisi harfiah dari "apa yang dimiliki customer".

Konsekuensi teknis, sama seperti keputusan "sengaja tidak ada kolom status lokal" di migrasi
`0005`: **jangan meng-cache registry di portal DB.** Data basi lebih berbahaya daripada data
lambat, karena sales akan menyebut angka yang salah ke hadapan pelanggan.

**Kalau Q-3 dijawab "addon bisa di-deploy"**: buat model kustom `x_installed_base.unit` yang lebih
bersih daripada menumpang `maintenance.equipment`. Rancangan di bawah tetap berlaku — hanya nama
model dan prefiks field yang berubah, dan perubahan itu seluruhnya terkurung di
`src/integrations/odoo/`.

### D-3 · Kedalaman dibatasi oleh "punya SKU atau tidak"

**Keputusan**: sebuah komponen masuk registry hanya kalau ia punya `product.product` sendiri yang
`sale_ok`. Baut, seal yang tidak dijual terpisah, dan sub-komponen tanpa SKU **tidak** masuk.

**Alasan**: tujuan datanya komersial. Komponen yang tidak bisa dipesan tidak bisa di-upsell, tapi
tetap menimbulkan biaya entri dan pemeliharaan selamanya. Aturan ini juga bisa diverifikasi mesin
(§16), jadi penegakannya tidak bergantung pada disiplin manusia.

### D-4 · Scoping memakai keluarga `commercial_partner_id`, bukan partner persis

**Keputusan**: `GET /equipment` mengembalikan unit milik **seluruh keluarga partner** pelanggan
(`commercial_partner_id` yang sama), bukan hanya `odooPartnerId` persis.

**Alasan**: mesin secara fisik berada di alamat pengiriman, yang di Odoo adalah partner **anak**
dari entitas komersial. User portal biasanya ter-map ke partner induk. Dengan pencocokan persis,
pelanggan yang punya 40 mesin akan melihat daftar kosong — dan ini baru ketahuan saat UAT.

**Preseden**: `OdooPartnerService.findFamilyIds` sudah melakukan ekspansi ini untuk
`resolveUserManagementScope`. Pakai ulang fungsi itu; jangan tulis yang baru.

**Catatan keamanan**: ini pelebaran cakupan yang disengaja dan berbeda dari `document_shares`
(yang sengaja memilih pencocokan persis). Alasan perbedaannya: dokumen ditujukan ke *individu*
tertentu, sedangkan aset dimiliki *badan hukum*. Perbedaan ini wajib ikut ditulis di
`system.md §9` supaya tidak terbaca sebagai kelalaian di kemudian hari.

### D-5 · Atribusi konsumsi part yang jujur

**Keputusan**: kalau pelanggan punya lebih dari satu unit dengan model sama dan pembelian part
tidak bisa ditautkan ke unit tertentu, rekomendasi dihitung **di level armada** dan diberi label
`attribution: 'fleet_estimated'`. Tidak pernah ditebak ke satu unit.

**Alasan**: pembelian tercatat di `sale.order.line` yang tidak membawa referensi unit. Kalau
pelanggan punya 5 mesin identik dan membeli 1 filter, secara matematis tidak mungkin tahu mesin
mana. Menebaknya lalu menampilkan hasil tebakan sebagai fakta adalah persis kegagalan yang sudah
dihindari repo ini di `OdooWarrantyService.lookupSerial` ("does NOT verify this specific customer
purchased that unit") dan di `OdooProductService.listProducts` (menolak menebak harga pricelist).

Field `attribution` wajib sampai ke UI dan ke ringkasan tool asisten — bukan hanya ada di response
JSON.

### D-6 · Penamaan

**Keputusan**: `equipment` di kode dan URL; "Customer Population" hanya di dokumen bisnis;
"My Equipment" di UI pelanggan.

**Alasan**: "population" tidak punya makna yang jelas bagi pelanggan yang membuka portal, dan di
kode ia akan bertabrakan secara konseptual dengan `res.partner`. `equipment` selaras dengan model
Odoo yang mendasarinya dan dengan domain `maintenance` yang sudah ada.

---

## 4. Invarian yang tidak boleh dilanggar (IB-1 … IB-5)

Lima aturan berikut adalah fondasi keamanan dan kepercayaan fitur ini. Melanggar salah satunya
membatalkan jaminannya, sekalipun fiturnya "jalan".

### IB-1 · Tidak ada id partner yang datang dari request

Berlaku sama seperti aturan #1 CLAUDE.md. Tidak ada endpoint `/equipment*` yang menerima
`partner_id`, `customer_id`, atau `company_id` dari body/query/header. Satu-satunya sumber:

```js
const { session, odooPartnerId, odooCompanyId } = await resolveOdooContext(userId, currentCompanyId);
```

Ekspansi keluarga D-4 dihitung **di server dari `odooPartnerId`**, bukan dikirim klien.

### IB-2 · Setiap query equipment terkunci ke keluarga partner + company

Termasuk pada pengambilan satu record (`ensureOwned`). Unit milik pelanggan lain menghasilkan
`404`, bukan data. Pola persis mengikuti `OdooMaintenanceService.getRequest`.

### IB-3 · Registry tidak di-cache di portal DB

Tidak ada tabel `equipment_*` yang menyimpan nama unit, serial, model, atau status. Alasan di D-2.
Satu-satunya tabel portal yang boleh ada adalah permintaan koreksi (§7), dan itu bukan salinan
registry melainkan antrean permintaan.

### IB-4 · Rekomendasi wajib membawa asal-usulnya

Setiap baris rekomendasi (§9) harus membawa `basis` (`last_purchase` / `install_date`) dan
`attribution` (`unit` / `fleet_estimated`). Angka jatuh tempo tanpa asal-usul dilarang tampil di
UI maupun di jawaban asisten. Ini pasangan operasional dari D-5.

### IB-5 · Field Odoo diverifikasi sebelum dipakai, bukan diasumsikan

`search_read` Odoo menggagalkan **seluruh** panggilan bila satu field saja tidak valid pada model
tersebut. Repo ini sudah pernah kena: `carrier_tracking_ref` sempat mematikan seluruh listing
pengiriman (lihat komentar di `OdooDeliveryService.js`). Karena itu setiap field `x_*` di §6 wajib
lolos `scripts/check-equipment-capability.js` (§16) sebelum masuk ke `LIST_FIELDS`, dan field
opsional dibaca lewat panggilan sekunder yang di-`try/catch` terpisah.

---

## 5. Model data konseptual — tiga lapis

Pemisahan lapis ini bukan kosmetik: **biaya akuisisi datanya berbeda satu-dua orde besaran per
lapis**, dan itulah yang menentukan urutan fase.

```
  MASTER DATA (per model produk, bukan per pelanggan)
  ┌─────────────────────────────────────────────────────────────┐
  │ ServiceCatalogItem                                          │
  │   part ──kompatibel-dengan──> kategori/model mesin          │
  │   interval_bulan · interval_jam · is_wear_part              │
  │   superseded_by ──> part pengganti (jalur "upgrade")        │
  └─────────────────────────────────────────────────────────────┘
                    │ join saat runtime (§9)
                    ▼
  INSTANCE DATA (per pelanggan)
  ┌─────────────────────────────────────────────────────────────┐
  │ L1  EquipmentUnit         mesin utuh, punya serial          │
  │      ├── L2 Component     modul/sub-assembly (opsional)     │
  │      │     └── L3 Part    part terpasang yang bisa diservis │
  │      └── relasi: maintenance.request · ticket · RMA · klaim │
  └─────────────────────────────────────────────────────────────┘
```

| Lapis | Isi | Sumber data | Biaya akuisisi | Nilai bisnis | Fase |
|---|---|---|---|---|---|
| **L1 — Unit** | Mesin utuh: serial, model, tanggal pasang, lokasi, akhir garansi, status | **Otomatis** dari `stock.move.line` + `stock.lot` + `sale.order` | **Rendah** — sekali backfill | **Tinggi** — memenuhi benefit #1 & #3 | 1 |
| **L2 — Konfigurasi** | Modul/sub-assembly di dalam unit (as-built) | `mrp.bom` di-snapshot saat delivery, lalu dikoreksi manual | **Sedang** | Sedang — hanya penting untuk mesin modular | 3 |
| **L3 — Part terpasang** | Part aus yang sedang terpasang + kapan terakhir diganti | Laporan servis; belum ada sistemnya | **Tinggi & berkelanjutan** | Tinggi tapi **hanya bila master data ada** | 3–4 |
| **Master** | Katalog servis: interval, kompatibilitas, supersession | Entri manual oleh Product Management | **Sedang, sekali + review berkala** | **Tertinggi per rupiah** — mengaktifkan benefit #2 & #4 | 2 |

**Konsekuensi urutan fase**: L1 (murah, otomatis) + Master (sedang, manual) sudah cukup untuk
menghasilkan seluruh nilai upsell. L3 hanya mempertajam akurasinya. Karena itu §17 menempatkan
Master di Fase 2 dan L3 baru di Fase 3–4 — kebalikan dari urutan intuitif "lengkapi dulu datanya
sampai ke bawah".

### Atribut per entitas

**EquipmentUnit (L1)** — yang wajib ada supaya fitur berjalan ditandai **(w)**:

| Atribut | Tipe | Wajib | Catatan |
|---|---|---|---|
| `id` | int | (w) | id Odoo |
| `name` | string | (w) | label unit |
| `serial_number` | string | (w) | kunci identitas di lapangan; sumber A-2 |
| `product_id` | m2o product | (w) | model/tipe mesin — kunci join ke katalog servis |
| `category_id` | m2o kategori | (w) | keluarga mesin; kunci kompatibilitas termurah |
| `owner_partner_id` | m2o res.partner | (w) | pemilik. **Bukan** `partner_id` bawaan Odoo — lihat §6 |
| `install_date` | date | (w) | titik nol perhitungan interval bila belum pernah beli part |
| `warranty_end` | date | | untuk klaim garansi & sinyal upsell kontrak servis |
| `location` | string | | site/plant tempat unit berada |
| `status` | enum | (w) | `active` / `idle` / `decommissioned` — unit mati tidak boleh menghasilkan rekomendasi |
| `runtime_hours` | float | | hanya bila pelanggan melaporkan; dasar interval berbasis jam |
| `parent_id` | m2o self | | hierarki L2/L3 |
| `source_picking_id` / `source_order_id` | int | | jejak asal untuk audit backfill |

**ServiceCatalogItem (Master)**:

| Atribut | Tipe | Wajib | Catatan |
|---|---|---|---|
| `part_product_id` | m2o product | (w) | SKU part |
| `applies_to_category_ids` | m2m kategori | (w) | kompatibilitas level keluarga mesin (murah) |
| `applies_to_product_ids` | m2m product | | kompatibilitas level model (presisi, mahal) |
| `interval_months` | int | (w)* | *minimal salah satu dari bulan/jam harus terisi |
| `interval_hours` | int | (w)* | |
| `is_wear_part` | bool | (w) | membedakan consumable dari spare cadangan |
| `superseded_by_id` | m2o product | | jalur "upgrade" benefit #2 |
| `supersession_note` | text | | alasan upgrade — dipakai sales sebagai talking point |

---

## 6. Pemetaan fisik ke Odoo

### 6.1 Model yang dipakai

| Konsep | Model Odoo | Status |
|---|---|---|
| EquipmentUnit / Component / Part | `maintenance.equipment` (hierarki lewat `x_parent_equipment_id`) | App Maintenance — **sudah dipakai** repo lewat `maintenance.request` |
| Kategori/keluarga mesin | `maintenance.equipment.category` | bawaan |
| Katalog servis + supersession | field `x_*` pada `product.template` | butuh Studio (A-4) |
| Riwayat servis per unit | `maintenance.request` (`equipment_id`) | **sudah terbaca** oleh `OdooMaintenanceService` |
| Sumber backfill | `stock.move.line`, `stock.lot`, `stock.picking`, `sale.order.line` | bawaan |

### 6.2 Jebakan yang wajib diketahui: `partner_id` pada `maintenance.equipment` adalah VENDOR

Pada Odoo standar, `maintenance.equipment.partner_id` berlabel **"Vendor"** — pemasok tempat alat
itu dibeli, berpasangan dengan `partner_ref` ("Vendor Reference"). Ia **bukan** pelanggan pemilik
alat.

Memakainya sebagai "pemilik" akan: (a) salah secara semantik, (b) bertabrakan dengan otomasi Odoo
mana pun yang membacanya sebagai vendor, dan (c) menghasilkan kebocoran data yang sulit dilacak
karena query-nya tampak benar.

**Karena itu**: pemilik disimpan di field Studio tersendiri, mengikuti preseden yang sudah dipakai
repo ini untuk `maintenance.request` (`CUSTOMER_FIELD = 'x_studio_customer'`, lihat
`OdooMaintenanceService.js`). Gunakan nama yang konsisten dengannya.

> Konfirmasi label field ini lewat `fields_get` di Fase 0 (IB-5) sebelum menulis kode apa pun.

### 6.3 Field Studio pada `maintenance.equipment`

| Field | Tipe | Tujuan |
|---|---|---|
| `x_studio_customer` | m2o `res.partner` | Pemilik unit. Nama menyusul konvensi `maintenance.request` |
| `x_parent_equipment_id` | m2o `maintenance.equipment` | Hierarki L1→L2→L3 |
| `x_product_id` | m2o `product.product` | Tautan ke katalog — kunci join ke master data |
| `x_lot_id` | m2o `stock.lot` | Tautan ke serial di inventori; kunci idempotensi backfill |
| `x_install_date` | date | Titik nol interval |
| `x_status` | selection | `active` / `idle` / `decommissioned` |
| `x_runtime_hours` | float | Jam operasi terakhir dilaporkan |
| `x_source_picking_id` | integer | Jejak `stock.picking` asal (audit backfill) |
| `x_source_order_id` | integer | Jejak `sale.order` asal |

Field bawaan yang dipakai apa adanya: `name`, `serial_no`, `model`, `location`, `category_id`,
`company_id`, `effective_date`, `warranty_date`, `note`, `maintenance_ids`.

> `x_install_date` sengaja tidak menumpang `effective_date` bawaan karena semantik `effective_date`
> di Odoo adalah tanggal alat mulai dipakai **oleh perusahaan sendiri** (konteks aset internal),
> bukan tanggal commissioning di site pelanggan. Menumpang field yang maknanya beda adalah sumber
> bug yang tidak kelihatan di kode.

### 6.4 Field Studio pada `product.template`

| Field | Tipe | Tujuan |
|---|---|---|
| `x_is_machine` | bool | Menandai produk sebagai mesin → dipakai selektor backfill (§8) |
| `x_is_serviceable_part` | bool | Menandai SKU sebagai part yang bisa diservis (penegakan D-3) |
| `x_service_interval_months` | int | Interval penggantian, bulan |
| `x_service_interval_hours` | int | Interval penggantian, jam operasi |
| `x_is_wear_part` | bool | Consumable vs spare cadangan |
| `x_compatible_category_ids` | m2m `maintenance.equipment.category` | Kompatibilitas level keluarga |
| `x_compatible_product_ids` | m2m `product.template` | Kompatibilitas level model (opsional, presisi) |
| `x_superseded_by_id` | m2o `product.template` | Jalur upgrade |
| `x_supersession_note` | text | Alasan upgrade, jadi talking point sales |

### 6.5 Base domain (pola wajib)

Mengikuti persis pola `OdooMaintenanceService.baseDomain`, ditambah ekspansi keluarga D-4:

```js
// src/integrations/odoo/OdooEquipmentService.js
const CUSTOMER_FIELD = 'x_studio_customer';

// partnerIds = himpunan keluarga dari OdooPartnerService.findFamilyIds (D-4): mesin berdiri di
// alamat pengiriman, yang di Odoo adalah partner ANAK dari entitas komersial, sementara user
// portal ter-map ke induknya. Pencocokan partner persis akan mengembalikan daftar kosong.
function baseDomain(partnerIds, companyId) {
  return [
    [CUSTOMER_FIELD, 'in', partnerIds],
    ['company_id', '=', companyId],
  ];
}
```

`LIST_FIELDS` disusun **hanya dari field yang lolos capability probe** (IB-5).

---

## 7. Yang tetap tinggal di portal DB

Hanya satu tabel, dan ia bukan salinan registry: antrean **permintaan koreksi data** dari
pelanggan. Ini sekaligus mekanisme utama menjaga kesegaran data (§8) — pelanggan adalah pihak yang
paling tahu mesinnya pindah atau berhenti beroperasi.

Polanya identik dengan `rma_requests` / `warranty_claims` (migrasi `0005`): baris lokal + mirror ke
`helpdesk.ticket`, status dibaca live dari tiket, **tanpa kolom status lokal**.

```sql
-- database/migrations/0011_equipment_corrections.sql
--
-- Customer Population (installed base) sepenuhnya hidup di Odoo -- lihat CR
-- customer_population_installed_base.md D-2. Tabel ini SENGAJA bukan salinan registry: ia hanya
-- antrean permintaan koreksi dari pelanggan, karena pelanggan tidak boleh menulis langsung ke
-- master data aset. Sama seperti rma_requests, workflow-nya hidup di helpdesk.ticket yang tertaut,
-- dan status TIDAK pernah dicache di sini supaya tidak bisa basi terhadap apa yang staf kerjakan.
--
-- Scoping mengikuti aturan repo: portal_user_id DAN odoo_connection_id, karena satu user bisa
-- punya mapping ke lebih dari satu Odoo.

CREATE TABLE equipment_corrections (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  portal_user_id     UUID NOT NULL REFERENCES portal_users(id) ON DELETE CASCADE,
  odoo_connection_id UUID NOT NULL REFERENCES odoo_connections(id),
  odoo_equipment_id  INTEGER NOT NULL,       -- maintenance.equipment yang dikoreksi
  odoo_ticket_id     INTEGER NOT NULL,       -- workflow-nya hidup di sini
  correction_type    VARCHAR(30) NOT NULL
    CHECK (correction_type IN ('location', 'status', 'runtime_hours', 'ownership', 'other')),
  proposed_value     TEXT NOT NULL,          -- nilai usulan, apa adanya; staf yang menerjemahkan
  note               TEXT,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX ix_equipment_corrections_user
  ON equipment_corrections (portal_user_id, created_at DESC);
```

Tidak ada tabel lain. Kalau muncul kebutuhan menambah tabel `equipment_units` di portal DB,
itu tanda IB-3 sedang dilanggar — kembali ke D-2.

---

## 8. Strategi akuisisi & kesegaran data

**Ini bagian yang menentukan proyek berhasil atau tidak.** Skema data tidak pernah jadi penyebab
kegagalan proyek installed base; yang menggagalkannya selalu (a) siapa mengisi data awal, dan
(b) siapa menjaganya tetap segar.

### 8.1 Backfill otomatis L1 dari transaksi historis

Sepuluh tahun transaksi yang sudah ada bisa diubah menjadi registry tanpa entri manual sama sekali.
Ini deliverable engineering dengan rasio nilai-per-usaha tertinggi di seluruh dokumen ini.

```js
// scripts/backfill-installed-base.js  --dry-run | --commit  [--since=YYYY-MM-DD]
//
// 1. Produk yang ditandai mesin
const machines = await session.searchRead('product.product',
  [['product_tmpl_id.x_is_machine', '=', true]], ['id', 'name']);

// 2. Setiap unit bernomor seri yang PERNAH KELUAR ke pelanggan.
//    picking_type_id.code = 'outgoing' + state = 'done' mengikuti pola OdooDeliveryService.
//    CATATAN VERSI: Odoo 17+ memakai `quantity`; <=16 memakai `qty_done` (A-3).
const lines = await session.searchRead('stock.move.line', [
  ['state', '=', 'done'],
  ['picking_id.picking_type_id.code', '=', 'outgoing'],
  ['product_id', 'in', machines.map((m) => m.id)],
  ['lot_id', '!=', false],
], ['product_id', 'lot_id', 'picking_id', 'date', 'quantity']);

// 3. picking -> partner + company + origin(sale.order), satu panggilan batch, bukan per baris.
// 4. Idempoten pada x_lot_id: sudah ada -> lewati; belum -> create maintenance.equipment dengan
//    serial_no = lot.name, x_install_date = tanggal picking selesai, x_studio_customer = partner.
```

Sifat yang wajib dimiliki skrip ini:

- **Idempoten** pada `x_lot_id` — boleh dijalankan berulang tanpa menduplikasi unit.
- **`--dry-run` sebagai default**, menghasilkan laporan hitungan + sampel + daftar anomali.
- **Keluar dengan exit code non-zero saat gagal**, mengikuti konvensi `scripts/*.js` repo ini
  (belum ada test runner).
- **Melaporkan yang tidak bisa dipetakan**, bukan mendiamkannya: pengiriman tanpa lot, lot yang
  dikembalikan lalu dijual ulang, unit yang partner-nya sudah di-*archive*.

### 8.2 Ongoing — unit baru

| Opsi | Cara | Syarat | Rekomendasi |
|---|---|---|---|
| Otomasi Odoo | Automated Action pada `stock.picking` saat `state = done` → buat equipment | Studio/Automation | **Pilihan utama** — real-time, tanpa infrastruktur baru |
| Inkremental terjadwal | `backfill-installed-base.js --since=<terakhir>` via cron | Tidak ada | Cadangan bila otomasi tidak tersedia |

### 8.3 Master data servis — yang tidak bisa diotomasi

Interval penggantian dan kompatibilitas **tidak ada di sistem mana pun** dan tidak bisa diturunkan.
Sumbernya adalah manual servis dan pengetahuan product engineer.

Strategi yang realistis, bukan "isi semua produk dulu":

1. **Mulai dari 20 model mesin dengan populasi terbesar.** Hasil backfill Fase 1 langsung
   memberi urutan prioritasnya — ini alasan lain kenapa Fase 1 harus lebih dulu.
2. **Isi interval hanya untuk wear part.** Spare cadangan tidak punya interval dan tidak boleh
   dipaksa punya.
3. **Satu PIC bernama + review kuartalan** (Q-5). Tanpa ini, mesin rekomendasi akan menyarankan
   penggantian yang salah, dan itu lebih merusak kepercayaan daripada tidak menyarankan apa pun.
4. **Import lewat spreadsheet**, bukan form satu per satu: template CSV → Odoo import. Cantumkan
   di runbook (§20).

### 8.4 Kesegaran data

| Sinyal | Sumber | Aksi |
|---|---|---|
| Unit pindah lokasi / berhenti beroperasi | Permintaan koreksi pelanggan (§7) | Staf memperbarui Odoo |
| Part diganti | `maintenance.request` selesai; laporan servis | Fase 3–4: perbarui L3 + reset penghitung interval |
| Jam operasi | Dilaporkan pelanggan lewat portal | Menyegarkan interval berbasis jam |
| Unit dijual/dipindahtangankan | Manual oleh staf | Ubah `x_studio_customer` |

**Metrik pembusukan yang harus dipantau** (§19): persentase unit yang tidak tersentuh perubahan
apa pun selama > 24 bulan. Kalau angka ini naik melewati 40%, rekomendasi upsell harus dimatikan
untuk segmen tersebut — bukan dibiarkan jalan dengan data yang tidak lagi dipercaya.

---

## 9. Mesin rekomendasi upsell (deterministik)

Ini kapabilitas yang memenuhi benefit #2 dan #4. **Bukan machine learning** — aturan eksplisit yang
bisa dijelaskan sales ke pelanggan, sejalan dengan cara `productService.getReorderSuggestions`
sengaja dibatasi ("not a similarity/collaborative-filtering engine").

### 9.1 Algoritma

Untuk setiap unit `E` milik pelanggan `P`, dengan model `M` dan kategori `C`:

```
1. Lewati bila E.status != 'active'                      -- unit mati tidak menghasilkan lead
2. parts = katalog servis di mana M ∈ x_compatible_product_ids
                              ATAU C ∈ x_compatible_category_ids
3. Untuk setiap part p di parts:
     last_buy   = tanggal terakhir P membeli p        (dari sale.order.line, state in sale/done)
     basis      = last_buy ?? E.install_date
     due_date   = basis + p.x_service_interval_months
     status     = overdue   bila due_date < hari_ini
                  due_soon  bila due_date < hari_ini + 60 hari
                  ok        selain itu
     attribution = 'unit' bila jumlah unit P dengan model M == 1
                   'fleet_estimated' selain itu                       -- D-5
4. upgrade = p.x_superseded_by_id bila ada                            -- benefit #2 "upgrade"
5. Urutkan: overdue lebih dulu, lalu jarak dari due_date, lalu nilai part
```

### 9.2 Bentuk keluaran (kontrak yang menegakkan IB-4)

```json
{
  "equipment_id": 412,
  "equipment_name": "Compressor GA-75 #3",
  "part": { "product_id": 1180, "name": "Air Filter Element AF-75" },
  "status": "overdue",
  "due_date": "2026-05-14",
  "days_overdue": 108,
  "basis": "last_purchase",
  "basis_date": "2025-05-14",
  "attribution": "fleet_estimated",
  "attribution_note": "Pelanggan memiliki 4 unit model ini; pembelian tidak dapat ditautkan ke unit tertentu.",
  "upgrade": {
    "product_id": 1450,
    "name": "Air Filter Element AF-75HD",
    "note": "Media HD, interval 12 bulan (dari 6 bulan)."
  }
}
```

`basis`, `attribution`, dan `attribution_note` **wajib** ada di setiap baris (IB-4). UI dan asisten
harus menampilkannya, bukan menyembunyikannya karena "membuat tampilan ramai".

### 9.3 Kasus tepi yang harus ditangani secara eksplisit

| Kasus | Perilaku yang benar |
|---|---|
| Part belum pernah dibeli sama sekali | `basis = install_date`. Kalau `install_date` juga kosong → **jangan tampilkan barisnya** (bukan "overdue") |
| Interval kosong di master data | Lewati diam-diam, tapi hitung ke metrik cakupan katalog (§19) |
| Pelanggan punya banyak unit model sama | `fleet_estimated` (D-5). Jangan bagi rata, jangan tebak unitnya |
| Part sudah *superseded* | Rekomendasikan penggantinya, sebutkan part lama sebagai konteks |
| Unit di luar garansi & tidak pernah diservis | Sinyal bernilai tinggi — beri tanda khusus untuk kontrak servis |
| Interval berbasis jam tapi `runtime_hours` kosong | Jatuh balik ke interval bulan; kalau dua-duanya kosong, lewati |
| Part di katalog yang merupakan **target supersession** dan belum pernah dibeli pelanggan | Jangan hasilkan barisnya. Part pengganti yang belum pernah dibeli berarti belum terpasang — memunculkannya membuat part lama dan penggantinya dua-duanya tampak jatuh tempo. Ditemukan saat menyusun data contoh |

---

## 10. Kontrak API

Semua di bawah `authenticate` + `requirePermission`. Tidak satu pun menerima id partner (IB-1).

| Method | Path | Permission | Mengembalikan | Fase |
|---|---|---|---|---|
| GET | `/equipment` | `equipment.view` | Daftar unit L1 milik keluarga partner | 1 |
| GET | `/equipment/:id` | `equipment.view` | Detail unit + pohon komponen (L2/L3) | 1 / 3 |
| GET | `/equipment/:id/service-history` | `equipment.view` | `maintenance.request` + tiket + klaim garansi yang tertaut unit | 3 |
| GET | `/equipment/:id/parts` | `equipment.view` | Part kompatibel + status jatuh tempo untuk unit ini | 2 |
| GET | `/equipment/due-replacements` | `equipment.view` | Daftar jatuh tempo lintas armada, terurut | 2 |
| POST | `/equipment/:id/corrections` | `equipment.correct` | Membuat permintaan koreksi + tiket (§7) | 4 |
| GET | `/equipment/corrections` | `equipment.correct` | Permintaan koreksi milik user + status dari tiket | 4 |

Contoh respons `GET /equipment`:

```json
{
  "data": [
    {
      "id": 412,
      "name": "Compressor GA-75 #3",
      "serial_number": "GA75-2019-0447",
      "model": { "product_id": 88, "name": "Atlas GA-75" },
      "category": { "id": 5, "name": "Air Compressor" },
      "install_date": "2019-11-02",
      "warranty_end": "2021-11-02",
      "location": "Plant B - Utility Room",
      "status": "active",
      "runtime_hours": 21400,
      "open_requests": 1
    }
  ]
}
```

Error mengikuti `errorHandler` yang sudah ada: `{ error: { code, message } }`. Unit milik pelanggan
lain → `404 not_found` (IB-2), tidak pernah `403` — supaya keberadaan sebuah unit tidak bisa
diprobing.

`api/openapi.yaml` **wajib** diperbarui untuk setiap endpoint di atas (konvensi repo).

---

## 11. File manifest backend

Mengikuti layering `routes → controllers → services → integrations`. Tidak ada lapisan yang
dilompati.

| File | Baru/Ubah | Isi |
|---|---|---|
| `src/integrations/odoo/OdooEquipmentService.js` | **Baru** | `baseDomain` terkunci keluarga+company, `listUnits`, `getUnit` (`ensureOwned`), `listChildren`, `listServiceCatalog` |
| `src/services/equipmentService.js` | **Baru** | `(userId, currentCompanyId, …)`; resolve konteks + ekspansi keluarga; komposisi mesin rekomendasi (§9) |
| `src/controllers/equipmentController.js` | **Baru** | `asyncHandler`, parse via Zod, `auditService.record` untuk aksi tulis |
| `src/validators/equipmentValidators.js` | **Baru** | Skema Zod: `correctionSchema`, query filter daftar |
| `src/routes/equipment.routes.js` | **Baru** | `authenticate` + `requirePermission('equipment.view' \| 'equipment.correct')` |
| `src/routes/index.js` | Ubah | Daftarkan `/equipment` |
| `src/repositories/equipmentCorrectionRepository.js` | **Baru** | `pool.query` berparameter, scope `portal_user_id` + `odoo_connection_id` |
| `src/integrations/odoo/OdooPartnerService.js` | — | Dipakai apa adanya (`findFamilyIds`, D-4) |
| `src/services/assistant/tools/equipment.js` | **Baru** | Tool asisten (§13) |
| `src/services/assistant/toolRegistry.js` | Ubah | Daftarkan `equipmentTools` |
| `database/migrations/0011_equipment_corrections.sql` | **Baru** | §7 |
| `database/seeds/0017_equipment_permissions.sql` | **Baru** | §14 |
| `scripts/check-equipment-capability.js` | **Baru** | Probe `fields_get` (IB-5) |
| `scripts/backfill-installed-base.js` | **Baru** | §8.1 |
| `api/openapi.yaml` | Ubah | §10 |

Yang **tidak** boleh terjadi: `equipmentService` me-`require` `OdooClient` langsung, controller
memanggil repository langsung, atau kode asisten me-`require` `integrations/odoo/*`.

---

## 12. Permukaan frontend

| File | Baru/Ubah | Isi |
|---|---|---|
| `frontend/src/api/equipment.js` | **Baru** | Modul tipis di atas `apiFetch` dari `client.js` |
| `frontend/src/pages/EquipmentPage.jsx` | **Baru** | Daftar unit + filter status/lokasi + panel detail |
| `frontend/src/components/EquipmentDetailPanel.jsx` | **Baru** | Mengikuti pola `OrderDetailPanel.jsx` / `TicketDetailPanel.jsx` yang sudah ada |
| `frontend/src/pages/DueReplacementsPage.jsx` | **Baru** (Fase 2) | Daftar jatuh tempo + tombol "Minta penawaran" → `/requests` |
| `frontend/src/App.jsx` | Ubah | Rute `/equipment`, `/equipment/due` |
| `frontend/src/components/AppShell.jsx` | Ubah | Item nav |

**Penempatan navigasi**: masuk ke grup **After Sales** yang sudah ada (bersama Warranty, Complaint,
Schedule Maintenance) sebagai "My Equipment", bukan grup baru. Alasannya: pelanggan mencarinya
justru saat butuh servis atau part, dan `AppShell` sudah punya grup itu.

**Styling**: pakai token CSS yang ada (`--color-primary`, `--radius-*`, `--shadow-*`, `--s-*`).
Status jatuh tempo memakai token semantik yang sudah dipakai untuk badge status, bukan warna
hardcoded — supaya dark mode dan tema brand ikut benar.

**Catatan i18n**: frontend belum punya i18n (batasan diketahui di CLAUDE.md). String baru ditulis
English hardcoded seperti halaman lain, konsisten — jangan memperkenalkan i18next diam-diam untuk
satu fitur.

---

## 13. Integrasi Asisten Portal

Empat tool baca baru di `src/services/assistant/tools/equipment.js`. Semuanya tunduk pada invarian
asisten yang sudah ada (I-1 … I-4 di CLAUDE.md) — tidak ada argumen identitas, hanya memanggil
`equipmentService`, dan wajib punya `summarize`.

| Tool | Args | Permission | Card | Kegunaan |
|---|---|---|---|---|
| `list_my_equipment` | `{}` | `equipment.view` | `EquipmentList` | "Mesin apa saja yang saya miliki" |
| `get_equipment_detail` | `{ equipmentId }` | `equipment.view` | `EquipmentDetail` | Detail satu unit + komponen |
| `get_due_replacements` | `{}` | `equipment.view` | `DueReplacements` | "Part apa yang sudah waktunya diganti" |
| `get_equipment_service_history` | `{ equipmentId }` | `equipment.view` | `ServiceHistory` | "Kapan terakhir mesin ini diservis" |

Contoh yang menegakkan IB-4 dan pola `summarize` yang sudah ada:

```js
{
  name: 'get_due_replacements',
  kind: 'read',
  permission: 'equipment.view',
  description:
    'Sparepart yang sudah atau hampir jatuh tempo diganti pada mesin milik pelanggan ini, ' +
    'beserta dasar perhitungannya. Pakai untuk "apa yang perlu saya ganti" atau "kapan servis ' +
    'berikutnya". Jangan dipakai untuk menyebut harga.',
  args: z.object({}).strict(),
  handler: (ctx) => equipmentService.getDueReplacements(ctx.userId, ctx.companyId),
  card: 'DueReplacements',
  // IB-4: ringkasan WAJIB membawa dasar dan atribusi. Tanpa itu model akan menyajikan estimasi
  // level armada sebagai fakta per unit -- persis kesalahan yang D-5 hindari.
  summarize: (rows) => {
    if (rows.length === 0) return 'Tidak ada sparepart yang jatuh tempo.';
    const overdue = rows.filter((r) => r.status === 'overdue');
    const estimated = rows.filter((r) => r.attribution === 'fleet_estimated').length;
    return (
      `${rows.length} sparepart perlu perhatian (${overdue.length} lewat jadwal). ` +
      sampled(rows, (r) => `${r.part.name} pada ${r.equipment_name} (${r.status}, jatuh tempo ${r.due_date})`) +
      (estimated > 0
        ? `. ${estimated} di antaranya estimasi level armada, bukan per unit -- sampaikan sebagai perkiraan.`
        : '')
    );
  },
}
```

**Jebakan urutan `redact` → `summarize`** (sudah tercatat di CLAUDE.md): `redact.js` membuang
`partner_id`, `commercial_partner_id`, dan `company_id` **sebelum** `summarize` berjalan. Jangan
menulis `summarize` yang membaca field itu — ia akan menerima `undefined` tanpa error, jadi
kegagalannya diam.

**Aksi tulis**: permintaan koreksi lewat asisten (Fase 4) adalah aksi tulis dan **wajib** melewati
alur draf→konfirmasi tombol. Baca skill [`asisten-aksi-tulis`](../../.claude/skills/asisten-aksi-tulis/SKILL.md)
sebelum menyentuhnya. Persetujuan verbal tidak cukup.

---

## 14. Permission & seed

Dua kode baru. Ikuti pola seed yang sudah ada (`INSERT INTO portal_permissions`, lalu join ke
`portal_role_permissions` berdasarkan nama role).

```sql
-- database/seeds/0017_equipment_permissions.sql
--
-- equipment.view diberikan ke keempat role pelanggan: registry installed base adalah data
-- referensi yang membantu semua orang di sisi pelanggan (Procurement memesan part yang benar,
-- Finance memverifikasi klaim garansi, Viewer memeriksa aset).
--
-- equipment.correct sengaja HANYA Customer Admin, dengan alasan yang sama seperti rma.create dan
-- warranty.create: ia mengubah catatan aset yang berkonsekuensi komersial (klaim garansi,
-- lingkup kontrak servis). Role lain mengajukannya lewat tiket biasa dan staf yang mengonversi.

INSERT INTO portal_permissions (code, description) VALUES
  ('equipment.view',    'Melihat installed base (mesin & sparepart terpasang) milik perusahaannya'),
  ('equipment.correct', 'Mengajukan koreksi data installed base');

INSERT INTO portal_role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM portal_roles r, portal_permissions p
WHERE p.code = 'equipment.view'
  AND r.name IN ('Customer Admin', 'Finance', 'Procurement', 'Viewer');

INSERT INTO portal_role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM portal_roles r, portal_permissions p
WHERE p.code = 'equipment.correct'
  AND r.name = 'Customer Admin';
```

Jangan mengarang kode permission lain tanpa menambahkan seed-nya (aturan #3 CLAUDE.md).

---

## 15. NFR: budget panggilan Odoo, degradasi, error

### 15.1 Budget panggilan XML-RPC

Setiap panggilan Odoo adalah satu round-trip XML-RPC. Loop per unit adalah jebakan performa paling
mudah terjadi pada fitur ini — pelanggan dengan 200 unit akan menghasilkan 200+ panggilan kalau
pohon komponen diambil per unit.

| Endpoint | Budget | Cara |
|---|---|---|
| `GET /equipment` | **3** | keluarga partner (1) + equipment (1) + kategori (1) |
| `GET /equipment/:id` | **3** | unit (1) + anak via `parent in [id]` (1) + maintenance request (1) |
| `GET /equipment/due-replacements` | **5** | keluarga (1) + unit (1) + katalog servis (1) + riwayat beli (1) + supersession (1) |

**Aturan**: agregasi dan penyusunan pohon dilakukan **di JavaScript** setelah pengambilan batch,
bukan lewat panggilan berulang. Ini pola yang sudah dipakai `productService.getReorderSuggestions`.

Ambil anak dengan satu domain `['x_parent_equipment_id', 'in', semuaIdInduk]`, lalu susun pohonnya
di memori.

### 15.2 Rate limiting

Belum ada rate limiting umum (batasan diketahui, `system.md §17`). `GET /equipment/due-replacements`
adalah endpoint termahal fitur ini dan **wajib membawa pembatasnya sendiri** — ikuti pola
`src/services/assistant/rateLimiter.js`. Catat juga bahwa pembatas in-memory tidak akurat bila
backend diskalakan multi-instance.

### 15.3 Degradasi

| Kondisi | Perilaku |
|---|---|
| App Maintenance tidak terpasang (A-1 salah) | `/equipment` mengembalikan `503 feature_unavailable` dengan pesan jelas; item nav disembunyikan |
| Field Studio belum dibuat | Capability probe gagal saat boot → fitur mati bersih, tidak crash separuh jalan |
| Katalog servis kosong | `/equipment` tetap jalan; `/due-replacements` mengembalikan daftar kosong + `catalog_coverage: 0` — **bukan** error |
| `install_date` kosong pada unit | Unit tetap tampil; barisnya tidak menghasilkan rekomendasi (§9.3) |

Prinsipnya sama dengan yang sudah dipakai `OdooDeliveryService.getCarrierTrackingRef`: kapabilitas
yang hilang berarti kehilangan satu informasi, tidak pernah berarti listing yang rusak.

---

## 16. Verifikasi

Tiga skrip, mengikuti konvensi repo (`node scripts/*.js`, exit code non-zero saat gagal — belum ada
test runner).

**1. Capability probe (IB-5) — jalankan sebelum menulis kode apa pun:**

```bash
node scripts/check-equipment-capability.js
```

Memanggil `fields_get` pada `maintenance.equipment`, `maintenance.equipment.category`,
`product.template`, dan `stock.move.line`; membandingkan dengan daftar field yang dibutuhkan §6;
mencetak yang hilang lalu keluar non-zero. Juga memverifikasi label `partner_id` (§6.2) supaya
jebakan vendor/pelanggan ketahuan otomatis, dan mendeteksi `quantity` vs `qty_done` (A-3).

**2. Backfill dry-run:**

```bash
node scripts/backfill-installed-base.js --dry-run
```

**3. Invarian asisten — sudah ada, otomatis mencakup tool baru §13:**

```bash
node scripts/check-assistant-invariants.js
```

**Tambahan yang perlu masuk ke skrip invarian**: penegakan D-3 — setiap `maintenance.equipment`
level anak wajib punya `x_product_id`; kalau tidak, ia komponen tanpa SKU dan melanggar batas
kedalaman.

---

## 17. Roadmap fase & acceptance criteria

Satu fase = satu branch = satu PR. Jangan menggabung fase.

### Fase 0 — Kelayakan & audit data (blocking)

Tanpa fase ini, seluruh sisa dokumen ini adalah asumsi.

- Jalankan capability probe; konfirmasi A-1, A-2, A-3, A-4.
- Jawab Q-1, Q-2, Q-3.
- Jalankan audit data: berapa persen mesin terjual punya serial/lot? Berapa model mesin unik?
  Berapa pelanggan punya > 1 unit model sama (memperkirakan dampak D-5)?

**Acceptance**: laporan kelayakan tertulis + keputusan lanjut/tidak.
**Gate**: bila cakupan serial < 60%, jangan lanjut ke Fase 1 sebelum menyepakati strategi entri
manual — registry dengan cakupan rendah menghasilkan rekomendasi yang salah dan merusak
kepercayaan lebih cepat daripada tidak punya fitur sama sekali.

### Fase 1 — Registry L1 + backfill + "My Equipment"

Field Studio §6.3, `OdooEquipmentService`, `equipmentService`, route + controller + validator,
`EquipmentPage`, seed permission, backfill.

**Acceptance**:
- Pelanggan dengan unit di partner anak melihat unitnya (D-4 terbukti — inilah bug UAT yang paling
  mungkin terjadi kalau D-4 diabaikan).
- Unit milik pelanggan lain → `404`, diverifikasi manual dengan dua akun.
- `GET /equipment` ≤ 3 panggilan Odoo, diukur, bukan diperkirakan.
- Backfill idempoten: jalankan dua kali, jumlah unit tidak berubah.
- `api/openapi.yaml` diperbarui.

### Fase 2 — Master data servis + mesin rekomendasi + tool asisten

Field Studio §6.4, isi katalog untuk 20 model teratas, `/equipment/:id/parts`,
`/equipment/due-replacements`, `DueReplacementsPage`, empat tool asisten.

**Acceptance**:
- Setiap baris rekomendasi membawa `basis` + `attribution` (IB-4), diverifikasi di UI **dan** di
  ringkasan asisten.
- Pelanggan dengan banyak unit identik mendapat `fleet_estimated`, tidak pernah atribusi unit.
- Katalog kosong → daftar kosong, bukan error.
- `node scripts/check-assistant-invariants.js` lulus.

### Fase 3 — Konfigurasi L2/L3 + riwayat servis per unit

Hierarki komponen, `/equipment/:id/service-history` yang menyatukan maintenance request + tiket +
klaim garansi per unit.

**Acceptance**: pohon komponen ≤ 3 panggilan Odoo untuk unit dengan 50 komponen; setiap komponen
punya `x_product_id` (D-3).

### Fase 4 — Permintaan koreksi + notifikasi proaktif

Migrasi `0011`, `POST /equipment/:id/corrections`, notifikasi jatuh tempo lewat
`notificationService` yang sudah ada, tool asisten `draft_equipment_correction` (**wajib** ikut
alur draf→konfirmasi).

### Fase 5 (kondisional) — Staff console

Hanya bila Q-1 dijawab "sales di portal". Lihat biaya di D-1. Wajib review keamanan tersendiri.

---

## 18. Risiko & mitigasi

| ID | Risiko | Dampak | Prob. | Mitigasi |
|---|---|---|---|---|
| **R-1** | Master data servis tidak pernah terisi | Benefit #2 & #4 gagal total; registry jadi pajangan | **Tinggi** | PIC bernama + review kuartalan (Q-5); mulai dari 20 model teratas; jadikan cakupan katalog KPI yang dilaporkan (§19) |
| **R-2** | Cakupan serial rendah pada data historis | Registry tidak lengkap; rekomendasi meleset | Sedang | Gate Fase 0; entri manual untuk pelanggan bernilai tinggi; tampilkan cakupan secara terbuka, jangan disembunyikan |
| **R-3** | Atribusi salah pada pelanggan multi-unit | Sales menyebut fakta yang keliru ke pelanggan | **Tinggi** | D-5 + IB-4 — labeli sebagai estimasi, jangan tebak |
| **R-4** | Field Studio berubah/terhapus oleh admin Odoo | Fitur mati mendadak | Sedang | Capability probe (§16) dijalankan di CI/boot; degradasi bersih (§15.3) |
| **R-5** | Addon Python tidak bisa di-deploy (Q-3) | Model kustom mustahil | Sedang | Rancangan ini sudah memakai Studio saja sebagai default |
| **R-6** | Odoo External API butuh plan Custom | Seluruh integrasi mati | Rendah | Sudah tercatat sebagai batasan; konfirmasi ulang di Fase 0 |
| **R-7** | Data installed base bocor lintas pelanggan | Pelanggaran kerahasiaan komersial serius | Rendah | IB-1, IB-2, `404` bukan `403`; D-4 diaudit khusus karena ia melebarkan cakupan |
| **R-8** | `/due-replacements` menghabiskan kuota Odoo | Portal melambat menyeluruh | Sedang | Budget panggilan §15.1 + pembatas khusus §15.2 |
| **R-9** | Sales menganggap data lengkap padahal tidak | Kehilangan kepercayaan pelanggan saat data terbukti salah | **Tinggi** | Tampilkan indikator cakupan & tanggal pembaruan terakhir di setiap layar; jangan pernah menyembunyikan ketidakpastian |
| **R-10** | Cakupan melebar ke mesin kompetitor (Q-2) | Estimasi meleset jauh; butuh proses survei | Sedang | Putuskan di Fase 0, bukan di tengah jalan |

R-1, R-3, dan R-9 adalah risiko yang benar-benar menentukan. Ketiganya bukan risiko teknis
melainkan risiko **kepercayaan** — dan ketiganya dimitigasi dengan keterbukaan tentang batas
pengetahuan sistem, bukan dengan kode yang lebih pintar.

---

## 19. KPI bisnis & metrik kualitas data

### KPI bisnis (membuktikan keempat benefit)

| Benefit | Metrik | Baseline | Target 6 bulan |
|---|---|---|---|
| #1 upselling | Attach rate part per mesin per tahun | ukur di Fase 0 | +20% |
| #2 upgrade part | Pendapatan dari lead `due-replacement` | 0 | terlacak & tumbuh |
| #3 profesionalisme | Waktu persiapan sales sebelum kunjungan | survei | −50% |
| #4 informasi kebutuhan | Konversi rekomendasi → penawaran | 0 | ≥ 10% |

### Metrik kualitas data (dilaporkan bulanan; ini yang memberi peringatan dini)

| Metrik | Formula | Ambang batas |
|---|---|---|
| Cakupan registry | unit di registry ÷ perkiraan unit terjual | ≥ 80% |
| Cakupan serial | unit dengan `serial_number` ÷ total unit | ≥ 90% |
| Cakupan tanggal pasang | unit dengan `install_date` ÷ total unit | ≥ 85% |
| Cakupan katalog servis | model mesin dengan ≥ 1 part berinterval ÷ total model | ≥ 70% |
| Rasio estimasi armada | baris `fleet_estimated` ÷ total baris rekomendasi | dilaporkan, bukan ditarget |
| Pembusukan data | unit tanpa perubahan apa pun > 24 bulan | < 40% |

Ambang batas ini bukan hiasan: **bila cakupan katalog servis < 30%, matikan tampilan rekomendasi**.
Rekomendasi yang jarang muncul dan sering salah lebih merusak daripada tidak ada rekomendasi.

---

## 20. Rekomendasi paket dokumentasi sistem

Sebelas dokumen. Kolom "Gate" menandai dokumen yang harus selesai sebelum fase berikutnya dimulai.

| # | Dokumen | Lokasi | Audiens | Kapan | Gate |
|---|---|---|---|---|---|
| 1 | **CR / Implementation Spec** (dokumen ini) | `Docs/CR/customer_population_installed_base.md` | Client, dev, Claude Code | Sekarang | Sebelum Fase 0 |
| 2 | **Laporan Kelayakan & Audit Data** | `Docs/CR/installed_base_feasibility_report.md` | Client, PM | Fase 0 | **Ya** — sebelum Fase 1 |
| 3 | **Update `system.md`** | `system.md` §8, §9, §10, §16 | Dev | Tiap fase | Ya — konvensi repo |
| 4 | **Update `CLAUDE.md`** | `CLAUDE.md` | Claude Code, dev | Fase 1 | Ya |
| 5 | **Update OpenAPI** | `api/openapi.yaml` | Dev, integrator | Tiap fase | Ya — konvensi repo |
| 6 | **Data Dictionary** | `Docs/data/installed_base_dictionary.md` | BA, dev, data steward | Fase 1 | Ya |
| 7 | **Odoo Configuration Guide** | `Docs/ops/odoo_studio_installed_base.md` | Admin Odoo | Fase 1 | **Ya** — tanpa ini deployment tidak reproducible |
| 8 | **Backfill & Migration Runbook** | `Docs/ops/installed_base_backfill_runbook.md` | Ops, dev | Fase 1 | Ya |
| 9 | **Master Data Governance SOP** | `Docs/ops/service_catalog_governance.md` | Product Management | Fase 2 | **Ya** — dokumen penentu hidup-matinya fitur |
| 10 | **Sales Playbook** | `Docs/business/upsell_playbook.md` | Sales, Sales Manager | Fase 2 | Tidak, tapi tanpanya adopsi gagal |
| 11 | **UAT Test Plan** | `Docs/qa/installed_base_uat.md` | QA, client | Tiap fase | Ya |

Tambahan opsional yang selaras dengan repo ini: skill Claude Code
`.claude/skills/installed-base/SKILL.md`, meringkas IB-1…IB-5 + D-4 + jebakan §6.2 supaya sesi
mendatang tidak mengulang kesalahan yang sama — pola yang sudah dipakai
`.claude/skills/asisten-aksi-tulis/`.

### Tiga dokumen yang paling sering dilewatkan, dan akibatnya

**#7 Odoo Configuration Guide** — daftar field Studio harus ditulis sebagai instruksi langkah demi
langkah: nama field persis, tipe, model tujuan, string label, dan urutan pembuatannya (field relasi
butuh model tujuannya lebih dulu). Field Studio dibuat lewat klik di UI dan **tidak masuk version
control**. Tanpa dokumen ini, lingkungan staging tidak akan pernah bisa direplikasi, dan penyebab
kegagalan akan terlihat seperti bug aplikasi.

**#9 Master Data Governance SOP** — memuat: siapa pemilik interval servis (Q-5), kadensi review,
proses menambah model baru, dan aturan supersession. Ini dokumen yang paling menentukan apakah
fitur ini masih bernilai 18 bulan lagi. R-1 adalah risiko tertinggi di §18 dan **hanya SOP ini**
yang memitigasinya — bukan kode.

**#6 Data Dictionary** — memetakan istilah client ("customer population", "satuan terkecil") ke
field Odoo dan field API secara satu-satu. Tanpanya, setiap diskusi client mengulang penerjemahan
istilah dari awal, dan aturan D-3 pelan-pelan luntur sampai ada yang memasukkan baut ke registry.

---

## 21. Anti-pattern: jangan lakukan ini

| Jangan | Kenapa |
|---|---|
| Menyalin registry ke portal DB "supaya cepat" | Melanggar IB-3/D-2. Data basi = sales menyebut angka salah ke pelanggan |
| Memakai `maintenance.equipment.partner_id` sebagai pemilik | Itu **vendor** (§6.2). Salah semantik + berpotensi bocor |
| Memakai partner persis, bukan keluarga | Pelanggan melihat daftar kosong (D-4). Kegagalan UAT klasik |
| Menebak unit mana yang memakai part | Melanggar D-5. Sebut sebagai estimasi armada, atau jangan sebut sama sekali |
| Mengambil pohon komponen per unit di dalam loop | 200 unit = 200+ panggilan XML-RPC (§15.1) |
| Menambah field ke `LIST_FIELDS` tanpa probe | Satu field tidak valid mematikan **seluruh** listing (IB-5) |
| Membuat tool asisten tanpa `summarize` | Pos biaya token terbesar sekaligus sumber halusinasi |
| Membaca `partner_id` di dalam `summarize` | `redact` sudah membuangnya — hasilnya `undefined`, gagal tanpa error |
| Mengarang kode permission tanpa seed | Melanggar aturan #3 CLAUDE.md |
| Memakai `is_platform_admin` sebagai peran sales | Mem-bypass seluruh RBAC. Setiap sales akan melihat seluruh pelanggan |
| Membangun L3 sebelum master data servis ada | Mengeluarkan biaya akuisisi tertinggi untuk nilai nol (§5) |
| Menyembunyikan ketidakpastian dari UI | R-9. Data yang terlihat pasti tapi salah lebih merusak daripada data yang jujur tidak lengkap |
