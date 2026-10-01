import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const tables = ["products", "sales", "sale_items", "expenses", "payroll_settlements", "payroll_movements", "cash_movements", "daily_cash_closures", "daily_cash_closure_items"];
const backupPath = path.join(os.tmpdir(), "morita-system-audit", "production-integrity.json");
const snapshots = tables.map((table) => `'${table}', (select coalesce(jsonb_object_agg(id::text, md5(to_jsonb(entry)::text)), '{}'::jsonb) from public.${table} entry)`).join(", ");
const sql = `select jsonb_build_object(${snapshots}) as fingerprints,
  (select jsonb_agg(jsonb_build_object('function', routine.proname, 'definition', pg_get_functiondef(routine.oid)))
   from pg_proc routine join pg_namespace schema on schema.oid = routine.pronamespace
   where schema.nspname = 'private' and routine.proname in
     ('apply_expense_cash_movement', 'apply_personnel_advance_cash_movement', 'apply_payroll_cash_movement')) as original_functions;`;
const result = spawnSync(process.execPath, [path.join(process.cwd(), "node_modules/supabase/dist/supabase.js"), "db", "query", "--linked", sql], { encoding: "utf8", maxBuffer: 20 * 1024 * 1024, windowsHide: true });
if (result.status !== 0) throw new Error(result.stderr || result.stdout);
const payload = JSON.parse(result.stdout.slice(result.stdout.indexOf("{"))).rows[0];
if (process.argv[2] === "capture") {
  await mkdir(path.dirname(backupPath), { recursive: true });
  await writeFile(backupPath, JSON.stringify({ capturedAt: new Date().toISOString(), ...payload }, null, 2));
  console.log(`Captured read-only historical fingerprints and original function definitions at ${backupPath}`);
} else if (process.argv[2] === "verify") {
  const before = JSON.parse(await readFile(backupPath, "utf8"));
  const checks = tables.map((table) => ({ table, originalRows: Object.keys(before.fingerprints[table]).length,
    changedOrMissing: Object.entries(before.fingerprints[table]).filter(([id, hash]) => payload.fingerprints[table][id] !== hash).length,
    added: Object.keys(payload.fingerprints[table]).filter((id) => !(id in before.fingerprints[table])).length,
  }));
  console.log(JSON.stringify(checks, null, 2));
  await writeFile(path.join(path.dirname(backupPath), "production-integrity-verification.json"), JSON.stringify({ checkedAt: new Date().toISOString(), checks }, null, 2));
  assert(checks.every((check) => check.changedOrMissing === 0), "Historical rows changed since capture; review whether there were concurrent live operations.");
} else throw new Error("Use capture or verify. This script only SELECTs production data; it never writes to Supabase.");
