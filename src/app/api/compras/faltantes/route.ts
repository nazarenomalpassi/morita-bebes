import ExcelJS from "exceljs";

import { getCurrentOrganization } from "@/lib/data/current-organization";
import { fetchAllRows } from "@/lib/data/fetch-all-rows";
import { createServerSupabaseClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

function styleSheet(sheet: ExcelJS.Worksheet) {
  sheet.views = [{ state: "frozen", ySplit: 1 }];
  sheet.autoFilter = {
    from: { row: 1, column: 1 },
    to: { row: 1, column: sheet.columnCount },
  };
  const header = sheet.getRow(1);
  header.height = 25;
  header.font = { bold: true, color: { argb: "FFFFFFFF" } };
  header.fill = {
    type: "pattern",
    pattern: "solid",
    fgColor: { argb: "FF5D506D" },
  };
  header.alignment = { vertical: "middle" };
  sheet.columns.forEach((column) => {
    const values = (column.values ?? []).slice(1);
    const longest = Math.max(
      String(column.header ?? "").length,
      ...values.map((value) => String(value ?? "").length),
    );
    column.width = Math.min(Math.max(longest + 2, 12), 42);
  });
}

function dateStamp() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Argentina/Buenos_Aires",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

export async function GET() {
  const supabase = await createServerSupabaseClient();
  const organization = await getCurrentOrganization(supabase);
  if (!organization) return new Response("No autorizado", { status: 401 });
  let data;
  try {
    data = await fetchAllRows((from, to) => supabase
      .from("products")
      .select("id, sku, barcode, name, current_stock, min_stock, target_stock, cost_price, unit, suppliers(business_name), categories(name), brands(name)")
      .eq("organization_id", organization.id)
      .eq("is_active", true)
      .eq("needs_restock", true)
      .order("name")
      .order("id")
      .range(from, to));
  } catch {
    return new Response("No se pudieron preparar los faltantes", { status: 500 });
  }

  const products = data
    .map((product) => {
      const stock = Number(product.current_stock);
      const minimum = Number(product.min_stock);
      const target = product.target_stock === null
        ? minimum
        : Number(product.target_stock);
      const suggested = Math.max(1, target - stock);
      const cost = Number(product.cost_price);
      return {
        supplier: product.suppliers?.business_name ?? "Proveedor pendiente",
        sku: product.sku,
        barcode: product.barcode ?? "",
        name: product.name,
        category: product.categories?.name ?? "Sin categoría",
        brand: product.brands?.name ?? "Sin marca",
        unit: product.unit,
        stock,
        minimum,
        target,
        suggested,
        cost,
        estimate: suggested * cost,
        pending: !product.suppliers,
      };
    })
    .sort((a, b) =>
      a.supplier.localeCompare(b.supplier, "es") || a.name.localeCompare(b.name, "es"),
    );

  const workbook = new ExcelJS.Workbook();
  workbook.creator = "Morita Bebes";
  workbook.created = new Date();

  const detail = workbook.addWorksheet("Faltantes");
  detail.columns = [
    { header: "Proveedor", key: "supplier" },
    { header: "SKU", key: "sku" },
    { header: "Código de barras", key: "barcode" },
    { header: "Producto", key: "name" },
    { header: "Categoría", key: "category" },
    { header: "Marca", key: "brand" },
    { header: "Unidad", key: "unit" },
    { header: "Stock actual", key: "stock" },
    { header: "Stock mínimo", key: "minimum" },
    { header: "Stock objetivo", key: "target" },
    { header: "Cantidad sugerida", key: "suggested" },
    { header: "Costo unitario", key: "cost" },
    { header: "Total estimado", key: "estimate" },
    { header: "Observación", key: "notes" },
  ];
  detail.addRows(products.map((product) => ({
    ...product,
    notes: product.pending
      ? "Completar proveedor antes de generar la orden"
      : product.cost === 0
        ? "Completar costo"
        : "",
  })));
  detail.getColumn("stock").numFmt = "0.000";
  detail.getColumn("minimum").numFmt = "0.000";
  detail.getColumn("target").numFmt = "0.000";
  detail.getColumn("suggested").numFmt = "0.000";
  detail.getColumn("cost").numFmt = "$#,##0.00";
  detail.getColumn("estimate").numFmt = "$#,##0.00";
  styleSheet(detail);

  let previousSupplier = "";
  products.forEach((product, index) => {
    const row = detail.getRow(index + 2);
    if (product.supplier !== previousSupplier) {
      row.border = { top: { style: "medium", color: { argb: "FFC9C4EE" } } };
      previousSupplier = product.supplier;
    }
    if (product.pending) {
      row.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFFFF1EB" } };
    }
  });

  const grouped = new Map<string, { products: number; units: number; estimate: number; pending: boolean }>();
  products.forEach((product) => {
    const current = grouped.get(product.supplier) ?? { products: 0, units: 0, estimate: 0, pending: product.pending };
    current.products += 1;
    current.units += product.suggested;
    current.estimate += product.estimate;
    grouped.set(product.supplier, current);
  });
  const summary = workbook.addWorksheet("Resumen por proveedor");
  summary.columns = [
    { header: "Proveedor", key: "supplier" },
    { header: "Productos", key: "products" },
    { header: "Unidades sugeridas", key: "units" },
    { header: "Total estimado", key: "estimate" },
    { header: "Estado", key: "status" },
  ];
  summary.addRows([...grouped.entries()].map(([supplier, values]) => ({
    supplier,
    products: values.products,
    units: values.units,
    estimate: values.estimate,
    status: values.pending ? "Completar proveedor" : "Listo para pedir",
  })));
  summary.getColumn("units").numFmt = "0.000";
  summary.getColumn("estimate").numFmt = "$#,##0.00";
  styleSheet(summary);

  const info = workbook.addWorksheet("Información");
  info.columns = [{ header: "Campo", key: "field" }, { header: "Valor", key: "value" }];
  info.addRows([
    { field: "Comercio", value: organization.name },
    { field: "Generado", value: new Date() },
    { field: "Productos a reponer", value: products.length },
    { field: "Criterio", value: "Stock actual menor o igual al stock mínimo" },
    { field: "Cantidad sugerida", value: "Diferencia hasta el stock objetivo (o mínimo); al menos una unidad" },
  ]);
  info.getColumn("value").width = 55;
  info.getCell("B3").numFmt = "dd/mm/yyyy hh:mm";
  styleSheet(info);

  const buffer = await workbook.xlsx.writeBuffer();
  return new Response(new Uint8Array(buffer), {
    headers: {
      "Cache-Control": "no-store",
      "Content-Disposition": `attachment; filename="morita-bebes-faltantes-${dateStamp()}.xlsx"`,
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    },
  });
}
