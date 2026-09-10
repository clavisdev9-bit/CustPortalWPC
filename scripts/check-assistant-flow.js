// Verifikasi orkestrasi Fase 1 (Docs/CR/customer_portal_ai_assistant.md section 12), dengan
// provider LLM dan Odoo di-stub. Jalankan: `node scripts/check-assistant-flow.js`.
// Keluar non-zero kalau ada yang gagal.
//
// Yang diuji di sini adalah hal-hal yang TIDAK bisa dibuktikan dengan menjalankan sistem asli:
// I-4 hanya menyala saat model mengarang angka, dan urutan event SSE hanya bisa diperiksa kalau
// jawaban model deterministik. Dua-duanya butuh model yang berkelakuan sesuai perintah kita,
// bukan sesuai peluang -- karena itu provider-nya di-stub, bukan dipanggil sungguhan.
//
// Yang SENGAJA tidak di-stub: repository, rate limiter, prompt builder, tool registry, dan
// penegakan permission. Semuanya berjalan sungguhan terhadap portal DB.
const pool = require('../src/db/pool');
const providers = require('../src/services/assistant/providers');
const invoiceService = require('../src/services/invoiceService');
const assistantService = require('../src/services/assistantService');
const assistantConfigRepository = require('../src/repositories/assistantConfigRepository');
const assistantRepository = require('../src/repositories/assistantRepository');
const promptBuilder = require('../src/services/assistant/promptBuilder');
const draftService = require('../src/services/assistant/draftService');
const helpdeskService = require('../src/services/helpdeskService');
const equipmentService = require('../src/services/equipmentService');

let failed = false;

function check(label, condition, detail) {
  if (condition) {
    console.log(`OK   ${label}`);
  } else {
    console.error(`FAIL ${label}${detail ? ` -- ${detail}` : ''}`);
    failed = true;
  }
}

// req tiruan untuk auditService.record: ia hanya membaca req.user, req.ip, dan header user-agent.
const fakeReq = { user: null, ip: '127.0.0.1', headers: { 'user-agent': 'check-assistant-flow' } };

// Provider palsu yang mengembalikan giliran yang sudah ditentukan, satu per panggilan.
// Mengembalikan penghitung supaya pemanggil bisa membuktikan BERAPA KALI provider disentuh --
// itu satu-satunya cara menguji percobaan ulang saat jawaban kosong.
function stubProvider(turns) {
  const counter = { calls: 0 };
  providers.chat = async (_provider, { onDelta }) => {
    const turn = turns[Math.min(counter.calls, turns.length - 1)];
    counter.calls += 1;
    if (turn.content && onDelta) onDelta(turn.content);
    return { content: turn.content || '', toolCalls: turn.toolCalls || [], usage: { promptTokens: 1, completionTokens: 1 } };
  };
  return counter;
}

// Subjek uji harus punya 'equipment.correct' (bukan cuma 'ticket.create'): kasus aksi tulis di
// bawah menjalankan pemeriksaan permission yang SUNGGUHAN, bukan versi di-stub. Customer Admin
// -- satu-satunya role dengan equipment.correct (seed 0018) -- juga punya ticket.create (seed
// 0014), jadi menyaring pada permission yang lebih sempit ini tidak mematahkan kasus tiket yang
// sudah ada. Tanpa syarat ini testnya akan gagal karena user yang kebetulan terpilih tidak
// berhak -- kegagalan yang tidak berkata apa-apa tentang kodenya.
async function findSubject() {
  const { rows } = await pool.query(
    `SELECT pu.id AS user_id, oc.id AS company_id, oc.odoo_connection_id AS connection_id
     FROM portal_users pu
     JOIN identity_mappings im ON im.portal_user_id = pu.id
     JOIN odoo_companies oc ON oc.odoo_connection_id = im.odoo_connection_id
     WHERE pu.status = 'active'
       AND (pu.is_platform_admin OR EXISTS (
         SELECT 1 FROM portal_user_roles ur
         JOIN portal_role_permissions rp ON rp.role_id = ur.role_id
         JOIN portal_permissions p ON p.id = rp.permission_id
         WHERE ur.user_id = pu.id AND p.code = 'equipment.correct'
       ))
     LIMIT 1`
  );
  return rows[0] || null;
}

