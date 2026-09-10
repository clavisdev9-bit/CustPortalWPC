---
name: asisten-aksi-tulis
description: >
  Standar wajib untuk menambahkan AKSI TULIS ke Asisten Portal (CustPortalCRM) — tool apa pun yang
  membuat data baru lewat chatbot: tiket helpdesk, RMA, klaim garansi, permintaan, atau aksi tulis
  baru mana pun. Pakai skill ini setiap kali muncul permintaan seperti "asisten bisa buatkan tiket",
  "chatbot bikin RMA", "bot langsung submit keluhan", "tambah tool draft_*", "kerjakan Fase 2",
  "endpoint confirm", atau saat mengubah `assistant_action_drafts`, `toolRegistry` dengan
  `kind: 'draft'`/`'write'`, atau `POST /assistant/drafts/:id/confirm`. Pakai juga saat me-review
  kode aksi tulis asisten yang sudah ada. Alur draf→konfirmasi di sini adalah batas keamanan
  (invarian I-5), bukan preferensi gaya — jangan mengarang alur sendiri, dan jangan mengasumsikan
  pola tool baca yang sudah ada cukup untuk aksi tulis.
---

# Aksi tulis Asisten Portal

Sumber kebenaran: [`Docs/CR/customer_portal_ai_assistant.md`](../../../Docs/CR/customer_portal_ai_assistant.md)
§13 (Fase 2). Skill ini adalah versi operasionalnya — apa yang harus ditulis, di mana, dan kenapa.

Kalau skill ini bertentangan dengan spec, **spec yang menang** — lalu perbaiki skill ini.

---

## Aturan yang membatalkan segalanya kalau dilanggar

**LLM hanya menghasilkan DRAF. Eksekusi hanya terjadi karena klik tombol pengguna.**

Ini invarian I-5, dan alasannya bukan kehati-hatian berlebihan. Model kecil salah menafsirkan
persetujuan. "Iya" bisa berarti "iya, saya mengerti", "iya, lanjutkan menjelaskan", atau "iya,
kirim". Ketiganya terlihat identik dalam token. Kalau eksekusi digantungkan pada tafsiran itu,
sebagian pelanggan akan menemukan tiket yang tidak pernah mereka minta — dan di sisi vendor,
antrean helpdesk terisi sampah yang tidak bisa dibedakan dari keluhan asli.

Konsekuensi konkretnya:

- Tool `draft_*` **tidak boleh** memanggil service yang menulis. Ia hanya menulis satu baris
  `assistant_action_drafts`.
- Persetujuan verbal **tidak pernah** cukup, seberapa pun eksplisitnya.
- Kalau kamu menemukan diri sedang menulis `if (userSaidYes)` di dalam kode asisten, berhenti.
  Itu tandanya alurnya sudah salah.

---

## Bentuk wajib: dua jalur terpisah

```
Pengguna mengeluh
   │
   ▼
tool draft_ticket  ──►  INSERT assistant_action_drafts (status='pending', expires_at)
   │                     (tidak menyentuh Odoo sama sekali)
   ▼
SSE  event: draft   ──►  DraftConfirm.jsx menampilkan payload lengkap
   │
   │  ...pengguna MEMBACA, boleh mengubah, lalu MENGKLIK Kirim
   ▼
POST /assistant/drafts/:id/confirm   ◄── permintaan HTTP baru, dipicu klik
   │
   ▼
service domain (helpdeskService.createTicket / rmaService.createRma / ...)
   │
   ▼
resolveOdooContext → partner_id + company_id terkunci → Odoo
```

Dua kotak itu **tidak boleh** menyatu. Kalau ada satu jalur kode yang bisa berjalan dari hasil LLM
sampai ke `session.create()` tanpa melewati permintaan HTTP kedua, invariannya sudah bocor.

---

## Anatomi tool draft

Sama seperti tool baca ([`src/services/assistant/tools/`](../../../src/services/assistant/tools/)),
dengan empat perbedaan: `kind: 'draft'`, permission-nya permission **aksi**, handler menulis draf,
dan skema argumennya **diambil dari `actions.js`** alih-alih didefinisikan ulang.

