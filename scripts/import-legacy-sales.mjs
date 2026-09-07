import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { createRequire } from "node:module";

import ExcelJS from "exceljs";

const DEFAULT_SOURCE = "legacy_pos";
const DEFAULT_ORGANIZATION_SLUG = "morita-bebes";

function parseArgs(argv) {
  const result = {
    file: null,
    organizationSlug: DEFAULT_ORGANIZATION_SLUG,
    source: DEFAULT_SOURCE,
    target: null,
    limit: null,
    finalize: false,
    pilot: false,
    expectHash: null,
    outputDir: path.resolve("tmp", "legacy-sales-import"),
  };

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    const next = argv[index + 1];
    if (argument === "--") continue;
    if (argument === "--file") { result.file = next; index += 1; }
    else if (argument === "--organization-slug") { result.organizationSlug = next; index += 1; }
    else if (argument === "--source") { result.source = next; index += 1; }
    else if (argument === "--target") { result.target = next; index += 1; }
    else if (argument === "--limit") { result.limit = Number(next); index += 1; }
    else if (argument === "--expect-hash") { result.expectHash = next; index += 1; }
    else if (argument === "--output-dir") { result.outputDir = path.resolve(next); index += 1; }
    else if (argument === "--finalize") result.finalize = true;
    else if (argument === "--pilot") result.pilot = true;
    else throw new Error(`Argumento desconocido: ${argument}`);
  }

  if (!result.file) throw new Error("Falta --file <ruta al Libro ventas.xlsx>.");
  if (result.target && !["local", "linked"].includes(result.target)) {
    throw new Error("--target debe ser local o linked.");
  }
  if (result.limit !== null && (!Number.isInteger(result.limit) || result.limit < 1)) {
    throw new Error("--limit debe ser un entero positivo.");
  }
  if (result.pilot && result.finalize) throw new Error("El piloto siempre revierte y no puede finalizar el lote.");
  if ((result.pilot || result.finalize) && !result.target) {
    throw new Error("Para ejecutar una importación indicá --target local o --target linked.");
  }

  return result;
}

function text(value) {
  const normalized = String(value ?? "").trim().replace(/\s+/g, " ");
  return normalized || null;
}

function number(value, label, rowNumber) {
  const parsed = typeof value === "number" ? value : Number(String(value ?? "").replace(",", "."));
  if (!Number.isFinite(parsed)) throw new Error(`Fila ${rowNumber}: ${label} no es numérico.`);
  return Math.round((parsed + Number.EPSILON) * 100) / 100;
}

function dateParts(value, rowNumber) {
  if (value instanceof Date && !Number.isNaN(value.valueOf())) {
    return {
      year: value.getUTCFullYear(),
      month: value.getUTCDate(),
      day: value.getUTCMonth() + 1,
      corrected: true,
    };
  }

  const match = text(value)?.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (!match) throw new Error(`Fila ${rowNumber}: fecha inválida.`);
  return { year: Number(match[3]), month: Number(match[2]), day: Number(match[1]), corrected: false };
}

function timeParts(value, rowNumber) {
  if (value instanceof Date && !Number.isNaN(value.valueOf())) {
    return {
      hour: value.getUTCHours(),
      minute: value.getUTCMinutes(),
      second: value.getUTCSeconds(),
    };
  }

  if (typeof value === "number" && Number.isFinite(value)) {
    const seconds = Math.round((value % 1) * 86400) % 86400;
    return { hour: Math.floor(seconds / 3600), minute: Math.floor((seconds % 3600) / 60), second: seconds % 60 };
  }

  const match = text(value)?.match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?$/);
  if (!match) throw new Error(`Fila ${rowNumber}: hora inválida.`);
  return { hour: Number(match[1]), minute: Number(match[2]), second: Number(match[3] ?? 0) };
}

function occurredAt(date, time) {
  const pad = (value) => String(value).padStart(2, "0");
  return `${date.year}-${pad(date.month)}-${pad(date.day)}T${pad(time.hour)}:${pad(time.minute)}:${pad(time.second)}-03:00`;
}

function sqlLiteral(value) {
  return `'${String(value).replaceAll("'", "''")}'`;
}

