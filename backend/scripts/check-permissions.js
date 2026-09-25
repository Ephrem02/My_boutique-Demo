// Read-only check that the live DB's roles/permissions match the seed file.
// Seeds don't run automatically, so the two can drift apart - run this when a
// permission "doesn't work" before assuming the seed file is what's deployed.
//
// Usage: npm run check:permissions   (exits 1 if drift is found)
const path = require('path');
const fs = require('fs');
const Module = require('module');

require('dotenv').config({ path: path.join(__dirname, '..', '.env'), quiet: true });
const db = require('../src/config/db');

// The seed file doesn't export its constants, and requiring it normally would
// only give us the (destructive) seed function. Compile a copy that also
// exports PERMISSIONS and ROLE_PERMISSIONS, without ever calling seed().
function loadSeedConstants() {
  const seedPath = path.join(__dirname, '..', 'src', 'seeds', '01_roles_permissions.js');
  const src = `${fs.readFileSync(seedPath, 'utf8')}\nmodule.exports.__constants = { PERMISSIONS, ROLE_PERMISSIONS };`;
  const mod = new Module(seedPath);
  mod.filename = seedPath;
  mod.paths = Module._nodeModulePaths(path.dirname(seedPath));
  mod._compile(src, seedPath);
  return mod.exports.__constants;
}

const difference = (a, b) => [...a].filter((x) => !b.has(x)).sort();

async function main() {
  const { PERMISSIONS, ROLE_PERMISSIONS } = loadSeedConstants();

  const rows = await db('roles as r')
    .leftJoin('role_permissions as rp', 'rp.role_id', 'r.id')
    .leftJoin('permissions as p', 'p.id', 'rp.permission_id')
    .select('r.name as role', 'p.code');
  const dbCodes = new Set(await db('permissions').pluck('code'));

  const live = {};
  for (const { role, code } of rows) {
    live[role] = live[role] || new Set();
    if (code) live[role].add(code);
  }

  let drift = false;
  const seedCodes = new Set(PERMISSIONS);
  console.log(`permissions table: ${dbCodes.size} codes (seed: ${seedCodes.size})`);
  for (const [label, codes] of [
    ['in seed, missing from DB', difference(seedCodes, dbCodes)],
    ['in DB, not in seed', difference(dbCodes, seedCodes)],
  ]) {
    if (codes.length) {
      drift = true;
      console.log(`  ${label}: ${codes.join(', ')}`);
    }
  }

  const roles = new Set([...Object.keys(ROLE_PERMISSIONS), ...Object.keys(live)]);
  for (const role of roles) {
    const expected = new Set(ROLE_PERMISSIONS[role] || []);
    const actual = live[role] || new Set();
    const missing = difference(expected, actual);
    const extra = difference(actual, expected);

    let status = 'match';
    if (!ROLE_PERMISSIONS[role]) status = 'ROLE NOT IN SEED';
    else if (!live[role]) status = 'ROLE MISSING FROM DB';
    else if (missing.length || extra.length) status = 'DRIFT';
    if (status !== 'match') drift = true;

    console.log(`\n${role}: ${status}  (seed ${expected.size}, db ${actual.size})`);
    if (missing.length) console.log(`  missing in DB: ${missing.join(', ')}`);
    if (extra.length) console.log(`  extra in DB:   ${extra.join(', ')}`);
  }

  console.log(drift ? '\nRESULT: DRIFT FOUND' : '\nRESULT: DB matches seed file');
  return drift ? 1 : 0;
}

main()
  .then((code) => { process.exitCode = code; })
  .catch((err) => {
    console.error(err.message);
    process.exitCode = 1;
  })
  .finally(() => db.destroy());