```js
// src/services/assistant/tools/support.js
{
  name: 'draft_ticket',
  kind: 'draft',
  permission: 'ticket.create',              // permission AKSI, bukan ticket.view
  description:
    'Menyiapkan DRAF tiket support dari keluhan pengguna. Tool ini TIDAK mengirim apa pun -- ' +
    'pengguna yang menekan tombol kirim. Tulis "name" sebagai subjek yang jelas bagi staf, dan ' +
    '"description" dengan kata-kata pengguna sendiri. Pahami dulu masalahnya sebelum memanggilnya.',
  args: actions.get('create_ticket').draftSchema,   // SATU sumber skema, lihat di bawah
  handler: (ctx, args) => draftService.create(ctx, 'create_ticket', args),
  summarize: () => draftSummary('tiket'),           // tidak boleh mengaku sudah mengirim
}
```

Lima hal yang gampang salah:

1. **Skema jangan didefinisikan ulang di sini.** [`actions.js`](../../../src/services/assistant/actions.js)
   memegang dua skema per aksi: `schema` (persis milik endpoint REST, dipakai `confirm` untuk
   validasi ulang) dan `draftSchema` (turunan yang lebih ketat, dipakai tool). Pengetatannya satu
   arah — apa pun yang lolos `draftSchema` dijamin lolos `schema` — sehingga draf yang sah tidak
   pernah ditolak saat dikonfirmasi. Tool yang punya skema sendiri akan menyimpang diam-diam dari
   apa yang `confirm` validasi.
2. **Draf TIDAK memakai `card`.** Sistem kartu memuat ulang datanya dari endpoint portal lewat
   ref, sedangkan draf belum jadi record apa pun. `DraftConfirm.jsx` yang merendernya, digerakkan
   event SSE `draft`.
3. **`summarize` tidak boleh mengaku sudah mengirim.** Model membaca ringkasan ini lalu
   meneruskannya ke pengguna — "tiket sudah dibuat" adalah kebohongan yang lahir persis di sini.
   Pola yang dipakai: kalimatnya secara eksplisit menyuruh model TIDAK mengatakan sudah terkirim.
4. **Payload tersimpan dalam bentuk skema VALIDATOR (snake_case), bukan bentuk service (camelCase).**
   Jebakan nyata di repo ini: `createRmaSchema` menghasilkan `{order_id, requested_action}`
   sementara `rmaService.createRma` menerima `{orderId, requestedAction}`. `actions.js.execute`
   yang memetakannya, di satu tempat.
5. **`expires_at` wajib.** 30 menit (`draftService.DRAFT_TTL_MS`).

---

## Anatomi endpoint confirm

Logikanya hidup di [`draftService.confirm`](../../../src/services/assistant/draftService.js),
**bukan di controller**. Alasannya praktis: controller butuh objek `req`, dan itu membuat seluruh
urutan pemeriksaan mustahil diuji tanpa menjalankan server. Controller tinggal menurunkan
`connectionId` dan mencatat audit.

Enam pemeriksaan, **berurutan**. Urutannya bukan selera — tiap langkah mengandaikan langkah
sebelumnya sudah lulus.

