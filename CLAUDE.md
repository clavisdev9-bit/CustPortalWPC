# CLAUDE.md — CustPortalWPC

Customer Self-Service Portal terintegrasi Odoo 18. Tiga runtime: React 18 SPA (`frontend/`),
Express API/BFF (`src/`), PostgreSQL (portal DB). Odoo adalah system of record.

**Prinsip inti:** Portal mengelola *siapa* customer dan *apa yang boleh* dia lakukan.
Odoo mengelola *apa yang dimiliki* customer dan *transaksi apa* yang terjadi.

> **Instance WPC.** Repo ini duplikat dari `C:\Dev\CustPortalCRM`, dijalankan berdampingan
> dengan instance CRM di mesin yang sama. Yang BERBEDA hanya lapis konfigurasi, bukan kode
> domain: port **7180** (Vite) / **7181** (Express), portal DB `custportalwpc`, serta
> `JWT_SECRET` + `ENCRYPTION_KEY` yang di-generate sendiri. `ENCRYPTION_KEY` yang berbeda itulah
> alasan baris `odoo_connections` **tidak bisa** dicopy dari instance CRM — kredensial Odoo di
> sana terenkripsi dengan kunci lain, jadi koneksi Odoo WPC harus didaftarkan dari nol lewat
> `/admin/odoo-connections`. Riwayat `cr.md`/`resolution.md` di bawah diwarisi dari CRM: nomor
> port yang disebut di narasi BUG/CR lama adalah port CRM saat kejadian, bukan port instance ini.

Dokumentasi as-built: [`system.md`](system.md). Rasional desain: [`Final_Technical_Specification.md`](Final_Technical_Specification.md).

---

## Aturan keamanan yang tidak boleh dilanggar

### 1. Identitas customer selalu diturunkan server-side

Client **tidak pernah** boleh menentukan data siapa yang dibaca. Satu-satunya jalur sah:

```js
const { session, odooPartnerId, odooCompanyId } = await resolveOdooContext(userId, currentCompanyId);
```

`userId` dan `currentCompanyId` hanya boleh berasal dari `req.user` (diisi `middleware/authenticate.js`),
**bukan** dari body, query, atau header. Lihat `src/services/odooContext.js`.

Jangan pernah menambahkan parameter `partner_id`, `customer_id`, atau `company_id` yang berasal dari
request ke endpoint mana pun.

### 2. Setiap query Odoo terkunci ke partner + company

Semua `Odoo*Service` membangun base domain yang memaksa `partner_id` dan `company_id`, termasuk
pada pengambilan record tunggal (pola `ensureOwned`). Record milik orang lain menghasilkan `404`,
bukan data. Jangan menulis query Odoo yang melewati pola ini.

### 3. Otorisasi wajib di Express

`requirePermission('<code>')` di route. Permission di frontend hanya kosmetik. Platform admin
(`is_platform_admin`) mem-bypass RBAC per-customer.

Gunakan **hanya** permission code yang sudah ada di `database/seeds/*.sql`. Jangan mengarang kode
baru tanpa menambahkan seed-nya. Catatan: `analytics.view` **tidak ada** — route analytics
menumpang `invoice.view` / `order.view`. Hal yang sama berlaku untuk tool asisten analytics.

### 4. Secret tidak pernah sampai ke klien

Kredensial Odoo tersimpan terenkripsi (AES-256-GCM, `src/utils/crypto.js`) di tabel
`odoo_connections`. Backend adalah satu-satunya pemegangnya. Jangan pernah menaruh secret di
variabel `VITE_*` — semuanya ter-bundle ke JS klien.

---

## Layering

```
routes → controllers → services → repositories → db/pool
                          ↓
                    integrations/odoo/Odoo*Service → OdooClient (XML-RPC)
```

Jangan melompati lapisan. Controller tidak memanggil repository langsung; service tidak memanggil
`OdooClient` langsung.

---

## Konvensi kode

- **CommonJS** (`require` / `module.exports`) di backend. **ESM** di frontend.
- **Controller**: `asyncHandler(async (req, res) => …)`, parse body dengan Zod schema dari
  `src/validators/`, catat aksi tulis lewat `auditService.record(req, {...})`.
