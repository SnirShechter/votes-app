import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { pool } from './db.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

export async function runMigrations(): Promise<void> {
  // Create migrations tracking table
  await pool.query(`
    CREATE TABLE IF NOT EXISTS migrations (
      id SERIAL PRIMARY KEY,
      name VARCHAR(255) NOT NULL UNIQUE,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);

  const migrationFile = '001_initial.sql';
  const applied = await pool.query(
    'SELECT name FROM migrations WHERE name = $1',
    [migrationFile]
  );

  if (applied.rows.length === 0) {
    const sql = readFileSync(
      join(__dirname, 'migrations', migrationFile),
      'utf-8'
    );
    await pool.query(sql);
    await pool.query('INSERT INTO migrations (name) VALUES ($1)', [migrationFile]);
    console.log(`Applied migration: ${migrationFile}`);
  }
}