```js
// src/services/assistant/draftService.js
async function confirm(userId, companyId, connectionId, draftId) {
  // 1. Ada DAN milik pemanggil. Query-nya join ke assistant_conversations supaya kepemilikan
  //    dan connection diverifikasi sekaligus. 404, bukan 403.
  const draft = await loadOwnDraft(draftId, userId, connectionId);

  // 2. Masih pending.
  if (draft.status !== 'pending') throw new ApiError(409, 'draft_not_pending', ...);

  // 3. Belum kedaluwarsa; yang basi ditandai supaya tidak terus tampil sebagai draf menunggu.
  if (new Date(draft.expires_at) < new Date()) {
    await assistantRepository.markDraftStatus(draft.id, 'expired');
    throw new ApiError(410, 'draft_expired', ...);
  }

  const spec = specFor(draft.action);

  // 4. Validasi ulang dengan skema endpoint ASLINYA. Payload di DB lahir dari keluaran LLM;
  //    mempercayainya karena "sudah tersimpan" sama dengan mempercayai LLM lewat jalan memutar.
  const payload = spec.schema.parse(draft.payload);

  // 5. Permission aksi diperiksa DI SINI juga -- peran bisa dicabut dalam 30 menit sejak draf.
  //    Dari services/assistant/permissions.js, BUKAN dari toolRegistry (lihat jebakan #2).
  await permissions.assertPermission(userId, spec.permission);

  // 6. Klaim hak eksekusi SEBELUM memanggil service. Ini penjaga klik-ganda yang sebenarnya:
  //    dua permintaan yang tiba bersamaan sama-sama lolos lima pemeriksaan di atas, tapi
  //    markDraftStatus memakai `WHERE status = 'pending'` sehingga hanya satu yang menang.
  //    Memeriksa status di langkah 2 saja TIDAK cukup -- itu balapan, bukan kunci.
  const claimed = await assistantRepository.markDraftStatus(draft.id, 'confirmed');
  if (!claimed) throw new ApiError(409, 'draft_not_pending', ...);

  let result;
  try {
    result = await spec.execute(userId, companyId, payload);
  } catch (err) {
    // Gagal eksekusi -> kembalikan ke pending supaya pengguna bisa mengulang tanpa menyusun
    // ulang keluhannya dari nol.
    await assistantRepository.markDraftStatus(draft.id, 'pending');
    throw err;
  }
  // ... markDraftConfirmed, lampirkan transkrip (best-effort), catat pesan hasil
}
```

Route-nya memakai `requirePermission('assistant.use')`, bukan permission aksinya:

```js
// Satu route melayani tiga aksi dengan tiga permission berbeda, jadi gerbang statis di router
// tidak bisa tahu mana yang berlaku. Permission aksinya diperiksa di langkah 5, terhadap draf
// yang bersangkutan.
router.patch('/drafts/:id', requirePermission('assistant.use'), assistantController.updateDraft);
router.post('/drafts/:id/confirm', requirePermission('assistant.use'), assistantController.confirmDraft);
router.post('/drafts/:id/cancel', requirePermission('assistant.use'), assistantController.cancelDraft);
```

**Menyunting draf.** Pengguna boleh memperbaiki draf sebelum mengirim, dan suntingannya ditulis ke
baris draf lewat `PATCH` — bukan dititipkan di body `confirm`. Itu yang menjaga properti "payload
yang dieksekusi adalah payload yang ditinjau", dan membuat jejak auditnya menunjukkan apa yang
benar-benar dikirim. Suntingan divalidasi dengan `draftSchema` yang ketat, bukan skema REST.

---

## Routing tiga jalur

Keluhan tidak semuanya jadi tiket. Salah jalur berarti pelanggan menunggu di antrean yang salah.

| Situasi | Jalur | Service |
|---|---|---|
| Minta uang kembali atau tukar barang | RMA | `rmaService.createRma` |
| Barang cacat **dan** ada nomor seri | Garansi | `warrantyService.createClaim` |
| Sisanya | Tiket umum | `helpdeskService.createTicket` |

**Jangan pernah** mengarahkan keluhan ke `POST /requests`. Itu jalur permintaan **penjualan** —
keluhan yang masuk ke sana hilang dari pipeline helpdesk dan tidak akan pernah ditangani.

Sebelum menawarkan draf, panggil `list_orders` dan `list_deliveries` lebih dulu lalu **tawarkan
kandidatnya**. Menyuruh pelanggan yang sedang kesal mengingat nomor PO adalah cara cepat membuat
mereka menyerah.

---

## Empati hidup di prompt, bukan di kode

