// Satu-satunya tempat aturan permission asisten hidup: penyaringan tool (toolRegistry) dan
// gerbang eksekusi aksi tulis (draftService) sama-sama membacanya dari sini.
//
// Modul ini SENGAJA tidak meng-import apa pun dari lapisan asisten. Sebelumnya aturan ini tinggal
// di toolRegistry, dan begitu draftService membutuhkannya terbentuk siklus
// draftService -> toolRegistry -> tools/support -> draftService, yang membuat toolRegistry
// setengah terinisialisasi saat draftService membacanya (assertPermission jadi undefined saat
// runtime, bukan saat load -- kegagalan yang baru muncul di jalur eksekusi paling sensitif).
const ApiError = require('../../utils/ApiError');
const portalUserRepository = require('../../repositories/portalUserRepository');

// Platform admin mem-bypass RBAC per-customer di seluruh portal (requirePermission.js), jadi ia
// mem-bypass di sini juga -- kalau tidak, asisten akan tampak "tidak punya tool apa pun" untuk
// operator platform, yang membingungkan. Catatan praktisnya: platform admin biasanya TIDAK punya
// identity_mapping ke sebuah res.partner pelanggan, sehingga tool-nya tetap akan gagal di
// resolveOdooContext dengan 403 no_identity_mapping. Itu kegagalan yang jujur dan terbaca,
// bukan daftar tool kosong tanpa penjelasan.
async function getGrantedPermissions(userId) {
  const user = await portalUserRepository.findById(userId);
  if (user && user.is_platform_admin) return null; // null = semua diizinkan
  return portalUserRepository.getPermissionCodes(userId);
}

function isGranted(permissions, code) {
  return permissions === null || permissions.includes(code);
}

async function assertPermission(userId, code) {
  const permissions = await getGrantedPermissions(userId);
  if (!isGranted(permissions, code)) {
    throw new ApiError(403, 'forbidden', `Missing permission: ${code}`);
  }
}

module.exports = { getGrantedPermissions, isGranted, assertPermission };