- **Service**: signature `(userId, currentCompanyId, …)`.
- **Repository**: `pool.query` dengan parameter `$1, $2` — jangan pernah string interpolation.
  Scope tabel portal ke `portal_user_id` **dan** `odoo_connection_id` (user bisa punya mapping ke
  lebih dari satu Odoo).
- **Error**: `throw new ApiError(status, code, message)`. `errorHandler` merender
  `{ error: { code, message } }`.
- **Id Odoo dari URL**: `parseOdooId(req.params.id)`.
- **Validator**: Zod, satu file per domain di `src/validators/`.
- **Frontend API**: modul tipis per domain di `frontend/src/api/`, di atas `apiFetch` dari
  `client.js` (menangani bearer token + refresh 401 sekali-lalu-retry).
- **Styling**: satu stylesheet global `frontend/src/styles/index.css`, digerakkan CSS custom
  property. Pakai token yang ada (`--color-primary`, `--radius-*`, `--shadow-*`, `--s-*`) — jangan
  hardcode warna, supaya dark mode dan tema brand ikut benar otomatis. Tidak ada
  PostCSS/autoprefixer di build ini (dependency baru butuh izin dulu — lihat § Dependency), jadi
  `backdrop-filter` dan `user-select` **wajib** ditulis berpasangan dengan padanan
  `-webkit-`-nya secara manual (Safari tidak pernah meng-unprefix keduanya). Lihat [BUG-39](resolution.md#bug-39--backdrop-filter-dan-user-select-tanpa-prefix--webkit--di-indexcss-diam-diam-tidak-berfungsi-di-safari-dan-safari-ios).
  Setelah menyentuh `index.css`, jalankan:

  ```bash
  node scripts/check-css-vendor-prefixes.js
  ```
- **Komentar**: jelaskan *kenapa*, bukan *apa*. Ikuti gaya komentar di `src/services/odooContext.js`
  dan `database/migrations/0009_document_shares.sql`.

---

## Migrasi & seed

- Migrasi: `database/migrations/NNNN_nama.sql`, bernomor urut. Beri komentar header yang
  menjelaskan keputusan desain dan aturan scoping-nya.
- Seed permission: `database/seeds/NNNN_nama.sql` — `INSERT INTO portal_permissions`, lalu join
  ke `portal_role_permissions` berdasarkan nama role.
- Jalankan dengan `npm run migrate`. Migrasi bersifat additif; jangan mengedit file yang sudah
  pernah dijalankan.
- Perbarui `api/openapi.yaml` untuk setiap perubahan endpoint. Ini konvensi repo.

---

## Perintah

**SELALU GUNAKAN INI untuk development:**

```bash
npm run dev
```

Menjalankan Backend (:7181) & Frontend (:7180) **bersamaan** dengan auto-reload saat file berubah. **TIDAK perlu menjalankan keduanya secara terpisah di awal.** (Jangan gunakan `npm start` — itu adalah bare Node tanpa auto-reload.)

Kalau ingin **troubleshoot satu komponen** (misalnya debug backend sendirian), jalankan terpisah:

```bash
npm run dev:backend     # Backend saja (:7181) — auto-reload dengan nodemon
npm run dev:frontend    # Frontend saja (:7180) — dari folder frontend/ subfolder
npm run migrate         # Jalankan database migrations
```

Frontend dev server memproksikan `/api` → `http://localhost:7181` (`frontend/vite.config.js`), jadi path relatif tetap bekerja dari mana pun browser mengakses SPA (localhost, LAN IP, tunnel ngrok, dll — lihat [CR-009](cr.md#cr-009--api-base-url-relatif--vite-dev-proxy-bukan-httplocalhost3000-absolut)).

### Troubleshooting: "Cannot reach the server..."

Error ini berarti browser tidak bisa terhubung ke API backend (port 7181). **Lihat detail lengkap di [`resolution.md` § Troubleshooting](resolution.md#troubleshooting-cannot-reach-the-server-make-sure-the-backend-is-running-then-try-again)**, tapi ringkas:

- **Backend belum dijalankan?** Jalankan `npm run dev` (kedua-duanya bersama) dari root directory (bukan dari `frontend/` subfolder).
- **Gunakan bare Node (`npm start`)?** JANGAN — itu tidak auto-reload `.env` atau file `src/`. Selalu pakai `npm run dev` atau `npm run dev:backend`.
- **Port 7181 dipakai process lain?** Kill proses itu atau ubah `PORT=7181` di `.env` ke port lain.
- **Backend jelas hidup tapi pesannya tetap muncul?** Pastikan dulu backend benar-benar mendengarkan di port yang dituju proxy: `netstat -an | findstr :7181`, lalu `curl` langsung ke `http://localhost:7181/api/v1/...`. Kalau backend sehat tapi lewat `:7180` tetap gagal, yang salah adalah target proxy — bukan backend. Sejak [CR-043](cr.md#cr-043--vite-proxy-baca-port-backend-dari-env-root-alih-alih-hardcode-hilangkan-sumber-drift-port) target itu dibaca dari `PORT` di `.env` root, jadi cukup pastikan `PORT` di sana memang port yang dipakai backend. Lihat [BUG-28](resolution.md#bug-28--cannot-reach-the-server-di-seluruh-spa-padahal-backend-hidup-proxy-vite-menunjuk-port-3001-backend-mendengarkan-di-3000).

---

## Dependency

Repo ini sengaja bergantung sedikit (backend: express, pg, zod, jsonwebtoken, bcryptjs, xmlrpc,
otplib, nodemailer, multer, helmet, cors, dotenv, google-auth-library; frontend: react,
react-router-dom, vite). **Tanya dulu sebelum menambah dependency atau framework baru** — termasuk
test runner, state manager, dan UI library.

Belum ada test runner. Script verifikasi ditulis sebagai `node scripts/*.js` yang keluar dengan
exit code non-zero saat gagal.

**Menyentuh `frontend/src/api/client.js` (sesi/refresh token)? Jalankan ini:**

```bash
node scripts/check-auth-refresh.mjs
```

Ia mengimpor `client.js` yang asli (dengan `fetch`/`localStorage` di-stub) dan benar-benar
menjalankan jalur refresh proaktif, jaring pengaman 401, pemulihan lintas-tab, dan logout saat
refresh token mati. `npm run build` **tidak** menangkap kerusakan di file ini — [BUG-34](resolution.md)
adalah satu karakter (`})();` alih-alih `});`) yang lolos build maupun `/code-review`, dan
membuat setiap sesi logout paksa tiap 15 menit.

---

## Keterbatasan yang diketahui

- **Rate limiting umum belum ada** (`system.md §17`). Endpoint baru yang mahal wajib membawa
  pembatasnya sendiri. Yang sudah punya: `/assistant/chat`
  (`src/services/assistant/rateLimiter.js` — kuota harian dari DB, burst per menit di memori,
  circuit breaker), `/equipment/due-replacements`
  (`src/services/equipmentRateLimiter.js` — burst per menit di memori saja, tanpa kuota/breaker),
  dan ketiga endpoint config koneksi Odoo yang benar-benar menelepon Odoo
  (`src/services/odooConnectionRateLimiter.js` — satu bucket dipakai bersama
  `POST /admin/odoo-connections/check-connection`, `POST /`, dan `PATCH /:id`).
  Semuanya **per-proses**: kalau backend diskalakan multi-instance, jadi tidak akurat.
- Upload file masuk ke disk lokal (`uploads/`) — ganti ke object storage sebelum produksi.
- Odoo External API hanya tersedia pada plan **Custom**.
- Frontend **belum punya i18n**: tidak ada i18next, semua string English hardcoded,
  `index.html` dipatri `lang="en"`.

---

## Fitur dalam pengerjaan

**AI Assistant ("Asisten Portal")** — chatbot melayang yang menjawab hanya dari data user yang
login. Spec lengkap: [`Docs/CR/customer_portal_ai_assistant.md`](Docs/CR/customer_portal_ai_assistant.md).

**Status: Fase 1 selesai** (baca-saja, siap rilis). Yang sudah ada: migrasi `0010_assistant.sql`,
permission `assistant.use`, prompt di DB, 19 tool baca, SSE, rate limiter, redaksi, kartu data
deterministik, mode degradasi, dan admin UI di `/admin/assistant`.

**Fase 2 (aksi tulis) — alur inti sudah jalan.** Tiga tool `draft_*` (tiket, RMA, garansi),
endpoint `PATCH /assistant/drafts/:id` + `POST .../confirm` + `POST .../cancel`, panel
`DraftConfirm.jsx`, dan lampiran transkrip ke tiket.

Cakupan akses sesudah seed `0014_assistant_ticket_access.sql`: **keempat role pelanggan** bisa
membuat draf tiket (`ticket.view`/`create`/`reply`). `rma.create` dan `warranty.create` sengaja
tetap hanya Customer Admin — keduanya berkonsekuensi komersial. Untuk role lain, permintaan
refund otomatis jatuh ke tiket umum, dan staf yang mengonversinya.

Belum ada di Fase 2: unggah foto pada draf (`POST /tickets/:id/attachments`, buat tiket dulu baru
unggah), dan field urgensi terstruktur (`priority` tidak pernah ditulis ke Odoo — lihat
`src/integrations/odoo/OdooHelpdeskService.js`).

Sebelum menyentuh aksi tulis, baca skill [`asisten-aksi-tulis`](.claude/skills/asisten-aksi-tulis/SKILL.md).
Alur draf→konfirmasi adalah batas keamanan (I-5), bukan preferensi gaya.

Empat invarian tambahan saat mengerjakan fitur ini:

1. **Skema tool yang dilihat LLM tidak boleh punya field identitas.** Argumen yang diizinkan hanya
   id record dan nilai isi. Ditegakkan `scripts/check-assistant-invariants.js`.
2. **Kode asisten tidak boleh me-`require` `integrations/odoo/*`.** Panggil service domain, supaya
   base domain terkunci partner tetap berlaku.
3. **Tanpa hasil tool, tanpa angka.** Kalau tidak ada tool yang berhasil, jawaban tidak boleh
   memuat angka, tanggal, atau nomor dokumen.
4. **Aksi tulis wajib konfirmasi tombol.** LLM hanya menghasilkan draf; eksekusi lewat endpoint
   `confirm` terpisah. Persetujuan verbal tidak cukup.

Prompt dan konfigurasi model hidup di tabel DB (`assistant_prompts`, `assistant_settings`), bukan
sebagai literal di kode. Presedensinya: baris per-connection → baris global → `env.assistant` →
503. Artinya **`ASSISTANT_ENABLED=false` tidak mematikan asisten** kalau ada baris
`assistant_settings` dengan `enabled = true` — matikan lewat `/admin/assistant`.

Dua hal yang mudah dilanggar tanpa sadar saat menambah tool baru:

- Tool baru wajib punya `summarize`. Mengirim list mentah ke model adalah pos biaya token
  terbesar fitur ini sekaligus sumber halusinasi.
- `redact` berjalan **sebelum** `summarize`. Kalau `summarize` membaca field yang dibuang
  `src/services/assistant/redact.js` (`partner_id`, `email`, `user_id`, alamat), ia akan menerima
  `undefined` — bukan error, jadi kegagalannya diam.

Verifikasi. Yang pertama statis (I-1, I-2) dan tidak butuh apa pun; yang kedua menjalankan
orkestrator sungguhan dengan provider LLM + Odoo di-stub (butuh portal DB sudah dimigrasi);
yang ketiga memanggil model sungguhan dan butuh `ASSISTANT_*` terisi.

```bash
node scripts/check-assistant-invariants.js
```

```bash
node scripts/check-assistant-flow.js
```

```bash
node scripts/eval-assistant.js
```

---

**Customer Population (Installed Base / "My Equipment")** — registry mesin milik pelanggan +
mesin rekomendasi part jatuh tempo. Spec lengkap:
[`Docs/CR/customer_population_installed_base.md`](Docs/CR/customer_population_installed_base.md).
Kamus istilah client ↔ kode: [`Docs/data/installed_base_dictionary.md`](Docs/data/installed_base_dictionary.md).

**Status: Fase 1–4 selesai dan terverifikasi hidup terhadap Odoo lokal** (registry L1, backfill,
master data servis + mesin rekomendasi §9, riwayat servis, permintaan koreksi lewat asisten).
**Fase 5 (staff console) sengaja dilewati** — kondisional pada Q-1 CR yang belum pernah dijawab
klien sungguhan (default masih berlaku: sales tetap bekerja di Odoo, bukan di portal).

**Prasyarat arsitektural yang wajib dipahami sebelum menyentuh fitur ini:**

1. **Registry-nya sendiri sepenuhnya hidup di Odoo** (D-2/IB-3). Jangan pernah menambah tabel
   portal DB yang menyimpan nama unit/serial/model/status — kalau muncul kebutuhan begitu, itu
   tanda invarian ini sedang dilanggar. Satu-satunya tabel portal (`equipment_corrections`) adalah
   antrean permintaan koreksi, bukan salinan registry.
2. **Field custom (`customer_id`, `catalog_product_id`, dst.) berasal dari addon Odoo
   `installed_base`** (Python asli, direpo `odoo18_1/ODOO_STAGING_PT_DIRA/installed_base` di luar
   repo ini) — **bukan** Odoo Studio. CR aslinya mengasumsikan Studio (nama field `x_studio_*`);
   pivot ke addon terjadi karena target ternyata punya akses deploy. Lihat
   [`Docs/ops/odoo_studio_installed_base.md`](Docs/ops/odoo_studio_installed_base.md) untuk
   tabel pemetaan nama field lengkap dan status verifikasi per environment.
3. **`maintenance.equipment.partner_id` bawaan adalah Vendor, bukan pemilik** (§6.2 CR) —
   kepemilikan ada di `customer_id`, field terpisah. Menganggap `partner_id` sebagai pemilik akan
   salah semantik dan berisiko bocor lintas pelanggan.
4. **Query dikunci ke keluarga partner** (`OdooPartnerService.findFamilyIdsViaSession`), bukan
   partner persis (D-4) — unit fisik ada di alamat pengiriman (partner anak), sementara user
   portal biasanya ter-map ke partner induk. Pencocokan persis = pelanggan melihat daftar kosong.
5. **Mesin rekomendasi (`equipmentService.getDueReplacements`/`getPartsForUnit`) wajib membawa
   `basis` + `attribution` di setiap baris** (IB-4). Pembelian yang tidak bisa ditautkan ke satu
   unit spesifik (pelanggan punya beberapa unit model sama) diberi `attribution: 'fleet_estimated'`
   — jangan pernah ditebak sebagai `'unit'` (D-5).
6. **Setiap field Odoo yang dipakai wajib diverifikasi dulu** (IB-5) — `search_read` menggagalkan
   SELURUH panggilan kalau satu field saja tidak valid. Jalankan
   `node scripts/check-equipment-capability.js --connection=<id>` sebelum menambah field ke
   `LIST_FIELDS` mana pun di `OdooEquipmentService.js`.

   Sejak [CR-046](cr.md) aturan ini punya penegak runtime, bukan cuma skrip yang harus diingat:
   `src/services/odooCapabilityService.js` membaca `ir.model` + `ir.model.fields` milik Odoo
   tujuan (di-cache per koneksi) dan `resolveOdooContext(userId, companyId, { feature })` menolak
   lebih awal dengan `503 feature_unavailable`. **Fitur baru yang bersandar pada modul Odoo
   opsional wajib menambah satu baris di tabel `FEATURES` dan menyebut nama fiturnya saat
   mengambil sesi** — jangan menambah `try/catch` lokal, itu pola yang sudah tiga kali gagal
   (BUG-17, `carrier_tracking_ref`, dan BUG-31 sendiri).

Permintaan koreksi (`draft_equipment_correction`) adalah aksi tulis — baca skill
[`asisten-aksi-tulis`](.claude/skills/asisten-aksi-tulis/SKILL.md) sebelum mengubahnya. Endpoint
`POST /equipment/corrections` sengaja **flat** (equipment id di body, bukan di path `:id`) supaya
skema yang sama dipakai ulang oleh alur draf asisten, yang `confirm`-nya tidak punya route param.

```bash
node scripts/check-equipment-capability.js --connection=<odoo_connections.id>
```

```bash
node scripts/backfill-installed-base.js --dry-run
```

Verifikasi asisten (`check-assistant-invariants.js`, `check-assistant-flow.js`) otomatis mencakup
empat tool baca dan satu tool draf fitur ini — tidak butuh perintah terpisah.