function dollarJson(value, tag) {
  const json = JSON.stringify(value);
  if (json.includes(`$${tag}$`)) throw new Error(`El contenido JSON entra en conflicto con el delimitador ${tag}.`);
  return `$${tag}$${json}$${tag}$::jsonb`;
}

async function analyzeWorkbook(filePath) {
  const bytes = fs.readFileSync(filePath);
  const hash = createHash("sha256").update(bytes).digest("hex");
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(bytes);
  const worksheet = workbook.worksheets[0];
  if (!worksheet) throw new Error("El libro no contiene hojas.");

  const headers = worksheet.getRow(1).values.slice(1).map(text);
  const expected = [
    "Numero Interno", "Fecha", "Hora", "Tipo de Comprobante", "Punto de Venta",
    "Num. de Comprobante", "Cliente", "Num. de Cuit", "Forma de Pago", "Subtotal",
    "Iva 10.5%", "Iva 21%", "Total", "Nro de CAE", "Estado",
  ];
  if (JSON.stringify(headers) !== JSON.stringify(expected)) {
    throw new Error(`Las columnas no coinciden con el formato analizado: ${headers.join(" | ")}`);
  }

  const sales = [];
  const issues = [];
  const seenNumbers = new Set();
  const errors = [];

  for (let rowNumber = 2; rowNumber <= worksheet.rowCount; rowNumber += 1) {
    const row = worksheet.getRow(rowNumber);
    if (!row.values.slice(1).some((value) => value !== null && value !== undefined && value !== "")) continue;

    try {
      const legacyNumber = text(row.getCell(1).value);
      if (!legacyNumber) throw new Error(`Fila ${rowNumber}: falta Numero Interno.`);
      if (seenNumbers.has(legacyNumber)) throw new Error(`Fila ${rowNumber}: Numero Interno duplicado (${legacyNumber}).`);
      seenNumbers.add(legacyNumber);

      const date = dateParts(row.getCell(2).value, rowNumber);
      const time = timeParts(row.getCell(3).value, rowNumber);
      const subtotal = number(row.getCell(10).value, "Subtotal", rowNumber);
      const vat105 = number(row.getCell(11).value, "IVA 10,5%", rowNumber);
      const vat21 = number(row.getCell(12).value, "IVA 21%", rowNumber);
      const total = number(row.getCell(13).value, "Total", rowNumber);
      const computed = Math.round((subtotal + vat105 + vat21) * 100) / 100;
      const roundingAdjustment = Math.round((total - computed) * 100) / 100;
      if (total <= 0) throw new Error(`Fila ${rowNumber}: el total debe ser positivo.`);
      if (Math.abs(roundingAdjustment) > 0.05) {
        throw new Error(`Fila ${rowNumber}: Subtotal + IVA (${computed}) no coincide con Total (${total}).`);
      }

      const paymentMethod = text(row.getCell(9).value);
      const rawData = Object.fromEntries(headers.map((header, index) => [header, row.getCell(index + 1).text || null]));
      sales.push({
        source_row: rowNumber,
        legacy_sale_number: legacyNumber,
        occurred_at: occurredAt(date, time),
        document_type: text(row.getCell(4).value),
        point_of_sale: text(row.getCell(5).value),
        document_number: text(row.getCell(6).value),
        customer_name: text(row.getCell(7).value),
        customer_tax_id: text(row.getCell(8).value),
        payment_method: paymentMethod,
        seller_name: null,
        legacy_status: text(row.getCell(15).value),
        subtotal,
        vat_10_5: vat105,
        vat_21: vat21,
        rounding_adjustment: roundingAdjustment,
        discount: 0,
        total,
        original_time_known: true,
        raw_data: rawData,
      });

      issues.push({
        severity: "warning",
        source_row: rowNumber,
        legacy_sale_number: legacyNumber,
        code: "missing_item_detail",
        message: "El libro de ventas no incluye productos, cantidades ni costos para esta venta.",
        raw_data: { legacy_sale_number: legacyNumber },
      });

      if (date.corrected) {
        issues.push({
          severity: "warning",
          source_row: rowNumber,
          legacy_sale_number: legacyNumber,
          code: "legacy_date_day_month_corrected",
          message: "La fecha numérica fue corregida de mm/dd a dd/mm según la secuencia del exportador legado.",
          raw_data: { original_display: row.getCell(2).text, normalized: occurredAt(date, time) },
        });
      }

      if (roundingAdjustment !== 0) {
        issues.push({
          severity: "warning",
          source_row: rowNumber,
          legacy_sale_number: legacyNumber,
          code: "legacy_rounding_difference",
          message: `El total legado difiere ${roundingAdjustment.toFixed(2)} del subtotal más IVA; ambos valores se preservan.`,
          raw_data: { subtotal, vat_10_5: vat105, vat_21: vat21, total, rounding_adjustment: roundingAdjustment },
        });
      }

      if (!["CONTADO", "TRANSFERENCIA BANCARIA"].includes(paymentMethod ?? "")) {
        issues.push({
          severity: "warning",
          source_row: rowNumber,
          legacy_sale_number: legacyNumber,
          code: "unmapped_payment_method",
          message: `El medio de pago legado '${paymentMethod ?? "vacío"}' se preserva sin vínculo actual.`,
          raw_data: { payment_method: paymentMethod },
        });
      }
    } catch (error) {
      errors.push({ row: rowNumber, message: error instanceof Error ? error.message : String(error) });
    }
  }

  if (errors.length > 0) {
    const preview = errors.slice(0, 10).map((error) => error.message).join("\n");
    throw new Error(`El análisis encontró ${errors.length} errores bloqueantes:\n${preview}`);
  }

  const numericNumbers = sales.map((sale) => Number(sale.legacy_sale_number)).filter(Number.isInteger);
  const missingNumbers = [];
  if (numericNumbers.length > 0) {
    const present = new Set(numericNumbers);
    const minimum = Math.min(...numericNumbers);
    const maximum = Math.max(...numericNumbers);
    for (let value = minimum; value <= maximum; value += 1) if (!present.has(value)) missingNumbers.push(value);
  }

  if (missingNumbers.length > 0) {
    issues.push({
      severity: "warning",
      source_row: null,
      legacy_sale_number: null,
      code: "missing_legacy_sale_numbers",
      message: `La secuencia del archivo no contiene: ${missingNumbers.join(", ")}.`,
      raw_data: { missing_numbers: missingNumbers },
    });
  }

  issues.push({
    severity: "warning",
    source_row: null,
    legacy_sale_number: null,
    code: "missing_legacy_status_assumed_completed",
    message: "La columna Estado está vacía en todo el libro; se importa como venta completada por tratarse del libro comercial de ventas.",
    raw_data: { rows: sales.length },
  });

  const sortedDates = sales.map((sale) => sale.occurred_at).sort();
  const summary = {
    file: path.resolve(filePath),
    sha256: hash,
    sheet: worksheet.name,
    headers,
    total_rows: sales.length,
    sales_detected: sales.length,
    legacy_number_min: Math.min(...numericNumbers),
    legacy_number_max: Math.max(...numericNumbers),
    missing_legacy_numbers: missingNumbers,
    date_range: [sortedDates[0], sortedDates.at(-1)],
    total_amount: Math.round(sales.reduce((sum, sale) => sum + sale.total, 0) * 100) / 100,
    warnings: issues.length,
    errors: 0,
    corrected_dates: issues.filter((issue) => issue.code === "legacy_date_day_month_corrected").length,
    sales_without_item_detail: sales.length,
    payment_methods: Object.groupBy(sales, (sale) => sale.payment_method ?? "(vacío)"),
  };
  summary.payment_methods = Object.fromEntries(
    Object.entries(summary.payment_methods).map(([key, rows]) => [key, rows.length]),
  );

  return { summary, sales, issues };
}

