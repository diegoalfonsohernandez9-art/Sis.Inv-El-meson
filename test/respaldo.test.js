const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const { respaldar } = require('../respaldar');

test('respaldo: copia íntegra con los datos, uno por día, rota los viejos y respeta los manuales', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'meson-respaldo-'));
  try {
    const base = path.join(dir, 'base.db'), destino = path.join(dir, 'respaldos');
    const db = new DatabaseSync(base);
    db.exec("PRAGMA journal_mode = WAL; CREATE TABLE t (x); INSERT INTO t VALUES ('ficticio')"); // abierta, como con el servidor corriendo

    const r = respaldar(base, destino, 2, new Date(2026, 10, 1));
    const copia = new DatabaseSync(r.destino, { readOnly: true });
    assert.equal(copia.prepare('SELECT x FROM t').get().x, 'ficticio', 'la copia trae lo que estaba en WAL');
    copia.close();

    fs.writeFileSync(path.join(destino, 'meson-manual.db'), '');
    respaldar(base, destino, 2, new Date(2026, 10, 1)); // mismo día: reemplaza
    respaldar(base, destino, 2, new Date(2026, 10, 2));
    const fin = respaldar(base, destino, 2, new Date(2026, 10, 3));
    assert.deepEqual(fin.borrados, ['meson-2026-11-01.db']);
    assert.deepEqual(fs.readdirSync(destino).sort(), ['meson-2026-11-02.db', 'meson-2026-11-03.db', 'meson-manual.db']);
    db.close();
    assert.throws(() => respaldar(path.join(dir, 'no-existe.db'), destino), /No existe/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
