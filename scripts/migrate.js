require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { Client } = require('pg');

async function run() {
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  await client.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      filename TEXT PRIMARY KEY,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);

  for (const dir of ['database/migrations', 'database/seeds']) {
    const full = path.join(process.cwd(), dir);
    const files = fs.readdirSync(full).filter((f) => f.endsWith('.sql')).sort();
    for (const file of files) {
      const key = `${dir}/${file}`;
      const { rows } = await client.query('SELECT 1 FROM schema_migrations WHERE filename = $1', [key]);
      if (rows.length) continue;
      const sql = fs.readFileSync(path.join(full, file), 'utf8');
      console.log(`Applying ${key}`);
      await client.query('BEGIN');
      try {
        await client.query(sql);
        await client.query('INSERT INTO schema_migrations (filename) VALUES ($1)', [key]);
        await client.query('COMMIT');
      } catch (err) {
        await client.query('ROLLBACK');
        throw err;
      }
    }
  }

  await client.end();
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
