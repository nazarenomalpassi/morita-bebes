import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import AxeBuilder from "@axe-core/playwright";

async function value(query) { const { data, error } = await query; if (error) throw new Error(error.message); return data; }
async function eventually(check) { for (let i = 0; i < 80; i++) { const result = await check(); if (result) return result; await delay(150); } throw new Error("Expected database/UI state was not reached"); }

export async function auditManagementWorkflows({ page, browser, context, baseUrl, artifacts, attempt, owner, organizationId, methods, staffEmail, password, runLocalSql }) {
  assert(["localhost", "127.0.0.1"].includes(new URL(baseUrl).hostname));
  assert(["localhost", "127.0.0.1"].includes(new URL(owner.supabaseUrl).hostname));
  const cash = methods.find((item) => item.code === "cash"), transfer = methods.find((item) => item.code === "transfer");
  const scope = randomUUID().slice(0, 8);
  const category = await value(owner.from("categories").insert({ organization_id: organizationId, name: `Gestion ${scope}`, slug: `gestion-${scope}` }).select("id,name").single());
  const brand = await value(owner.from("brands").insert({ organization_id: organizationId, name: `Marca ${scope}` }).select("id,name").single());
  async function fixture(name = "Pañales Bebé Premium XXG", stock = 10) {
    const suffix = randomUUID().slice(0, 8);
    const product = await value(owner.from("products").insert({ organization_id: organizationId, name: `${name} ${suffix}`, sku: `000-WF-${suffix}`, barcode: `0770-${suffix}`, cost_price: 5000, retail_price: 10000, wholesale_price: 9000 }).select().single());
    if (stock) await value(owner.rpc("adjust_inventory", { p_organization_id: organizationId, p_product_id: product.id, p_quantity_delta: stock, p_reason: "LOCAL workflow fixture" }));
    return { ...product, current_stock: stock };
  }
  async function clearDrafts() { await page.goto(`${baseUrl}/app`); await page.evaluate(() => sessionStorage.clear()); }
  async function addSale(product, search = product.sku) {
    await page.getByRole("searchbox", { name: "Buscar por nombre, SKU o código de barras", exact: true }).fill(search);
    await page.locator(".sale-product-row").filter({ hasText: product.name }).click();
  }
  async function screenshot(name) {
    assert((await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)) <= 1, "No horizontal page scroll");
    const axe = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa"]).analyze();
    const serious = axe.violations.filter((issue) => ["serious", "critical"].includes(issue.impact));
    assert.equal(serious.length, 0, serious.map((issue) => `${issue.id}: ${issue.nodes.map((node) => node.target).join(",")}`).join("; "));
    await page.screenshot({ path: path.join(artifacts, `workflow-${name}.png`), fullPage: true });
  }
  const run = (name, fn) => process.env.AUDIT_WORKFLOW_CASE && !name.includes(process.env.AUDIT_WORKFLOW_CASE) ? Promise.resolve() : attempt(name, fn);

  await run("Workflow sale predictive search, draft recovery, inline customer and exact payment remainder", async () => {
    await clearDrafts();
    const product = await fixture();
    await page.setViewportSize({ width: 1366, height: 768 });
    await page.goto(`${baseUrl}/app/ventas`);
    await addSale(product, `bebe xxg ${product.name.split(" ").at(-1)}`);
    await page.getByRole("button", { name: "Crear cliente sin salir de la venta", exact: true }).click();
    const customerName = `Cliente rapido ${randomUUID().slice(0, 8)}`;
    const customerDialog = page.getByRole("dialog", { name: "Nuevo cliente", exact: true });
    await customerDialog.locator('[name="name"]').fill(customerName);
    await customerDialog.locator('[name="phone"]').fill("3511234567");
    await screenshot("inline-customer-desktop");
    await customerDialog.getByRole("button", { name: "Guardar y seleccionar", exact: true }).click();
    await customerDialog.waitFor({ state: "hidden" });
    const customer = await value(owner.from("customers").select("id").eq("name", customerName).single());
    assert.equal(await page.locator('[name="customer_id"]').inputValue(), customer.id);
    assert.equal(await page.locator(".cart-line").count(), 1);
    await page.locator(".sale-adjustments > summary").click();
    await page.locator('[name="discount"]').fill("10");
    await page.locator('[name="notes"]').fill("Borrador local de prueba");
    await page.getByLabel("Pago combinado", { exact: true }).check();
    await page.getByLabel(cash.name, { exact: true }).fill("3000");
    await page.getByRole("button", { name: `Completar restante en ${transfer.name}`, exact: true }).click();
    assert.equal(await page.getByLabel(transfer.name, { exact: true }).inputValue(), "6000.00");
    await page.goto(`${baseUrl}/app/productos`);
    await page.goto(`${baseUrl}/app/ventas`);
    await page.getByRole("button", { name: "Recuperar", exact: true }).click();
    assert.equal(await page.locator(".cart-line").count(), 1);
    assert.equal(await page.locator('[name="customer_id"]').inputValue(), customer.id);
    assert.equal(await page.locator('[name="discount"]').inputValue(), "10");
    await page.reload();
    await page.getByRole("button", { name: "Recuperar", exact: true }).click();
    await page.getByRole("button", { name: /^Cobrar / }).click();
    await page.getByRole("button", { name: "Confirmar venta", exact: true }).click();
    await page.getByText("Venta registrada y stock actualizado.", { exact: true }).waitFor();
    const sale = await value(owner.from("sales").select("id,total,discount_percent").eq("customer_id", customer.id).single());
    assert.equal(Number(sale.total), 9000); assert.equal(Number(sale.discount_percent), 10);
    assert.equal(Number((await value(owner.from("products").select("current_stock").eq("id", product.id).single())).current_stock), 9);
    const movements = await value(owner.from("cash_movements").select("signed_amount").eq("reference_id", sale.id));
    assert.equal(movements.reduce((sum, row) => sum + Number(row.signed_amount), 0), 9000);
    await addSale(product);
    await page.goto(`${baseUrl}/app`); await page.goto(`${baseUrl}/app/ventas`);
    await page.getByRole("button", { name: "Recuperar", exact: true }).waitFor();
    await page.getByRole("button", { name: "Descartar", exact: true }).click();
  });

  await run("Workflow inventory draft keeps prices, adds optional category and brand atomically", async () => {
    await clearDrafts();
    const product = await fixture("Ingreso gestion");
    const ordersBefore = (await value(owner.from("purchase_orders").select("id"))).length;
    const cashBefore = (await value(owner.from("cash_movements").select("id"))).length;
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(`${baseUrl}/app/compras/cargar`);
    await page.getByRole("searchbox", { name: "Buscar artículo", exact: true }).fill(product.sku);
    await page.getByRole("button", { name: `Agregar ${product.name}`, exact: true }).click();
    let line = page.locator(`[data-product-id="${product.id}"]`);
    await line.getByRole("textbox", { name: `Cantidad recibida de ${product.name}`, exact: true }).fill("2");
    await line.getByRole("textbox", { name: `Costo unitario ($) de ${product.name}`, exact: true }).fill("5.500,95");
    await page.getByRole("button", { name: "Cargar nuevo producto", exact: true }).click();
    const newName = `Nuevo clasificado ${randomUUID().slice(0, 8)}`, sku = `000-NEW-${randomUUID().slice(0, 8)}`;
    let newLine = page.locator('[data-new-product="true"]');
    await newLine.getByLabel("Nombre del nuevo producto", { exact: true }).fill(newName);
    await newLine.getByLabel("SKU / código interno", { exact: true }).fill(sku);
    await newLine.getByLabel("Categoría (opcional)", { exact: true }).selectOption(category.id);
    await newLine.getByLabel("Marca (opcional)", { exact: true }).selectOption(brand.id);
    await newLine.getByRole("textbox", { name: `Costo unitario ($) de ${newName}`, exact: true }).fill("2000");
    await newLine.getByRole("textbox", { name: `Precio minorista ($) de ${newName}`, exact: true }).fill("3500");
    page.once("dialog", (dialog) => dialog.accept());
    await page.reload();
    await page.getByRole("button", { name: "Recuperar", exact: true }).click();
    line = page.locator(`[data-product-id="${product.id}"]`); newLine = page.locator('[data-new-product="true"]');
    assert.equal(await line.getByRole("textbox", { name: `Costo unitario ($) de ${product.name}`, exact: true }).inputValue(), "5.500,95");
    assert.equal(await newLine.getByLabel("Categoría (opcional)", { exact: true }).inputValue(), category.id);
    await screenshot("inventory-draft-mobile");
    await page.getByRole("button", { name: "Guardar e ingresar stock", exact: true }).click();
    await page.getByRole("heading", { name: "Ingreso de mercadería registrado", exact: true }).waitFor();
    const saved = await value(owner.from("products").select().eq("sku", sku).single());
    assert.equal(saved.category_id, category.id); assert.equal(saved.brand_id, brand.id); assert.equal(Number(saved.current_stock), 1);
    assert.equal(Number((await value(owner.from("products").select("current_stock,cost_price").eq("id", product.id).single())).current_stock), 12);
    assert.equal((await value(owner.from("purchase_orders").select("id"))).length, ordersBefore);
    assert.equal((await value(owner.from("cash_movements").select("id"))).length, cashBefore);
  });

  await run("Workflow quick price conflict preserves typed values and records successful edits", async () => {
    const product = await fixture("Precio concurrente");
    await page.goto(`${baseUrl}/app/productos?q=${product.sku}`);
    await page.getByRole("button", { name: "Editar precios", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: "Editar precios", exact: true });
    await dialog.locator('[name="retail_price"]').fill("12000");
    await value(owner.rpc("update_management_prices", { p_organization_id: organizationId, p_changes: [{ product_id: product.id, cost_price: 5100, retail_price: 10500, wholesale_price: 9000, original_cost_price: 5000, original_retail_price: 10000, original_wholesale_price: 9000 }] }));
    await dialog.getByRole("button", { name: "Guardar precios", exact: true }).click();
    await dialog.getByText("Otra persona cambió estos precios.", { exact: false }).waitFor();
    assert.equal(await dialog.locator('[name="retail_price"]').inputValue(), "12.000");
    page.once("dialog", (notice) => notice.accept());
    await dialog.getByRole("button", { name: "Cargar precios actuales", exact: true }).click();
    await dialog.locator('[name="retail_price"]').fill("12000");
    await screenshot("price-conflict-mobile");
    await dialog.getByRole("button", { name: "Guardar precios", exact: true }).click();
    await dialog.waitFor({ state: "hidden" });
    const after = await value(owner.from("products").select().eq("id", product.id).single());
    assert.equal(Number(after.retail_price), 12000); assert.equal(Number(after.cost_price), 5100); assert.equal(Number(after.current_stock), 10);
    assert.equal((await value(owner.from("product_price_changes").select("id").eq("product_id", product.id))).length, 2);
  });

  await run("Workflow batch preview, classification, optional attributes and pending filters", async () => {
    const name = `Tanda ${randomUUID().slice(0, 8)}`;
    const products = [await fixture(name), await fixture(name)];
    await page.goto(`${baseUrl}/app/productos?q=${encodeURIComponent(name)}&page_size=10`);
    await page.locator(".catalog-maintenance > summary").click();
    await page.getByLabel("Seleccionar esta página (2 productos)", { exact: true }).check();
    await page.getByLabel("Variación (%)", { exact: true }).fill("10");
    await page.getByRole("button", { name: "Ver cambios antes de guardar", exact: true }).click();
    assert.equal(Number((await value(owner.from("products").select("retail_price").eq("id", products[0].id).single())).retail_price), 10000);
    await screenshot("batch-preview-mobile");
    await page.getByRole("button", { name: "Confirmar cambios en 2 productos", exact: true }).click();
    await page.getByText("Precios actualizados en 2 productos.", { exact: false }).waitFor();
    await eventually(async () => (await value(owner.from("products").select("retail_price").in("id", products.map((item) => item.id)))).every((item) => Number(item.retail_price) === 11000));
    await page.getByRole("radio", { name: "Clasificación", exact: true }).check();
    await page.getByLabel("Seleccionar esta página (2 productos)", { exact: true }).check();
    const tools = page.locator(".catalog-maintenance");
    await tools.getByRole("combobox").nth(0).selectOption(category.id);
    await tools.getByRole("combobox").nth(1).selectOption(brand.id);
    await tools.getByRole("button", { name: "Ver cambios antes de guardar", exact: true }).click();
    await tools.getByRole("button", { name: "Confirmar cambios en 2 productos", exact: true }).click();
    await tools.getByText("Clasificación actualizada en 2 productos.", { exact: false }).waitFor();
    await page.goto(`${baseUrl}/app/productos/${products[0].id}/editar`);
    await page.getByLabel("Talle", { exact: true }).fill("XXG");
    await page.getByLabel("Presentación / unidades", { exact: true }).fill("30 unidades");
    await page.getByRole("button", { name: "Guardar cambios", exact: true }).click();
    await page.getByText("Producto actualizado correctamente.", { exact: true }).waitFor();
    await page.goto(`${baseUrl}/app/productos?q=xxg%2030%20${encodeURIComponent(name)}`);
    assert.equal(await page.locator(".product-price-table tbody tr").count(), 1);
    await page.goto(`${baseUrl}/app/productos?q=${encodeURIComponent(name)}&pending=brand`);
    await page.getByRole("heading", { name: "No encontramos productos", exact: true }).waitFor();
    await page.goto(`${baseUrl}/app/productos/${products[0].id}`);
    await page.getByRole("heading", { name: "Historial de precios", exact: true }).waitFor();
    await screenshot("product-history-mobile");
  });

  await run("Workflow expense payment remainder and report drilldown keep complete filters", async () => {
    await page.goto(`${baseUrl}/app/gastos`);
    await page.getByText("Nuevo gasto", { exact: true }).click();
    const form = page.locator(".details-panel form").first();
    const description = `Gasto recorrido ${randomUUID().slice(0, 8)}`;
    await form.locator('[name="description"]').fill(description);
    await form.locator('[name="amount"]').fill("10000,95");
    await form.getByLabel("Pago combinado", { exact: true }).check();
    await form.getByLabel(cash.name, { exact: true }).fill("3000");
    await form.getByRole("button", { name: `Completar restante en ${transfer.name}`, exact: true }).click();
    assert.equal(await form.getByLabel(transfer.name, { exact: true }).inputValue(), "7000.95");
    await form.getByRole("button", { name: "Guardar gasto", exact: true }).click();
    await page.locator(".form-success:visible").first().waitFor();
    const expense = await value(owner.from("expenses").select().eq("description", description).single());
    const day = expense.expense_date;
    const from = `${day.slice(0, 4)}-01-01`;
    const reportParams = new URLSearchParams({ vista: "expenses", periodo: "custom", desde: from, hasta: day, gasto_categoria: "none", gasto_empleado: expense.created_by, gasto_pago: transfer.id });
    await page.goto(`${baseUrl}/app/reportes?${reportParams}`);
    await page.locator(".analytics-kpi").filter({ hasText: "Total de gastos" }).click();
    await page.waitForURL((url) => url.pathname === "/app/gastos" && url.searchParams.get("desde") === from);
    assert.equal(new URL(page.url()).searchParams.get("hasta"), day);
    assert.equal(new URL(page.url()).searchParams.get("pago"), transfer.id);
    assert.equal(new URL(page.url()).searchParams.get("categoria"), "none");
    assert.equal(await page.locator('[name="desde"]').inputValue(), from);
    await page.locator(".data-table tbody").getByText(description, { exact: true }).waitFor();
    await screenshot("expense-drilldown-mobile");
    const movements = await value(owner.from("cash_movements").select("signed_amount").eq("reference_id", expense.id));
    assert.equal(Math.round(movements.reduce((sum, row) => sum + Number(row.signed_amount), 0) * 100), -1000095);
  });

  await run("Workflow closure history reads records older than the previous 90-row cap", async () => {
    assert(/^[0-9a-f-]{36}$/i.test(organizationId));
    runLocalSql(`begin; set local session_replication_role = replica; insert into public.daily_cash_closures(organization_id,business_date,closed_by,closure_type,status,expected_total,counted_total,difference_total,absolute_difference_total)
select '${organizationId}'::uuid, date '2001-01-01' + n, null, 'automatic', 'balanced', 0,0,0,0 from generate_series(0,94) n on conflict do nothing; commit;`);
    await page.goto(`${baseUrl}/app/caja?cierres=4&buscar=prueba`);
    await page.getByRole("navigation", { name: "Páginas de cierres", exact: true }).waitFor();
    assert((await page.locator(".cash-closure-history-row").count()) > 0);
    const previous = page.getByRole("navigation", { name: "Páginas de cierres" }).getByRole("link", { name: "Página anterior" });
    assert((await previous.getAttribute("href")).includes("buscar=prueba"));
    await screenshot("closure-pagination-mobile");
  });

  await run("Workflow staff keeps inventory permissions on mobile and cannot see another user's draft", async () => {
    const storage = await context.storageState();
    const staffContext = await browser.newContext({ serviceWorkers: "block", viewport: { width: 390, height: 844 } });
    const staffPage = await staffContext.newPage();
    try {
      await staffPage.goto(`${baseUrl}/login`); await staffPage.locator('[name="email"]').fill(staffEmail); await staffPage.locator('[name="password"]').fill(password);
      await staffPage.getByRole("button", { name: "Ingresar", exact: true }).click(); await staffPage.waitForURL("**/app");
      const product = await fixture("Edicion empleada");
      await staffPage.goto(`${baseUrl}/app/productos?q=${product.sku}`);
      await staffPage.getByRole("button", { name: "Editar precios", exact: true }).click();
      const dialog = staffPage.getByRole("dialog", { name: "Editar precios", exact: true });
      await dialog.locator('[name="retail_price"]').fill("11500"); await dialog.getByRole("button", { name: "Guardar precios", exact: true }).click();
      await dialog.waitFor({ state: "hidden" });
      assert.equal(Number((await value(owner.from("products").select("retail_price").eq("id", product.id).single())).retail_price), 11500);
      const ownerId = (await value(owner.auth.getUser())).user.id;
      await staffPage.evaluate(({ org, user, productId }) => {
        sessionStorage.setItem(`morita:management-draft:v1:${org}:${user}:sale`, JSON.stringify({ version: 1, savedAt: Date.now(), value: { cart: [{ id: productId, quantity: 1 }], customerId: "", notes: "Borrador privado de otro usuario", occurredAt: "", discountInput: "", manualSurchargeInput: "", combinedPayment: false, selectedPaymentMethod: "", selectedCardType: "", paymentAmounts: {}, paymentCardTypes: {}, idempotencyKey: "" } }));
      }, { org: organizationId, user: ownerId, productId: product.id });
      await staffPage.goto(`${baseUrl}/app/ventas`); assert.equal(await staffPage.getByRole("button", { name: "Recuperar", exact: true }).count(), 0);
      await staffPage.goto(`${baseUrl}/app/reportes`); await staffPage.getByRole("heading", { name: "Acceso restringido", exact: true }).waitFor();
    } finally { await staffContext.close(); await context.addCookies(storage.cookies); }
  });
}
