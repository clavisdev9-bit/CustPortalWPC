require('dotenv').config();
const bcrypt = require('bcryptjs');
const pool = require('../src/db/pool');

async function main() {
  const [, , email, password, name] = process.argv;
  if (!email || !password) {
    console.error('Usage: npm run create-platform-admin -- <email> <password> [name]');
    process.exit(1);
  }
  const passwordHash = await bcrypt.hash(password, 10);
  await pool.query(
    `INSERT INTO portal_users (email, name, password_hash, status, is_platform_admin)
     VALUES ($1, $2, $3, 'active', true)
     ON CONFLICT (lower(email)) DO UPDATE SET is_platform_admin = true, password_hash = EXCLUDED.password_hash`,
    [email, name || email, passwordHash]
  );
  console.log(`Platform admin ready: ${email}`);
  await pool.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
