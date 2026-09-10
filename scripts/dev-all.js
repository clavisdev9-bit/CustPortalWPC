const { spawn } = require('child_process');
const path = require('path');
require('dotenv').config();

// Port backend dibaca dari .env, bukan diketik di banner ini: versi sebelumnya mencetak
// "Backend: 3000" secara literal dan tetap mencetaknya setelah portnya pindah, yang membuat
// terminal aktif berbohong soal port mana yang sebenarnya didengarkan. Port frontend masih
// hidup di frontend/vite.config.js (server.port) -- Vite sendiri mencetaknya saat siap.
console.log(
  `=== Starting Customer Portal WPC (Backend: ${process.env.PORT || '?'} | Frontend: 7180) ===`
);

const rootDir = path.join(__dirname, '..');
const frontendDir = path.join(rootDir, 'frontend');

const nodemonBin = path.join(rootDir, 'node_modules', 'nodemon', 'bin', 'nodemon.js');
const viteBin = path.join(frontendDir, 'node_modules', 'vite', 'bin', 'vite.js');

const backend = spawn(process.execPath, [nodemonBin, 'src/server.js'], {
  cwd: rootDir,
  stdio: ['ignore', 'inherit', 'inherit'],
});

const frontend = spawn(process.execPath, [viteBin], {
  cwd: frontendDir,
  stdio: ['ignore', 'inherit', 'inherit'],
});

function shutdown() {
  console.log('\nShutting down dev servers...');
  if (backend && !backend.killed) backend.kill();
  if (frontend && !frontend.killed) frontend.kill();
  process.exit(0);
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