Kalau requirement-nya "asisten harus berempati", jangan menulis template balasan di JS. Itu
melanggar anti-pattern §16 (prompt sebagai literal) dan menghapus kemampuan rollback.

Nada bicara diatur di baris `assistant_prompts` dengan `key='system'`, bagian GAYA. Yang sudah ada
di seed `0013_assistant_prompts.sql`:

> Untuk keluhan: akui dulu perasaan pengguna dalam satu kalimat yang tulus, baru bertindak.
> Ajukan satu pertanyaan per pesan, jangan memberondong.

Kalau perlu alur wawancara keluhan yang lebih terarah, tambahkan **versi prompt baru** (atau
`key='ticket_intake'`) lewat `POST /admin/assistant/prompts`, uji, lalu aktifkan. Jangan sentuh
kode orkestrator untuk itu.

Satu batas yang tetap berlaku meski nadanya hangat: asisten **tidak boleh menjanjikan waktu
respons, tanggal kirim, atau hasil penanganan**. Empati adalah mengakui perasaan, bukan membuat
komitmen atas nama perusahaan.

---

## Dua jebakan yang sudah memakan waktu

**1. `check-assistant-invariants.js` mencari STRING mentah, bukan `require`.**

Spec §7.3 memintanya begitu, dan itu memang disengaja tumpul. Akibatnya: menulis `integrations/odoo`
atau `OdooClient` **di dalam komentar** — misalnya saat menjelaskan invarian I-2 — akan
menggagalkan check. Jelaskan invariannya tanpa mengutip path terlarangnya. Jangan melonggarkan
check-nya supaya komentar jadi enak; ketumpulan itulah yang membuatnya tidak bisa diakali.

**2. Modul permission tidak boleh hidup di `toolRegistry`.**

`toolRegistry` → `tools/support.js` → `draftService`. Kalau `draftService` juga meng-`require`
`toolRegistry` (misalnya untuk memakai pemeriksaan permission-nya), siklusnya tertutup dan
`toolRegistry` hanya setengah terinisialisasi saat `draftService` membacanya. Gejalanya bukan
error saat load, tapi `assertPermission is not a function` **saat runtime, di jalur eksekusi aksi
tulis** — tempat paling buruk untuk menemukan kegagalan.

Aturan permission tinggal di [`src/services/assistant/permissions.js`](../../../src/services/assistant/permissions.js),
yang tidak meng-import apa pun dari lapisan asisten. Pakai dari sana.

---

## Periksa ini SEBELUM menulis kode

Dua celah di repo ini akan membuat fitur "tampak jalan tapi tidak berguna" kalau dilewati.

**1. Permission aksi menentukan siapa yang bisa dibantu — periksa distribusinya dulu.**

Tool `draft_*` hanya dikirim ke model kalau penggunanya punya permission aksinya. Distribusi saat
ini (seed `0004`, `0005`, `0014`):

| Permission | Role |
|---|---|
| `ticket.view`, `ticket.create`, `ticket.reply` | Customer Admin, Finance, Procurement, Viewer |
| `rma.create`, `warranty.create`, `ticket.close` | Customer Admin saja |

Artinya untuk tiga role non-admin, `draft_rma` dan `draft_warranty` **tidak pernah ada** dari sudut
pandang model — permintaan refund mereka jatuh ke tiket umum, dan staf yang mengonversinya. Itu
disengaja: membuat tiket adalah meminta bantuan, sedangkan RMA dan klaim garansi berkonsekuensi
komersial.

Sebelum menambah aksi tulis baru, putuskan lebih dulu ia masuk kelas yang mana. Dan jangan
memperluas permission diam-diam: kode seperti `ticket.create` berlaku di **seluruh portal**, bukan
hanya di widget asisten, jadi itu keputusan produk yang perlu diajukan terpisah.

**2. Tidak ada field urgensi.**

`createTicketSchema` hanya menerima `name` dan `description`. `OdooHelpdeskService.createTicket`
hanya menulis `name`, `description`, `partner_id`, `company_id`. Kolom `priority` **dibaca** di
`LIST_FIELDS` tapi tidak pernah **ditulis**.

