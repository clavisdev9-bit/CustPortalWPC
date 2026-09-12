# Implementation Spec — Customer Portal: Vessel Schedule

- **Status**: Draft rancangan. **Belum ada kode yang ditulis.** Tiga pertanyaan penentu bentuk
  sudah dijawab client pada 2026-09-10 dan jawabannya sudah masuk ke rancangan ini (lihat §1,
  tabel "Keputusan client"). Delapan pertanyaan operasional (§2.4) belum dijawab; Q-1 dan Q-4
  memblokir go-live, bukan Fase 0.
- **Prepared as**: Hasil analisis kelayakan atas attachment "Customer Portal – Vessel Schedule"
  (5 bagian: Overview, Fitur Utama, User Flow, Arsitektur Sistem, Data Flow + tiga mockup A/B/C),
  untuk direview client dan dieksekusi oleh Claude Code / developer.
- **Date**: 2026-09-10
- **Related documents**:
  - [`system.md`](../../system.md) — arsitektur as-built (§6 keamanan, §7 Odoo layer, §17 batasan)
  - [`customer_population_installed_base.md`](customer_population_installed_base.md) — dokumen ini
    meniru strukturnya, dan §6 di sana adalah preseden "field dari addon Odoo sendiri, bukan Studio"
  - [`customer_portal_odoo18_customer_scoped_access.md`](customer_portal_odoo18_customer_scoped_access.md)
    — model identity/scope yang WAJIB tetap berlaku, termasuk untuk data referensi
  - [`prompt-shipment-tracking-interactive-prototype_1.md`](prompt-shipment-tracking-interactive-prototype_1.md)
    — prototipe mock yang non-goals-nya menyebut Vessel Schedule sebagai langkah berikutnya
  - [`odoo_studio_installed_base.md`](../ops/odoo_studio_installed_base.md) — pola dokumentasi
    pemetaan field per environment yang wajib diikuti addon baru di §6
- **Current state referenced** (dibaca langsung dari repo, sudah diverifikasi):
  `src/services/odooCapabilityService.js`, `src/services/odooContext.js`,
  `src/integrations/odoo/OdooProductService.js`, `src/integrations/odoo/OdooDeliveryService.js`,
  `src/services/notificationService.js`, `src/services/equipmentRateLimiter.js`,
  `src/services/invoiceService.js`, `src/routes/equipment.routes.js`,
  `src/routes/odooWebhooks.routes.js`, `src/utils/parseOdooId.js`,
  `frontend/src/api/client.js` (`apiFetchBlob`), `frontend/src/utils/download.js`,
  `frontend/src/components/AppShell.jsx`, `frontend/src/pages/ShipmentTrackingPage.jsx`,
  `frontend/src/data/shipmentMockData.js`, `database/seeds/0001_permissions_and_roles.sql`,
  `package.json`, `frontend/package.json`

> **Tujuan dokumen ini**: menjadi satu-satunya acuan implementasi, cukup presisi untuk dikerjakan
> tanpa menebak, dan cukup eksplisit soal *yang belum diketahui* supaya tidak ada asumsi diam-diam
> yang baru ketahuan salah saat UAT. Setiap pola kode di bawah diambil dari file yang sudah ada di
> repo ini. Yang **tidak** ada di repo ini disebut sebagai pekerjaan di luar repo, bukan
> disembunyikan sebagai detail.

---

## Daftar Isi