function buildSql({ args, analysis, sales, issues }) {
  const sourceFileName = path.basename(args.file);
  const call = `select private.import_legacy_sales_batch(
  (select id from public.organizations where slug = ${sqlLiteral(args.organizationSlug)}),
  ${sqlLiteral(args.source)},
  ${sqlLiteral(sourceFileName)},
  ${sqlLiteral(analysis.sha256)},
  ${analysis.total_rows},
  ${dollarJson(sales, "sales_payload")},
  ${dollarJson(issues, "issues_payload")},
  ${args.finalize ? "true" : "false"}
) as import_result;`;

  const verification = `
select jsonb_build_object(
  'products', count(*),
  'stock_units', coalesce(sum(current_stock), 0),
  'inventory_movements', (select count(*) from public.inventory_movements where organization_id = organization.id),
  'legacy_sales', (select count(*) from public.sales where organization_id = organization.id and source = 'legacy_import'),
  'legacy_total', (select coalesce(sum(total), 0) from public.sales where organization_id = organization.id and source = 'legacy_import'),
  'legacy_stock_movements', (select count(*) from public.inventory_movements movement join public.sales sale on sale.id = movement.reference_id where sale.organization_id = organization.id and sale.source = 'legacy_import'),
  'first_legacy_sale', (select min(occurred_at) from public.sales where organization_id = organization.id and source = 'legacy_import'),
  'last_legacy_sale', (select max(occurred_at) from public.sales where organization_id = organization.id and source = 'legacy_import')
) as verification
from public.organizations as organization
join public.products as product on product.organization_id = organization.id
where organization.slug = ${sqlLiteral(args.organizationSlug)}
group by organization.id;`;

  if (!args.pilot) return `${call}\n${verification}\n`;
  return `begin;
create temporary table legacy_sales_pilot_baseline on commit drop as
select organization.id as organization_id,
       count(product.id) as products,
       coalesce(sum(product.current_stock), 0) as stock_units,
       (select count(*) from public.inventory_movements where organization_id = organization.id) as movements
from public.organizations as organization
join public.products as product on product.organization_id = organization.id
where organization.slug = ${sqlLiteral(args.organizationSlug)}
group by organization.id;
${call}
select jsonb_build_object(
  'stock_unchanged', baseline.stock_units = coalesce(sum(product.current_stock), 0),
  'movement_count_unchanged', baseline.movements = (select count(*) from public.inventory_movements where organization_id = baseline.organization_id),
  'pilot_sales_visible', (select count(*) from public.sales where source = 'legacy_import' and organization_id = baseline.organization_id),
  'pilot_total', (select coalesce(sum(total), 0) from public.sales where source = 'legacy_import' and organization_id = baseline.organization_id),
  'legacy_stock_movements', (select count(*) from public.inventory_movements movement join public.sales sale on sale.id = movement.reference_id where sale.source = 'legacy_import' and sale.organization_id = baseline.organization_id)
) as pilot_verification
from legacy_sales_pilot_baseline as baseline
join public.products as product on product.organization_id = baseline.organization_id
group by baseline.organization_id, baseline.stock_units, baseline.movements;
rollback;
`;
}

