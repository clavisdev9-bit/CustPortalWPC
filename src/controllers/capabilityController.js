const asyncHandler = require('../utils/asyncHandler');
const { resolveOdooContext } = require('../services/odooContext');
const odooCapabilityService = require('../services/odooCapabilityService');

// BUG-31: menolak permintaan dengan pesan yang jelas sudah jauh lebih baik daripada fault XML-RPC
// mentah, tapi tetap saja pelanggan baru tahu setelah mengklik menu yang tidak akan pernah
// bekerja. Endpoint ini yang membuat menunya bisa hilang sejak awal (AppShell.jsx).
//
// Sengaja tidak pernah gagal. Ia dipanggil sekali per pemuatan SPA, di samping /companies, dan
// setiap alasan kegagalannya sudah punya penanganannya sendiri di tempat lain: company belum
// dipilih (400), identitas belum dipetakan (403, BUG-29), koneksi bermasalah (503, BUG-30).
// Mengulanginya di sini hanya akan menghasilkan pesan error kedua untuk masalah yang sama.
// Kalau konteksnya tidak bisa diselesaikan, jawabannya "semua tersedia" -- navigasi tampil utuh,
// persis seperti perilaku sebelum CR ini, dan endpoint aslinya yang menjelaskan masalahnya.
const list = asyncHandler(async (req, res) => {
  const allAvailable = Object.fromEntries(Object.keys(odooCapabilityService.FEATURES).map((f) => [f, true]));

  try {
    const { session, connectionId } = await resolveOdooContext(req.user.id, req.user.currentCompanyId);
    res.json(await odooCapabilityService.getCapabilities(session, connectionId));
  } catch {
    res.json(allAvailable);
  }
});

module.exports = { list };
