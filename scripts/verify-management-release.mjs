import { spawnSync } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import os from "node:os";

const expectedProject = "hhymxkuvtcgabaeekplc";
const project = (await readFile("supabase/.temp/project-ref", "utf8")).trim();
if (project !== expectedProject) throw new Error("Unexpected Supabase project. No release verification was performed.");
const mode = process.argv[2];
const backupPath = process.argv[3] ?? path.join(os.tmpdir(), `morita-management-release-${Date.now()}.json`);
const cli = path.resolve("node_modules/supabase/dist/supabase.js");
function query(sql) {
  const result = spawnSync(process.execPath, [cli, "db", "query", "--linked", sql, "--output", "json"], { encoding: "utf8", windowsHide: true, maxBuffer: 24 * 1024 * 1024, timeout: 120000 });
  if (result.status !== 0) throw new Error(result.stderr || result.error?.message || "Release verification query failed");
  const start = result.stdout.indexOf("{");
  return JSON.parse(result.stdout.slice(start)).rows;
}
const tables = ["products", "sales", "sale_items", "sale_payments", "expenses", "expense_categories", "inventory_movements", "customers", "categories", "brands", "suppliers", "purchase_orders", "purchase_order_items", "purchase_receipts", "purchase_receipt_items", "cash_tracking_settings", "cash_accounts", "cash_movements", "daily_cash_closures", "daily_cash_closure_items", "employees", "payroll_movements", "payroll_settlements", "payroll_settlement_adjustments", "payroll_settlement_payments", "product_images", "site_settings", "store_banners", "store_customer_profiles", "web_orders", "web_order_items", "organizations", "organization_members"];
function fingerprints(selected) {
  return query(selected.map(({ schema, table }) => {
    if (![schema, table].every((value) => /^[a-z_]+$/.test(value))) throw new Error("Invalid snapshot table");
    const normalized = table === "products" ? "to_jsonb(record) - 'inventory_attributes' - 'management_search_text'" : "to_jsonb(record)";
    return `select '${schema}.${table}' as table_name, count(*)::int as row_count, md5(coalesce(jsonb_agg(value order by value::text)::text,'[]')) as fingerprint from (select ${normalized} as value from ${schema}.${table} record) rows`;
  }).join(" union all "));
}
if (mode === "snapshot") {
  const selected = query(`select table_schema as schema, table_name as table from information_schema.tables where table_type='BASE TABLE' and ((table_schema='public' and table_name in (${tables.map((table) => `'${table}'`).join(",")})) or (table_schema='private' and table_name='inventory_entries')) order by table_schema, table_name`);
  const before = fingerprints(selected);
  const products = query("select id,name,sku,barcode,cost_price,retail_price,wholesale_price,current_stock,category_id,brand_id from public.products order by id");
  const functions = query("select p.proname,pg_get_functiondef(p.oid) as definition from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname in ('load_inventory_entry','update_product_details') order by p.proname");
  await writeFile(backupPath, JSON.stringify({ project, createdAt: new Date().toISOString(), selected, fingerprints: before, products, functions }, null, 2));
  console.log(JSON.stringify({ backupPath, tables: before.length, products: products.length }));
} else if (mode === "compare") {
  const before = JSON.parse(await readFile(backupPath, "utf8"));
  if (before.project !== expectedProject) throw new Error("Backup belongs to another project");
  const after = fingerprints(before.selected);
  const changed = after.filter((item) => {
    const original = before.fingerprints.find((row) => row.table_name === item.table_name);
    return !original || original.row_count !== item.row_count || original.fingerprint !== item.fingerprint;
  });
  console.log(JSON.stringify({ tablesChecked: after.length, changed, checkedAt: new Date().toISOString() }));
  process.exitCode = changed.length ? 1 : 0;
} else throw new Error("Use snapshot [path] or compare <backup-path>. All database operations are read-only.");