async function run() {
  const subject = await findSubject();
  if (!subject) {
    console.error('FAIL no active portal user with an identity_mapping + company -- seed one first');
    process.exit(1);
  }
  fakeReq.user = { id: subject.user_id };

  // Settings global sementara supaya hasilnya tidak bergantung pada isi .env mesin yang menjalankan.
  const before = (await assistantConfigRepository.findSettings(null)).global;
  await assistantConfigRepository.upsertSettings(null, {
    provider: 'ollama', model: 'stub-model', enabled: true,
    daily_message_quota: 1000, burst_per_minute: 1000, max_tool_iterations: 3, history_window: 10,
  }, subject.user_id);
  // BUG-27 (resolution.md): assistant_provider_configs (0012_assistant_provider_configs.sql)
  // dibaca SEBELUM kolom assistant_settings.model di atas (assistantConfigService.resolve --
  // "Konfigurasi Provider AI" lapisnya menang lebih dulu). Kalau ada baris provider_configs
  // sungguhan untuk 'ollama' (kondisi NORMAL di deployment mana pun yang benar-benar memakai
  // fitur ini), 'stub-model' di atas akan tertutup diam-diam oleh model sungguhan, dan assertion
  // 'model + latensi' di bawah gagal semu -- bukan karena orkestrasi rusak, tapi karena kedua
  // lapis config sama-sama diisi punya sumber berbeda. Baris provider_configs juga di-override
  // sementara di sini, pola sama seperti assistant_settings di atas.
  const beforeProviderConfig = (await assistantConfigRepository.findProviderConfig(null, 'ollama')).global;
  await assistantConfigRepository.upsertProviderConfig(null, 'ollama', {
    model: 'stub-model', base_url: null, ollama_target: 'auto',
    ollama_model_manual: null, encrypted_api_key: null, encrypted_api_key_cloud: null,
  }, subject.user_id);
  require('../src/services/assistantConfigService').invalidate();

  const createdConversations = [];
  const realGetOutstanding = invoiceService.getOutstanding;
  const realChat = providers.chat;
  const realCreateTicket = helpdeskService.createTicket;
  const realReplyTicket = helpdeskService.replyTicket;
  const realCreateCorrection = equipmentService.createCorrection;

  try {
    // ---------------------------------------------------------------- kasus 1
    // Jalur sukses: model memanggil tool, tool berhasil, lalu model menjawab dengan angka.
    invoiceService.getOutstanding = async () => ({ total: 1234.5, count: 3, currency: 'IDR' });
    stubProvider([
      { content: 'sebentar saya cek', toolCalls: [{ name: 'get_outstanding_invoices', args: {} }] },
      { content: 'Ada 3 invoice outstanding, total 1234.5 IDR.' },
    ]);

    const events = [];
    const result = await assistantService.converse({
      userId: subject.user_id,
      companyId: subject.company_id,
      message: 'Berapa outstanding saya?',
      locale: 'id',
      route: '/invoices',
      emit: (event, data) => events.push({ event, data }),
      req: fakeReq,
    });
    createdConversations.push(result.conversationId);

    const names = events.map((e) => e.event);
    check('event `reset` terkirim saat giliran ternyata memanggil tool', names.includes('reset'));
    check('event `tool_call` terkirim', names.includes('tool_call'));
    check('event `card` terkirim', names.includes('card'));
    check('event `done` terkirim terakhir', names[names.length - 1] === 'done', names.join(','));
    check('urutan: reset mendahului tool_call', names.indexOf('reset') < names.indexOf('tool_call'));

    const card = events.find((e) => e.event === 'card');
    check('card membawa type dari registry', card?.data.type === 'OutstandingSummary', JSON.stringify(card?.data));
    check(
      'card membawa REF saja, bukan datanya',
      card && !JSON.stringify(card.data.ref || {}).includes('1234.5'),
      JSON.stringify(card?.data.ref)
    );

    check('jawaban berbasis tool boleh memuat angka', /1234\.5/.test(result.content), result.content);

    const messages = await assistantRepository.listMessages(result.conversationId);
    check('pesan user tersimpan', messages.some((m) => m.role === 'user' && m.content === 'Berapa outstanding saya?'));
    check('baris tool tersimpan dengan ringkasan', messages.some((m) => m.role === 'tool' && m.tool_summary));
    check(
      'ringkasan tool tersimpan, payload Odoo mentah TIDAK',
      messages.filter((m) => m.role === 'tool').every((m) => m.tool_summary && !m.content),
    );
    check('jawaban assistant tersimpan dengan model + latensi', messages.some((m) => m.role === 'assistant' && m.model === 'stub-model' && m.latency_ms !== null));

    // ---------------------------------------------------------------- kasus 2
    // I-4: tidak ada tool yang berhasil, tapi model tetap mengarang angka. Jawabannya WAJIB
    // diganti penolakan -- ini penjagaan yang tidak boleh diserahkan ke prompt.
    stubProvider([{ content: 'Tagihan Anda 9.999.000 rupiah, jatuh tempo 3 Januari.' }]);

    const events2 = [];
    const result2 = await assistantService.converse({
      userId: subject.user_id,
      companyId: subject.company_id,
      message: 'Berapa tagihan saya?',
      locale: 'id',
      emit: (event, data) => events2.push({ event, data }),
      req: fakeReq,
    });
    createdConversations.push(result2.conversationId);

    // Asersinya "isinya PERSIS teks penolakan aktif", bukan "tidak memuat digit". Yang dijaga
    // I-4 adalah angka KARANGAN MODEL; teks penolakan sendiri boleh saja memuat angka (admin
    // wajar menulis "hubungi kami di 24 jam layanan"). Menguji ketiadaan digit akan gagal pada
    // penolakan yang sah sekaligus lolos pada penolakan yang salah, jadi ia mengukur hal keliru.
    const activeRefusal = await promptBuilder.getRefusal('id');
    check('I-4: angka tanpa hasil tool diganti teks penolakan', result2.content === activeRefusal, result2.content);
    check('I-4: penolakannya berasal dari assistant_prompts, bukan literal di kode', activeRefusal.length > 20);

    // ---------------------------------------------------------------- kasus 3
    // Tool gagal (Odoo mati) tetap harus menghasilkan jawaban, bukan 500 -- dan karena tidak ada
    // tool yang BERHASIL, aturan I-4 tetap berlaku.
    invoiceService.getOutstanding = async () => { throw new Error('Odoo unreachable'); };
    stubProvider([
      { content: '', toolCalls: [{ name: 'get_outstanding_invoices', args: {} }] },
      { content: 'Maaf, datanya belum bisa saya ambil sekarang.' },
    ]);

    const events3 = [];
    const result3 = await assistantService.converse({
      userId: subject.user_id,
      companyId: subject.company_id,
      message: 'Coba lagi dong',
      locale: 'id',
      emit: (event, data) => events3.push({ event, data }),
      req: fakeReq,
    });
    createdConversations.push(result3.conversationId);

    check('tool gagal tidak menjatuhkan percakapan', Boolean(result3.content));
    check('tool gagal: tidak ada event card', !events3.some((e) => e.event === 'card'));
    const failedMessages = await assistantRepository.listMessages(result3.conversationId);
    check('tool gagal tercatat dengan error_code', failedMessages.some((m) => m.role === 'tool' && m.error_code));

    // ---------------------------------------------------------------- kasus 4
    // Percakapan milik orang lain harus tidak ditemukan, bukan ditemukan lalu ditolak.
    const foreign = await assistantRepository.findConversation(
      result.conversationId,
      '00000000-0000-0000-0000-000000000000',
      subject.company_id
    );
    check('percakapan user lain tidak terbaca', foreign === null);

    // ---------------------------------------------------------------- kasus 5
    // Kuota HARIAN (bukan burst) harus menghasilkan 429, bukan 500. Dua cabang rate limit itu
    // gampang tertukar saat diuji manual: burst menyala lebih dulu dan menutupi cabang kuota,
    // sehingga cabang kuota bisa lolos ke produksi tanpa pernah dijalankan sekali pun.
    // Di sini burst dibuat longgar dan kuota dibuat 1, jadi hanya cabang kuota yang bisa menyala.
    await assistantConfigRepository.upsertSettings(null, {
      daily_message_quota: 1, burst_per_minute: 1000,
    }, subject.user_id);
    require('../src/services/assistantConfigService').invalidate();

    // Provider di-stub gagal keras: kalau kuota TIDAK menahan, kegagalannya akan terlihat sebagai
    // error provider, bukan lolos diam-diam sebagai sukses.
    providers.chat = async () => { throw new Error('provider seharusnya tidak pernah dipanggil'); };

    let quotaError = null;
    try {
      await assistantService.converse({
        userId: subject.user_id,
        companyId: subject.company_id,
        message: 'Pesan yang harus tertahan kuota',
        locale: 'id',
        emit: () => {},
        req: fakeReq,
      });
    } catch (err) {
      quotaError = err;
    }
    check('kuota harian terlampaui -> ditolak', quotaError !== null);
    check('kuota harian -> HTTP 429, bukan 500', quotaError?.status === 429, `status=${quotaError?.status}`);
    check('kuota harian -> code rate_limited', quotaError?.code === 'rate_limited', quotaError?.code);
    check(
      'kuota diperiksa SEBELUM provider dipanggil',
      quotaError?.message?.includes('Daily'),
      quotaError?.message
    );

    // Kuota dilonggarkan lagi: kasus berikutnya memanggil converse() sungguhan, dan kuota 1 yang
    // tertinggal akan menahannya sebelum satu pun asersi aksi tulis sempat dijalankan.
    await assistantConfigRepository.upsertSettings(null, {
      daily_message_quota: 1000, burst_per_minute: 1000,
    }, subject.user_id);
    require('../src/services/assistantConfigService').invalidate();
    // ------------------------------------------------- kasus 6: aksi tulis
    // Inti I-5: tool draf TIDAK boleh menyentuh service tulis. Stub di bawah menghitung setiap
    // panggilan; kalau angkanya bukan nol setelah model memanggil draft_ticket, batas antara
    // "menyiapkan" dan "mengeksekusi" sudah bocor.
    let createTicketCalls = 0;
    let replyCalls = 0;
    helpdeskService.createTicket = async (_u, _c, payload) => {
      createTicketCalls += 1;
      return { id: 4242, name: payload.name, description: payload.description };
    };
    helpdeskService.replyTicket = async () => { replyCalls += 1; return {}; };

    stubProvider([
      { content: 'saya bantu buatkan tiketnya', toolCalls: [{ name: 'draft_ticket', args: { name: 'Barang diterima rusak', description: 'Kardus penyok dan isinya retak.' } }] },
      { content: 'Draf tiketnya sudah saya siapkan, silakan periksa lalu tekan kirim.' },
    ]);

    const events6 = [];
    const result6 = await assistantService.converse({
      userId: subject.user_id,
      companyId: subject.company_id,
      message: 'Barang saya datang dalam keadaan rusak',
      locale: 'id',
      emit: (event, data) => events6.push({ event, data }),
      req: fakeReq,
    });
    createdConversations.push(result6.conversationId);

    const draftEvent = events6.find((e) => e.event === 'draft');
    check('aksi tulis: event draft terkirim', Boolean(draftEvent));
    check('I-5: tool draf TIDAK memanggil service tulis', createTicketCalls === 0, 'terpanggil ' + createTicketCalls + 'x');
    check('aksi tulis: draf tidak memakai sistem kartu', !events6.some((e) => e.event === 'card'));

    const draftId = draftEvent && draftEvent.data.draft_id;
    const storedDraft = await assistantRepository.findDraftForUser(draftId, subject.user_id, subject.connection_id);
    check('draf tersimpan dengan status pending', storedDraft && storedDraft.status === 'pending', storedDraft && storedDraft.status);
    check('draf punya expires_at di masa depan', new Date(storedDraft.expires_at) > new Date());
    check('payload draf disimpan dalam bentuk skema validator', 'name' in storedDraft.payload && 'description' in storedDraft.payload);

    // I-5, diuji lewat pintunya sendiri: pengguna menyetujui SECARA VERBAL dan model menjawab
    // seolah sudah mengirim. Tidak boleh ada apa pun yang terkirim. Ini bukan pengulangan asersi
    // di atas -- yang itu membuktikan tool draf tidak mengeksekusi, yang ini membuktikan tidak ada
    // jalur lain di orkestrator yang bisa dipicu oleh kalimat persetujuan.
    stubProvider([{ content: 'Baik, tiketnya sudah saya kirimkan ke tim support.' }]);
    const verbal = await assistantService.converse({
      userId: subject.user_id,
      companyId: subject.company_id,
      conversationId: result6.conversationId,
      message: 'Iya, kirim saja sekarang',
      locale: 'id',
      emit: () => {},
      req: fakeReq,
    });
    check('I-5: persetujuan verbal tidak mengeksekusi apa pun', createTicketCalls === 0, 'terpanggil ' + createTicketCalls + 'x');
    check('I-5: draf masih pending setelah persetujuan verbal',
      (await assistantRepository.findDraftForUser(draftId, subject.user_id, subject.connection_id)).status === 'pending');
    // Bonus yang jatuh dari I-4: giliran tanpa hasil tool ini memuat kata "sudah saya kirimkan"
    // tanpa digit, jadi ia lolos apa adanya. Yang menahan klaim palsu di sini bukan I-4 melainkan
    // ketiadaan jalur eksekusi -- dan prompt yang melarang model mengaku sudah mengirim.
    check('percakapan tetap berjalan normal setelah itu', Boolean(verbal.content));

    const foreignConfirm = await draftService
      .confirm('00000000-0000-0000-0000-000000000000', subject.company_id, subject.connection_id, draftId)
      .then(() => null, (e) => e);
    check('confirm draf milik user lain -> 404', foreignConfirm && foreignConfirm.status === 404, 'status=' + (foreignConfirm && foreignConfirm.status));
    check('I-5: draf orang lain tidak dieksekusi', createTicketCalls === 0);

    // Konfirmasi sungguhan: BARU di sini service tulis boleh terpanggil.
    const outcome = await draftService.confirm(subject.user_id, subject.company_id, subject.connection_id, draftId);
    check('confirm memanggil service tulis tepat sekali', createTicketCalls === 1, 'terpanggil ' + createTicketCalls + 'x');
    check('label hasil memuat nomor record dari service', /4242/.test(outcome.label), outcome.label);
    check('deep link menunjuk record yang benar', outcome.deepLink === '/tickets?id=4242', outcome.deepLink);
    check('transkrip percakapan dilampirkan ke tiket', replyCalls === 1, 'terpanggil ' + replyCalls + 'x');

    const secondConfirm = await draftService
      .confirm(subject.user_id, subject.company_id, subject.connection_id, draftId)
      .then(() => null, (e) => e);
    check('confirm kedua -> 409', secondConfirm && secondConfirm.status === 409, 'status=' + (secondConfirm && secondConfirm.status));
    check('confirm kedua tidak membuat record kedua', createTicketCalls === 1, 'terpanggil ' + createTicketCalls + 'x');

    // ------------------------------------------------- kasus 7: draf kedaluwarsa
    const expired = await assistantRepository.createDraft({
      conversationId: result6.conversationId,
      portalUserId: subject.user_id,
      action: 'create_ticket',
      payload: { name: 'Sudah basi', description: 'Draf ini kedaluwarsa.' },
      expiresAt: new Date(Date.now() - 1000),
    });
    const expiredConfirm = await draftService
      .confirm(subject.user_id, subject.company_id, subject.connection_id, expired.id)
      .then(() => null, (e) => e);
    check('confirm draf kedaluwarsa -> 410', expiredConfirm && expiredConfirm.status === 410, 'status=' + (expiredConfirm && expiredConfirm.status));
    check('draf kedaluwarsa tidak dieksekusi', createTicketCalls === 1);

    // ------------------------------------------------- kasus 8: payload dirusak
    // Payload di DB berasal dari keluaran LLM. Kalau ia rusak (bug, migrasi, manipulasi langsung),
    // validasi ulang di confirm harus menangkapnya -- bukan meneruskannya ke service.
    const tampered = await assistantRepository.createDraft({
      conversationId: result6.conversationId,
      portalUserId: subject.user_id,
      action: 'create_ticket',
      payload: { name: '', description: 42 },
      expiresAt: new Date(Date.now() + 60000),
    });
    const tamperedConfirm = await draftService
      .confirm(subject.user_id, subject.company_id, subject.connection_id, tampered.id)
      .then(() => null, (e) => e);
    check('payload rusak ditolak validasi ulang', tamperedConfirm && tamperedConfirm.name === 'ZodError', tamperedConfirm && tamperedConfirm.name);
    check('payload rusak tidak diteruskan ke service', createTicketCalls === 1, 'terpanggil ' + createTicketCalls + 'x');

    // ------------------------------------------------- kasus 9: jawaban kosong
    // Bug nyata dari lapangan: pertanyaan "bisa bantu saya claim garansi?" dijawab dengan teks
    // penolakan data ("coba tanyakan tentang invoice outstanding..."), padahal itu justru hal
    // yang asisten bisa bantu. Penyebabnya model mengembalikan teks kosong, dan kegagalan teknis
    // itu dilaporkan sebagai keterbatasan cakupan.
    //
    // Yang benar: coba ulang sekali, lalu -- kalau tetap kosong -- akui sebagai gangguan teknis.
    const emptyRefusal = await promptBuilder.getRefusal('id');
    const emptyInterrupted = await promptBuilder.getInterrupted('id');
    check('teks `interrupted` berbeda dari `refusal`', emptyRefusal !== emptyInterrupted);

    const alwaysEmpty = stubProvider([{ content: '' }]);
    const events9 = [];
    const result9 = await assistantService.converse({
      userId: subject.user_id,
      companyId: subject.company_id,
      message: 'saya ada keluhan barang rusak bisa bantu saya claim garansi ?',
      locale: 'id',
      emit: (event, data) => events9.push({ event, data }),
      req: fakeReq,
    });
    createdConversations.push(result9.conversationId);

    check('jawaban kosong dicoba ulang sekali', alwaysEmpty.calls === 2, 'provider dipanggil ' + alwaysEmpty.calls + 'x');
    check('kosong terus -> pesan gangguan teknis, BUKAN penolakan data',
      result9.content === emptyInterrupted, JSON.stringify(result9.content).slice(0, 80));
    const stored9 = await assistantRepository.listMessages(result9.conversationId);
    check('jawaban kosong tercatat dengan error_code untuk dihitung',
      stored9.some((m) => m.role === 'assistant' && m.error_code === 'empty_model_response'));

    // Percobaan ulang yang BERHASIL: pengguna tidak melihat gangguan sama sekali.
    const recovers = stubProvider([{ content: '' }, { content: 'Tentu, boleh sebutkan nomor serinya?' }]);
    const result10 = await assistantService.converse({
      userId: subject.user_id,
      companyId: subject.company_id,
      message: 'bisa bantu klaim garansi?',
      locale: 'id',
      emit: () => {},
      req: fakeReq,
    });
    createdConversations.push(result10.conversationId);
    check('kosong lalu terisi -> jawaban asli yang dipakai',
      result10.content === 'Tentu, boleh sebutkan nomor serinya?', JSON.stringify(result10.content));
    check('pemulihan hanya butuh dua panggilan', recovers.calls === 2, 'provider dipanggil ' + recovers.calls + 'x');

    // I-4 TIDAK boleh ikut longgar oleh perubahan ini.
    stubProvider([{ content: 'Tagihan Anda 9.999.000 rupiah.' }]);
    const result11 = await assistantService.converse({
      userId: subject.user_id,
      companyId: subject.company_id,
      message: 'berapa tagihan saya',
      locale: 'id',
      emit: () => {},
      req: fakeReq,
    });
    createdConversations.push(result11.conversationId);
    check('I-4 tetap ketat: angka karangan tetap diganti penolakan', result11.content === emptyRefusal);

    // ------------------------------------------ kasus 12: aksi tulis equipment correction
    // Sama seperti kasus 6 (draft_ticket), tapi untuk permintaan koreksi installed base (Fase 4,
    // Docs/CR/customer_population_installed_base.md section 13). I-5 harus tetap berlaku di sini
    // juga -- ini bukan cabang khusus, jadi kalau kasus 6 lulus tapi ini gagal, artinya draftService
    // atau actions.js punya jalur berbeda untuk aksi ini yang seharusnya tidak ada.
    let createCorrectionCalls = 0;
    equipmentService.createCorrection = async (_userId, _companyId, equipmentId, payload) => {
      createCorrectionCalls += 1;
      return { id: 'fake-correction-id', odoo_equipment_id: equipmentId, ticket_id: 4343, ...payload };
    };

    stubProvider([
      {
        content: 'saya bantu siapkan permintaan koreksinya',
        toolCalls: [{
          name: 'draft_equipment_correction',
          args: { equipment_id: 9, correction_type: 'location', proposed_value: 'Plant C', note: 'unit sudah pindah' },
        }],
      },
      { content: 'Draf permintaan koreksinya sudah saya siapkan, silakan periksa lalu tekan kirim.' },
    ]);

    const events12 = [];
    const result12 = await assistantService.converse({
      userId: subject.user_id,
      companyId: subject.company_id,
      message: 'Unit saya sudah dipindah ke Plant C, datanya masih tercatat lokasi lama',
      locale: 'id',
      emit: (event, data) => events12.push({ event, data }),
      req: fakeReq,
    });
    createdConversations.push(result12.conversationId);

    const draftEvent12 = events12.find((e) => e.event === 'draft');
    check('equipment correction: event draft terkirim', Boolean(draftEvent12));
    check('I-5: draft_equipment_correction TIDAK memanggil service tulis', createCorrectionCalls === 0, 'terpanggil ' + createCorrectionCalls + 'x');

    const draftId12 = draftEvent12 && draftEvent12.data.draft_id;
    const storedDraft12 = await assistantRepository.findDraftForUser(draftId12, subject.user_id, subject.connection_id);
    check('draf koreksi tersimpan dengan status pending', storedDraft12 && storedDraft12.status === 'pending', storedDraft12 && storedDraft12.status);
    check(
      'payload draf koreksi disimpan dalam bentuk skema validator (equipment_id di body)',
      storedDraft12 && 'equipment_id' in storedDraft12.payload && 'correction_type' in storedDraft12.payload
    );

    const foreignConfirm12 = await draftService
      .confirm('00000000-0000-0000-0000-000000000000', subject.company_id, subject.connection_id, draftId12)
      .then(() => null, (e) => e);
    check('confirm draf koreksi milik user lain -> 404', foreignConfirm12 && foreignConfirm12.status === 404, 'status=' + (foreignConfirm12 && foreignConfirm12.status));

    const outcome12 = await draftService.confirm(subject.user_id, subject.company_id, subject.connection_id, draftId12);
    check('confirm memanggil equipmentService.createCorrection tepat sekali', createCorrectionCalls === 1, 'terpanggil ' + createCorrectionCalls + 'x');
    check('label hasil memuat nomor tiket dari service', /4343/.test(outcome12.label), outcome12.label);
    check('deep link koreksi menunjuk /equipment', outcome12.deepLink === '/equipment', outcome12.deepLink);

    const secondConfirm12 = await draftService
      .confirm(subject.user_id, subject.company_id, subject.connection_id, draftId12)
      .then(() => null, (e) => e);
    check('confirm koreksi kedua -> 409', secondConfirm12 && secondConfirm12.status === 409, 'status=' + (secondConfirm12 && secondConfirm12.status));
    check('confirm koreksi kedua tidak membuat record kedua', createCorrectionCalls === 1, 'terpanggil ' + createCorrectionCalls + 'x');

  } finally {
    providers.chat = realChat;
    invoiceService.getOutstanding = realGetOutstanding;
    helpdeskService.createTicket = realCreateTicket;
    helpdeskService.replyTicket = realReplyTicket;
    equipmentService.createCorrection = realCreateCorrection;

    for (const id of createdConversations) {
      await pool.query('DELETE FROM assistant_conversations WHERE id = $1', [id]);
    }
    if (before) {
      await assistantConfigRepository.upsertSettings(null, {
        provider: before.provider, model: before.model, enabled: before.enabled,
        daily_message_quota: before.daily_message_quota, burst_per_minute: before.burst_per_minute,
        max_tool_iterations: before.max_tool_iterations, history_window: before.history_window,
      }, before.updated_by);
    } else {
      await pool.query('DELETE FROM assistant_settings WHERE odoo_connection_id IS NULL');
    }
    if (beforeProviderConfig) {
      await assistantConfigRepository.upsertProviderConfig(null, 'ollama', {
        model: beforeProviderConfig.model, base_url: beforeProviderConfig.base_url,
        ollama_target: beforeProviderConfig.ollama_target, ollama_model_manual: beforeProviderConfig.ollama_model_manual,
        encrypted_api_key: beforeProviderConfig.encrypted_api_key, encrypted_api_key_cloud: beforeProviderConfig.encrypted_api_key_cloud,
      }, beforeProviderConfig.updated_by);
    } else {
      await pool.query('DELETE FROM assistant_provider_configs WHERE provider = $1 AND odoo_connection_id IS NULL', ['ollama']);
    }
    require('../src/services/assistantConfigService').invalidate();
  }
}

run()
  .then(() => {
    if (failed) {
      console.error('\nassistant flow check FAILED');
      process.exitCode = 1;
    } else {
      console.log('\nassistant flow check passed');
    }
  })
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