function executeSql(target, sqlPath) {
  const require = createRequire(import.meta.url);
  const supabase = path.join(path.dirname(require.resolve("supabase/package.json")), "dist", "supabase.js");
  const targetFlag = target === "linked" ? "--linked" : "--local";
  execFileSync(process.execPath, [supabase, "db", "query", targetFlag, "--file", sqlPath], { stdio: "inherit" });
}

const args = parseArgs(process.argv.slice(2));
const { summary, sales, issues } = await analyzeWorkbook(args.file);
if (args.expectHash && args.expectHash !== summary.sha256) {
  throw new Error(`El hash cambió. Esperado ${args.expectHash}; recibido ${summary.sha256}.`);
}

fs.mkdirSync(args.outputDir, { recursive: true });
fs.writeFileSync(path.join(args.outputDir, "analysis.json"), JSON.stringify(summary, null, 2));
fs.writeFileSync(path.join(args.outputDir, "warnings.json"), JSON.stringify(issues, null, 2));

const selectedSales = args.limit === null ? sales : sales.slice(0, args.limit);
const selectedRows = new Set(selectedSales.map((sale) => sale.source_row));
const selectedIssues = args.limit === null
  ? issues
  : issues.filter((issue) => issue.source_row === null || selectedRows.has(issue.source_row));
const sql = buildSql({ args, analysis: summary, sales: selectedSales, issues: selectedIssues });
const sqlPath = path.join(args.outputDir, args.pilot ? "pilot.sql" : args.finalize ? "commit.sql" : "preview.sql");
fs.writeFileSync(sqlPath, sql);

console.log(JSON.stringify({
  ...summary,
  selected_sales: selectedSales.length,
  selected_issues: selectedIssues.length,
  mode: args.pilot ? "pilot_rollback" : args.finalize ? "commit" : "dry_run",
  target: args.target,
  output_dir: args.outputDir,
}, null, 2));

if (args.pilot || args.finalize) executeSql(args.target, sqlPath);
