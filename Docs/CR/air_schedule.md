# Implementation Spec — Air Schedule (Airline Cargo Schedule & Booking Console)

- **Status**: Draft rancangan. **Belum ada kode yang ditulis.** Fitur ini disepakati lewat mockup
  interaktif ("Cargo Ops Console", diverifikasi cocok oleh client pada 2026-09-12) dan tiga
  keputusan penentu bentuk dijawab langsung dalam sesi yang sama (lihat §1, tabel "Keputusan
  client"). Lima pertanyaan operasional (§2.4) belum dijawab; Q-1 dan Q-2 memblokir go-live.
- **Prepared as**: Spesifikasi implementasi dari fitur "Airline Schedule" yang diminta client
  (senior business analyst) — **bukan** jadwal penerbangan penumpang, melainkan **jadwal kargo
  udara untuk distribusi barang perusahaan freight forwarder**: staf operasional melihat kapasitas
  tiap penerbangan dan meng-assign booking/kiriman pelanggan ke penerbangan yang sesuai.
- **Date**: 2026-09-12
- **Related documents**:
  - [`system.md`](../../system.md) — arsitektur as-built (§6 keamanan, §7 Odoo layer, §17 batasan)
  - [`customer_portal_vessel_schedule.md`](customer_portal_vessel_schedule.md) — dokumen ini
    meniru strukturnya dan **memperluas addon Odoo yang sama** (`freight_schedule`); D-7 di sana
    secara eksplisit sudah meramalkan Airline Schedule sebagai konsumen berikutnya dari namespace
    `freight.*`. Vessel Schedule juga **belum diimplementasikan** (migrasi/seed yang direncanakan
    di sana belum pernah dibuat) — lihat §1 Temuan 4 untuk konsekuensi koordinasinya.
  - [`customer_portal_odoo18_customer_scoped_access.md`](customer_portal_odoo18_customer_scoped_access.md)
    — model identity yang dipakai *sebagian*: fitur ini adalah kasus pertama di portal yang
    **sengaja tidak** memakai model per-customer itu untuk jalur baca/tulisnya (lihat Temuan 2)
  - [`customer_population_installed_base.md`](customer_population_installed_base.md) — preseden
    "field dari addon Odoo sendiri, bukan Studio", dan preseden dokumentasi pemetaan field per
    environment (`Docs/ops/odoo_studio_installed_base.md`)
- **Current state referenced** (dibaca langsung dari repo, sudah diverifikasi pada 2026-09-12):
  `src/services/odooContext.js` (`resolveOdooContext`, `resolveIdentity`),
  `src/services/odooCapabilityService.js` (`FEATURES`, `assertFeature`),
  `src/services/documentShareService.js` + `src/controllers/documentShareController.js` — **preseden
  langsung** untuk bagaimana peran staf internal bekerja di portal ini (lihat §1 Temuan 2),
  `src/middleware/requirePermission.js`, `src/middleware/requirePlatformAdmin.js`,
  `database/seeds/0008_document_share_permissions.sql` (role `Staff (Internal)`),
  `database/migrations/0001_phase1_foundation.sql` (skema `portal_permissions`, `portal_users`,
  `identity_mappings`), `src/integrations/odoo/OdooPartnerService.js`,
  `src/integrations/odoo/OdooHelpdeskService.js` (`session.create`/`session.write`),
  `src/integrations/odoo/OdooProductService.js` (`baseDomain` tanpa partner),
  `src/services/equipmentRateLimiter.js`, `src/routes/equipment.routes.js` (urutan route literal
  vs `:id`), `frontend/src/pages/DocumentsPage.jsx` (`canShare`, gating berbasis `user.roles`),
  `frontend/src/components/AppShell.jsx` (`PLATFORM_ADMIN_SECTIONS`, gating nav berbasis
  `is_platform_admin`), `database/migrations` & `database/seeds` (nomor file terakhir: migrasi
  `0016`, seed `0018` per 2026-09-12 — **vessel_schedule CR juga merencanakan migrasi `0017`/seed
  `0019`; keduanya belum dieksekusi, jadi nomor final harus dicek ulang saat implementasi, lihat
  catatan di §11 dan §14**).

> **Tujuan dokumen ini**: menjadi satu-satunya acuan implementasi, cukup presisi untuk dikerjakan
> tanpa menebak. Setiap pola kode di bawah diambil dari file yang sudah ada di repo ini — ditandai
> dengan path dan baris bila relevan. Yang **tidak** ada di repo ini (addon Odoo) disebut sebagai
> pekerjaan di luar repo, bukan disembunyikan sebagai detail.

---

## Daftar Isi

1. [Ringkasan eksekutif & temuan yang mengubah rancangan](#1-ringkasan-eksekutif--temuan-yang-mengubah-rancangan)
2. [Analisis requirement](#2-analisis-requirement)
3. [Keputusan desain (D-1 … D-9)](#3-keputusan-desain-d-1--d-9)
4. [Invarian yang tidak boleh dilanggar (AS-1 … AS-7)](#4-invarian-yang-tidak-boleh-dilanggar-as-1--as-7)
5. [Model data konseptual](#5-model-data-konseptual)
6. [Pemetaan fisik ke Odoo — ekstensi addon `freight_schedule`](#6-pemetaan-fisik-ke-odoo--ekstensi-addon-freight_schedule)
7. [Yang tetap tinggal di portal DB](#7-yang-tetap-tinggal-di-portal-db)
8. [Kontrak API](#8-kontrak-api)
9. [File manifest backend](#9-file-manifest-backend)
10. [Permukaan frontend](#10-permukaan-frontend)
11. [Permission & seed](#11-permission--seed)
12. [NFR: budget panggilan Odoo, rate limit, degradasi](#12-nfr-budget-panggilan-odoo-rate-limit-degradasi)
13. [Verifikasi](#13-verifikasi)
14. [Roadmap fase & acceptance criteria](#14-roadmap-fase--acceptance-criteria)
15. [Risiko & mitigasi](#15-risiko--mitigasi)
16. [Anti-pattern: jangan lakukan ini](#16-anti-pattern-jangan-lakukan-ini)

---

## 1. Ringkasan eksekutif & temuan yang mengubah rancangan

Client meminta "Airline Schedule": bukan jadwal penerbangan penumpang, melainkan alat kerja **staf
internal freight forwarder** untuk melihat kapasitas kargo tiap penerbangan dan meng-assign
booking/kiriman pelanggan ke penerbangan yang sesuai (mockup: *Cargo Ops Console* — papan jadwal
penerbangan + panel kapasitas + pool booking belum ter-assign, lihat prototipe interaktif yang
sudah disetujui). Ini **secara struktural berbeda** dari Vessel Schedule sekalipun keduanya sama-sama
"jadwal + Odoo": Vessel Schedule adalah data referensi baca-saja untuk **pelanggan**; Air Schedule
adalah alat kerja tulis untuk **staf**, dan objek yang ditulisnya (booking kargo) **dimiliki**
pelanggan tapi **dikerjakan** staf lintas pelanggan.

### Temuan 1 — Odoo 18 tidak punya konsep maskapai, penerbangan, atau booking kargo udara

Sama seperti Vessel Schedule Temuan 1: baik Community maupun Enterprise tidak punya model ini.
`stock.picking` (dipakai `OdooDeliveryService.js`) adalah jadwal **pengiriman ke pelanggan**, bukan
alokasi kargo ke **penerbangan**. Pekerjaan pertama fitur ini, sama seperti Vessel Schedule, adalah
pekerjaan addon Odoo — §6 menspesifikasikannya, §14 menempatkannya sebagai Fase 0 yang memblokir.

### Temuan 2 — Ini bukan "pelanggan melihat miliknya sendiri"; ini "staf melihat & menulis milik semua pelanggan"

Prinsip inti CLAUDE.md dan seluruh isi
[`customer_portal_odoo18_customer_scoped_access.md`](customer_portal_odoo18_customer_scoped_access.md)
dibangun di atas satu asumsi: **satu portal user = satu identitas customer** (`resolveOdooContext`
mengembalikan tepat satu `odooPartnerId`). Staf yang meng-assign booking PT A dan PT B ke penerbangan
yang sama dalam satu sesi kerja **tidak muat** ke asumsi itu — bukan karena ada bug, tapi karena
memang bukan kasus yang model itu dirancang untuk menjawabnya.

Portal ini **sudah pernah memecahkan masalah yang persis sama**, dan solusinya sudah berjalan:
fitur *Documents* (Option B document sharing, `database/migrations/0009_document_shares.sql`).
Pengirim dokumen adalah **staf internal**, role `Staff (Internal)` (seed
`database/seeds/0008_document_share_permissions.sql`), dan
`src/services/documentShareService.js` (`searchRecipients`, `shareDocument`) memanggil
`resolveOdooContext(userId, currentCompanyId)` persis seperti fitur pelanggan lain — **tapi tidak
pernah membaca `odooPartnerId` dari hasilnya**. Yang dipakai hanya `session` (untuk membuka koneksi
Odoo yang benar) dan `connectionId`. Partner yang dituju (`recipientPartnerId`) datang dari body
request, divalidasi sebagai partner yang benar-benar ada di koneksi itu
(`OdooPartnerService.findByIdViaSession`) — bukan diperlakukan sebagai identitas pemanggil, tapi
sebagai **target** tindakan, sama seperti `:id` di URL tiket atau equipment.

Air Schedule mengikuti pola **persis sama**:

```js
// Pola persis mengikuti documentShareService.shareDocument -- staf internal, bukan pelanggan.
// odooPartnerId dari resolveOdooContext SENGAJA tidak dipakai di sini: tujuan fitur ini justru
// staf melihat & bertindak lintas SEMUA pelanggan pada company yang sama.
const { session, connectionId } = await resolveOdooContext(userId, currentCompanyId, {
  feature: 'airSchedule',
});
```

Ini **bukan** solusi baru yang diciptakan dokumen ini — ini adalah preseden yang sudah dipakai
produksi (Documents), diterapkan ke domain kedua. Konsekuensinya harus ditulis eksplisit di kode
(D-3/D-4, AS-3), karena ini justru kasus yang paling berbahaya untuk "diperbaiki" oleh pembaca
berikutnya yang tidak tahu alasannya: menambahkan `['customer_partner_id', '=', odooPartnerId]` ke
domain booking akan membuat fiturnya *tampak* lebih aman, padahal justru mematikan satu-satunya
alasan fitur ini ada (staf tidak lagi bisa melihat booking pelanggan lain untuk di-assign).

### Temuan 3 — Peran `Staff (Internal)` sudah ada, tapi belum pernah dipakai untuk fitur yang menulis banyak record berbeda

Seed `0008` menjelaskan role ini sebagai *"Internal vendor staff; can share documents to specific
customers"*, dan komentar di `database/seeds/0012_assistant_permissions.sql` mencatat staf
biasanya **tidak** punya `identity_mapping` ke seorang pelanggan (itulah kenapa asisten sengaja
mengecualikan role ini). Tapi `documentShareService` memanggil `resolveOdooContext` yang **mewajibkan**
`identity_mapping` untuk membuka sesi Odoo sama sekali (`resolveIdentity`,
`src/services/odooContext.js:86-90`). Artinya: praktik yang sudah berjalan adalah **staf tetap
diberi satu baris `identity_mappings`** per koneksi yang perlu ia akses — `odoo_partner_id`-nya
boleh menunjuk partner mana saja (mis. partner internal vendor sendiri di Odoo itu), karena nilainya
memang tidak pernah dibaca oleh kode staf-side. Ini **operasional**, bukan kode: provisioning akun
staf baru wajib menyertakan satu baris identity_mapping per company/koneksi yang staf itu tangani,
kalau tidak `resolveOdooContext` akan melempar `403 no_identity_mapping` dan konsolnya tampak rusak.
Ini dicatat sebagai R-4 dan wajib masuk runbook onboarding staf (Q-1).

### Temuan 4 — Addon Odoo dibangun bersama Vessel Schedule, bukan terpisah

D-7 di `customer_portal_vessel_schedule.md` sudah menulis alasannya lebih dulu: *"Prefiks model Odoo
dibuat lebih luas (`freight.*`) karena entitas yang sama akan dipakai Airline Schedule ... berikutnya
— `vessel.*` akan salah nama begitu ada pesawat."* Pada 2026-09-12, migrasi/seed yang direncanakan
dokumen itu **belum ada** di repo (migrasi terakhir `0016`, bukan `0017`) — jadi Vessel Schedule
sendiri juga belum dieksekusi. Dua kemungkinan urutan implementasi, dan dokumen ini menspesifikasikan
untuk keduanya (§6): (a) Air Schedule dikerjakan lebih dulu → addon `freight_schedule` dibuat dari
nol dengan model sisi udara saja, model sisi laut menyusul; atau (b) Vessel Schedule sudah
dieksekusi lebih dulu → Air Schedule **memperluas** addon yang sudah ada, model baru saja, tidak
menyentuh `freight.vessel`/`freight.voyage`/`freight.port`. Yang **tidak boleh** terjadi: dua addon
`freight_schedule` yang berbeda dibangun terpisah lalu bentrok nama modul saat keduanya dideploy ke
Odoo yang sama.

### Keputusan client (2026-09-12)

| Pertanyaan | Jawaban client | Konsekuensi di dokumen ini |
|---|---|---|
| Siapa pengguna utama? | **Staf internal freight forwarder** (bukan pelanggan) | Temuan 2/3, D-3, D-4, AS-3, AS-4 — seluruh model akses berbeda dari fitur lain di portal ini |
| Sumber data jadwal penerbangan? | **Odoo** (modul freight/logistik) | §6 seluruhnya; Fase 0 blocking, sama seperti Vessel Schedule |
| Lingkup fitur? | **Terhubung ke booking/kiriman**, bukan sekadar jadwal referensi | Butuh model baru `freight.cargo.booking` yang bisa ditulis portal (bukan cuma dibaca) — beda kelas risiko dari Vessel Schedule yang murni baca |

### Bentuk akhir

```
                    ODOO (system of record)
  ┌─────────────────────────────────────────────────────────────────┐
  │  addon freight_schedule  (Python, diperluas -- lihat Temuan 4)  │
  │    freight.airline      maskapai kargo                          │
  │    freight.airport      IATA code + timezone                    │
  │    freight.flight       flight_no + rute + ETD/ETA + kapasitas  │
  │    freight.cargo.booking  AWB + customer + berat/volume + flight│
  │    (freight.vessel/voyage/port -- milik CR lain, tidak disentuh)│
  └──────────┬─────────────────────────────────┬────────────────────┘
             │ diisi ops (flight, airline,     │ XML-RPC, terkunci COMPANY untuk flight/airline/airport
             │ airport -- §6); booking         │ dan (SENGAJA) TIDAK terkunci partner untuk booking (D-3)
             │ ditulis dari portal (§6)        ▼
             ▼                          CustPortalWPC — /air-schedule
      OPS / SCHEDULING                  Console STAF (role Staff (Internal) + is_platform_admin)
                                         board penerbangan · kapasitas · assign/unassign booking
                                         TIDAK tampil di nav pelanggan biasa (D-4)
```

Portal DB tidak menyimpan satu baris pun data penerbangan atau booking (§7, prinsip sama VS-3) —
Odoo tetap satu-satunya system of record. Yang membedakan fitur ini dari Vessel Schedule bukan di
mana datanya hidup, tapi **siapa yang boleh menulis ke sana dan lewat identitas macam apa**.

---

## 2. Analisis requirement

### 2.1 Pemetaan fitur mockup → kapabilitas → sumber data

| Prototipe (Cargo Ops Console) | Kapabilitas | Sumber data | Status hari ini |
|---|---|---|---|
| Papan jadwal penerbangan (flight no, carrier, rute, ETD/ETA, status) | List + filter + pagination, company-scoped | `freight.flight` | Data **belum ada** |
| Gauge kapasitas berat & volume per penerbangan | Dihitung dari booking yang `flight_id`-nya menunjuk penerbangan itu | `freight.cargo.booking` (agregasi) | Data **belum ada** |
| Panel detail penerbangan: assigned bookings + pool unassigned | Query booking company-scoped (D-3), TANPA partner lock | `freight.cargo.booking` | Data **belum ada** |
| Assign / Remove booking dari/ke penerbangan | Write `flight_id` pada booking, validasi kapasitas server-side (AS-6) | `freight.cargo.booking.flight_id` | Belum ada |
| + New Booking (intake) | Create booking baru, `customer_partner_id` divalidasi sebagai partner nyata | `freight.cargo.booking` | Belum ada |
| Filter tanggal/status/search | Domain dibangun server-side dari query yang divalidasi Zod | — | Pola siap (`ShipmentTrackingPage.jsx`, `OdooDeliveryService`) |
| Akses hanya staf, tidak tampil di nav pelanggan | Role `Staff (Internal)` + permission baru | `portal_roles`, `portal_permissions` | Role **sudah ada** (seed `0008`); permission baru (§11) |

### 2.2 Glosarium & pemetaan istilah

| Istilah mockup | Arti | Nama di kode |
|---|---|---|
| Flight no (`GA-6512`) | Nomor penerbangan kargo | `freight.flight.flight_no` |
| Carrier | Maskapai kargo | `freight.airline`, `airline_id` |
| Origin / Destination | Bandara asal/tujuan (kode IATA 3 huruf) | `freight.airport.iata_code`, `origin_airport_id`/`dest_airport_id` |
| ETD / ETA | *Estimated* time of departure/arrival | `etd` / `eta` |
| ATD / ATA | *Actual* — terisi setelah kejadian, dasar status `departed`/`arrived` yang jujur (sama alasan D-5 Vessel Schedule) | `atd` / `ata` |
| AWB (Air Waybill) | Nomor dokumen kargo per booking, format `NNN-NNNNNNNN` (3 digit prefiks maskapai + 8 digit serial) | `freight.cargo.booking.awb_number` |
| Booking / Shipment | Satu kiriman kargo milik satu pelanggan, belum tentu sudah ter-assign ke penerbangan | `freight.cargo.booking` |
| Assign | Menghubungkan booking ke satu `freight.flight` | `booking.flight_id = <flight>` |
| Unassigned pool | Booking yang `flight_id` masih kosong | domain `[['flight_id', '=', false]]` |
| Capacity (kg / cbm) | Kapasitas berat & volume penerbangan; dua batas independen (D-6) | `freight.flight.capacity_kg` / `capacity_cbm` |
| Commodity | Jenis barang (mockup: Elektronik, Tekstil, dst.) | `freight.cargo.booking.commodity` |

### 2.3 Yang sudah ada di sistem dan dipakai ulang

| Sudah ada | File | Dipakai untuk |
|---|---|---|
| Pola staf internal + `resolveOdooContext` tanpa memakai `odooPartnerId` | `src/services/documentShareService.js:17-23,28-42` | **Preseden inti** D-3/D-4/AS-3 — bukan pola baru, pola yang sudah dipakai produksi |
| Role `Staff (Internal)` | `database/seeds/0008_document_share_permissions.sql` | Role yang sama dipakai fitur ini (§11), bukan role baru |
| Validasi target id lewat body (bukan identitas) | `documentShareService.shareDocument` — `recipientPartnerId` divalidasi `OdooPartnerService.findByIdViaSession` | Pola persis untuk `customer_partner_id` pada `POST /air-schedule/bookings` (D-5) |
| Pola query company-scoped tanpa partner | `src/integrations/odoo/OdooProductService.js:6` | Preseden untuk `freight.flight`/`airline`/`airport` (D-2) — beda alasan dari booking (D-3), tapi bentuk domain-nya sama |
| Gerbang kapabilitas modul Odoo opsional | `src/services/odooCapabilityService.js` | Baris `FEATURES.airSchedule` (§6.3) |
| Sesi + identitas server-side | `src/services/odooContext.js` | Semua service fitur ini, `feature: 'airSchedule'` |
| Nav bergrup + gating berbasis role/flag | `frontend/src/components/AppShell.jsx` (`PLATFORM_ADMIN_SECTIONS`), `frontend/src/pages/DocumentsPage.jsx` (`canShare`) | Pola gating nav untuk `Staff (Internal)` (§10) |
| Pembatas burst per user | `src/services/equipmentRateLimiter.js` | Pola `airScheduleRateLimiter` (§12.2) |
| `session.create` / `session.write` | `src/integrations/odoo/OdooHelpdeskService.js:64,128` | Pola create booking & assign/unassign (§6) |
| Pola list + filter + panel detail | `frontend/src/pages/ShipmentTrackingPage.jsx` | Referensi UI board (mockup sudah menerapkannya) |

### 2.4 Pertanyaan yang harus dijawab client / tim ops

| ID | Pertanyaan | Kenapa penting | Default kalau tidak dijawab |
|---|---|---|---|
| **Q-1** | Siapa yang membuat akun `Staff (Internal)` untuk tim ops, dan siapa yang bertanggung jawab membuatkan `identity_mapping`-nya per koneksi (Temuan 3)? | Tanpa ini, staf pertama yang login akan mendapat `403 no_identity_mapping` dan konsolnya tampak rusak, bukan tampak "belum di-setup" | Platform admin memprovisioning manual lewat DB/psql sampai ada UI admin khusus; wajib masuk runbook go-live |
| **Q-2** | Satu perusahaan freight forwarder = satu koneksi Odoo, atau staf yang sama menangani beberapa koneksi/company? | Menentukan berapa baris `identity_mappings` per staf dan apakah UI "switch company" yang sudah ada cukup, atau staf perlu pemilih company terpisah dari pelanggan | Satu staf bisa dipetakan ke lebih dari satu koneksi (pola yang sama dengan pelanggan multi-company), pilih company lewat mekanisme switch yang sudah ada |
| **Q-3** | Kapasitas dihitung dari berat aktual saja, atau berat volumetrik (`volumetric = L×W×H(cm) / 6000`) ikut menentukan *chargeable weight* seperti standar IATA kargo udara? | Booking kecil-tapi-ringan-tapi-besar (mis. barang gabus) bisa lolos gauge berat padahal sebenarnya memenuhi kabin | **Default MVP: berat aktual saja** (D-6). Volumetrik dicatat sebagai simplifikasi yang disengaja, bukan diabaikan diam-diam |
| **Q-4** | Kapasitas yang sudah penuh: ditolak keras (`400`), atau staf boleh override dengan alasan? | Operasional nyata kadang butuh overbook toleransi kecil | **Default MVP: ditolak keras** (`400 capacity_exceeded`). Override adalah fase terpisah, bukan tombol tersembunyi |
| **Q-5** | Booking yang batal (`cancelled`) tetap tampil di riwayat, atau dihapus? | Menentukan apakah perlu state `cancelled` + soft handling, atau `unlink` langsung ke Odoo | **Default MVP: state `cancelled`**, tidak pernah `unlink` — konsisten dengan tidak pernah menghapus catatan transaksi Odoo dari portal |

### 2.5 Asumsi yang dipakai dokumen ini

| ID | Asumsi | Kalau salah, yang terdampak |
|---|---|---|
| A-1 | Addon Python bisa dideploy ke Odoo target (sama seperti A-1 Vessel Schedule) | §6 seluruhnya. Preseden: `installed_base` sudah ter-deploy di target |
| A-2 | Plan Odoo = **Custom** (XML-RPC aktif) | Batasan diketahui CLAUDE.md; dikonfirmasi ulang Fase 0 |
| A-3 | Satu booking = satu AWB = satu kiriman fisik (tidak dipecah/digabung lintas penerbangan otomatis) | Model §5; kalau ternyata satu kiriman bisa dipecah ke beberapa penerbangan (split shipment), butuh entitas tambahan "leg" yang sengaja **tidak** dibangun di MVP ini (D-7) |
| A-4 | `Staff (Internal)` yang memakai fitur ini jumlahnya kecil (belasan, bukan ratusan) sehingga provisioning manual `identity_mapping` (Temuan 3, Q-1) masih wajar untuk MVP | Kalau jumlah staf besar, Q-1 butuh UI admin khusus, bukan langkah manual — jadikan Fase tersendiri |
| A-5 | Penerbangan kargo yang relevan untuk satu company ≤ beberapa ratus baris aktif | Cap dan pagination §12.1; kalau jauh lebih besar, board butuh agregasi server-side |

---

## 3. Keputusan desain (D-1 … D-9)

### D-1 · Data hidup di Odoo, memperluas addon `freight_schedule` yang sama dengan Vessel Schedule

**Keputusan**: model baru (`freight.airline`, `freight.airport`, `freight.flight`,
`freight.cargo.booking`) ditambahkan ke addon Python `freight_schedule` (Temuan 4). Portal
membacanya lewat XML-RPC dan **menulis** ke `freight.cargo.booking` lewat XML-RPC juga (`create`/
`write`) — ini satu-satunya bagian dokumen ini yang portal menulis data non-portal-DB ke Odoo di
luar pola "draft asisten" yang sudah ada.

**Alasan**: sama dengan D-1 Vessel Schedule — data operasional dipakai lebih luas dari portal
(invoicing, dokumentasi kargo, laporan ops), jadi harus tetap satu sumber kebenaran di Odoo.

### D-2 · `freight.airline`/`freight.airport`/`freight.flight` adalah data referensi: terkunci company, tidak terkunci partner

**Keputusan**: sama persis dengan D-2 Vessel Schedule — `baseDomain(companyId)` memaksa
`company_id` (termasuk `company_id = false`), tanpa `partner_id`. **Tidak** memakai `is_published`
seperti Vessel Schedule (lihat catatan di bawah).

```js
// Pola persis mengikuti OdooProductService.listProducts DAN baseDomain di
// OdooVesselScheduleService (rancangan) -- data referensi company-scoped tanpa partner.
function baseDomain(companyId) {
  return [
    '|',
    ['company_id', '=', false],
    ['company_id', '=', companyId],
  ];
}
```

**Kenapa tanpa `is_published`**: `is_published` di Vessel Schedule ada karena jadwal itu tampil ke
**pelanggan**, dan draft yang bocor ke pelanggan adalah kebocoran komersial (D-3 Vessel Schedule).
Air Schedule di MVP ini **hanya** tampil ke staf internal perencana — staf justru butuh melihat
*semua* penerbangan termasuk yang belum final untuk merencanakan alokasi. Kalau kelak fitur ini
melebar ke tampilan pelanggan ("kiriman saya dijadwalkan naik penerbangan apa"), `is_published`
**wajib** ditambahkan saat itu, sebelum endpoint pelanggan dibuka — dicatat sebagai keterbatasan
sadar, bukan celah yang terlewat (lihat AS-4).

### D-3 · `freight.cargo.booking`: dimiliki pelanggan (`customer_partner_id`), tapi query staf SENGAJA company-scoped, bukan partner-scoped

**Keputusan**: domain booking untuk seluruh endpoint staf hanya memaksa `company_id`. Field
`customer_partner_id` **ada** di model (kepemilikan harus tercatat untuk pelaporan, invoicing, dan
supaya suatu hari fitur baca pelanggan bisa dibangun di endpoint terpisah — D-7 Vessel Schedule),
tapi **tidak pernah** masuk domain query di jalur staf.

```js
// !! JANGAN menambahkan ['customer_partner_id', '=', odooPartnerId] di sini. Ini BUKAN pelanggaran
// aturan #2 CLAUDE.md yang terlewat -- ini keputusan sadar (D-3, Docs/CR/air_schedule.md). Fitur
// ini ADALAH staf melihat & meng-assign booking LINTAS SEMUA pelanggan pada company yang sama.
// Preseden: documentShareService.shareDocument juga tidak memakai odooPartnerId dari
// resolveOdooContext untuk pemanggil (staf); partner yang relevan datang sebagai target dari body,
// divalidasi, bukan dipakai untuk menyaring hasil.
function baseDomain(companyId) {
  return [['company_id', '=', companyId]];
}
```

**Alasan**: Temuan 2. Ini adalah keputusan yang paling mudah "diperbaiki" oleh pembaca berikutnya
yang tidak membaca dokumen ini, dan paling parah kalau diperbaiki — matinya fitur secara total
(daftar kosong untuk staf, sama seperti R-8 Vessel Schedule tapi arah kebalikannya: di situ resiko
adalah *menambahkan* partner lock pada data referensi; di sini resikonya juga *menambahkan* partner
lock, tapi pada data yang sekilas terlihat seperti "harus" partner-locked karena punya `partner_id`
sungguhan). Komentar di atas **wajib** ada persis di `baseDomain` implementasinya.

### D-4 · Identitas staf: role `Staff (Internal)` + `resolveOdooContext` dengan `odooPartnerId` diabaikan

**Keputusan**: tidak ada fungsi baru `resolveOdooStaffContext`. Air Schedule memakai
`resolveOdooContext(userId, currentCompanyId, { feature: 'airSchedule' })` yang **sama persis**
dipakai fitur pelanggan lain — satu-satunya perbedaan adalah service Air Schedule tidak pernah
membaca `odooPartnerId` dari hasilnya (Temuan 2). Akses digerbangi di lapisan permission
(`requirePermission('air_schedule.view'|'air_schedule.manage')`, §11), yang hanya diberikan ke
role `Staff (Internal)` (bukan role pelanggan mana pun) plus bypass `is_platform_admin` bawaan.

**Alasan**: memakai ulang mekanisme yang sudah terbukti (`resolveOdooContext`) berarti tidak ada
lapisan otorisasi baru yang perlu dipelihara, diuji, dan bisa salah dengan cara baru. Satu-satunya
hal yang harus benar-benar disiplin adalah *tidak membaca* `odooPartnerId` — itulah kenapa AS-3
menuntut komentar eksplisit di titik itu juga, bukan hanya di `baseDomain`.

### D-5 · `customer_partner_id` pada `POST /air-schedule/bookings` adalah target, bukan identitas

**Keputusan**: saat staf membuat booking baru, mereka memilih pelanggan lewat pencarian partner
(pola identik `documentShareService.searchRecipients`/`shareDocument`). Id partner yang dipilih
datang dari body request, **divalidasi** sebagai partner nyata di koneksi yang sedang aktif
(`OdooPartnerService.findByIdViaSession` atau `.search`), lalu disimpan sebagai
`customer_partner_id` pada booking.

**Alasan**: ini terlihat seperti melanggar aturan #1 CLAUDE.md ("jangan pernah menambahkan
`partner_id`/`customer_id` yang berasal dari request") — tapi aturan itu soal **identitas pemanggil
untuk menentukan data apa yang boleh ia baca**, bukan soal "boleh tidaknya sebuah endpoint menerima
id partner sama sekali". `:id` tiket, `recipient_partner_id` di document share, dan
`customer_partner_id` di sini adalah **target tindakan** yang dipilih pemanggil, selalu divalidasi
keberadaannya di koneksi yang sama sebelum dipakai — pola yang identik dengan yang sudah berjalan.
Baris komentar di titik validasi ini **wajib** menyebut D-5, supaya pembaca berikutnya tidak
mengira ini pelanggaran dan menghapus validasinya (yang justru menjaganya tetap aman) atau
menganggapnya identitas pemanggil (yang akan salah arah sama sekali).

### D-6 · Kapasitas: berat (kg) dan volume (cbm) sebagai dua batas independen, berat aktual — bukan volumetrik

**Keputusan**: `freight.flight.capacity_kg`/`capacity_cbm` dibandingkan terhadap jumlah
`weight_kg`/`volume_cbm` seluruh booking yang `flight_id`-nya menunjuk penerbangan itu. Tidak ada
perhitungan *chargeable weight* (volumetrik IATA, `L×W×H/6000`) di MVP ini.

**Alasan**: mockup sudah memakai bentuk dua-gauge ini dan sudah disetujui client. Perhitungan
volumetrik butuh dimensi per koli yang belum diminta (Q-3) — menambahkannya sekarang adalah
melebarkan cakupan tanpa diminta (prinsip "jangan mendesain untuk kebutuhan hipotetis"). Batasan
ini **wajib** disebut eksplisit di UI (mis. tooltip pada gauge: "berdasarkan berat aktual") supaya
staf tidak mengira sistem sudah menghitung kargo bulky dengan benar.

### D-7 · Tidak ada entitas "leg"/multi-flight per booking di MVP

**Keputusan**: satu `freight.cargo.booking` hanya bisa menunjuk **satu** `freight.flight`
(`flight_id`, many2one, bukan many2many). Kiriman yang butuh transit/interline direpresentasikan
sebagai **booking terpisah per leg** (staf membuat dua booking berantai), bukan sebagai satu
booking dengan banyak leg seperti `freight.voyage.leg` di Vessel Schedule.

**Alasan**: Vessel Schedule butuh `leg` karena satu voyage kapal secara alami melintasi banyak
pelabuhan berurutan dan pelanggan perlu melihat itu sebagai satu perjalanan. Booking kargo udara,
sebaliknya, lazimnya **memang** dijual/dilacak per leg penerbangan di industri freight forwarding —
menambah entitas leg sekarang berarti membangun struktur yang lebih rumit daripada yang diminta
mockup, untuk kasus (multi-leg) yang belum terkonfirmasi dibutuhkan (A-3). Kalau nanti dibutuhkan,
ini perluasan aditif (`freight.cargo.booking.next_leg_booking_id`, opsional), bukan migrasi ulang.

### D-8 · Status penerbangan dihitung, bukan diketik ulang — sama seperti D-5 Vessel Schedule

**Keputusan**: `freight.flight.state` (`scheduled`, `loading`, `departed`, `delayed`, `cancelled`,
`arrived`) — `delayed` dihitung dari selisih ETD terhadap baseline publikasi pertama;
`departed`/`arrived` mengikuti terisinya `atd`/`ata`. `loading` adalah satu-satunya status yang
tetap diketik manual (menandai "sedang proses muat", tidak ada sinyal otomatis untuk itu di data
yang tersedia).

**Alasan**: sama seperti D-5 Vessel Schedule — status yang seluruhnya manual akan berbohong pada
hari sibuk, justru saat staf paling membutuhkannya akurat.

### D-9 · Penamaan

**Keputusan**: `/air-schedule` di URL portal, `airSchedule`/`cargoBooking` di kode portal; model
Odoo tetap berprefiks `freight.*` (D-1); label UI **"Air Cargo Schedule"** — bukan "Airline
Schedule" polos, supaya tidak diasumsikan sebagai jadwal penerbangan penumpang oleh pembaca kode
berikutnya. Istilah **"flight"**, bukan **"voyage"** — voyage sudah dipakai Vessel Schedule dan
artinya perjalanan kapal, bukan penerbangan.

---

## 4. Invarian yang tidak boleh dilanggar (AS-1 … AS-7)

### AS-1 · Identitas pemanggil tidak pernah dari request; target tindakan boleh, dan selalu divalidasi

`userId`/`currentCompanyId` staf selalu dari `req.user` (aturan #1 CLAUDE.md, tanpa pengecualian).
`flight_id`, `booking_id` (dari URL), dan `customer_partner_id` (dari body, D-5) **boleh** berasal
dari request **karena mereka adalah objek yang ditunjuk, bukan identitas yang menentukan hak baca**
— tapi setiap satu wajib divalidasi ada dan berada di company/koneksi yang sama dengan sesi staf
sebelum dipakai. Tidak ada jalur yang mempercayai id itu begitu saja.

### AS-2 · `freight.airline`/`airport`/`flight` company-scoped, tanpa partner (D-2)

Berlaku untuk seluruh endpoint baca jadwal. Komentar `baseDomain` wajib menyebut D-2 dan preseden
`listProducts`, sama seperti VS-1 di Vessel Schedule.

### AS-3 · `freight.cargo.booking` company-scoped untuk staf, TIDAK partner-locked — dan ini disengaja (D-3/D-4)

Ini invarian paling kritis di dokumen ini. Kedua titik kode berikut **wajib** membawa komentar yang
menyebut D-3/D-4 dan Temuan 2: `baseDomain` booking (D-3) dan titik di service tempat
`resolveOdooContext` dipanggil tapi `odooPartnerId` sengaja tidak didestrukturisasi/dipakai (D-4).
Tanpa dua komentar itu, invarian ini akan terlihat seperti bug oleh siapa pun yang membaca kode
tanpa dokumen ini, dan "perbaikan" atas bug yang tidak ada itu akan mematikan seluruh fitur.

### AS-4 · Kalau pelanggan pernah diberi akses baca ke booking miliknya sendiri, itu endpoint terpisah dengan domain terpisah

Belum diminta (di luar cakupan MVP, §14), tapi dicatat sekarang supaya tidak ada yang menambahkannya
sebagai field ekstra di respons staf. Kalau/ketika dibangun: endpoint baru, memakai
`resolveOdooContext` dengan `odooPartnerId` **ditegakkan** kali ini (`['customer_partner_id', '=',
odooPartnerId]`), fungsi service terpisah dari fungsi staf — pola yang identik D-6/VS-2 Vessel
Schedule (endpoint terpisah, bukan payload yang sama dengan dua aturan scoping).

### AS-5 · Kapabilitas Odoo diverifikasi, tidak diasumsikan

Satu baris `FEATURES.airSchedule` (§6.3, VS-4-setara). Field baru **wajib** lolos
`scripts/check-air-schedule-capability.js` (§13) sebelum masuk daftar field yang dipakai
`search_read` mana pun — satu field tidak valid menggagalkan seluruh panggilan (IB-5/BUG-31).

### AS-6 · Kapasitas divalidasi server-side sebelum tulis, tidak pernah dipercaya dari klien

`POST /air-schedule/bookings/:id/assign` **wajib** membaca ulang kapasitas penerbangan +
total booking ter-assign saat ini dari Odoo, lalu menolak (`400 capacity_exceeded`, Q-4) **sebelum**
memanggil `session.write`. Gauge di frontend (mockup) adalah umpan balik UI, bukan penegakan —
penegakan yang sesungguhnya selalu di backend, sesudah data terbaru dibaca ulang.

### AS-7 · Permission `air_schedule.*` hanya untuk `Staff (Internal)`, tidak pernah untuk role pelanggan

Ini pasangan operasional AS-3: kalau `air_schedule.view`/`air_schedule.manage` pernah diberikan ke
`Customer Admin`/`Finance`/`Procurement`/`Viewer`, AS-3 langsung berarti pelanggan itu bisa melihat
DAN meng-assign booking milik pelanggan lain — pelanggaran kerahasiaan komersial paling serius yang
mungkin terjadi di fitur ini. Seed (§11) hanya boleh menyebut `Staff (Internal)`.

---

## 5. Model data konseptual

```
freight.airline    (maskapai kargo -- nama, kode IATA 2-huruf)
freight.airport    (bandara -- kode IATA 3-huruf + timezone)

freight.flight     (satu penerbangan: flight_no + airline + origin/dest + ETD/ETA + kapasitas)
   ▲  n..1 (flight_id, nullable = unassigned)
   │
freight.cargo.booking  (satu kiriman: AWB + customer_partner_id + berat/volume + commodity)
```

Berbeda dari Vessel Schedule, hierarkinya **datar** (D-7): tidak ada leg, tidak ada "kapal" sebagai
entitas terpisah dari "penerbangan" (satu `freight.flight` sudah representasi lengkap satu
penerbangan bernomor pada satu tanggal — tidak ada konsep "kapal yang sama, banyak voyage" yang
perlu dipisah seperti `freight.vessel` vs `freight.voyage`, karena nomor penerbangan + tanggal sudah
unik secara alami di industri ini).

### Atribut per entitas

**`freight.airline`** — `name`, `iata_code` (2 karakter, unik), `icao_code` (opsional), `active`.

**`freight.airport`** — `name`, `iata_code` (3 karakter, unik), `icao_code` (opsional), `city`,
`country_id` → `res.country`, `tz` (IANA, mis. `Asia/Jakarta`) — disediakan untuk konsistensi lintas
zona waktu staf (§3 D-2 catatan), meski format tampilan "local time" berlabel eksplisit adalah
peningkatan UI opsional di Fase 1, bukan blocking.

**`freight.flight`** — `flight_no`, `airline_id`, `origin_airport_id`, `dest_airport_id`,
`etd`/`eta`/`atd`/`ata` (Datetime, UTC), `state` (D-8), `capacity_kg`, `capacity_cbm`,
`aircraft_type` (char, opsional), `company_id`. Constraint unik `(flight_no, etd_date)` — nomor
penerbangan yang sama terbang di tanggal berbeda adalah baris berbeda.

**`freight.cargo.booking`** — `awb_number` (char, unik, format `NNN-NNNNNNNN`), `customer_partner_id`
→ `res.partner` (**wajib**, bukan nullable — booking tanpa pemilik tidak bermakna), `origin_airport_id`,
`dest_airport_id`, `weight_kg` (float), `volume_cbm` (float), `commodity` (char atau selection),
`flight_id` → `freight.flight` (**nullable** — kosong = pool belum ter-assign), `state`
(`unassigned`, `assigned`, `loaded`, `in_transit`, `delivered`, `cancelled` — Q-5), `notes` (text),
`company_id`, `write_date` (bawaan Odoo, dipakai UI sebagai "last updated" sama seperti §8 poin 2
Vessel Schedule).

---

## 6. Pemetaan fisik ke Odoo — ekstensi addon `freight_schedule`

Addon ini **pekerjaan di luar repo portal**. Dua skenario koordinasi (Temuan 4):

- **Kalau Vessel Schedule belum dieksekusi** (kondisi hari ini): addon `freight_schedule` dibangun
  dari nol dengan **hanya** empat model §5 di atas. Model sisi laut (`freight.vessel`, dst.)
  ditambahkan nanti oleh CR itu sendiri, tanpa mengubah model yang dibangun di sini.
- **Kalau Vessel Schedule sudah dieksekusi lebih dulu**: addon sudah ada; tambahkan empat model di
  atas ke dalamnya. **Jangan** mengubah `freight.vessel`/`freight.voyage`/`freight.voyage.leg`/
  `freight.port` yang sudah ada — hanya menambah, tidak pernah mengedit skema CR lain.

### 6.1 Yang harus dideliver addon

| Deliverable | Kenapa portal membutuhkannya |
|---|---|
| Empat model §5 + constraint unik (`iata_code` per airline/airport, `(flight_no, etd_date)`, `awb_number`) | Identitas stabil; portal memakai id Odoo sebagai id API |
| `state` compute untuk `delayed` di `freight.flight` (D-8) | Badge status jujur tanpa entri manual |
| Akses **read** untuk user integrasi portal pada `freight.airline`/`airport`/`flight` | Portal memakai satu user Odoo (`odoo_connections.username`), sama seperti fitur lain |
| Akses **read + write + create** untuk user integrasi portal pada `freight.cargo.booking` | Satu-satunya model di fitur ini yang portal tulis, bukan hanya baca |
| Menu ops + view list/form di Odoo untuk keempat model | Tim ops tetap perlu mengisi/meninjau data ini langsung di Odoo (mis. mengoreksi ETD, menambah penerbangan baru) — portal hanya mengelola booking-ke-penerbangan, bukan entri jadwal itu sendiri (di luar cakupan mockup) |
| Dokumen pemetaan field per environment | Mengikuti pola `Docs/ops/odoo_studio_installed_base.md`, wajib untuk verifikasi §13 |

### 6.2 Jebakan yang wajib diketahui

- **`freight.cargo.booking.customer_partner_id` bukan identitas pemanggil** (D-5). Kode yang salah
  membaca ini sebagai "milik siapa yang sedang login" akan berjalan tanpa error karena bertipe
  partner — jebakan yang sama bentuknya dengan `operator_id` di Vessel Schedule §6.2 dan
  `maintenance.equipment.partner_id` di Installed Base.
- **Kapasitas bukan constraint Odoo, dihitung/divalidasi di portal** (AS-6). Addon tidak perlu
  (dan sebaiknya tidak) menolak `write` yang melebihi kapasitas di level Odoo — itu akan
  mempersulit ops mengoreksi data secara manual saat memang perlu override. Penegakan `400` ada di
  service portal, bukan di Odoo.
- **`write_date` bukan opsional untuk ditampilkan** — sama alasan §8 poin 2 Vessel Schedule: staf
  perlu tahu kapan sebuah baris terakhir berubah untuk menilai kesegarannya.

### 6.3 Baris `FEATURES` di portal (wajib, AS-5)

```js
// src/services/odooCapabilityService.js
airSchedule: {
  label: 'Air Cargo Schedule (jadwal & booking kargo udara)',
  odooModule: 'addon freight_schedule (ekstensi sisi udara)',
  models: ['freight.flight', 'freight.airline', 'freight.airport', 'freight.cargo.booking'],
  fields: {},
},
```

Addon belum terpasang → `503 feature_unavailable` + item nav tersembunyi lewat `GET /capabilities`
yang sudah ada.

---

## 7. Yang tetap tinggal di portal DB

**Tidak ada tabel baru.** Berbeda dari Vessel Schedule (yang butuh `vessel_watchlist` untuk
notifikasi), fitur ini tidak punya komponen "siapa ingin diberi tahu tentang apa" di MVP — dan
"siapa boleh mengerjakan ini" sudah terjawab lewat mekanisme yang sudah ada (`portal_roles`,
`portal_permissions`, `identity_mappings`; §11). Kalau Fase pasca-MVP menambah notifikasi perubahan
jadwal untuk staf (mis. penerbangan yang di-*watch* mendekati kapasitas penuh), itu tabel baru yang
mengikuti pola `vessel_watchlist` — tapi di luar cakupan dokumen ini (§14).

---

## 8. Kontrak API

Semua di bawah `authenticate` + `requirePermission`. `flight_id`/`booking_id` dari URL diparse
`parseOdooId` (`src/utils/parseOdooId.js`). Tidak ada endpoint ini yang tampil ke role pelanggan
(AS-7) — baik lewat permission maupun lewat nav (§10).

| Method | Path | Permission | Mengembalikan | Fase |
|---|---|---|---|---|
| GET | `/air-schedule/flights` | `air_schedule.view` | Daftar penerbangan + kapasitas terpakai (filter + pagination) | 1 |
| GET | `/air-schedule/flights/:id` | `air_schedule.view` | Detail penerbangan + daftar booking ter-assign + kapasitas | 1 |
| GET | `/air-schedule/airports` | `air_schedule.view` | Daftar bandara untuk dropdown origin/destination | 1 |
| GET | `/air-schedule/airlines` | `air_schedule.view` | Daftar maskapai untuk dropdown carrier | 1 |
| GET | `/air-schedule/bookings` | `air_schedule.view` | Daftar booking, filter `status` (termasuk `unassigned` untuk pool), `flight_id`, `q` | 1 |
| POST | `/air-schedule/bookings` | `air_schedule.manage` | Membuat booking baru (D-5), status awal `unassigned` | 2 |
| POST | `/air-schedule/bookings/:id/assign` | `air_schedule.manage` | Assign booking ke penerbangan (body: `flight_id`), validasi kapasitas (AS-6) | 2 |
| POST | `/air-schedule/bookings/:id/unassign` | `air_schedule.manage` | Melepas booking dari penerbangan, kembali ke pool | 2 |

**Urutan route**: `/flights/:id` tidak berkolisi dengan sub-resource lain di bawah `/air-schedule`
(`/airports`, `/airlines`, `/bookings` semuanya prefiks berbeda) — tapi tetap ikuti konvensi
`equipment.routes.js`: segmen literal apa pun yang ditambahkan kelak di bawah `/flights/*` atau
`/bookings/*` (mis. `/bookings/unassigned` sebagai path literal alih-alih query filter) **wajib**
didaftarkan sebelum `/flights/:id`/`/bookings/:id`.

**Query `GET /air-schedule/flights`** (opsional, divalidasi Zod): `q` (cocok ke `flight_no`,
`ilike`), `airline_id`, `origin_airport_id`, `dest_airport_id`, `status` (enum `state`), `from`,
`to` (tanggal ETD), `page`, `limit` (default 20, maks 100), `sort` (enum kolom yang diizinkan).

**Query `GET /air-schedule/bookings`**: `status` (enum termasuk `unassigned`), `flight_id`,
`origin_airport_id`, `dest_airport_id`, `q` (cocok ke `awb_number`/nama pelanggan), `page`, `limit`.

Contoh respons `GET /air-schedule/flights`:

```json
{
  "data": [
    {
      "id": 501,
      "flight_no": "GA-6512",
      "airline": { "id": 3, "name": "Garuda Cargo", "iata_code": "GA" },
      "origin": { "id": 10, "iata_code": "CGK", "name": "Jakarta" },
      "dest": { "id": 12, "iata_code": "SUB", "name": "Surabaya" },
      "etd": "2026-09-12T00:40:00Z",
      "eta": "2026-09-12T01:55:00Z",
      "atd": "2026-09-12T00:38:00Z",
      "ata": null,
      "state": "departed",
      "capacity_kg": 9000,
      "capacity_cbm": 52,
      "used_kg": 5500,
      "used_cbm": 30,
      "booking_count": 2,
      "updated_at": "2026-09-12T00:38:04Z"
    }
  ],
  "meta": { "page": 1, "limit": 20, "total": 10 }
}
```

`used_kg`/`used_cbm`/`booking_count` dihitung di service (agregasi booking yang `flight_id`-nya
menunjuk baris ini), bukan disimpan sebagai field tersendiri di Odoo — menghindari dua sumber
kebenaran untuk angka yang sama (mirip prinsip D-5/D-8 status dihitung, bukan diketik ulang).

Error mengikuti `errorHandler`: `{ error: { code, message } }`. Kapasitas terlampaui →
`400 capacity_exceeded`. Booking/flight yang tidak ada atau beda company → `404 not_found`. Addon
belum terpasang → `503 feature_unavailable`.

`api/openapi.yaml` **wajib** diperbarui untuk setiap endpoint di atas.

---

## 9. File manifest backend

| File | Baru/Ubah | Isi |
|---|---|---|
| `src/integrations/odoo/OdooAirScheduleService.js` | **Baru** | `baseDomain(companyId)` untuk flight/airline/airport (D-2) DAN untuk booking (D-3, komentar terpisah wajib ada); `listFlights`, `getFlight`, `listAirlines`, `listAirports`, `listBookings`, `createBooking`, `assignBooking`, `unassignBooking` |
| `src/services/airScheduleService.js` | **Baru** | `(userId, currentCompanyId, …)`; `resolveOdooContext(..., { feature: 'airSchedule' })` — **tidak** mendestrukturisasi `odooPartnerId` (D-4, komentar wajib); validasi `customer_partner_id`/`flight_id` sebagai target (D-5); perhitungan & penegakan kapasitas (AS-6) |
| `src/services/airScheduleRateLimiter.js` | **Baru** | Pola `equipmentRateLimiter.js` (§12.2) |
| `src/controllers/airScheduleController.js` | **Baru** | `asyncHandler`, parse Zod, `auditService.record` untuk create/assign/unassign |
| `src/validators/airScheduleValidators.js` | **Baru** | `listFlightsSchema`, `listBookingsSchema`, `createBookingSchema`, `assignSchema` |
| `src/routes/airSchedule.routes.js` | **Baru** | `authenticate` + `requirePermission('air_schedule.view'|'air_schedule.manage')` |
| `src/routes/index.js` | Ubah | Daftarkan `/air-schedule` |
| `src/services/odooCapabilityService.js` | Ubah | Satu baris `FEATURES.airSchedule` (§6.3) |
| `database/seeds/00XX_air_schedule_permissions.sql` | **Baru** | §11 — **cek nomor seed tersedia saat implementasi** (§11 catatan koordinasi dengan Vessel Schedule) |
| `scripts/check-air-schedule-capability.js` | **Baru** | Probe model + field addon (§13), pola `check-equipment-capability.js` |
| `api/openapi.yaml` | Ubah | §8 |

Yang **tidak** boleh terjadi: `airScheduleService` membaca `odooPartnerId` dari `resolveOdooContext`
untuk keperluan apa pun selain, jika kelak dibutuhkan, memvalidasi bahwa staf punya mapping yang
valid; controller memanggil `OdooAirScheduleService` langsung tanpa lewat `airScheduleService`;
`baseDomain` booking mendapat tambahan filter partner "supaya lebih aman" (D-3).

---

## 10. Permukaan frontend

| File | Baru/Ubah | Isi |
|---|---|---|
| `frontend/src/api/airSchedule.js` | **Baru** | Modul tipis di atas `apiFetch` dari `client.js` |
| `frontend/src/pages/AirSchedulePage.jsx` | **Baru** | Konsol dua-panel sesuai mockup: papan penerbangan (kiri) + panel kapasitas/booking (kanan), filter tanggal/status/search, modal "New Booking" |
| `frontend/src/components/AirScheduleFlightBoard.jsx` | **Baru** | Daftar penerbangan + gauge kapasitas, mengikuti pola `ShipmentTrackingPage.jsx` |
| `frontend/src/components/AirScheduleBookingPanel.jsx` | **Baru** | Detail penerbangan terpilih: assigned bookings, pool unassigned (route matching + lainnya), aksi assign/unassign |
| `frontend/src/App.jsx` | Ubah | Rute `/air-schedule`, dilindungi **juga** di sisi frontend oleh pengecekan role (lihat di bawah) — permission frontend tetap kosmetik (aturan #3 CLAUDE.md), gerbang sungguhan tetap `requirePermission` di backend |
| `frontend/src/components/AppShell.jsx` | Ubah | Item nav baru, **hanya** tampil untuk `user.roles.includes('Staff (Internal)') || user.is_platform_admin` — pola identik `DocumentsPage.jsx` `canShare` dan `PLATFORM_ADMIN_SECTIONS`, **bukan** `feature: 'airSchedule'` biasa (yang hanya menyembunyikan berdasar kapabilitas Odoo, bukan berdasar peran pengguna) |
| `frontend/src/utils/localTime.js` | **Baru** (atau reuse) | Format waktu ber-timezone bandara pakai `Intl.DateTimeFormat` bawaan. **Cek dulu** apakah Vessel Schedule sudah membuat `frontend/src/utils/portTime.js` — kalau sudah dan generik (menerima IANA tz apa pun), pakai ulang itu alih-alih membuat file baru; kalau belum ada, beri nama generik (`localTime.js`, bukan `portTime.js`) supaya Vessel Schedule bisa memakainya ulang nanti |
| `frontend/src/styles/index.css` | Ubah | Kelas gauge kapasitas/board; token yang ada saja (`--color-primary`, `--radius-*`, dst.) |

**Penempatan navigasi**: **bukan** bagian dari grup pelanggan mana pun (Delivery, Complaint, dst).
Ini surface staf, jadi ditaruh sebagai section nav tersendiri yang hanya dirender untuk
`Staff (Internal)`/platform admin — pola yang sama dengan bagaimana `PLATFORM_ADMIN_SECTIONS`
dirender terpisah dari `NAV_SECTIONS` biasa di `AppShell.jsx:244`.

**Styling**: setelah menyentuh `index.css`, jalankan `node scripts/check-css-vendor-prefixes.js`
(BUG-39).

**i18n**: sama seperti Vessel Schedule — frontend belum punya i18n, string baru ditulis English
hardcoded seperti halaman lain.

---

## 11. Permission & seed

Dua kode baru, **hanya** untuk role yang sudah ada `Staff (Internal)` (seed `0008`) — **tidak**
untuk keempat role pelanggan (AS-7).

```sql
-- database/seeds/00XX_air_schedule_permissions.sql
--
-- CATATAN NOMOR: per 2026-09-12, migrasi terakhir di repo adalah 0016 dan seed terakhir 0018.
-- Docs/CR/customer_portal_vessel_schedule.md JUGA merencanakan seed 0019 dan migrasi 0017 --
-- keduanya belum dieksekusi. Siapa pun yang membangun fitur ini lebih dulu berhak atas nomor
-- berikutnya yang benar-benar tersedia; jangan asumsikan 0019 masih kosong tanpa mengecek ulang
-- `ls database/seeds` saat implementasi dimulai.
--
-- air_schedule.view dan air_schedule.manage SENGAJA hanya untuk 'Staff (Internal)'. Ini bukan
-- pola yang sama dengan vessel.export vs vessel.view (yang membedakan berdasar biaya operasi) --
-- ini soal AS-7: kalau kode ini pernah diberikan ke role pelanggan mana pun, pelanggan itu bisa
-- melihat DAN meng-assign booking milik pelanggan LAIN (Docs/CR/air_schedule.md, D-3/D-4).

INSERT INTO portal_permissions (code, name, module) VALUES
  ('air_schedule.view',   'View air cargo flight schedule and bookings', 'air_schedule'),
  ('air_schedule.manage', 'Create bookings and assign/unassign cargo to flights', 'air_schedule');

INSERT INTO portal_role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM portal_roles r, portal_permissions p
WHERE p.code IN ('air_schedule.view', 'air_schedule.manage')
  AND r.name = 'Staff (Internal)';
```

**Provisioning staf (Q-1, Temuan 3)**: menambahkan permission saja tidak cukup membuat seorang
staf bisa memakai fitur ini — mereka juga butuh baris `identity_mappings` yang valid untuk koneksi
yang mereka tangani (persis seperti prasyarat `documentShareService`). Ini bukan bagian dari
migrasi/seed (baris `identity_mappings` per-user, bukan data seed), tapi **wajib** masuk runbook
go-live sebagai langkah manual sampai ada alur onboarding staf khusus.

---

## 12. NFR: budget panggilan Odoo, rate limit, degradasi

### 12.1 Budget panggilan XML-RPC

| Endpoint | Budget | Cara |
|---|---|---|
| `GET /air-schedule/flights` | **3** | `search_count` + `search_read` flight + satu `search_read` booking (agregasi `used_kg`/`used_cbm`/`booking_count` untuk seluruh flight di halaman itu sekaligus, domain `flight_id in [...ids halaman ini]` — **bukan** satu panggilan per baris) |
| `GET /air-schedule/flights/:id` | **2** | flight (1) + booking `['flight_id', '=', id]` (1) |
| `GET /air-schedule/airports` / `/airlines` | **1** masing-masing | Master data, di-cache proses 10 menit |
| `GET /air-schedule/bookings` | **2** | `search_count` + `search_read` |
| `POST /air-schedule/bookings` | **2** | validasi partner (1) + `create` (1) |
| `POST /air-schedule/bookings/:id/assign` | **3** | baca booking (1) + baca flight & booking ter-assign untuk hitung kapasitas (1) + `write` (1) |
| `POST /air-schedule/bookings/:id/unassign` | **1** | `write` |

**Aturan wajib**: agregasi kapasitas per halaman board dilakukan dengan **satu** `search_read`
booking ber-domain `flight_id in [...]`, dijumlahkan di JavaScript — bukan satu panggilan per
penerbangan (pola yang sama ditegaskan §15.1 Vessel Schedule dan dipakai
`productService.getReorderSuggestions`).

### 12.2 Rate limiting

`src/services/airScheduleRateLimiter.js`, pola `equipmentRateLimiter.js` (burst in-memory per user,
`429 rate_limited`):

| Bucket | Batas | Alasan |
|---|---|---|
| Baca (list/detail/dropdown) | 30 / menit / user | Board diundang klik cepat ganti filter |
| Tulis (create/assign/unassign) | 20 / menit / user | Staf mengerjakan banyak booking berurutan; tetap dibatasi karena ini satu-satunya endpoint fitur ini yang menulis ke Odoo |

Catat di komentar: bucket in-memory berarti per-proses, tidak akurat bila backend diskalakan
multi-instance (batasan yang sama dengan tiga rate limiter lain yang sudah ada).

### 12.3 Degradasi

| Kondisi | Perilaku |
|---|---|
| Addon `freight_schedule` belum diperluas (model udara belum ada) | `503 feature_unavailable`; item nav tersembunyi (AS-5) |
| Staf belum punya `identity_mapping` untuk koneksi ini | `403 no_identity_mapping` (bawaan `resolveOdooContext`) — pesan error di UI **wajib** membedakan ini dari "tidak punya izin", supaya staf tahu ini masalah provisioning (Q-1), bukan RBAC |
| Belum ada penerbangan untuk company ini | Daftar kosong + empty state, bukan error |
| Kapasitas terlampaui saat assign | `400 capacity_exceeded` dengan angka sisa kapasitas di pesan |
| Odoo tidak terjangkau | `503 odoo_connection_unavailable` yang sudah ada (CR-045) |

---

## 13. Verifikasi

**1. Capability probe (AS-5) — jalankan sebelum menulis kode portal apa pun:**

```bash
node scripts/check-air-schedule-capability.js --connection=<odoo_connections.id>
```

Membaca `ir.model` untuk `freight.flight`, `freight.airline`, `freight.airport`,
`freight.cargo.booking`; membandingkan dengan daftar field §5; mencetak yang hilang lalu keluar
non-zero. Pola skripnya mengikuti `scripts/check-equipment-capability.js`.

**2. Prefiks vendor CSS (setelah menyentuh `index.css`):**

```bash
node scripts/check-css-vendor-prefixes.js
```

**Verifikasi manual yang tidak bisa diskripkan, dan wajib dilakukan** — dua pemeriksaan yang
menguji hal berlawanan, sama seperti §16 Vessel Schedule:

1. **Batas company terjaga**: dua koneksi Odoo (company) berbeda → staf yang identity_mapping-nya
   hanya ke koneksi A **tidak boleh** melihat penerbangan/booking company B (D-2/D-3 tetap
   terkunci company).
2. **Lintas pelanggan justru harus terlihat**: dalam **satu** company yang sama, staf melihat
   booking milik **lebih dari satu** `customer_partner_id` sekaligus pada satu penerbangan,
   dan bisa meng-assign booking milik pelanggan mana pun ke penerbangan mana pun di company itu
   (AS-3 terbukti — ini bukti bahwa fitur intinya bekerja, kebalikan dari pemeriksaan yang lazim
   di fitur lain portal ini).
3. **Role pelanggan ditolak**: login sebagai `Customer Admin`/`Finance`/`Procurement`/`Viewer` →
   `GET /air-schedule/flights` mengembalikan `403` (AS-7 terbukti).
4. **Kapasitas ditegakkan di server**: assign booking yang melebihi kapasitas lewat panggilan API
   langsung (bukan lewat UI, yang mungkin mencegahnya di klien) → tetap `400 capacity_exceeded`
   (AS-6 terbukti — UI bukan satu-satunya penjaga).

---

## 14. Roadmap fase & acceptance criteria

Satu fase = satu branch = satu PR.

### Fase 0 — Addon Odoo + kelayakan (blocking)

- Perluas/bangun addon `freight_schedule` sesuai §6.1 (koordinasi Temuan 4 — cek dulu apakah
  Vessel Schedule sudah dieksekusi); deploy ke Odoo target; konfirmasi A-1, A-2.
- Isi data contoh: minimal 10 penerbangan lintas ≥ 4 bandara dan ≥ 2 maskapai, dan minimal 15
  booking dengan campuran `unassigned`/`assigned` ke penerbangan berbeda.
- Jalankan `scripts/check-air-schedule-capability.js`; harus hijau.
- Jawab Q-1 (provisioning staf) dan Q-2 (satu/banyak koneksi per staf) — keduanya memblokir go-live.

**Acceptance**: capability probe hijau + data contoh terbaca dari user integrasi portal + Q-1/Q-2
terjawab tertulis (runbook provisioning staf ada, bukan sekadar disepakati lisan).

### Fase 1 — Baca-saja: board penerbangan + pool booking (mockup, tanpa tulis)

`OdooAirScheduleService` (baca), `airScheduleService` (baca), controller + validator + routes untuk
GET saja, baris `FEATURES`, seed permission (§11) — `air_schedule.manage` **belum** diberikan ke
siapa pun sampai Fase 2 selesai (menghindari UI tombol assign yang mengarah ke endpoint yang belum
ada), `AirSchedulePage`/`AirScheduleFlightBoard`, nav gating berbasis role, OpenAPI.

**Acceptance**:
- Staf dari koneksi A tidak melihat data koneksi B (verifikasi manual #1).
- Staf yang sama melihat booking dari **lebih dari satu** pelanggan pada company yang sama
  (verifikasi manual #2) — kalau ini gagal (daftar kosong/hanya satu pelanggan terlihat), curigai
  ada filter partner yang tidak sengaja ditambahkan (D-3 dilanggar).
- Role pelanggan mendapat `403` (verifikasi manual #3).
- `GET /air-schedule/flights` ≤ 3 panggilan Odoo, **diukur**.
- Addon dimatikan → `503 feature_unavailable` + menu hilang.
- `api/openapi.yaml` diperbarui.

### Fase 2 — Tulis: create booking + assign/unassign

`createBooking`, `assignBooking`, `unassignBooking` di service & integrasi, endpoint POST, gating
kapasitas server-side (AS-6), `air_schedule.manage` diberikan ke `Staff (Internal)`,
`AirScheduleBookingPanel` (form New Booking + tombol assign/remove).

**Acceptance**:
- Assign melebihi kapasitas → `400 capacity_exceeded`, diuji lewat panggilan API langsung
  (verifikasi manual #4), bukan hanya lewat UI.
- Create booking dengan `customer_partner_id` yang tidak ada di koneksi ini → ditolak (D-5
  tervalidasi), bukan diam-diam membuat booking dengan id partner yang salah.
- Setiap create/assign/unassign tercatat di audit log (`auditService.record`).
- Dua akun staf berbeda pada company yang sama meng-assign booking secara berurutan; total
  kapasitas terpakai yang ditampilkan konsisten dengan booking yang benar-benar ter-assign
  (tidak ada penghitungan ganda).

### Fase 3 (opsional, di luar cakupan MVP kecuali diminta ulang)

Ekspor, notifikasi kapasitas penuh, tampilan baca untuk pelanggan (AS-4), *chargeable weight*
volumetrik (Q-3), override kapasitas dengan alasan (Q-4). **Jangan** mengerjakan salah satu dari
ini tanpa CR/keputusan client tersendiri — lihat R-6.

---

## 15. Risiko & mitigasi

| ID | Risiko | Dampak | Prob. | Mitigasi |
|---|---|---|---|---|
| **R-1** | `air_schedule.*` ter-grant ke role pelanggan (salah ketik seed, atau "supaya gampang testing") | Pelanggan bisa melihat & meng-assign booking pelanggan lain — pelanggaran kerahasiaan komersial paling serius di fitur ini | Rendah | AS-7; seed hanya menyebut `Staff (Internal)`; acceptance Fase 1 menguji eksplisit (#3) |
| **R-2** | Seseorang menambahkan filter `customer_partner_id` ke `baseDomain` booking staf, mengira menegakkan aturan #2 CLAUDE.md | Fitur mati total untuk staf (hanya melihat booking miliknya sendiri yang notabene tidak ada, karena staf bukan pelanggan) | Sedang | Komentar wajib di `baseDomain` (D-3) + acceptance Fase 1 menguji lintas-pelanggan (#2) secara eksplisit sebagai "harus terlihat", bukan "harus tersembunyi" |
| **R-3** | Staf baru tidak diprovisioning `identity_mapping` | Konsol tampak "rusak" (`403 no_identity_mapping`) tanpa penjelasan | Tinggi (sampai ada UI admin) | Q-1 dijawab dengan runbook tertulis; pesan error UI membedakan ini dari "tidak berizin" |
| **R-4** | Race condition dua staf assign ke penerbangan yang sama mendekati kapasitas penuh bersamaan | Kapasitas sedikit terlampaui dalam jendela balapan yang sempit | Rendah (backend proses tunggal, staf sedikit) | Diterima sebagai keterbatasan MVP; dicatat eksplisit, bukan diklaim tidak mungkin terjadi |
| **R-5** | Dua addon `freight_schedule` berbeda dibangun terpisah (Air Schedule dan Vessel Schedule tidak berkoordinasi) | Bentrok nama modul Odoo saat dideploy bersamaan | Sedang | Temuan 4 dicatat eksplisit; Fase 0 wajib mengecek keberadaan addon sebelum membangun dari nol |
| **R-6** | Cakupan melebar ke fitur yang belum diminta (ekspor, notifikasi, tampilan pelanggan, volumetrik) di tengah jalan | CR ini berubah jadi modul freight forwarding penuh yang tidak pernah selesai | Sedang | Batas eksplisit §14 Fase 3; setiap perluasan butuh keputusan client tertulis, bukan inisiatif implementasi |
| **R-7** | AWB duplikat/format salah karena tidak ada validasi check-digit penuh | Kebingungan operasional kecil, bukan kebocoran data | Rendah | Constraint unik `awb_number` + regex format; validasi check-digit penuh dicatat sebagai simplifikasi disengaja, bukan diabaikan diam-diam |

---

## 16. Anti-pattern: jangan lakukan ini

| Jangan | Kenapa |
|---|---|
| Menambahkan `['customer_partner_id', '=', odooPartnerId]` ke domain booking staf | Melanggar D-3/AS-3. Ini FITUR-nya, bukan bug — akibatnya staf hanya melihat booking "miliknya sendiri" yang tidak ada artinya untuk staf |
| Membaca `odooPartnerId` dari `resolveOdooContext` di jalur staf untuk keperluan penyaringan data | Melanggar D-4. `odooPartnerId` staf tidak relevan untuk penyaringan — ia hanya bagian dari mekanisme membuka sesi (Temuan 3) |
| Memberi `air_schedule.view`/`air_schedule.manage` ke `Customer Admin`/`Finance`/`Procurement`/`Viewer` | Melanggar AS-7. Kombinasi dengan D-3 berarti kebocoran lintas pelanggan |
| Membangun `resolveOdooStaffContext` baru alih-alih memakai `resolveOdooContext` yang sudah ada | Menduplikasi mekanisme yang sudah teruji (`documentShareService`) dengan risiko bug baru yang tidak perlu |
| Menaruh `freight.cargo.booking` di portal DB "supaya bisa transaksional" | Melanggar §7/D-1. Portal DB tidak pernah jadi system of record kedua untuk data yang juga dipakai Odoo untuk invoicing/pelaporan |
| Menghitung/menegakkan kapasitas hanya di frontend | Melanggar AS-6. Panggilan API langsung (curl, Postman) akan melewati validasi UI sepenuhnya |
| Menambahkan entitas `leg` untuk multi-flight booking tanpa Q-3/A-3 dikonfirmasi | Melanggar D-7. Membangun kerumitan yang belum diminta dan belum tentu dibutuhkan |
| Menghitung *chargeable weight* volumetrik tanpa Q-3 dikonfirmasi | Melanggar D-6. Melebarkan cakupan model data untuk kasus yang belum diminta |
| Membuat addon Odoo baru tanpa mengecek apakah Vessel Schedule sudah membangun `freight_schedule` | Melanggar Temuan 4/R-5. Berisiko dua addon bentrok nama modul |
| Menandai `delayed` secara manual | Melanggar D-8. Status manual berbohong tepat di hari tersibuk |
| Mengambil nama maskapai/bandara per baris alih-alih lewat display name many2one `search_read` | Ratusan round-trip untuk satu board (§12.1) |
| Menghitung kapasitas terpakai per penerbangan dengan satu panggilan Odoo per baris board | Melanggar §12.1. Wajib satu `search_read` agregat untuk seluruh halaman |
| Menampilkan halaman ini di nav pelanggan biasa, bahkan tersembunyi/disabled | Staf-only berarti tidak ada jejaknya sama sekali di pengalaman pelanggan, bukan tombol yang dinonaktifkan |
| Mengarang kode permission tanpa seed | Melanggar aturan #3 CLAUDE.md |
