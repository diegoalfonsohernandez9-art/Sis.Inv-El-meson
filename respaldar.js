// Respaldo diario de la base: copia consistente (aunque el sistema esté abierto), revisada y con rotación.
// Uso: node respaldar.js   ·   Variables: DB_PATH (meson.db), RESPALDOS_DIR (respaldos/), RESPALDOS_CONSERVAR (30)
// respaldos/ está dentro de OneDrive, así que cada copia también sube a la nube. Tiene datos fiscales y hashes de PIN: nunca a git.
const { DatabaseSync } = require('node:sqlite');
const fs = require('node:fs'), path = require('node:path');

function respaldar(rutaDb, dir, conservar = 30, hoy = new Date()) {
  if (!fs.existsSync(rutaDb)) throw new Error(`No existe la base ${rutaDb}`);
  fs.mkdirSync(dir, { recursive: true });
  const dia = hoy.toLocaleDateString('sv'); // AAAA-MM-DD en hora local
  const destino = path.join(dir, `meson-${dia}.db`), temporal = `${destino}.tmp`;
  fs.rmSync(temporal, { force: true });

  // VACUUM INTO saca una copia íntegra aunque el servidor esté escribiendo (copiar el archivo a mano puede salir corrupta).
  const db = new DatabaseSync(rutaDb, { readOnly: true });
  try { db.exec(`VACUUM INTO '${temporal.replace(/'/g, "''")}'`); } finally { db.close(); }

  const copia = new DatabaseSync(temporal, { readOnly: true });
  let revision;
  try { revision = copia.prepare('PRAGMA integrity_check').get().integrity_check; } finally { copia.close(); }
  if (revision !== 'ok') { fs.rmSync(temporal, { force: true }); throw new Error(`La copia no pasó la revisión: ${revision}`); }
  fs.renameSync(temporal, destino); // un respaldo por día: el del mismo día se reemplaza

  // Rotación: solo los respaldos diarios automáticos, nunca los manuales con otro nombre.
  const diarios = fs.readdirSync(dir).filter(f => /^meson-\d{4}-\d{2}-\d{2}\.db$/.test(f)).sort();
  const borrados = diarios.slice(0, Math.max(diarios.length - conservar, 0));
  borrados.forEach(f => fs.rmSync(path.join(dir, f)));
  return { destino, tam: fs.statSync(destino).size, borrados };
}

module.exports = { respaldar };

if (require.main === module) {
  try {
    const r = respaldar(process.env.DB_PATH || path.join(__dirname, 'meson.db'), process.env.RESPALDOS_DIR || path.join(__dirname, 'respaldos'), Number(process.env.RESPALDOS_CONSERVAR) || 30);
    console.log(`${new Date().toLocaleString('es-MX')} Respaldo listo: ${r.destino} (${Math.round(r.tam / 1024)} KB)${r.borrados.length ? `. Se quitaron ${r.borrados.length} antiguos.` : ''}`);
  } catch (e) {
    console.error(`${new Date().toLocaleString('es-MX')} RESPALDO FALLÓ: ${e.message}`);
    process.exitCode = 1;
  }
}