Artinya "pelanggan butuh respons cepat" saat ini hanya bisa masuk sebagai teks di dalam
`description` — tidak terstruktur, tidak bisa dipakai SLA atau penyortiran antrean di Odoo.

Memperbaikinya berarti memperluas `helpdeskService.createTicket` + `createTicketSchema` +
`OdooHelpdeskService.createTicket`, dan itu **di luar cakupan kerja asisten** — perubahan di modul
tiket yang ikut memengaruhi `POST /tickets` biasa. Ajukan terpisah. Kalau dikerjakan, verifikasi
dulu nilai selection `priority` di instance Odoo target (`fields_get`); nilainya berbeda antar
versi dan antar addon.

---

## Checklist sebelum menyatakan selesai

- [ ] Tidak ada satu pun jalur dari hasil LLM ke service tulis tanpa permintaan HTTP kedua
- [ ] Draf kedaluwarsa tidak bisa dikonfirmasi
- [ ] Draf milik user A tidak bisa dikonfirmasi user B — **diuji langsung**, bukan dibaca dari kode
- [ ] Konfirmasi ganda pada draf yang sama menghasilkan satu record, bukan dua
- [ ] Payload divalidasi ulang dengan skema endpoint aslinya di `confirm`
- [ ] Permission diperiksa di `confirm`, bukan hanya saat draf dibuat
- [ ] `order_id` milik pelanggan lain ditolak oleh validasi service yang sudah ada
- [ ] "Iya, buat saja" **tidak** memicu eksekusi — diuji dengan kalimat persetujuan yang eksplisit
- [ ] Routing benar pada skenario keluhan berlabel (spec minta 20)
- [ ] Setelah sukses: nomor tiket disebut, deep link diberikan, transkrip percakapan dilampirkan
      sebagai reply pertama (`helpdeskService.replyTicket`) supaya staf punya konteks penuh
- [ ] `auditService.record` action `assistant.action` tercatat
- [ ] `api/openapi.yaml` diperbarui
- [ ] `scripts/check-assistant-invariants.js` lulus
- [ ] `scripts/check-assistant-flow.js` lulus, **dengan kasus baru untuk aksi tulis**

Kasus yang wajib ditambahkan ke `check-assistant-flow.js` — semuanya bisa dijalankan dengan
provider di-stub, jadi tidak ada alasan menundanya sampai Odoo hidup:

```
- tool draft_* TIDAK memanggil service tulis (stub service, pastikan tidak pernah terpanggil)
- draf tersimpan dengan status 'pending' dan expires_at di masa depan
- confirm pada draf kedaluwarsa -> 410
- confirm dua kali -> yang kedua 409
- confirm draf milik user lain -> 404
- payload yang dirusak di DB ditolak oleh parse ulang, bukan diteruskan ke service
```

---

## Anti-pattern

| Jangan | Sebabnya |
|---|---|
| Eksekusi setelah "iya" verbal | Model kecil salah tafsir persetujuan (I-5) |
| Handler `draft_*` memanggil service tulis | Menghapus batas draf/eksekusi |
| Menyimpan payload dalam bentuk camelCase service | `confirm` tidak bisa mem-`parse()` ulang dengan skema aslinya |
| Percaya payload di DB tanpa validasi ulang | Payload itu berasal dari LLM, lewat jalan memutar |
| Cek permission hanya saat draf dibuat | Peran bisa dicabut di antara draf dan konfirmasi |
| Template empati sebagai literal di JS | Anti-pattern §16; hilang kemampuan rollback |
| Mengarahkan keluhan ke `POST /requests` | Itu jalur penjualan — keluhan hilang dari helpdesk |
| Menambah permission baru untuk aksi asisten | Pakai `ticket.create`/`rma.create`/`warranty.create` yang sudah ada |
| Menjanjikan waktu respons di jawaban asisten | Komitmen atas nama perusahaan, di luar cakupan (§9.1 aturan 8) |
