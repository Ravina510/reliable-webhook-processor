import * as fs from 'fs';
import * as path from 'path';
import { createPool } from './pool';

export async function runMigrations(connectionString?: string): Promise<void> {
  const pool = createPool(connectionString);
  try {
    const sqlPath = path.join(__dirname, 'migrations', '001_init.sql');
    const sql = fs.readFileSync(sqlPath, 'utf8');
    await pool.query(sql);
  } finally {
    await pool.end();
  }
}

if (require.main === module) {
  runMigrations()
    .then(() => {
      console.log('Migrations applied successfully');
      process.exit(0);
    })
    .catch((err) => {
      console.error('Migration failed:', err);
      process.exit(1);
    });
}
