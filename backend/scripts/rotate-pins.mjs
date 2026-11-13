import { query, runMigrations, closePool } from '../src/db.js';
import { generatePin, hashPin } from '../src/pins.js';

async function main() {
  await runMigrations();
  const { rows } = await query("SELECT id, slug FROM sites WHERE slug <> 'demo' ORDER BY slug");
  if (rows.length === 0) {
    console.log('No sites to rotate.');
    return;
  }
  for (const site of rows) {
    const pin = generatePin();
    await query('UPDATE sites SET guard_pin_hash = $1, updated_at = now() WHERE id = $2', [
      hashPin(pin),
      site.id,
    ]);
    console.log(`${site.slug} -> ${pin}`);
  }
  console.log('Done. Write these PINs down now; they are not stored in readable form.');
}

main()
  .catch((err) => {
    console.error('Rotation failed:', err.message);
    process.exitCode = 1;
  })
  .finally(() => closePool());