1. [Ringkasan eksekutif & temuan yang mengubah rancangan](#1-ringkasan-eksekutif--temuan-yang-mengubah-rancangan)
2. [Analisis requirement](#2-analisis-requirement)
3. [Keputusan desain (D-1 … D-7)](#3-keputusan-desain-d-1--d-7)
4. [Invarian yang tidak boleh dilanggar (VS-1 … VS-6)](#4-invarian-yang-tidak-boleh-dilanggar-vs-1--vs-6)
5. [Model data konseptual](#5-model-data-konseptual)
6. [Pemetaan fisik ke Odoo — addon `freight_schedule`](#6-pemetaan-fisik-ke-odoo--addon-freight_schedule)
7. [Yang tetap tinggal di portal DB](#7-yang-tetap-tinggal-di-portal-db)
8. [Akuisisi & kesegaran data](#8-akuisisi--kesegaran-data)
9. [Ekspor XLSX & PDF — permintaan dependency](#9-ekspor-xlsx--pdf--permintaan-dependency)
10. [Kontrak API](#10-kontrak-api)
11. [File manifest backend](#11-file-manifest-backend)
12. [Permukaan frontend](#12-permukaan-frontend)
13. [Notifikasi perubahan jadwal](#13-notifikasi-perubahan-jadwal)
14. [Permission & seed](#14-permission--seed)
15. [NFR: budget panggilan Odoo, rate limit, degradasi](#15-nfr-budget-panggilan-odoo-rate-limit-degradasi)
16. [Verifikasi](#16-verifikasi)
17. [Roadmap fase & acceptance criteria](#17-roadmap-fase--acceptance-criteria)
18. [Risiko & mitigasi](#18-risiko--mitigasi)
19. [Anti-pattern: jangan lakukan ini](#19-anti-pattern-jangan-lakukan-ini)

---

## 1. Ringkasan eksekutif & temuan yang mengubah rancangan

Attachment meminta fitur **Vessel Schedule**: pelanggan yang login melihat jadwal kapal (ETD/ETA,
rute, status pelayaran) dengan pencarian/filter, tampilan daftar dan kalender, detail kapal +
voyage, notifikasi perubahan, dan ekspor Excel/PDF — "terintegrasi dengan Odoo 18 melalui API
sehingga data selalu up-to-date".

Seluruh lapis portal untuk ini **bisa dibangun dengan pola yang sudah ada di repo**. Yang tidak
bisa diasumsikan ada adalah datanya.

### Temuan 1 — Odoo 18 tidak punya konsep kapal, voyage, atau jadwal pelayaran

Baik Community maupun Enterprise. Yang paling dekat di portal hari ini adalah `stock.picking`
(`scheduled_date`/`date_done`, dipakai `/deliveries` lewat `OdooDeliveryService.js`) — itu jadwal
**kiriman**, bukan jadwal **kapal**. Kustomisasi Odoo yang tersedia di mesin dev
(`C:\Dev\add on ff 16092025\customizations.zip`) juga sudah diperiksa: isinya export Studio dengan
model `x_test*` dan `x_property*`, tidak ada apa pun soal vessel/voyage/port/ETD.

Artinya kalimat "terintegrasi dengan Odoo 18 sehingga data selalu up-to-date" pada attachment
**belum punya sumber**, dan pekerjaan pertama fitur ini bukan pekerjaan portal: ia pekerjaan addon
Odoo. Client sudah memilih jalur itu (lihat tabel di bawah), jadi §6 dokumen ini menspesifikasikan
addon-nya, dan §17 menempatkannya sebagai Fase 0 yang memblokir.

### Temuan 2 — Jadwal kapal adalah data referensi, dan itu menyentuh aturan keamanan inti

Aturan #2 CLAUDE.md ("setiap query Odoo terkunci ke partner + company") dibangun untuk data yang
**dimiliki** pelanggan. Jadwal kapal tidak dimiliki siapa pun: ia jadwal yang sama untuk semua
orang. Client sudah menjawab bahwa jadwal boleh dilihat semua pemegang akun, jadi rancangan ini
memakai pola yang presedennya sudah ada — `OdooProductService.listProducts` menyaring katalog
hanya dengan `sale_ok` + `company_id` (termasuk `company_id = false`), tanpa partner sama sekali.

Konsekuensinya harus ditulis eksplisit, bukan dibiarkan terbaca sebagai bug: **badan jadwal
company-scoped, tetapi setiap lapis data per-pelanggan yang menumpang di atasnya tetap terkunci
partner.** Mockup §B punya tab **Cargo** dan **Documents** — dua tab itu jelas milik pelanggan yang
sedang melihat, bukan milik voyage. Batas itu dijaga VS-2 dengan cara yang terlihat di kode:
endpoint terpisah, bukan field tambahan di respons voyage.

### Temuan 3 — "Real-time" di portal ini berarti polling, dan itu perlu disepakati tertulis

Portal tidak punya websocket. Notifikasi bekerja dengan polling
(`notificationService.checkForUpdates`, throttle 30 detik per user+koneksi, `NotificationBell`
menarik setiap interval), dan satu-satunya webhook Odoo yang ada hanya untuk provisioning user
(`src/routes/odooWebhooks.routes.js:9` — satu route, `POST /:connectionId/:secret`), bukan event
perubahan data. SSE hanya dipakai chat asisten.

Jadi "real-time" yang bisa dijanjikan adalah: perubahan yang sudah masuk Odoo akan terlihat pada
pemuatan halaman berikutnya, dan notifikasi menyusul dalam ≤ 60 detik. Ini bukan kekurangan yang
perlu ditutupi — ini angka yang harus ada di kontrak (Q-6), karena kata "real-time" pada attachment
akan diukur oleh orang yang tidak membaca dokumen ini.

### Keputusan client (2026-09-10)

| Pertanyaan | Jawaban client | Konsekuensi di dokumen ini |
|---|---|---|
| Jadwal boleh dilihat semua pemegang akun, atau hanya yang punya booking? | **Semua pemegang akun** | D-2, VS-2, VS-5. Menambah kewajiban baru: flag `is_published` di Odoo (D-3), karena "terlihat semua pelanggan" berarti jadwal draft tidak boleh ikut terbit |
| Siapa pemasok data jadwal — addon Odoo sendiri atau feed carrier? | **Addon Odoo yang kita bangun** | §6 seluruhnya; Fase 0 jadi blocking; A-1 wajib dikonfirmasi ke Odoo target |
| Ekspor cukup CSV, atau XLSX/PDF? | **XLSX/PDF** | §9. Butuh **satu** dependency backend baru (`exceljs`) yang perlu persetujuan; PDF **tidak** butuh dependency karena dirender Odoo (QWeb) dan diunduh lewat jalur yang sudah dibangun CR-033 |

### Bentuk akhir

```
                    ODOO (system of record)
  ┌─────────────────────────────────────────────────────────────┐
  │  addon freight_schedule  (Python, kita bangun sendiri)      │
  │    freight.vessel    kapal + IMO + kapasitas + operator     │
  │    freight.voyage    voyage no + POL/POD + ETD/ETA + state  │
  │      └─ freight.voyage.leg   port call per leg (rute)       │
  │    freight.port      UN/LOCODE + timezone                   │
  │    report QWeb       -> PDF jadwal (dipakai portal §9)      │
  └──────────┬─────────────────────────────────┬────────────────┘
             │ diisi & dipelihara tim ops      │ XML-RPC, terkunci COMPANY
             │ langsung di Odoo (§8)           │ (bukan partner -- D-2)
             ▼                                 ▼
      OPS / SCHEDULING                  CustPortalWPC
                                        /vessel-schedule  (list · kalender · detail)
                                        + overlay per-pelanggan yang TETAP
                                          terkunci partner (VS-2)
```

Portal DB tidak menyimpan satu baris pun jadwal (VS-3). Satu-satunya tabel portal yang dibolehkan
adalah daftar voyage yang di-*watch* seorang user untuk notifikasi (§7) — itu data "siapa mau
diberi tahu", yang memang urusan portal, bukan salinan jadwal.

---

## 2. Analisis requirement

### 2.1 Pemetaan fitur attachment → kapabilitas → sumber data

| Attachment | Kapabilitas | Sumber data | Status hari ini |
|---|---|---|---|
| §2.1 Pencarian & Filter (nama kapal, no. voyage, POL/POD, rentang tanggal, status) | Domain Odoo dibangun server-side dari query terverifikasi | `freight.voyage` | Pola siap (`ShipmentTrackingPage.jsx` untuk UI, `OdooDeliveryService` untuk domain), data **belum ada** |
| §2.2 Jadwal kapal (ETD/ETA) | List + pagination | `freight.voyage.etd/eta` | Data **belum ada** |
| §2.3 Detail kapal & voyage (mockup §B) | Detail + tab Overview/Schedule/Route | `freight.vessel`, `freight.voyage`, `freight.voyage.leg` | Data **belum ada** |
| §2.3 tab **Cargo** & **Documents** (mockup §B) | Overlay per-pelanggan | `sale.order`/`stock.picking` milik partner + `ir.attachment` | **Terkunci partner** (VS-2). Sebagian sudah ada lewat `documentService` |
| §2.4 Notifikasi perubahan jadwal | Watchlist + poll "apa yang berubah" | `mail.tracking.value` pada `freight.voyage` + tabel watchlist portal | Infrastruktur notifikasi **sudah ada**, fan-out-nya belum (§13) |
| §2.5 Ekspor Excel/PDF | XLSX dirender portal, PDF dirender Odoo | Sama dengan list | Butuh 1 dependency (§9) |
| §3 User Flow (login → menu → filter → detail → download) | Auth, RBAC, nav, unduh blob | — | **Sudah ada seluruhnya** kecuali permission code baru (§14) |
| Mockup §C Calendar/Week/Month | Grid kalender + bar multi-hari | Sama dengan list, rentang tanggal | Tidak ada library kalender; digambar sendiri (§12) |

### 2.2 Glosarium & pemetaan istilah

Istilah pelayaran di attachment dipakai tanpa definisi. Kode wajib memakai kolom kanan.

| Istilah attachment / mockup | Arti | Nama di kode |
|---|---|---|
| Vessel | Kapal fisik, identitasnya nomor IMO (tidak berubah selama umur kapal) | `freight.vessel`, `vessel_id` |
| Voyage | Satu pelayaran kapal itu, bernomor (mockup: `037N`, `015E`) | `freight.voyage`, `voyage_no` |
| POL / POD | Port of Loading / Port of Discharge | `pol_id` / `pod_id` |
| ETD / ETA | *Estimated* time of departure/arrival — angka rencana, bisa berubah | `etd` / `eta` |
| ATD / ATA | *Actual* — terisi setelah kejadian; inilah yang membuat status "Arrived" jujur | `atd` / `ata` |
| Route `SGSIN → IDJKT` | Kode UN/LOCODE pelabuhan | `freight.port.code` |
| Transshipment | Pindah kapal di pelabuhan antara | `freight.voyage.leg.leg_type = 'transship'` |
| Service `Direct` | Pola layanan (langsung / via transshipment) | `service_type` |
| Status `On Schedule`/`Delayed`/`Arrived` | Status pelayaran | `state` (§6) |
| TEU | Satuan kapasitas kontainer | `capacity_teu` |

### 2.3 Yang sudah ada di sistem dan bisa dipakai ulang

Rancangan ini sengaja tidak memulai dari nol.

| Sudah ada | File | Dipakai untuk |
|---|---|---|
| Pola query company-scoped tanpa partner | `src/integrations/odoo/OdooProductService.js:6` (`sale_ok` + `company_id` termasuk `false`) | Preseden persis untuk D-2; domain jadwal meniru bentuk ini |
| Gerbang kapabilitas modul Odoo opsional | `src/services/odooCapabilityService.js` (`FEATURES`, `assertFeature`) | Addon `freight_schedule` adalah modul opsional; wajib satu baris di sana (VS-4) |
| Sesi + identitas server-side | `src/services/odooContext.js` (`resolveOdooContext(userId, companyId, { feature })`) | Semua service fitur ini; `feature: 'vesselSchedule'` |
| Unduh file biner ke klien | `frontend/src/api/client.js:288` (`apiFetchBlob`) + `frontend/src/utils/download.js` | Ekspor XLSX/PDF (§9) tanpa dependency frontend |
| Unduh PDF yang dirender Odoo | `src/services/invoiceService.js:21` + jalur HTTP/session-cookie `OdooClient` (CR-033) | PDF jadwal (§9) — Odoo menolak render report lewat XML-RPC, jalur ini sudah menyelesaikannya |
| Pembatas burst per user | `src/services/equipmentRateLimiter.js` | Pola untuk `vesselScheduleRateLimiter` (§15.2) |
| Notifikasi polling + "apa yang berubah sejak" | `src/services/notificationService.js` | §13 |
| Pola list + filter + sort + pagination + panel detail | `frontend/src/pages/ShipmentTrackingPage.jsx`, `TicketDetailPanel.jsx` | Mockup §A dan §B |
| Nav bergrup + penyembunyian by capability | `frontend/src/components/AppShell.jsx:45` (grup **Delivery**, atribut `feature`) | Penempatan menu (§12) |

### 2.4 Pertanyaan yang harus dijawab client / tim ops

Tiga pertanyaan penentu bentuk sudah dijawab (§1). Delapan berikut operasional; Q-1 dan Q-4
memblokir **go-live**, bukan Fase 0.

| ID | Pertanyaan | Kenapa penting | Default kalau tidak dijawab |
|---|---|---|---|
| **Q-1** | Siapa yang mengisi & memelihara jadwal di Odoo, dan berapa SLA kesegarannya? | Ini R-1: fitur yang datanya tidak dipelihara lebih merusak kepercayaan daripada tidak ada fitur. Butuh nama jabatan, bukan "tim ops" | PIC Scheduling, pembaruan ≤ 4 jam kerja setelah perubahan dari carrier |
| **Q-2** | Horizon publikasi berapa jauh ke depan, dan voyage lampau disimpan berapa lama? | Menentukan cap rentang tanggal (§15.1) dan isi default filter | Terbit 8 minggu ke depan; voyage lampau tetap terbaca 6 bulan |
| **Q-3** | Jadwal mencakup kapal/servis pihak lain (co-loading, partner line) atau hanya milik sendiri? | Kalau ya, `operator_id` wajib tampil dan ekspektasi akurasi turun (data pihak ketiga) | Hanya kapal/servis sendiri |
| **Q-4** | Satu jadwal berlaku lintas company Odoo, atau per company? | Menentukan `company_id` diisi atau dibiarkan kosong; salah pilih = pelanggan melihat jadwal company lain, atau tidak melihat apa pun | Per company (`company_id` diisi) |
| **Q-5** | Tab **Cargo**/**Documents** di mockup §B benar-benar berisi booking milik pelanggan yang login? | Kalau ternyata dimaksudkan "manifest seluruh kapal", itu kebocoran lintas pelanggan dan harus ditolak | Ya — milik pelanggan yang login saja (VS-2) |
| **Q-6** | "Real-time" disepakati sebagai polling ≤ 60 detik? | Temuan 3. Kata ini akan diukur oleh orang yang tidak membaca dokumen ini | Ya, ≤ 60 detik |
| **Q-7** | ETD/ETA ditampilkan dalam waktu lokal pelabuhan atau WIB seragam? | D-4. Jadwal pelayaran dikutip dalam waktu lokal pelabuhan; salah pilih = pelanggan ke dermaga di jam yang salah | Waktu lokal pelabuhan, berlabel `LT` |
| **Q-8** | Ekspor PDF: cukup tabel jadwal, atau harus ber-kop surat/branding? | Menentukan effort QWeb template di addon (§9) | Tabel + kop standar company Odoo |

### 2.5 Asumsi yang dipakai dokumen ini

| ID | Asumsi | Kalau salah, yang terdampak |
|---|---|---|
| A-1 | Addon Python bisa di-deploy ke Odoo target | **§6 seluruhnya.** Jawaban client atas pertanyaan (2) mengandaikan ini. Preseden: addon `installed_base` memang ter-deploy di target. Diuji Fase 0 |
| A-2 | Plan Odoo = **Custom** (External API/XML-RPC aktif) | Seluruh integrasi. Sudah tercatat sebagai batasan diketahui di CLAUDE.md; konfirmasi ulang di Fase 0 |
| A-3 | Satu voyage = satu kapal, dan `(vessel_id, voyage_no)` unik | Model §6 harus dinormalisasi ulang (voyage berbagi kapal dalam satu string) |
| A-4 | Odoo menyimpan `etd`/`eta` sebagai `Datetime` (UTC), portal yang mengubahnya ke waktu lokal pelabuhan | D-4, dan seluruh angka jam yang tampil di UI |
| A-5 | Voyage aktif per company ≤ beberapa ribu baris | Cap dan pagination §15.1; kalau jauh lebih besar, kalender butuh agregasi server-side |
| A-6 | Pelabuhan diidentifikasi UN/LOCODE (mockup: `SGSIN`, `IDJKT`, `AUPER`) | Master data `freight.port` dan filter "All Ports" |

---

## 3. Keputusan desain (D-1 … D-7)

### D-1 · Jadwal hidup di Odoo, di addon yang kita bangun sendiri

**Keputusan**: model jadwal dibuat sebagai addon Python `freight_schedule` di Odoo target. Portal
membacanya lewat XML-RPC. Portal tidak pernah menjadi tempat entri jadwal.

**Alasan**: prinsip inti CLAUDE.md — *"Odoo mengelola apa yang dimiliki customer dan transaksi apa
yang terjadi"*. Jadwal pelayaran adalah data operasional yang dipakai jauh lebih luas daripada
portal (ops, dokumentasi, invoicing). Menaruhnya di portal DB berarti Odoo tidak bisa memakainya,
dan itu menjamin munculnya sumber kebenaran kedua dalam waktu satu kuartal.

**Addon, bukan Studio**: preseden addon `installed_base` sudah membuktikan target punya akses
deploy (`Docs/ops/odoo_studio_installed_base.md`), dan fitur ini butuh hal-hal yang Studio tidak
bisa: model baru dengan relasi one2many bertingkat (voyage → leg), constraint unik
`(vessel_id, voyage_no)`, `mail.thread` untuk riwayat perubahan ETA (§13), dan **report QWeb**
untuk PDF (§9). Konsekuensi penamaan: field **tanpa** prefiks `x_` — sama seperti `customer_id`
milik `installed_base`, bukan `x_studio_*`.

### D-2 · Jadwal adalah data referensi: terkunci company, tidak terkunci partner

**Keputusan**: domain dasar jadwal hanya memaksa `company_id` (termasuk menerima
`company_id = false`) dan `is_published = true`. Tidak ada `partner_id` di dalamnya.

```js
// Pola persis mengikuti OdooProductService.listProducts -- katalog juga data referensi
// company-scoped tanpa partner. Perbedaannya cuma nama modelnya.
function baseDomain(companyId) {
  return [
    ['is_published', '=', true],
    '|',
    ['company_id', '=', false],
    ['company_id', '=', companyId],
  ];
}
```

**Alasan**: jawaban client atas pertanyaan (1). Mockup §A juga hanya bisa dibaca begitu — filter
"All Ports" dan pencarian bebas nama kapal tidak punya makna pada daftar yang sudah dipersempit ke
booking pelanggan.

**Yang wajib ikut ditulis**: karena ini satu-satunya endpoint pelanggan di portal yang tidak
memaksa partner, komentar di `OdooVesselScheduleService.js` **harus** menyebut D-2 dan menyebut
preseden `listProducts`. Tanpa itu, pembaca berikutnya akan membacanya sebagai pelanggaran aturan
#2 CLAUDE.md dan "memperbaikinya" — lalu fiturnya mati. Perbedaannya juga wajib masuk
`system.md §9`, sejajar dengan catatan pelebaran cakupan D-4 milik Installed Base.

### D-3 · Terbit ke pelanggan butuh flag eksplisit (`is_published`)

**Keputusan**: `freight.voyage.is_published` (boolean, default `False`). Portal hanya membaca yang
`True`.

**Alasan**: konsekuensi langsung dari D-2 yang mudah terlewat. Begitu jadwal terlihat **semua**
pemegang akun, jadwal yang masih draft (rencana rotasi kapal, slot yang belum dikonfirmasi carrier)
menjadi informasi komersial yang bocor ke pasar. Menyaring dengan `state` tidak cukup — voyage
berstatus `scheduled` bisa saja masih draft. Flag terpisah membuat "sudah boleh dilihat pelanggan"
menjadi keputusan sadar seorang manusia, bukan efek samping status.

Cancelled **tetap** terbit: pelanggan justru paling butuh tahu pelayaran yang dibatalkan.

### D-4 · Waktu selalu waktu lokal pelabuhan, dan selalu berlabel

**Keputusan**: `etd`/`eta`/`atd`/`ata` disimpan Odoo sebagai `Datetime` (UTC). Portal
mengonversinya ke timezone pelabuhan yang relevan (`freight.port.tz`, IANA) dan **selalu**
menampilkan label `LT` (local time) di sebelah jam.

**Alasan**: jadwal pelayaran di seluruh industri dikutip dalam waktu lokal pelabuhan. Mockup §A
menulis "12 Sep 2026 10:00" tanpa zona — dan itu persis bentuk bug yang tidak pernah terlihat di
layar developer: pelanggan Jakarta membaca ETD Singapura sebagai WIB, selisihnya satu jam, dan
kesalahannya baru ketahuan di dermaga. Konversi dilakukan **di frontend** dengan
`Intl.DateTimeFormat(…, { timeZone })` (built-in, nol dependency), sedangkan API selalu mengirim
ISO-8601 UTC + `tz` pelabuhan. API tidak pernah mengirim string jam yang sudah diformat.

### D-5 · Status pelayaran dihitung, bukan diketik ulang

**Keputusan**: `state` punya lima nilai (`scheduled`, `departed`, `arrived`, `delayed`,
`cancelled`), tapi `delayed` **dihitung** di Odoo sebagai `compute` dari selisih ETD/ETA terhadap
baseline yang dipublikasikan pertama kali, bukan dicentang manual. `departed`/`arrived` mengikuti
terisinya `atd`/`ata`.

**Alasan**: status yang diketik manual akan berbohong pada hari yang sibuk — persis ketika
pelanggan paling membutuhkannya. Ini juga alasan `atd`/`ata` wajib ada di model meski tidak tampil
di mockup: tanpa waktu aktual, badge "Arrived" hanya opini.

### D-6 · Overlay per-pelanggan adalah endpoint terpisah, bukan field tambahan

**Keputusan**: tab **Cargo** dan **Documents** pada mockup §B dilayani
`GET /vessel-schedule/:id/my-cargo` dan endpoint dokumen yang sudah ada — bukan field di dalam
respons `GET /vessel-schedule/:id`.

**Alasan**: menempelkan data partner-locked ke dalam payload yang company-scoped berarti satu
respons punya dua aturan scoping sekaligus, dan aturan yang lebih ketat akan hilang pada
perubahan pertama yang dilakukan orang yang tidak tahu (mis. saat menambah caching, atau saat
membuat ekspor). Endpoint terpisah membuat batas itu terlihat di daftar route, di OpenAPI, dan di
log audit. Ini pasangan operasional VS-2.

### D-7 · Penamaan

**Keputusan**: `vessel-schedule` di URL portal dan `vesselSchedule` di kode portal; model Odoo
berprefiks `freight.*` di dalam addon bernama `freight_schedule`; label UI "Vessel Schedule".

**Alasan**: URL dan kode portal memakai istilah yang dipakai pelanggan (attachment dan mockup
menyebutnya Vessel Schedule). Prefiks model Odoo dibuat lebih luas (`freight.*`) karena entitas
yang sama akan dipakai Airline Schedule dan Shipment Tracking berikutnya — `vessel.*` akan salah
nama begitu ada pesawat. Jangan memakai nama `shipment*`: itu sudah dipakai prototipe lain
(`frontend/src/pages/ShipmentTrackingPage.jsx`) dan artinya berbeda (kiriman, bukan pelayaran).

---

## 4. Invarian yang tidak boleh dilanggar (VS-1 … VS-6)

### VS-1 · Tidak ada identitas yang datang dari request

Berlaku sama seperti aturan #1 CLAUDE.md, **tanpa pengecualian meski datanya referensi**. Tidak ada
endpoint `/vessel-schedule*` yang menerima `partner_id`, `customer_id`, atau `company_id` dari
body/query/header. Satu-satunya sumber:

```js
const { session, odooPartnerId, odooCompanyId } = await resolveOdooContext(
  userId, currentCompanyId, { feature: 'vesselSchedule' }
);
```

`companyId` yang masuk ke `baseDomain` (D-2) adalah `odooCompanyId` hasil resolve itu — bukan
parameter filter. Filter "All Ports"/status/tanggal boleh datang dari klien; **company tidak
pernah**.

### VS-2 · Company-scoped hanya untuk badan jadwal; overlay pelanggan tetap partner-locked

`freight.voyage`, `freight.vessel`, `freight.voyage.leg`, `freight.port` → company-scoped (D-2).
Booking/cargo/dokumen pelanggan pada sebuah voyage → **wajib** membawa
`['partner_id', '=', odooPartnerId]` (atau keluarga partner bila menyusul pola D-4 Installed Base),
dan wajib berada di endpoint terpisah (D-6). Data pelanggan lain menghasilkan daftar kosong atau
`404` — tidak pernah data.

### VS-3 · Tidak ada salinan jadwal di portal DB

Tidak ada tabel `vessel_*`/`voyage_*` yang menyimpan nama kapal, nomor voyage, ETD/ETA, atau
status. Alasannya sama dengan IB-3 di Installed Base, dan lebih tajam di sini: **jadwal yang basi
adalah jadwal yang salah**, dan pelanggan mengambil keputusan logistik dari angka itu. Satu-satunya
tabel portal yang boleh ada adalah watchlist notifikasi (§7).

### VS-4 · Kapabilitas Odoo diverifikasi, tidak diasumsikan

Fitur ini bersandar penuh pada addon opsional, jadi ia **wajib** menambah satu baris di `FEATURES`
(`src/services/odooCapabilityService.js:20`) dan menyebut nama fiturnya saat mengambil sesi.
Jangan menambah `try/catch` lokal — itu pola yang sudah tiga kali gagal (BUG-17,
`carrier_tracking_ref`, BUG-31). Satu field tidak valid menggagalkan **seluruh** `search_read`
(IB-5), jadi setiap field baru lolos `scripts/check-vessel-schedule-capability.js` (§16) sebelum
masuk `LIST_FIELDS`.

### VS-5 · "Boleh dilihat semua pelanggan" ≠ "endpoint publik"

Setiap route tetap `authenticate` + `requirePermission('vessel.view')`. Tidak ada route jadwal
tanpa autentikasi, tidak ada tautan berbagi anonim, tidak ada embed publik — sekalipun mockup §A
terlihat seperti halaman publik dan sekalipun secara komersial jadwalnya memang tidak rahasia.
Alasannya bukan kerahasiaan jadwal: endpoint tanpa auth berarti endpoint tanpa rate limit, tanpa
audit, dan tanpa batas company — tiga hal yang tidak boleh hilang dari permukaan yang memanggil
Odoo.

### VS-6 · Ekspor memakai ulang jalur baca yang sama, tidak pernah query sendiri

`GET /vessel-schedule/export` **wajib** memanggil fungsi service yang sama dengan yang melayani
`GET /vessel-schedule`, dengan filter yang sudah diparse oleh validator yang sama. Ekspor tidak
boleh membangun domain-nya sendiri.

**Alasan**: jalur ekspor yang menulis query-nya sendiri adalah cara paling umum sebuah filter
scoping hilang tanpa terlihat — layarnya benar, filenya bocor. Ini juga berlaku untuk PDF: portal
menghitung daftar id dengan domain ber-scope-nya, lalu meminta Odoo merender report **untuk
id-id itu**; report Odoo tidak pernah menerima filter dari klien.

---

## 5. Model data konseptual

Empat entitas, satu hierarki. Semuanya di Odoo (D-1).

```
freight.vessel  (kapal fisik -- identitas: IMO)
   │  1..n
   ▼
freight.voyage  (satu pelayaran: voyage_no + POL/POD + ETD/ETA + state)
   │  1..n
   ▼
freight.voyage.leg  (port call berurutan: load -> transship -> discharge)
   │  n..1
   ▼
freight.port  (UN/LOCODE + timezone)
```

**Kenapa `leg` entitas sendiri, bukan dua kolom POL/POD saja**: mockup §B punya tab **Route** dan
panel **Current Status** dengan tiga tahap (Departed Singapore → At Sea → Arriving Jakarta), dan
mockup §A menampilkan rute satu-hop (`SGSIN → IDJKT`). Dua kolom cukup untuk §A, tapi tidak untuk
transshipment — dan transshipment adalah kasus normal, bukan kasus tepi (prototipe Shipment
Tracking yang sudah ada pun punya leg Busan dan Singapura). Menambah leg belakangan berarti
mengubah kontrak API yang sudah dipakai UI. POL/POD tetap ada di voyage sebagai `related`/`compute`
dari leg pertama dan terakhir, supaya §A tetap 1 query.

### Atribut per entitas

**`freight.vessel`** — nama, `imo_number` (unik, 7 digit), `vessel_type`, `capacity_teu`,
`flag_country_id` → `res.country`, `operator_id` → `res.partner`, `active`.
Mockup §B "Vessel Information" terpenuhi seluruhnya oleh baris ini.

**`freight.voyage`** — `voyage_no`, `vessel_id`, `service_type`, `pol_id`/`pod_id`,
`etd`/`eta`/`atd`/`ata`, `state` (D-5), `is_published` (D-3), `company_id`, `remarks`, `leg_ids`.
Inherit `mail.thread` dengan `tracking=True` pada `etd`/`eta`/`state` — riwayat perubahan jadwal
didapat gratis dan menjadi sumber notifikasi §13.

**`freight.voyage.leg`** — `voyage_id`, `sequence`, `port_id`, `leg_type`
(`load`/`transship`/`discharge`), `eta`/`etd`/`ata`/`atd`, `terminal` (char, opsional).

**`freight.port`** — `name`, `code` (UN/LOCODE, unik), `country_id`, `tz` (IANA, mis.
`Asia/Singapore`) — `tz` wajib, karena D-4 bergantung padanya.

---

## 6. Pemetaan fisik ke Odoo — addon `freight_schedule`

Addon ini **pekerjaan di luar repo portal** (repo Odoo, sejajar dengan addon `installed_base`).
Dokumen ini menspesifikasikan kontraknya, bukan implementasi Python-nya.

### 6.1 Yang harus dideliver addon

| Deliverable | Kenapa portal membutuhkannya |
|---|---|
| Empat model §5 + constraint unik `(vessel_id, voyage_no)` dan `imo_number` | Identitas voyage stabil; portal memakai id Odoo sebagai id API |
| `is_published` (default `False`) | D-3 / VS-4 — dimasukkan ke `FEATURES.fields` supaya addon versi lama ditolak lebih awal, bukan diam-diam menerbitkan draft |
| `state` compute untuk `delayed` (D-5) | Badge status di §A/§B jujur tanpa entri manual |
| `mail.thread` + `tracking=True` pada `etd`/`eta`/`state` | §13 notifikasi + audit perubahan jadwal di sisi Odoo |
| Report QWeb `freight_schedule.report_voyage_schedule` yang menerima daftar id | §9 PDF tanpa dependency portal |
| Akses read untuk user integrasi portal | Portal memakai satu user Odoo (`odoo_connections.username`) |
| Menu ops + view list/form/calendar di Odoo | §8 — jadwal diisi di Odoo, jadi UI-nya harus layak dipakai tim ops |
| Dokumen pemetaan field per environment | Mengikuti pola `Docs/ops/odoo_studio_installed_base.md`; tanpa ini verifikasi §16 tidak bisa direview |

### 6.2 Jebakan yang wajib diketahui

- **`res.partner` sebagai `operator_id`** adalah pelayaran/operator, **bukan** pelanggan. Jangan
  pernah memakai field ini untuk scoping apa pun. Ini jebakan yang sama bentuknya dengan
  `maintenance.equipment.partner_id` yang ternyata vendor (§6.2 CR Installed Base) — dan di sini
  akibatnya lebih parah, karena `operator_id` **memang** bertipe partner sehingga kode yang salah
  akan berjalan tanpa error.
- **`eta` bukan fakta.** Ia berubah. Setiap tampilan wajib memasangkannya dengan waktu pembaruan
  terakhir (`write_date`), supaya pelanggan bisa menilai kesegaran angka itu (R-1).
- **`company_id = false`** berarti jadwal berlaku lintas company. Domain D-2 sudah menerimanya;
  keputusan mengisinya atau tidak ada di Q-4 dan harus dijawab **sebelum** data diisi, bukan
  sesudah.

### 6.3 Baris `FEATURES` di portal (wajib, VS-4)

```js
// src/services/odooCapabilityService.js
vesselSchedule: {
  label: 'Jadwal kapal (Vessel Schedule)',
  odooModule: 'addon freight_schedule',
  models: ['freight.voyage', 'freight.vessel', 'freight.port'],
  // is_published bukan sekadar kolom: domain D-2 memaksanya, jadi addon versi lama yang belum
  // punya field ini harus ditolak sebagai "fitur tidak tersedia" -- bukan dibiarkan menggagalkan
  // seluruh search_read dengan "Invalid field" di hadapan pelanggan.
  fields: { 'freight.voyage': ['is_published'] },
},
```

Addon belum terpasang → `503 feature_unavailable` + menu tersembunyi lewat `GET /capabilities`
yang sudah ada. Tidak ada fault XML-RPC mentah yang bocor.

---

## 7. Yang tetap tinggal di portal DB

Satu tabel, dan hanya untuk Fase 4 (§13):

```sql
-- database/migrations/0017_vessel_watchlist.sql
--
-- Ini BUKAN salinan jadwal (VS-3). Yang disimpan hanya "user mana ingin diberi tahu tentang
-- voyage mana" -- pertanyaan tentang siapa dan apa yang boleh, yang menurut prinsip inti
-- CLAUDE.md justru urusan portal. Tidak ada nama kapal, ETD, atau status di sini; semuanya
-- dibaca ulang dari Odoo saat notifikasi dibuat.
--
-- Scoping ganda portal_user_id + odoo_connection_id mengikuti konvensi repo: satu portal user
-- bisa ter-map ke lebih dari satu Odoo, dan id voyage hanya bermakna di dalam satu koneksi.
CREATE TABLE vessel_watchlist (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  portal_user_id     UUID NOT NULL REFERENCES portal_users(id) ON DELETE CASCADE,
  odoo_connection_id UUID NOT NULL REFERENCES odoo_connections(id) ON DELETE CASCADE,
  odoo_voyage_id     INTEGER NOT NULL,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (portal_user_id, odoo_connection_id, odoo_voyage_id)
);
```

---

## 8. Akuisisi & kesegaran data

Jadwal diisi **manusia di Odoo** (tim ops), bukan diimpor portal dan bukan (untuk sekarang) diambil
dari feed carrier. Konsekuensi yang harus diterima secara sadar:

1. **Fitur ini hanya sebaik disiplin entrinya.** Ini R-1, risiko terbesar fitur ini, dan ia bukan
   risiko teknis. Q-1 harus dijawab dengan nama jabatan dan SLA angka.
2. **Kesegaran wajib tampil, bukan disembunyikan.** Setiap layar menampilkan "Updated
   <write_date>" per baris/voyage. Jadwal tanpa jejak kesegaran akan dianggap benar selamanya.
3. **View kalender Odoo bagian dari deliverable addon** (§6.1). Kalau UI entri di Odoo tidak
   nyaman, jadwal tidak akan dipelihara — dan portalnya jadi ikut salah.
4. **Feed carrier adalah Fase pasca-rilis, bukan Fase 1.** Kalau nanti dipakai, feed masuk **ke
   Odoo** dulu (job di addon), tidak langsung ke portal. Portal tidak boleh punya sumber kebenaran
   kedua — alasan yang sama dengan D-1.

---

## 9. Ekspor XLSX & PDF — permintaan dependency

Client meminta XLSX **dan** PDF. Kedua format ditempuh dengan jalur berbeda, sengaja:

| Format | Jalur | Dependency baru |
|---|---|---|
| **XLSX** | Dirender backend portal dari baris yang sama dengan yang dikirim ke layar (VS-6) | **`exceljs`** — butuh persetujuan |
| **PDF** | Dirender **Odoo** lewat report QWeb di addon (§6.1), diunduh portal lewat jalur HTTP/session-cookie `OdooClient` yang sudah dibangun CR-033 | **Tidak ada** |

### 9.1 Kenapa PDF lewat Odoo, bukan digambar portal

Portal sudah punya jalur "unduh PDF yang dirender Odoo" yang sudah terbukti di produksi
(`invoiceService.js`, lalu `sale.order` di CR-033) — termasuk penyelesaian atas fakta bahwa Odoo
menolak method render report dipanggil via XML-RPC. Memakainya berarti: nol dependency baru, kop
surat/branding company ikut otomatis (Q-8), dan tata letak PDF dipelihara di tempat yang sama
dengan dokumen resmi lain. Menggambar PDF di portal berarti menambah `pdfkit` (atau, lebih buruk,
Chromium headless) dan memelihara tata letak kedua yang akan berbeda dari dokumen Odoo.

### 9.2 Permintaan dependency: `exceljs`

CLAUDE.md § Dependency mewajibkan izin sebelum menambah dependency. Ini permintaannya, dengan
alternatifnya, supaya keputusannya bisa diambil sekali dan tercatat:

| Opsi | Konsekuensi |
|---|---|
| **`exceljs` (rekomendasi)** | De facto standar, punya streaming writer (penting untuk ekspor ribuan baris tanpa menahan seluruh file di memori), styling header/format tanggal tanpa akal-akalan. Biayanya: ini dependency backend paling besar yang pernah masuk repo ini |
| `xlsx` (SheetJS) dari npm | **Tidak disarankan**: paket npm-nya sudah lama tidak jadi jalur distribusi resmi SheetJS dan versi di sana membawa advisory yang tidak diperbaiki |
| Tulis writer XLSX sendiri | Mungkin (xlsx = zip berisi XML, dan `zlib` sudah built-in Node), tapi ±250 baris kode format Office yang harus dipelihara selamanya demi satu tombol. Tidak sebanding |
| Turunkan ke CSV | Nol dependency, tapi menolak permintaan client yang sudah dijawab eksplisit |

**Frontend tidak butuh dependency apa pun** untuk keduanya: `apiFetchBlob`
(`frontend/src/api/client.js:288`) + `downloadBlob` (`frontend/src/utils/download.js`) sudah
melakukan tepat ini untuk PDF invoice.

### 9.3 Aturan yang mengikat kedua format

- **VS-6**: satu jalur baca, satu validator filter. Ekspor tidak pernah membangun domain sendiri.
- **Cap keras**: maksimum 5.000 baris per ekspor; lebih dari itu → `400` dengan pesan yang
  menyebutkan cara mempersempit filter. Tanpa cap, satu klik "Export" pada filter kosong menahan
  proses backend (yang single-process) selama puluhan detik.
- **Rate limit sendiri** (§15.2): ekspor adalah satu-satunya endpoint fitur ini yang membebani CPU
  backend, bukan hanya Odoo.
- **Nama file deterministik**: `vessel-schedule_<from>_<to>.xlsx` — supaya file yang diunduh
  berulang tidak menumpuk sebagai `(1)`, `(2)` di folder Downloads pelanggan.
- **Audit**: ekspor dicatat lewat `auditService.record` meski ia operasi baca. Alasannya: ia
  memindahkan sekumpulan data keluar dari portal, dan itu yang ingin diketahui saat ada pertanyaan
  kemudian.

---

## 10. Kontrak API

Semua di bawah `authenticate` + `requirePermission`. Tidak satu pun menerima id partner atau
company (VS-1). Id voyage dari URL diparse `parseOdooId` (`src/utils/parseOdooId.js`).

| Method | Path | Permission | Mengembalikan | Fase |
|---|---|---|---|---|
| GET | `/vessel-schedule` | `vessel.view` | Daftar voyage terbit (filter + pagination) | 1 |
| GET | `/vessel-schedule/ports` | `vessel.view` | Daftar pelabuhan untuk dropdown "All Ports" | 1 |
| GET | `/vessel-schedule/:id` | `vessel.view` | Detail voyage + kapal + leg (mockup §B) | 1 |
| GET | `/vessel-schedule/calendar` | `vessel.view` | Voyage dalam rentang, tanpa pagination, ber-cap (mockup §C) | 2 |
| GET | `/vessel-schedule/export` | `vessel.export` | File `xlsx` atau `pdf` (§9) | 3 |
| GET | `/vessel-schedule/:id/my-cargo` | `vessel.view` | Booking/kontainer **milik caller** pada voyage ini (D-6, VS-2) | 3 |
| POST | `/vessel-schedule/:id/watch` | `vessel.view` | Menandai voyage untuk notifikasi (§7, §13) | 4 |
| DELETE | `/vessel-schedule/:id/watch` | `vessel.view` | Melepas tanda | 4 |

**Urutan route wajib**: segmen literal (`/ports`, `/calendar`, `/export`) didaftarkan **sebelum**
`/:id` — kalau tidak, Express mencocokkannya sebagai `:id` dan `parseOdooId` gagal. Ini persis
catatan yang sudah ada di `src/routes/equipment.routes.js:9`.

**Query `GET /vessel-schedule`** (semua opsional, divalidasi Zod):
`q` (cocok ke nama kapal / voyage_no / IMO, `ilike`), `pol`, `pod` (id pelabuhan),
`status` (enum `state`), `from`, `to` (tanggal ETD), `page`, `limit` (default 20, maks 100),
`sort` (enum kolom yang diizinkan — **bukan** string bebas yang diteruskan ke `order` Odoo).

Contoh respons `GET /vessel-schedule`:

```json
{
  "data": [
    {
      "id": 1841,
      "voyage_no": "037N",
      "vessel": { "id": 22, "name": "SINAR BAHARI", "imo_number": "9323456" },
      "service_type": "direct",
      "pol": { "id": 4, "code": "SGSIN", "name": "Singapore", "tz": "Asia/Singapore" },
      "pod": { "id": 7, "code": "IDJKT", "name": "Jakarta", "tz": "Asia/Jakarta" },
      "etd": "2026-09-12T02:00:00Z",
      "eta": "2026-09-15T01:00:00Z",
      "atd": null,
      "ata": null,
      "state": "scheduled",
      "updated_at": "2026-09-09T04:11:07Z"
    }
  ],
  "meta": { "page": 1, "limit": 20, "total": 5 }
}
```

Dua hal yang disengaja pada bentuk respons ini:

- **Waktu selalu ISO-8601 UTC, dan `tz` pelabuhan ikut dikirim** (D-4). API tidak pernah mengirim
  jam yang sudah diformat; frontend yang memformat ke waktu lokal pelabuhan berlabel `LT`.
- **`updated_at` bukan hiasan** (§8 poin 2). Ia wajib sampai ke UI.

Error mengikuti `errorHandler`: `{ error: { code, message } }`. Voyage yang tidak terbit atau milik
company lain → `404 not_found`, tidak pernah `403` (keberadaannya tidak boleh bisa diprobing).
Addon belum terpasang → `503 feature_unavailable` (VS-4).

`api/openapi.yaml` **wajib** diperbarui untuk setiap endpoint di atas (konvensi repo).

---

## 11. File manifest backend

Mengikuti layering `routes → controllers → services → integrations`. Tidak ada lapisan yang
dilompati.

| File | Baru/Ubah | Isi |
|---|---|---|
| `src/integrations/odoo/OdooVesselScheduleService.js` | **Baru** | `baseDomain(companyId)` (D-2, wajib berkomentar menyebut D-2 + preseden `listProducts`), `listVoyages`, `countVoyages`, `getVoyage` (+ leg), `listPorts` |
| `src/services/vesselScheduleService.js` | **Baru** | `(userId, currentCompanyId, filters)`; `resolveOdooContext(..., { feature: 'vesselSchedule' })`; komposisi list/detail/kalender; **satu-satunya** pemilik fungsi yang dipakai ekspor (VS-6) |
| `src/services/vesselScheduleExport.js` | **Baru** (Fase 3) | XLSX via `exceljs`; PDF mendelegasikan ke jalur report Odoo (§9) |
| `src/services/vesselScheduleRateLimiter.js` | **Baru** | Dua bucket: pencarian & ekspor (§15.2), pola `equipmentRateLimiter.js` |
| `src/controllers/vesselScheduleController.js` | **Baru** | `asyncHandler`, parse Zod, `auditService.record` untuk ekspor & watch |
| `src/validators/vesselScheduleValidators.js` | **Baru** | `listQuerySchema` (termasuk enum `sort`), `calendarQuerySchema` (cap rentang), `exportQuerySchema` |
| `src/routes/vesselSchedule.routes.js` | **Baru** | `authenticate` + `requirePermission`; literal sebelum `/:id` |
| `src/routes/index.js` | Ubah | Daftarkan `/vessel-schedule` |
| `src/services/odooCapabilityService.js` | Ubah | Satu baris `FEATURES.vesselSchedule` (§6.3) |
| `src/repositories/vesselWatchlistRepository.js` | **Baru** (Fase 4) | `pool.query` berparameter, scope `portal_user_id` + `odoo_connection_id` |
| `src/services/notificationService.js` | Ubah (Fase 4) | Cabang watchlist di `checkForUpdates` (§13) |
| `database/migrations/0017_vessel_watchlist.sql` | **Baru** (Fase 4) | §7 |
| `database/seeds/0019_vessel_schedule_permissions.sql` | **Baru** | §14 |
| `scripts/check-vessel-schedule-capability.js` | **Baru** | Probe model + field addon (§16) |
| `scripts/check-vessel-export.js` | **Baru** (Fase 3) | Verifikasi XLSX yang dihasilkan (§16) |
| `api/openapi.yaml` | Ubah | §10 |

Yang **tidak** boleh terjadi: `vesselScheduleService` me-`require` `OdooClient` langsung, controller
memanggil repository langsung, ekspor membangun domain-nya sendiri (VS-6), atau kode asisten
me-`require` `integrations/odoo/*`.

---

## 12. Permukaan frontend

| File | Baru/Ubah | Isi |
|---|---|---|
| `frontend/src/api/vesselSchedule.js` | **Baru** | Modul tipis di atas `apiFetch`/`apiFetchBlob` dari `client.js` |
| `frontend/src/pages/VesselSchedulePage.jsx` | **Baru** | Mockup §A: search + filter (ports/status/rentang tanggal) + tabel + pagination + toggle List/Week/Month |
| `frontend/src/components/VesselScheduleCalendar.jsx` | **Baru** (Fase 2) | Mockup §C: grid CSS, bar ETD→ETA per voyage, navigasi minggu/bulan |
| `frontend/src/components/VoyageDetailPanel.jsx` | **Baru** | Mockup §B: tab Overview/Schedule/Route (+ Cargo/Documents di Fase 3), mengikuti pola `TicketDetailPanel.jsx` |
| `frontend/src/utils/portTime.js` | **Baru** | Format waktu lokal pelabuhan + label `LT` (D-4), `Intl.DateTimeFormat` built-in |
| `frontend/src/App.jsx` | Ubah | Rute `/vessel-schedule`, `/vessel-schedule/:id` |
| `frontend/src/components/AppShell.jsx` | Ubah | Item nav + `feature: 'vesselSchedule'` |
| `frontend/src/styles/index.css` | Ubah | Kelas kalender/bar; token yang ada saja |

**Penempatan navigasi**: masuk grup **Delivery** yang sudah ada, di sebelah Shipment Tracking —
bukan menu top-level. Sidebar flat pada mockup adalah gaya mockup, bukan requirement; `AppShell`
portal ini bergrup dan pelanggan mencari jadwal kapal di tempat yang sama dengan ia mencari
kirimannya. Item nav **wajib** membawa `feature: 'vesselSchedule'` supaya menu hilang sendiri kalau
addon belum terpasang (pola yang sudah dipakai `feature: 'equipment'` di `AppShell.jsx:65`).

**Kalender (mockup §C)** adalah bagian termahal di frontend dan tidak boleh menarik dependency:
tidak ada library kalender/Gantt di `frontend/package.json`, dan menambahnya butuh izin. Digambar
dengan CSS grid — satu kolom per hari, satu baris per voyage, bar dari ETD ke ETA dengan
`grid-column: span`. Batas yang harus disepakati sejak awal: **maksimum 62 hari** per permintaan
(§15.1), dan tampilan Month meringkas ke bar per voyage tanpa jam.

**Styling**: pakai token yang ada (`--color-primary`, `--radius-*`, `--shadow-*`, `--s-*`). Badge
status memakai token semantik yang sudah dipakai badge lain, bukan warna hardcoded — supaya dark
mode dan tema brand ikut benar. Setelah menyentuh `index.css`, jalankan
`node scripts/check-css-vendor-prefixes.js` (BUG-39: `backdrop-filter` dan `user-select` wajib
berpasangan dengan padanan `-webkit-`-nya karena tidak ada autoprefixer di build ini).

**Catatan i18n**: frontend belum punya i18n (batasan diketahui di CLAUDE.md) dan mockup pun
berbahasa Inggris. String baru ditulis English hardcoded seperti halaman lain — jangan
memperkenalkan i18next diam-diam untuk satu fitur. Kalau client menginginkan UI berbahasa
Indonesia, itu pekerjaan tersendiri yang mencakup seluruh portal, bukan bagian dari CR ini.

**Kalau prototipe mock dipakai untuk demo sebelum addon siap** (Fase 0-P, §17): halaman itu
**wajib** membawa label "Sample data" yang terlihat. Prototipe Shipment Tracking yang sudah ada
tidak punya label itu dan tetap tampil di nav — jangan mengulanginya. Pelanggan tidak bisa
membedakan mock dari data sungguhan, dan jadwal palsu yang terlihat asli adalah bentuk kerusakan
kepercayaan yang paling mahal di fitur ini.

---

## 13. Notifikasi perubahan jadwal

Attachment menandai fitur ini **opsional**; dokumen ini menempatkannya di Fase 4 karena ia
bergantung pada dua hal yang belum ada.

**Masalah yang harus dipecahkan lebih dulu: fan-out.** Perubahan ETA adalah satu peristiwa global,
sedangkan tabel notifikasi portal ber-`portal_user_id` — tidak ada mekanisme broadcast. Mengirim
setiap perubahan ke semua pemegang akun akan mengubah bel notifikasi menjadi kebisingan dalam satu
minggu, dan pelanggan berhenti membacanya (termasuk untuk notifikasi lain yang penting).

**Jalur yang dipilih: opt-in per voyage.** Pelanggan menandai voyage yang ia pantau
(`POST /vessel-schedule/:id/watch` → tabel §7). `notificationService.checkForUpdates` mendapat satu
cabang tambahan: untuk voyage yang di-watch user ini, baca `freight.voyage` yang
`write_date > last_polled_at`, lalu `notify()` per perubahan.

Tiga hal yang membuat cabang ini murah dan jujur:

1. **Bounded, bukan timer global.** Ia menumpang poll yang sudah ada (throttle 30 detik per
   user+koneksi lewat `identity_mappings.last_polled_at`) dan domainnya dibatasi
   `['id', 'in', watchedIds]` — satu panggilan XML-RPC tambahan, dan hanya untuk user yang
   benar-benar membuka portal dan benar-benar punya watchlist.
2. **Isi notifikasi butuh nilai lama.** "ETA berubah" tanpa angka tidak menolong. Itulah alasan
   `mail.thread` + `tracking=True` masuk ke deliverable addon (§6.1): nilai sebelum/sesudah dibaca
   dari `mail.tracking.value`, bukan dari salinan lokal (VS-3 tetap berlaku).
3. **Tidak ada janji push.** Kalau nanti dibutuhkan latensi lebih rendah, jalurnya adalah webhook
   Odoo baru — dan itu pekerjaan tersendiri: webhook yang ada hari ini hanya melayani provisioning
   user (`src/routes/odooWebhooks.routes.js:9`), bukan event perubahan data.

---

## 14. Permission & seed

Dua kode baru. Ikuti pola seed yang sudah ada (`INSERT INTO portal_permissions`, lalu join ke
`portal_role_permissions` berdasarkan nama role). Jangan mengarang kode lain tanpa seed-nya
(aturan #3 CLAUDE.md).

```sql
-- database/seeds/0019_vessel_schedule_permissions.sql
--
-- vessel.view diberikan ke keempat role pelanggan. Jadwal kapal adalah data referensi yang
-- terbuka untuk semua pemegang akun (keputusan client 2026-09-10, lihat D-2 di
-- Docs/CR/customer_portal_vessel_schedule.md) -- Procurement merencanakan pengiriman, Finance
-- memverifikasi tanggal untuk dokumen, Viewer memantau.
--
-- vessel.export dipisahkan dan TIDAK diberikan ke Viewer, dengan alasan yang berbeda dari
-- rma.create/warranty.create: bukan karena konsekuensi komersial, melainkan karena ekspor adalah
-- satu-satunya endpoint fitur ini yang merender file di backend (CPU portal, bukan cuma panggilan
-- Odoo) dan satu-satunya yang memindahkan sekumpulan data keluar dari portal. Memisahkannya
-- memberi admin tuas untuk mematikan ekspor tanpa mematikan fiturnya.

INSERT INTO portal_permissions (code, description) VALUES
  ('vessel.view',   'Melihat jadwal kapal (vessel schedule) dan detail voyage'),
  ('vessel.export', 'Mengunduh jadwal kapal sebagai XLSX/PDF');

INSERT INTO portal_role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM portal_roles r, portal_permissions p
WHERE p.code = 'vessel.view'
  AND r.name IN ('Customer Admin', 'Finance', 'Procurement', 'Viewer');

INSERT INTO portal_role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM portal_roles r, portal_permissions p
WHERE p.code = 'vessel.export'
  AND r.name IN ('Customer Admin', 'Finance', 'Procurement');
```

---

## 15. NFR: budget panggilan Odoo, rate limit, degradasi

### 15.1 Budget panggilan XML-RPC

Setiap panggilan Odoo adalah satu round-trip. Nama pelabuhan dan kapal datang gratis sebagai
display name many2one di `search_read` — **jangan** mengambilnya dengan panggilan terpisah per baris.

| Endpoint | Budget | Cara |
|---|---|---|
| `GET /vessel-schedule` | **2** | `search_count` (total untuk pagination) + `search_read` |
| `GET /vessel-schedule/ports` | **1** | `search_read` `freight.port`, di-cache proses 10 menit (master data yang nyaris tidak berubah) |
| `GET /vessel-schedule/:id` | **2** | voyage (1) + `leg` via `['voyage_id','in',[id]]` (1) |
| `GET /vessel-schedule/calendar` | **1** | satu `search_read` ber-cap; tidak ada `search_count` karena tidak ada pagination |
| `GET /vessel-schedule/:id/my-cargo` | **2** | booking partner-locked (1) + baris/kontainer (1) |
| `GET /vessel-schedule/export?format=xlsx` | **2** | sama dengan list, tanpa pagination, cap 5.000 baris |
| `GET /vessel-schedule/export?format=pdf` | **2** | daftar id ber-scope (1) + render report lewat jalur HTTP CR-033 (1) |

**Cap yang wajib ada**, karena keduanya adalah cara paling mudah satu klik menjatuhkan backend
single-process ini: rentang tanggal kalender **maksimum 62 hari**, dan ekspor **maksimum 5.000
baris**. Keduanya divalidasi di Zod (§11), bukan di service — supaya ditolak sebelum menyentuh Odoo.

**Aturan**: penyusunan bar kalender dan pengelompokan per kapal dilakukan **di JavaScript** setelah
satu pengambilan batch, bukan lewat panggilan per hari atau per kapal. Pola yang sama sudah dipakai
`productService.getReorderSuggestions`.

### 15.2 Rate limiting

Belum ada rate limiting umum (batasan diketahui, `system.md §17`), jadi fitur ini **wajib membawa
pembatasnya sendiri** — `src/services/vesselScheduleRateLimiter.js`, pola `equipmentRateLimiter.js`
(burst in-memory per user, `429 rate_limited` + `Retry-After` dalam pesan):

| Bucket | Batas | Alasan |
|---|---|---|
| Pencarian/list/kalender | 30 / menit / user | Mockup §A dan §C mengundang klik cepat (ganti minggu, ganti filter); ini masih longgar untuk pemakaian manusia |
| Ekspor | 5 / menit / user | Satu-satunya endpoint yang membebani CPU backend (§9) |

Catat juga di komentar file: bucket in-memory berarti batasnya per-proses dan tidak akurat bila
backend diskalakan multi-instance (sama seperti tiga pembatas yang sudah ada).

### 15.3 Degradasi

| Kondisi | Perilaku |
|---|---|
| Addon `freight_schedule` belum terpasang | `503 feature_unavailable` dengan pesan jelas; item nav disembunyikan lewat `GET /capabilities` (VS-4) |
| Addon terpasang tapi versi lama (tanpa `is_published`) | Ditolak gerbang kapabilitas yang sama — **bukan** fault "Invalid field" ke pelanggan, dan **bukan** menerbitkan draft |
| Belum ada voyage terbit untuk company ini | Daftar kosong + empty state yang menyebutkan filter aktif — **bukan** error |
| `freight.port.tz` kosong pada sebuah pelabuhan | Jam ditampilkan UTC dengan label `UTC` yang jujur, bukan diam-diam dianggap waktu lokal (D-4) |
| Ekspor melampaui cap | `400` dengan pesan cara mempersempit filter, bukan timeout |
| Odoo tidak terjangkau | `503 odoo_connection_unavailable` yang sudah ada (CR-045) |

Prinsipnya sama dengan `OdooDeliveryService.getCarrierTrackingRef`: kapabilitas yang hilang berarti
kehilangan satu informasi, tidak pernah berarti listing yang rusak.

---

## 16. Verifikasi

Mengikuti konvensi repo (`node scripts/*.js`, exit code non-zero saat gagal — belum ada test
runner).

**1. Capability probe (VS-4) — jalankan sebelum menulis kode portal apa pun:**

```bash
node scripts/check-vessel-schedule-capability.js --connection=<odoo_connections.id>
```

Membaca `ir.model` + `ir.model.fields` untuk `freight.vessel`, `freight.voyage`,
`freight.voyage.leg`, `freight.port`; membandingkan dengan daftar field §5/§6; mencetak yang hilang
lalu keluar non-zero. Wajib juga memverifikasi tiga hal yang tidak terlihat dari daftar field:
`is_published` benar-benar ada (D-3), `freight.port.tz` terisi untuk semua pelabuhan yang dipakai
voyage terbit (D-4), dan `operator_id` bertipe `res.partner` **tanpa** dipakai di domain mana pun
(§6.2). Pola skripnya mengikuti `scripts/check-equipment-capability.js`.

**2. Verifikasi ekspor (Fase 3):**

```bash
node scripts/check-vessel-export.js
```

Merender XLSX dari baris fixture, lalu memeriksa file hasilnya: zip valid, jumlah baris sama dengan
jumlah fixture, header sesuai kolom mockup §A, dan sel tanggal bertipe tanggal (bukan string).
Skrip ini juga menegakkan VS-6 secara statis: ekspor tidak boleh menyebut `searchRead` sendiri —
satu-satunya jalannya lewat fungsi list `vesselScheduleService`.

**3. Prefiks vendor CSS (setelah menyentuh `index.css`):**

```bash
node scripts/check-css-vendor-prefixes.js
```

**4. Invarian asisten** — hanya kalau tool baca asisten ditambahkan (Fase 5); skrip yang ada
otomatis mencakupnya:

```bash
node scripts/check-assistant-invariants.js
```

**Verifikasi manual yang tidak bisa diskripkan, dan wajib dilakukan**: buka dua akun pelanggan
berbeda pada company yang sama → keduanya melihat **jadwal yang sama** (D-2 terbukti); lalu buka tab
Cargo pada voyage yang sama → masing-masing hanya melihat booking-nya sendiri (VS-2 terbukti). Dua
pemeriksaan ini adalah inti keamanan fitur ini dan keduanya justru menguji hal yang berlawanan.

---

## 17. Roadmap fase & acceptance criteria

Satu fase = satu branch = satu PR. Jangan menggabung fase.

### Fase 0 — Addon Odoo + kelayakan (blocking)

Tanpa fase ini, seluruh sisa dokumen ini adalah asumsi. **Pekerjaan utamanya di repo Odoo, bukan
di repo portal.**

- Bangun addon `freight_schedule` sesuai §6.1; deploy ke Odoo target; konfirmasi A-1, A-2.
- Isi data contoh: minimal 20 voyage terbit lintas 6 pelabuhan, termasuk **satu** voyage
  transshipment (leg > 2) dan **satu** cancelled — dua kasus yang paling sering bikin UI pecah.
- Jalankan `scripts/check-vessel-schedule-capability.js`; harus hijau.
- Jawab Q-1 dan Q-4 (keduanya memblokir go-live, dan Q-4 harus dijawab sebelum data diisi massal).

**Acceptance**: capability probe hijau + 20 voyage contoh terbaca lewat `search_read` dari user
integrasi portal + Q-1/Q-4 terjawab tertulis.
**Gate**: kalau A-1 ternyata salah (addon tidak bisa di-deploy), **stop**. Jangan berpindah ke
Studio tanpa merevisi §5–§6 lebih dulu: hierarki voyage → leg dan report QWeb tidak bisa dibuat
lewat Studio, jadi rancangannya harus berubah, bukan ditambal.

### Fase 0-P (opsional, paralel) — Prototipe mock untuk demo client

Hanya kalau client butuh melihat sesuatu sebelum addon siap. Meniru pola
`prompt-shipment-tracking-interactive-prototype_1.md`: mock in-memory, tanpa backend.

**Acceptance**: halaman membawa label "Sample data" yang terlihat di layar (§12), dan tidak
mengklaim integrasi Odoo apa pun. **Dihapus atau digantikan** saat Fase 1 mendarat — jangan
tinggalkan dua halaman jadwal di nav.

### Fase 1 — List + filter + detail (mockup §A dan §B)

`OdooVesselScheduleService`, `vesselScheduleService`, controller + validator + routes, baris
`FEATURES`, `vesselScheduleRateLimiter`, seed permission `0019`, `VesselSchedulePage`,
`VoyageDetailPanel`, `portTime.js`, nav, OpenAPI.

**Acceptance**:
- Dua akun pelanggan berbeda di company yang sama melihat jadwal yang sama (D-2 terbukti).
- Voyage `is_published = false` **tidak** pernah tampil, diuji dengan satu voyage draft yang
  sengaja dibuat (D-3).
- Voyage company lain → `404`, diverifikasi manual dengan dua company.
- ETD/ETA tampil dalam waktu lokal pelabuhan berlabel `LT`, diverifikasi pada satu voyage yang POL
  dan POD-nya beda timezone (D-4).
- `GET /vessel-schedule` ≤ 2 panggilan Odoo, **diukur**, bukan diperkirakan.
- Addon dimatikan → `503 feature_unavailable` + menu hilang, bukan halaman rusak.
- `api/openapi.yaml` diperbarui.

### Fase 2 — Tampilan kalender (mockup §C)

`GET /vessel-schedule/calendar`, `VesselScheduleCalendar.jsx`, toggle List/Week/Month.

**Acceptance**: rentang > 62 hari → `400` dari validator (bukan dari Odoo); voyage yang melintasi
batas minggu tergambar benar di kedua minggu; satu panggilan Odoo per perpindahan minggu;
`node scripts/check-css-vendor-prefixes.js` lulus.

### Fase 3 — Ekspor XLSX/PDF + tab Cargo & Documents

`vesselScheduleExport.js` (butuh persetujuan `exceljs` — §9.2), report QWeb di addon,
`GET /vessel-schedule/export`, `GET /vessel-schedule/:id/my-cargo`.

**Acceptance**:
- File hasil ekspor berisi **persis** baris yang tampil di layar untuk filter yang sama, diuji
  dengan tiga kombinasi filter (VS-6).
- Ekspor > 5.000 baris → `400`, bukan timeout.
- Tab Cargo pada satu voyage yang sama, dua akun berbeda → masing-masing hanya melihat miliknya
  sendiri (VS-2 terbukti).
- Ekspor tercatat di audit log.
- `node scripts/check-vessel-export.js` lulus.

### Fase 4 — Watchlist + notifikasi perubahan jadwal

Migrasi `0017`, `POST`/`DELETE /vessel-schedule/:id/watch`, cabang watchlist di
`notificationService.checkForUpdates` (§13).

**Acceptance**: mengubah ETA sebuah voyage yang di-watch di Odoo → notifikasi muncul ≤ 60 detik
dengan **nilai lama dan nilai baru**; voyage yang tidak di-watch tidak menghasilkan notifikasi;
poll tambahan tetap satu panggilan XML-RPC.

### Fase 5 (opsional) — Tool baca asisten

Dua tool (`search_vessel_schedule`, `get_voyage_detail`) di
`src/services/assistant/tools/vesselSchedule.js`, permission `vessel.view`. Tunduk pada invarian
asisten yang sudah ada: tidak ada argumen identitas (I-1), hanya memanggil `vesselScheduleService`
(I-2), wajib punya `summarize`, dan ingat `redact` berjalan **sebelum** `summarize`.

**Acceptance**: `node scripts/check-assistant-invariants.js` lulus; tanpa hasil tool, jawaban tidak
memuat angka/tanggal (I-3).

---

## 18. Risiko & mitigasi

| ID | Risiko | Dampak | Prob. | Mitigasi |
|---|---|---|---|---|
| **R-1** | Jadwal tidak dipelihara setelah go-live | Fitur menampilkan jadwal salah ke semua pelanggan sekaligus — lebih buruk daripada tidak ada fitur | **Tinggi** | Q-1 dijawab dengan nama jabatan + SLA angka; `updated_at` tampil di setiap baris; view kalender ops jadi deliverable addon (§6.1) |
| **R-2** | Addon tidak bisa di-deploy (A-1 salah) | Seluruh §6 mustahil; Studio tidak bisa menggantikannya | Rendah | Gate Fase 0; preseden `installed_base` sudah ter-deploy di target |
| **R-3** | Jadwal draft ikut terbit | Rencana rotasi kapal bocor ke pasar lewat akun pelanggan | Sedang | D-3 `is_published` default `False` + masuk `FEATURES.fields` + diuji eksplisit di acceptance Fase 1 |
| **R-4** | Salah timezone pada ETD/ETA | Pelanggan datang ke dermaga di jam yang salah; kesalahan tidak terlihat di layar developer | **Tinggi** | D-4; `tz` wajib di `freight.port`; probe §16 memeriksa `tz` terisi; degradasi berlabel `UTC` yang jujur |
| **R-5** | "Real-time" dipahami sebagai push | Ekspektasi tidak terpenuhi meski sistem bekerja sesuai rancangan | Sedang | Q-6 disepakati tertulis (≤ 60 detik); `updated_at` tampil; jangan memakai kata "real-time" di UI |
| **R-6** | Ekspor tanpa filter menahan backend | Portal melambat menyeluruh (proses tunggal) | Sedang | Cap 5.000 baris + bucket ekspor 5/menit (§15) |
| **R-7** | Data pelanggan bocor lewat tab Cargo | Pelanggaran kerahasiaan komersial serius | Rendah | VS-2 + D-6 (endpoint terpisah) + verifikasi manual dua akun (§16) |
| **R-8** | Seseorang "memperbaiki" D-2 menjadi partner-locked | Fitur mati total (semua pelanggan melihat daftar kosong) | Sedang | Komentar wajib di `baseDomain` yang menyebut D-2 + preseden `listProducts`; catatan di `system.md §9` |
| **R-9** | `exceljs` ditolak | Fase 3 XLSX tidak bisa dikerjakan | Sedang | §9.2 memuat alternatifnya; PDF tetap bisa jalan tanpa dependency apa pun |
| **R-10** | Prototipe mock (Fase 0-P) ikut ke produksi tanpa label | Pelanggan mengambil keputusan dari jadwal palsu | Sedang | Label "Sample data" wajib; dihapus saat Fase 1 mendarat; jangan ulangi pola Shipment Tracking |
| **R-11** | Cakupan melebar ke booking/quotation pelayaran | CR ini berubah jadi modul freight forwarding penuh di tengah jalan | Sedang | Batas eksplisit: CR ini **hanya** jadwal + overlay baca. Booking adalah CR tersendiri |

R-1 dan R-4 adalah risiko yang benar-benar menentukan, dan keduanya bukan risiko teknis: yang
pertama soal disiplin operasional, yang kedua soal satuan yang tidak pernah ditulis. Keduanya
dimitigasi dengan menampilkan apa yang sistem tahu dan sejak kapan — bukan dengan kode yang lebih
pintar.

---

## 19. Anti-pattern: jangan lakukan ini

| Jangan | Kenapa |
|---|---|
| Menyimpan jadwal di portal DB "supaya cepat" / "supaya offline" | Melanggar VS-3/D-1. Jadwal basi adalah jadwal salah, dan pelanggan mengambil keputusan logistik dari angka itu |
| Menambahkan `partner_id` ke domain jadwal karena "aturan #2" | Melanggar D-2. Hasilnya daftar kosong untuk semua pelanggan. Baca komentar `baseDomain` sebelum mengubahnya |
| Menempelkan cargo/dokumen pelanggan ke respons voyage | Melanggar D-6/VS-2. Satu respons dengan dua aturan scoping akan kehilangan yang lebih ketat |
| Memakai `operator_id` untuk scoping pelanggan | Itu pelayaran/operator, bukan pemilik. Bertipe partner, jadi kode salahnya berjalan tanpa error (§6.2) |
| Membuat route jadwal tanpa `authenticate` karena "jadwalnya publik" | Melanggar VS-5. Endpoint tanpa auth = tanpa rate limit, tanpa audit, tanpa batas company |
| Membangun query sendiri di jalur ekspor | Melanggar VS-6. Layarnya benar, filenya bocor — dan tidak ada yang menyadarinya |
| Mengirim jam yang sudah diformat dari API | Melanggar D-4. Zona waktu hilang di perjalanan dan tidak bisa dipulihkan di klien |
| Menganggap `eta` sebagai fakta | Ia estimasi yang berubah. Tanpa `updated_at` di sebelahnya, pelanggan tidak bisa menilai kesegarannya (R-1) |
| Menandai `delayed` secara manual | Melanggar D-5. Status manual akan berbohong tepat di hari tersibuk |
| Menerbitkan voyage tanpa `is_published` | Melanggar D-3. Rencana yang belum dikonfirmasi bocor ke pasar |
| Menambah library kalender/Gantt tanpa izin | CLAUDE.md § Dependency. Grid CSS sudah cukup untuk mockup §C |
| Menambah field ke `LIST_FIELDS` tanpa probe | Satu field tidak valid mematikan **seluruh** listing (VS-4/IB-5) |
| Mengambil nama pelabuhan/kapal per baris | Display name many2one sudah ikut di `search_read`. Per baris = ratusan round-trip (§15.1) |
| Membangun kalender dengan satu panggilan per hari | 62 panggilan untuk satu tampilan bulan |
| Membiarkan prototipe mock tanpa label di nav | R-10. Pelanggan tidak bisa membedakannya dari data sungguhan |
| Mengarang kode permission tanpa seed | Melanggar aturan #3 CLAUDE.md |
| Menyebut fitur ini "real-time" di UI | Ia polling ≤ 60 detik (Temuan 3). Kata itu akan diukur oleh orang yang tidak membaca dokumen ini |
