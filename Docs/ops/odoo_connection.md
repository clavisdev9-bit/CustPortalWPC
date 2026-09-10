# Odoo Connection — Setting yang Bisa Dikonfigurasi

Referensi untuk field `odoo_connections` yang bisa diatur langsung lewat REST API portal
(`/api/v1/admin/odoo-connections`).

**UI frontend** (sejak [CR-037](../../cr.md#cr-037--halaman-admin-setting--koneksi-odoo-di-frontend)):
*My Account &rsaquo; Setting &rsaquo; Koneksi Odoo* (`frontend/src/pages/OdooConnectionSettingsPage.jsx`,
route `/settings/odoo-connection`), platform-admin only. Sejak
[CR-044](../../cr.md#cr-044--validasi-kredensial-odoo-sebelum-disimpan-wizard-check-connection--pilih-company--simpan)
penambahan koneksi berbentuk **wizard tiga langkah** (kredensial → pilih company → selesai), bukan
form simpan-lalu-uji: kredensial diverifikasi ke Odoo dulu, dan nama database ditemukan sendiri
sehingga admin hanya mengisi URL/username/password. Selain itu tersedia edit (kredensial opsional,
kosong = tidak diubah, dengan Check Connection yang mengunci tombol simpan sampai berhasil),
Test Connection, Sync Companies + pemilihan company, Sync Users, dan Buat/Ganti Webhook URL.
**Belum ada** di UI: delete koneksi — masih harus lewat API langsung (curl/Postman).
`frontend/src/pages/AssistantAdminPage.jsx` juga menyentuh resource ini tapi hanya untuk memilih
connection lewat dropdown yang sudah ada, tidak membuat/mengedit baris `odoo_connections`.

Sumber kebenaran kode: `src/controllers/odooConnectionController.js`,
`src/services/odooConnectionService.js`, `src/repositories/odooConnectionRepository.js`,
`database/migrations/0001_phase1_foundation.sql` (tabel), `0007_odoo_webhook_provisioning.sql`
(`webhook_secret`).

---

## 1. Siapa yang boleh mengatur

`src/routes/odooConnections.routes.js` menggerbangi seluruh route dengan
`authenticate` + `requirePlatformAdmin` — **bukan** `requirePermission()` RBAC per-customer.
Field `portal_users.is_platform_admin` harus `true`. Ini konfigurasi tingkat platform (koneksi ke
Odoo tenant mana pun), bukan sesuatu yang boleh diakses Customer Admin biasa.

## 2. Field yang bisa di-set

Dikirim lewat body `POST /` (create, wajib semua) atau `PATCH /:id` (update, partial —
`updateConnectionSchema` adalah `.partial()` dari skema create, lihat
`src/validators/odooConnectionValidators.js`):

| Field | Tipe | Keterangan |
|---|---|---|
| `name` | string, min 1 | Label bebas untuk admin (mis. "PT Dira Staging"). Tidak dipakai logika apa pun, murni tampilan. |
| `url` | string, harus URL valid | Base URL instance Odoo, mis. `https://odoo.contoh.co.id/`. |
| `database` | string, min 1 | Nama database Odoo (parameter `db` di XML-RPC). |
| `username` | string, min 1 | Login Odoo yang dipakai portal untuk autentikasi XML-RPC. |
| `auth_type` | enum `password` \| `api_key` | Menentukan interpretasi `credential` — keduanya lewat XML-RPC `authenticate()`/`execute_kw()` yang sama; Odoo membedakan validitasnya di sisi server, bukan lewat parameter API terpisah. |
| `credential` | string, min 1 | Password akun atau API key Odoo. **Write-only** — dienkripsi (`crypto.encrypt`, AES-256-GCM) sebelum disimpan ke `encrypted_credential`, dan tidak pernah dikembalikan oleh `GET`. |
| `company_ids` | array integer, opsional | Sejak CR-044: id `res.company` yang dipakai portal ("Select Company"). Hanya id — nama/currency dibaca ulang server-side dari Odoo yang barusan diautentikasi. Dikosongkan = semua company aktif. Company yang tidak dipilih tetap tersimpan di `odoo_companies` tapi `is_active = false`. |

Sejak CR-044, `POST /` dan `PATCH /:id` yang menyentuh `url`/`database`/`username`/`credential`
**memvalidasi dulu ke Odoo** sebelum menulis apa pun: kredensial ditolak → `422` dan tidak ada
baris yang dibuat/diubah. Konsekuensinya, koneksi baru tidak bisa disimpan saat Odoo-nya sedang
tidak terjangkau — itu memang disengaja (lihat §4). `PATCH` yang hanya mengganti `name` atau
`company_ids` tidak menyentuh Odoo sama sekali.

Field yang **tidak bisa** diisi manual — dihitung/diisi sistem:

| Field | Diisi oleh |
|---|---|
| `id` | `gen_random_uuid()` saat create. |
| `odoo_version` | Diisi saat create/`PATCH` yang tervalidasi, dan tiap `POST /:id/test-connection`/`check-connection` (dari `common.version()` Odoo). |
| `status` | Sejak CR-044 baris baru langsung lahir `connected` (tidak ada lagi baris `pending` — kredensialnya sudah diverifikasi sebelum insert). Berubah `connected`/`error` otomatis dari hasil `test-connection`/`check-connection`, **dan sejak [CR-045](../../cr.md#cr-045--permintaan-pelanggan-sungguhan-jadi-health-check-koneksi-odoo-dan-tolak-koneksi-duplikat) juga dari permintaan pelanggan biasa** — setiap `openSession` pada jalur baca ikut mencatat hasilnya (`src/services/odooConnectionHealth.js`, throttle 60 detik/koneksi). Artinya kredensial yang basi tidak bisa lagi tampil hijau selamanya, dan koneksi yang dibetulkan pulih sendiri tanpa menunggu Test Connection ditekan. |
| `last_checked_at`, `last_error` | Diisi tiap kali koneksi benar-benar dihubungi (create, `PATCH` tervalidasi, `test-connection`, `check-connection` dengan `connection_id`, dan sejak CR-045 juga saat permintaan pelanggan gagal/berhasil ber-authenticate). |
| `webhook_secret` | Digenerasi acak (`crypto.randomToken(24)`) saat create; hanya bisa diganti lewat `POST /:id/webhook-secret/rotate`, tidak lewat `PATCH` biasa. |
| `encryption_key_version` | Default `1`, mengikuti versi `ENCRYPTION_KEY` di `.env`. |
| `is_enabled` | **[CR-047](../../cr.md#cr-047--nonaktifkan-koneksi-odoo-tanpa-menghapusnya-is_enabled-sebagai-kolom-sendiri-terpisah-dari-status).** Lahir `true`; hanya bisa diubah lewat `POST /:id/disable` dan `POST /:id/enable` (bukan `PATCH`). |

**`is_enabled` bukan `status`, dan perbedaannya penting.** `status` adalah *apa kata Odoo pada
kontak terakhir* dan ditulis mesin — sejak CR-045 setiap permintaan pelanggan ikut menulisnya.
`is_enabled` adalah *keputusan admin apakah portal boleh memakai koneksi ini* dan hanya ditulis
manusia. Keduanya berdiri sendiri, jadi baris `status = 'connected'` yang `is_enabled = false`
bukan kontradiksi — justru itu keadaan yang dicari sebelum menyalakan koneksi kembali (buktinya
kredensialnya sudah benar lagi).

Nilai `disabled` pada `status` sendiri tetap ada di `CHECK` constraint skema tapi **tidak dipakai
kode mana pun, dan jangan disetel manual**: `odooConnectionHealth.recordSuccess()` menimpa apa pun
yang bukan `connected` begitu ada satu permintaan pelanggan yang berhasil, jadi nilai itu tidak
akan bertahan. Untuk menghentikan pemakaian koneksi, pakai `POST /:id/disable`.

## 3. Endpoint

Semua di-prefix `/api/v1/admin/odoo-connections`:

| Method & Path | Fungsi |
|---|---|
| `GET /` | List semua koneksi. `encrypted_credential`, `encryption_key_version`, `webhook_secret` disaring keluar (`toDto` di controller). |
| `POST /check-connection` | **CR-044.** Validasi kredensial ke Odoo **tanpa menyimpan apa pun** + kembalikan daftar company untuk dipilih. Lihat §4. |
| `POST /` | Simpan koneksi yang sudah tervalidasi (memverifikasi ulang sendiri, lihat §2). Respons menyertakan `companies` hasil sync dan **satu-satunya** yang menyertakan `webhook_url` siap-tempel selain rotate (lihat §5). |
| `GET /:id` | Detail satu koneksi (DTO yang sama, tanpa secret). |
| `PATCH /:id` | Update parsial — field yang tidak dikirim tidak disentuh. Divalidasi ulang ke Odoo bila menyentuh `url`/`database`/`username`/`credential`. |
| `DELETE /:id` | Hapus. Ditolak `409 connection_in_use` kalau masih ada baris `identity_mappings` yang menunjuk ke koneksi ini. |
| `POST /:id/disable` | **CR-047.** Portal berhenti memakai koneksi ini — semua endpoint pelanggan yang jatuh padanya menjawab `503 odoo_connection_disabled`, `sync-companies`/`sync-users` `409`, `POST /users` yang memetakan user baru ke sini `422`, dan webhook provisioning-nya dijawab `200 skipped_connection_disabled` tanpa membuat user. **Tidak** diblokir oleh `identity_mappings` (tidak seperti `DELETE`) — justru koneksi berisi pelanggan itulah yang perlu dihentikan tanpa dihapus. Tidak menelepon Odoo, jadi tetap bekerja saat Odoo-nya mati. |
| `POST /:id/enable` | Kebalikannya. Tidak memvalidasi kredensial — menyalakan koneksi yang Odoo-nya sedang mati harus tetap mungkin. Peristiwa webhook yang terlewat selama koneksi mati tidak diputar ulang: jalankan `sync-users` sekali sesudahnya untuk menyusulkannya. |
| `POST /:id/test-connection` | Panggil `common.version()` + `authenticate()` ke Odoo sungguhan, lalu tulis `status`/`odoo_version`/`last_checked_at`/`last_error`. |
| `POST /:id/sync-companies` | Tarik `res.company` dari Odoo dan upsert ke `odoo_companies` (dipakai selector company di sesi login). Dengan body `{ "company_ids": [...] }` sekaligus mengubah company mana yang aktif; tanpa body, pilihan yang ada tidak disentuh. |
| `POST /:id/webhook-secret/rotate` | Generate secret baru (yang lama langsung tidak valid) dan kembalikan `webhook_url` baru — **hanya muncul sekali** di respons ini. |

`POST /check-connection`, `POST /`, dan `PATCH /:id` berbagi satu burst limiter in-memory
(`src/services/odooConnectionRateLimiter.js`, 12 panggilan/menit per admin, `429 rate_limited`).
Yang dibatasi adalah "berapa kali seorang admin boleh membuat backend ini menelepon Odoo", bukan
tiap endpoint sendiri-sendiri — `check-connection` menerima URL sembarang tanpa menyimpan apa pun,
jadi tanpa pembatas ia adalah pemindai jaringan yang rapi. Sama seperti dua pembatas lain di repo
ini, bucket-nya per-proses (tidak akurat kalau backend diskalakan multi-instance).

## 4. Alur setup koneksi baru

Urutannya **validasi dulu, simpan belakangan** (CR-044) — tidak ada lagi baris koneksi yang belum
pernah terbukti bekerja:

1. `POST /check-connection` dengan `url`, `username`, `credential` (+ `auth_type`). Tidak ada yang
   disimpan. Tiga kemungkinan jawaban:
   - `200 { status: 'connected', odoo_version, database, companies: [...] }` — lanjut ke langkah 2.
   - `200 { status: 'database_required', databases }` — Odoo terjangkau tapi nama database-nya
     belum bisa ditentukan sendiri (server melayani beberapa database, atau `list_db = False`
     sehingga `databases` bernilai `null`). Kirim ulang dengan `database` terisi. Ini **bukan**
     kegagalan kredensial — belum ada yang diautentikasi.
   - `422 odoo_unreachable` / `422 odoo_auth_failed` — perbaiki isian, ulangi.
2. `POST /` dengan `name`, `url`, `database` (nilai dari langkah 1), `username`, `auth_type`,
   `credential`, dan `company_ids` (company yang dipilih). Backend memverifikasi ulang, menyimpan
   baris berstatus `connected`, dan langsung mengisi `odoo_companies`. Tidak perlu
   `test-connection` maupun `sync-companies` menyusul.
3. Simpan `webhook_url` dari respons `POST /` (atau dari rotate) untuk dipasang di Odoo — lihat §5.

Kredensial lama yang basi diperbaiki dengan `PATCH /:id` (`credential` baru) — validasinya sudah
termasuk, jadi `POST /:id/test-connection` susulan tidak wajib lagi; tetap tidak perlu
hapus-buat-ulang baris.

**Efek samping yang disengaja:** koneksi baru tidak bisa disimpan saat Odoo-nya sedang mati atau
tidak terjangkau. Itu harga dari jaminan "setiap baris `odoo_connections` pernah diverifikasi" —
kalau suatu saat perlu menyiapkan konfigurasi secara buta (mis. Odoo baru dibangun), jalurnya
adalah INSERT SQL langsung, bukan melonggarkan endpoint-nya.

### 4b. Nama database ditemukan, bukan diketik

`OdooClient.listDatabases()` memanggil service `db` XML-RPC Odoo (`/xmlrpc/2/db`, method `list`) —
satu-satunya panggilan di kelas itu yang tidak butuh database maupun kredensial. Kalau server
menjawab tepat satu database, itulah yang dipakai dan admin tidak pernah melihat field Database.
Server dengan `list_db = False` (default Odoo.sh/SaaS) menjawab AccessDenied; itu **setting**, bukan
kegagalan, jadi hasilnya `null` dan admin diminta mengetik namanya. `version()` selalu dipanggil
lebih dulu supaya "URL salah" tidak pernah dilaporkan sebagai "sebutkan database-nya".

### 4c. "Select Company" menentukan apa

Semua company yang ditemukan tetap tersimpan di `odoo_companies` (supaya pilihannya bisa diubah
lagi tanpa mengetik ulang kredensial), tapi hanya yang dicentang yang `is_active = true`.
Konsumennya satu: `odooCompanyRepository.findByConnectionAndOdooCompanyId()` — dipakai ketiga
jalur provisioning user untuk menentukan company default seorang user baru. Company non-aktif
berperilaku persis seperti company yang belum pernah disinkron: fungsi itu mengembalikan `null`
dan user dibuat tanpa company (cabang yang memang sudah ditangani sejak BUG-25).

Yang **tidak** dilakukan: mencabut akses. `listForUser()` (company switcher) sengaja tidak
memfilter `is_active`, supaya mencentang-lepas sebuah company tidak diam-diam mencabut akses user
yang sudah terlanjur diberi company itu di `portal_user_companies`. Pencabutan akses tetap
perubahan `portal_user_companies` yang eksplisit.

## 5. Webhook provisioning (Odoo → Portal)

`webhook_secret` dipakai untuk mengamankan endpoint publik `POST
/api/v1/webhooks/odoo/:connectionId/:secret` (`src/routes/odooWebhooks.routes.js`) — route ini
sengaja **di luar** middleware `authenticate` karena Odoo tidak punya sesi JWT portal untuk
dikirim; secret di URL path itulah satu-satunya autentikasinya (dibandingkan timing-safe terhadap
`webhook_secret` tersimpan).

Cara pasang di Odoo: buat **Automation Rule** pada model kontak/partner, trigger saat Portal
Access diberikan, aksi **"Send a Webhook Notification"** ke URL yang didapat dari `POST /` atau
`POST /:id/webhook-secret/rotate`. Odoo tidak bisa mengirim header custom lewat aksi ini, jadi
jangan coba menambahkan auth header — path URL sudah cukup.

Payload yang diterima (`userProvisionedWebhookSchema`) longgar secara sengaja karena Odoo mengirim
field apa pun yang dipilih admin saat konfigurasi automation rule:

- `login` **atau** `email` (salah satu wajib, keduanya diterima sebagai alamat email user).
- `name` (opsional — fallback ke display name dari `partner_id` kalau kosong).
- `partner_id` (wajib) — boleh berupa integer polos atau tuple `[id, display_name]` (bentuk
  bawaan `read()` Odoo untuk field many2one).
- `company_id` (opsional, sejak [BUG-25](../../resolution.md#bug-25--tidak-ada-satu-jalur-pembuatan-user-pun-yang-pernah-mengisi-portal_user_companies-select-a-company-first-selamanya)) — bentuk sama dengan `partner_id`. **Sangat disarankan diisi**: tanpa
  ini, user hasil provisioning webhook mendarat tanpa company sama sekali (`portal_user_companies`
  kosong) — setiap endpoint yang butuh konteks Odoo (dashboard, quotations, invoices, dst.) akan
  menjawab `400 no_company_selected` selamanya, dan user itu sendiri tidak punya cara
  memperbaikinya sendiri (`GET /companies` juga kosong). Otomatis diabaikan dengan aman kalau
  company Odoo-nya belum pernah disinkron lewat `POST /:id/sync-companies` (fallback ke tanpa
  company, sama seperti sebelum field ini ada) — jalankan Sync Companies dulu di halaman *Setting
  > Koneksi Odoo* supaya field ini benar-benar berefek.

Rotasi secret (`POST /:id/webhook-secret/rotate`) langsung membuat konfigurasi lama di Odoo gagal
(404 generik, tidak membedakan connection id salah vs secret salah) — update action di Odoo dengan
URL baru segera setelah rotate.

## 6. Enkripsi & secret

- `credential` → kolom `encrypted_credential`, dienkripsi AES-256-GCM (`src/utils/crypto.js`)
  memakai `ENCRYPTION_KEY` dari `.env` (64 hex char / 32 byte). Didekripsi hanya saat dipakai
  (`test-connection`, `sync-companies`, dan tiap panggilan `OdooAuthService.openSession` di
  service domain lain) — tidak pernah dikirim balik ke klien.
- `webhook_secret` tersimpan **plaintext** di DB (bukan hash) karena admin perlu menempelnya
  kembali ke konfigurasi Odoo yang tidak punya secret manager sendiri — tetap disaring dari
  respons `GET`/`list`, hanya dikembalikan sekali oleh `create`/`rotate`.
- Mengganti `ENCRYPTION_KEY` di `.env` tanpa migrasi ulang akan membuat semua `encrypted_credential`
  lama gagal didekripsi — `encryption_key_version` ada untuk mendukung rotasi kunci bertahap, tapi
  belum ada tooling migrasi kunci otomatis di repo ini.

## 7. Keterbatasan yang diketahui

- UI frontend untuk CRUD koneksi mencakup create (wizard)/edit/test/sync/select-company/sync-users/
  webhook (lihat bagian atas) — **delete koneksi** masih API-only.
- Tidak ada endpoint API untuk men-set `status = 'disabled'` secara eksplisit.
- Koneksi baru tidak bisa disimpan saat Odoo-nya tidak terjangkau (§4) — konsekuensi yang
  disengaja dari validasi-sebelum-simpan.
- Burst limiter `check-connection`/create/patch hidup di memori proses, jadi tidak akurat kalau
  backend diskalakan multi-instance (sama seperti pembatas asisten dan equipment).
- `api/openapi.yaml` **sudah** mendokumentasikan sebagian besar grup endpoint ini (list, create,
  get, patch, delete, test-connection, sync-companies, companies sejak CR-037, dan
  sync-users sejak CR-039, dan check-connection sejak CR-044). Yang masih belum ada entrinya:
  `POST /:id/webhook-secret/rotate` — tambahkan saat endpoint itu disentuh.
