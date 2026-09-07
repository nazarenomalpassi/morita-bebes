import ExcelJS from "exceljs";

import { getCurrentOrganization } from "@/lib/data/current-organization";
import { fetchAllRows } from "@/lib/data/fetch-all-rows";
import { excelDateInArgentina, isIsoDate, nextIsoDate } from "@/lib/date";
import { createServerSupabaseClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

function styleSheet(sheet: ExcelJS.Worksheet) {
  sheet.views = [{ state: "frozen", ySplit: 1 }];
  sheet.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: sheet.columnCount } };
  const header = sheet.getRow(1);
  header.height = 24;
  header.font = { bold: true, color: { argb: "FFFFFFFF" } };
  header.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF5D506D" } };
  header.alignment = { vertical: "middle" };
  sheet.columns.forEach((column) => {
    const longest = Math.max(
      String(column.header ?? "").length,
      ...(column.values ?? []).slice(1).map((value) => String(value ?? "").length),
    );
    column.width = Math.min(Math.max(longest + 2, 12), 42);
  });
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const from = url.searchParams.get("desde");
  const to = url.searchParams.get("hasta");
  if (!isIsoDate(from) || !isIsoDate(to) || from > to) return new Response("Rango de fechas inválido", { status: 400 });

  const supabase = await createServerSupabaseClient();
  const organization = await getCurrentOrganization(supabase);
  if (!organization) return new Response("No autorizado", { status: 401 });
  if (organization.role === "staff") return new Response("Acceso restringido", { status: 403 });

  const end = nextIsoDate(to);

  let salesRows;
  let expenseRows;
  let productRows;
  let movementRows;
  let payrollRows;
  try {
    [salesRows, expenseRows, productRows, movementRows, payrollRows] = await Promise.all([
      fetchAllRows((rangeFrom, rangeTo) => supabase
        .from("sales")
        .select("id, reference, occurred_at, subtotal, vat_10_5, vat_21, rounding_adjustment, manual_surcharge, surcharge, total, discount, discount_percent, status, source, legacy_sale_number, legacy_payment_method, legacy_customer_name, item_detail_status, customers(name), payment_methods(name), sale_items(quantity, unit_price, discount, line_total, unit_cost, legacy_product_name, legacy_product_code, products(name, sku))")
        .eq("organization_id", organization.id)
        .gte("occurred_at", `${from}T00:00:00-03:00`)
        .lt("occurred_at", `${end}T00:00:00-03:00`)
        .order("occurred_at")
        .order("id")
        .range(rangeFrom, rangeTo)),
      fetchAllRows((rangeFrom, rangeTo) => supabase
        .from("expenses")
        .select("id, expense_date, description, amount, notes, expense_categories(name), payment_methods(name)")
        .eq("organization_id", organization.id)
        .eq("status", "posted")
        .gte("expense_date", from)
        .lte("expense_date", to)
        .order("expense_date")
        .order("id")
        .range(rangeFrom, rangeTo)),
      fetchAllRows((rangeFrom, rangeTo) => supabase
        .from("products")
        .select("id, sku, barcode, name, current_stock, min_stock, target_stock, cost_price, retail_price, needs_restock, suppliers(business_name), categories(name), brands(name)")
        .eq("organization_id", organization.id)
        .eq("is_active", true)
        .order("name")
        .order("id")
        .range(rangeFrom, rangeTo)),
      fetchAllRows((rangeFrom, rangeTo) => supabase
        .from("inventory_movements")
        .select("id, occurred_at, kind, quantity_delta, unit_cost, notes, products(name, sku)")
        .eq("organization_id", organization.id)
        .gte("occurred_at", `${from}T00:00:00-03:00`)
        .lt("occurred_at", `${end}T00:00:00-03:00`)
        .order("occurred_at")
        .order("id")
        .range(rangeFrom, rangeTo)),
      fetchAllRows((rangeFrom, rangeTo) => supabase
        .from("payroll_movements")
        .select("id, period_month, paid_at, kind, amount, notes, employees(first_name, last_name)")
        .eq("organization_id", organization.id)
        .gte("paid_at", from)
        .lte("paid_at", to)
        .order("paid_at")
        .order("id")
        .range(rangeFrom, rangeTo)),
    ]);
  } catch {
    return new Response("No se pudieron preparar los datos", { status: 500 });
  }

  const workbook = new ExcelJS.Workbook();
  workbook.creator = "Morita Bebes";
  workbook.created = new Date();
  workbook.properties.date1904 = false;

  const summary = workbook.addWorksheet("Resumen");
  summary.columns = [{ header: "Indicador", key: "label" }, { header: "Valor", key: "value" }];
  const completedSales = salesRows.filter((sale) => sale.status === "completed");
  const grossSalesTotal = completedSales.reduce((sum, sale) => sum + Number(sale.subtotal), 0);
  const discountsTotal = completedSales.reduce((sum, sale) => sum + Number(sale.discount), 0);
  const manualSurchargesTotal = completedSales.reduce((sum, sale) => sum + Number(sale.manual_surcharge), 0);
  const salesTotal = grossSalesTotal - discountsTotal + manualSurchargesTotal;
  const chargedTotal = completedSales.reduce((sum, sale) => sum + Number(sale.total), 0);
  const expensesTotal = expenseRows.reduce((sum, expense) => sum + Number(expense.amount), 0);
  const payrollTotal = payrollRows.reduce(
    (sum, movement) => sum + (movement.kind === "deduction" ? -1 : 1) * Number(movement.amount),
    0,
  );
  const salesWithKnownCost = completedSales.filter(
    (sale) => sale.sale_items.length > 0 && sale.sale_items.every((item) => item.unit_cost !== null),
  );
  const revenueWithKnownCost = salesWithKnownCost.reduce(
    (sum, sale) => sum + Number(sale.subtotal) - Number(sale.discount) + Number(sale.manual_surcharge),
    0,
  );
  const revenueWithoutKnownCost = salesTotal - revenueWithKnownCost;
  const estimatedCost = salesWithKnownCost.reduce(
    (sum, sale) => sum + sale.sale_items.reduce((itemSum, item) => itemSum + Number(item.quantity) * Number(item.unit_cost), 0),
    0,
  );
  summary.addRows([
    { label: "Comercio", value: organization.name },
    { label: "Período", value: `${from} al ${to}` },
    { label: "Ventas completadas", value: completedSales.length },
    { label: "Venta bruta", value: grossSalesTotal },
    { label: "Descuentos", value: discountsTotal },
    { label: "Recargos manuales", value: manualSurchargesTotal },
    { label: "Ingreso neto", value: salesTotal },
    { label: "Total indicado al cliente", value: chargedTotal },
    { label: "Ventas con costo histórico conocido", value: revenueWithKnownCost },
    { label: "Ventas sin costo histórico", value: revenueWithoutKnownCost },
    { label: "Costo de mercadería conocido", value: estimatedCost },
    { label: "Margen bruto comprobable", value: revenueWithKnownCost - estimatedCost },
    { label: "Gastos", value: expensesTotal },
    { label: "Personal pagado", value: payrollTotal },
    { label: "Resultado operativo estimado", value: revenueWithoutKnownCost === 0 ? salesTotal - estimatedCost - expensesTotal - payrollTotal : "No calculable: faltan costos históricos" },
  ]);
  summary.getCell("B4").numFmt = "0";
  for (let row = 5; row <= 16; row += 1) {
    summary.getCell(`B${row}`).numFmt = "$#,##0.00";
  }
  styleSheet(summary);

  const sales = workbook.addWorksheet("Ventas");
  sales.columns = [
    { header: "Fecha", key: "date" }, { header: "Origen", key: "source" },
    { header: "Referencia", key: "reference" }, { header: "N.º histórico", key: "legacyNumber" },
    { header: "Estado", key: "status" }, { header: "Cliente", key: "customer" },
    { header: "Medio de pago", key: "payment" }, { header: "Productos", key: "items" },
    { header: "Subtotal", key: "subtotal" }, { header: "IVA 10,5%", key: "vat105" },
    { header: "IVA 21%", key: "vat21" }, { header: "Ajuste de redondeo", key: "rounding" },
    { header: "Descuento %", key: "discountPercent" },
    { header: "Descuento", key: "discount" },
    { header: "Recargo", key: "manualSurcharge" },
    { header: "Recargo por tarjeta", key: "cardSurcharge" },
    { header: "Total", key: "total" },
  ];
  sales.addRows(salesRows.map((sale) => ({
    date: excelDateInArgentina(sale.occurred_at),
    source: sale.source === "legacy_import" ? "Histórica importada" : "Sistema actual",
    reference: sale.source === "legacy_import" ? `Hist. #${sale.legacy_sale_number}` : sale.reference ?? sale.id.slice(0, 8),
    legacyNumber: sale.legacy_sale_number ?? "",
    status: sale.status === "completed" ? "Completada" : "Anulada",
    customer: sale.customers?.name ?? sale.legacy_customer_name ?? "Consumidor final",
    payment: sale.payment_methods?.name ?? sale.legacy_payment_method ?? "Sin indicar",
    items: sale.item_detail_status === "missing_from_source"
      ? "No provisto por el archivo legado"
      : sale.sale_items.map((item) => `${item.products?.name ?? item.legacy_product_name ?? "Producto"} x ${item.quantity}`).join(" | "),
    subtotal: Number(sale.subtotal), vat105: Number(sale.vat_10_5), vat21: Number(sale.vat_21), rounding: Number(sale.rounding_adjustment),
    discountPercent: sale.discount_percent ?? "Histórico en monto", discount: Number(sale.discount),
    manualSurcharge: Number(sale.manual_surcharge), cardSurcharge: Number(sale.surcharge), total: Number(sale.total),
  })));
  sales.getColumn("date").numFmt = "dd/mm/yyyy hh:mm";
  sales.getColumn("subtotal").numFmt = "$#,##0.00";
  sales.getColumn("vat105").numFmt = "$#,##0.00";
  sales.getColumn("vat21").numFmt = "$#,##0.00";
  sales.getColumn("rounding").numFmt = "$#,##0.00;[Red]-$#,##0.00";
  sales.getColumn("discount").numFmt = "$#,##0.00";
  sales.getColumn("manualSurcharge").numFmt = "$#,##0.00";
  sales.getColumn("cardSurcharge").numFmt = "$#,##0.00";
  sales.getColumn("discountPercent").numFmt = "0.00\"%\"";
  sales.getColumn("total").numFmt = "$#,##0.00";
  styleSheet(sales);

  const expenses = workbook.addWorksheet("Gastos");
  expenses.columns = [
    { header: "Fecha", key: "date" }, { header: "Descripción", key: "description" },
    { header: "Categoría", key: "category" }, { header: "Medio de pago", key: "payment" },
    { header: "Importe", key: "amount" }, { header: "Notas", key: "notes" },
  ];
  expenses.addRows(expenseRows.map((expense) => ({
    date: new Date(`${expense.expense_date}T12:00:00Z`),
    description: expense.description,
    category: expense.expense_categories?.name ?? "Sin categoría",
    payment: expense.payment_methods?.name ?? "Sin indicar",
    amount: Number(expense.amount),
    notes: expense.notes ?? "",
  })));
  expenses.getColumn("date").numFmt = "dd/mm/yyyy";
  expenses.getColumn("amount").numFmt = "$#,##0.00";
  styleSheet(expenses);

  const payroll = workbook.addWorksheet("Personal");
  payroll.columns = [
    { header: "Período", key: "period" }, { header: "Fecha de pago", key: "paid" },
    { header: "Empleado", key: "employee" }, { header: "Concepto", key: "kind" },
    { header: "Importe", key: "amount" }, { header: "Notas", key: "notes" },
  ];
  const payrollLabels = { salary: "Sueldo", advance: "Adelanto", bonus: "Bono", deduction: "Descuento" } as const;
  payroll.addRows(payrollRows.map((movement) => ({
    period: new Date(`${movement.period_month}T12:00:00Z`),
    paid: movement.paid_at ? new Date(`${movement.paid_at}T12:00:00Z`) : null,
    employee: movement.employees ? `${movement.employees.last_name}, ${movement.employees.first_name}` : "Empleado no disponible",
    kind: payrollLabels[movement.kind],
    amount: movement.kind === "deduction" ? -Number(movement.amount) : Number(movement.amount),
    notes: movement.notes ?? "",
  })));
  payroll.getColumn("period").numFmt = "mm/yyyy";
  payroll.getColumn("paid").numFmt = "dd/mm/yyyy";
  payroll.getColumn("amount").numFmt = "$#,##0.00;[Red]-$#,##0.00";
  styleSheet(payroll);

  const stock = workbook.addWorksheet("Stock actual");
  stock.columns = [
    { header: "SKU", key: "sku" }, { header: "Código de barras", key: "barcode" },
    { header: "Producto", key: "name" }, { header: "Categoría", key: "category" },
    { header: "Marca", key: "brand" }, { header: "Proveedor", key: "supplier" },
    { header: "Stock", key: "stock" }, { header: "Stock mínimo", key: "minimum" },
    { header: "Stock objetivo", key: "target" }, { header: "Compra sugerida", key: "suggested" },
    { header: "Costo", key: "cost" }, { header: "Precio", key: "price" },
    { header: "Reponer", key: "restock" },
  ];
  stock.addRows(productRows.map((product) => {
    const current = Number(product.current_stock);
    const minimum = Number(product.min_stock);
    const target = product.target_stock === null ? minimum : Number(product.target_stock);
    return {
      sku: product.sku, barcode: product.barcode ?? "", name: product.name,
      category: product.categories?.name ?? "Pendiente", brand: product.brands?.name ?? "Pendiente",
      supplier: product.suppliers?.business_name ?? "Pendiente de completar",
      stock: current, minimum, target,
      suggested: product.needs_restock ? Math.max(1, target - current) : 0,
      cost: Number(product.cost_price), price: Number(product.retail_price),
      restock: product.needs_restock ? "Sí" : "No",
    };
  }));
  stock.getColumn("cost").numFmt = "$#,##0.00";
  stock.getColumn("price").numFmt = "$#,##0.00";
  styleSheet(stock);

  const movements = workbook.addWorksheet("Movimientos de stock");
  movements.columns = [
    { header: "Fecha", key: "date" }, { header: "SKU", key: "sku" },
    { header: "Producto", key: "product" }, { header: "Tipo", key: "kind" },
    { header: "Cantidad", key: "quantity" }, { header: "Costo unitario", key: "cost" },
    { header: "Nota", key: "notes" },
  ];
  movements.addRows(movementRows.map((movement) => ({
    date: excelDateInArgentina(movement.occurred_at), sku: movement.products?.sku ?? "",
    product: movement.products?.name ?? "", kind: movement.kind,
    quantity: Number(movement.quantity_delta), cost: movement.unit_cost === null ? null : Number(movement.unit_cost),
    notes: movement.notes ?? "",
  })));
  movements.getColumn("date").numFmt = "dd/mm/yyyy hh:mm";
  movements.getColumn("cost").numFmt = "$#,##0.00";
  styleSheet(movements);

  const buffer = await workbook.xlsx.writeBuffer();
  const filename = `morita-bebes-gestion-${from}-${to}.xlsx`;
  return new Response(new Uint8Array(buffer), {
    headers: {
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Cache-Control": "no-store",
    },
  });
}
