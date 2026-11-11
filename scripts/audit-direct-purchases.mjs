import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { writeFile } from "node:fs/promises";
import AxeBuilder from "@axe-core/playwright";

async function value(query) {
  const { data, error } = await query;
  if (error) throw new Error(error.message);
  return data;
}
async function waitOrder(owner, reference, status) {
  for (let i = 0; i < 60; i++) {
    const order = await value(owner.from("purchase_orders").select("id,status,estimated_total").eq("reference", reference).maybeSingle());
    if (order?.status === status) return order;
    await delay(250);
  }
  throw new Error(`Order ${reference} did not reach ${status}`);
}

export async function auditDirectPurchases({ browser, context, baseUrl, artifacts, attempt, owner, organizationId, supplierId, staffEmail, password }) {
  assert(["localhost", "127.0.0.1"].includes(new URL(baseUrl).hostname));
  assert(["localhost", "127.0.0.1"].includes(new URL(owner.supabaseUrl).hostname));
  const storageState = await context.storageState();
  const runCase = (name, callback) => process.env.AUDIT_DIRECT_CASE && !name.includes(process.env.AUDIT_DIRECT_CASE) ? Promise.resolve() : attempt(name, callback);
  async function fixture() {
    const token = randomUUID().slice(0, 8);
    return value(owner.from("products").insert({ organization_id: organizationId, name: `Panal entrada ${token}`, sku: `DIRECT-${token}`, barcode: `0${Date.now()}${token}`, cost_price: 9000, retail_price: 14000, wholesale_price: 12000, default_supplier_id: supplierId, is_published: true }).select().single());
  }
  async function add(page, product) {
    const search = page.getByRole("searchbox", { name: "Buscar artículo", exact: true });
    await search.fill(product.barcode);
    await page.getByRole("button", { name: `Agregar ${product.name}`, exact: true }).click();
    return page.locator(`[data-product-id="${product.id}"]`);
  }
  async function saved(product, expectedStock, expectedCost, expectedRetail, expectedWholesale) {
    const row = await value(owner.from("products").select("current_stock,cost_price,retail_price,wholesale_price").eq("id", product.id).single());
    assert.equal(Number(row.current_stock), expectedStock);
    assert.equal(Number(row.cost_price), expectedCost);
    assert.equal(Number(row.retail_price), expectedRetail);
    assert.equal(row.wholesale_price === null ? null : Number(row.wholesale_price), expectedWholesale);
  }

  for (const staff of [false, true]) await runCase(staff ? "Staff mobile standalone entry creates products and increments stock" : "Standalone entry saves quantities and propagates catalog prices", async () => {
    const testContext = await browser.newContext({ storageState: staff ? undefined : storageState, serviceWorkers: "block", reducedMotion: "reduce", viewport: { width: staff ? 390 : 1366, height: staff ? 844 : 768 } });
    try {
      const page = await testContext.newPage();
      if (staff) {
        await page.goto(`${baseUrl}/login`);
        await page.locator('[name="email"]').fill(staffEmail);
        await page.locator('[name="password"]').fill(password);
        await page.getByRole("button", { name: "Ingresar", exact: true }).click();
        await page.waitForURL("**/app");
      }
      const product = await fixture();
      const second = staff ? null : await fixture();
      const reference = `REM-UI-${randomUUID().slice(0, 8)}`;
      const ordersBefore = (await value(owner.from("purchase_orders").select("id"))).length;
      const receiptsBefore = (await value(owner.from("purchase_receipts").select("id"))).length;
      await page.goto(`${baseUrl}/app/compras`);
      await page.getByRole("link", { name: "Ingresar mercadería", exact: true }).first().click();
      await page.locator("h1").getByText("Ingresar mercadería", { exact: true }).waitFor();
      const form = page.locator(".direct-purchase-form");
      assert.equal(await form.locator('[name="supplier_id"], [name="reference"], [name="document_date"]').count(), 0, "No supplier or document inputs belong to a stock entry");
      await form.locator('[name="notes"]').fill(reference);
      const line = await add(page, product);
      const quantity = line.getByRole("textbox", { name: `Cantidad recibida de ${product.name}`, exact: true });
      await quantity.fill("0");
      const submit = form.getByRole("button", { name: "Guardar e ingresar stock", exact: true });
      assert(await submit.isDisabled(), "Zero received quantity cannot be committed");
      await quantity.fill(staff ? "4" : "2,5");
      const cost = line.getByRole("textbox", { name: `Costo unitario ($) de ${product.name}`, exact: true });
      await cost.fill(staff ? "1234" : "10500");
      await cost.press(",");
      assert((await cost.inputValue()).endsWith(","), "Decimal separator survives typing");
      await cost.pressSequentially(staff ? "56" : "95");
      await line.getByRole("textbox", { name: `Precio minorista ($) de ${product.name}`, exact: true }).fill(staff ? "2.345,67" : "15.000,50");
      await line.getByRole("textbox", { name: `Precio mayorista ($) de ${product.name}`, exact: true }).fill(staff ? "2000" : "13.000");
      await quantity.focus();
      await quantity.press("Enter");
      assert.equal((await value(owner.from("purchase_orders").select("id").eq("reference", reference))).length, 0, "Enter in a field must not save the order");
      if (second) {
        const secondLine = await add(page, second);
        await secondLine.getByRole("textbox", { name: `Cantidad recibida de ${second.name}`, exact: true }).fill("3");
      }
      await form.getByRole("button", { name: "Cargar nuevo producto", exact: true }).click();
      const newLine = form.locator('[data-new-product="true"]').last();
      const newId = await newLine.getAttribute("data-product-id");
      const newName = `Nuevo ingreso ${randomUUID().slice(0, 8)}`;
      const newSku = `000-${randomUUID().slice(0, 8)}`;
      await newLine.getByRole("textbox", { name: "Nombre del nuevo producto", exact: true }).fill(newName);
      await newLine.getByRole("textbox", { name: "SKU / código interno", exact: true }).fill(product.sku);
      assert(await submit.isDisabled(), "A new product cannot reuse an existing identifier");
      await newLine.getByRole("textbox", { name: "SKU / código interno", exact: true }).fill(newSku);
      await newLine.getByRole("textbox", { name: "Código de barras", exact: true }).fill(newSku);
      await newLine.getByRole("textbox", { name: `Cantidad recibida de ${newName}`, exact: true }).fill("2");
      await newLine.getByRole("textbox", { name: `Costo unitario ($) de ${newName}`, exact: true }).fill("2.500,50");
      await newLine.getByRole("textbox", { name: `Precio minorista ($) de ${newName}`, exact: true }).fill("4.500");
      assert.equal((await value(owner.from("products").select("id").eq("sku", newSku))).length, 0, "New products are not created before stock confirmation");
      for (const [width, height] of staff ? [[375, 812], [390, 844], [430, 932], [768, 1024]] : [[1024, 768], [1366, 768], [1920, 1080]]) {
        await page.setViewportSize({ width, height });
        await page.evaluate(() => window.scrollTo(0, 0));
        assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), "Direct entry must not overflow horizontally");
        await page.screenshot({ path: path.join(artifacts, `direct-purchase-${staff ? "staff" : "owner"}-${width}.png`), fullPage: true });
      }
      const axe = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa"]).analyze();
      assert.deepEqual(axe.violations.filter((issue) => ["critical", "serious"].includes(issue.impact)).map((issue) => issue.id), []);
      await submit.click();
      await page.getByRole("heading", { name: "Ingreso de mercadería registrado", exact: true }).waitFor();
      await saved(product, staff ? 4 : 2.5, staff ? 1234.56 : 10500.95, staff ? 2345.67 : 15000.50, staff ? 2000 : 13000);
      await saved({ id: newId }, 2, 2500.5, 4500, null);
      const created = await value(owner.from("products").select("sku,barcode,default_supplier_id,is_published").eq("id", newId).single());
      assert.equal(created.sku, newSku);
      assert.equal(created.barcode, newSku);
      assert.equal(created.default_supplier_id, null);
      assert.equal(created.is_published, false);
      assert.equal((await value(owner.from("purchase_orders").select("id"))).length, ordersBefore);
      assert.equal((await value(owner.from("purchase_receipts").select("id"))).length, receiptsBefore);
      assert.equal((await value(owner.from("inventory_movements").select("id").like("notes", `%${reference}`))).length, staff ? 2 : 3);
      await page.getByRole("link", { name: "Ver inventario", exact: true }).click();
      await page.goto(`${baseUrl}/app/productos?q=${encodeURIComponent(newSku)}`);
      await page.getByText(newName, { exact: true }).first().waitFor();
      if (!staff) {
        await page.goto(`${baseUrl}/app/ventas`);
        const picker = page.locator(".sale-product-list");
        await page.getByPlaceholder("Nombre, SKU o código de barras").fill(product.name);
        assert((await picker.innerText()).includes("15.000,50"), "Sales picker reflects the new retail price");
        await page.goto(`${baseUrl}/tienda/productos?buscar=${encodeURIComponent(product.name)}`);
        await page.locator(".store-product-card").first().waitFor();
        assert((await page.locator(".store-product-card").first().innerText()).includes("15.000,50"), "Public retail catalog reflects the new price");
      }
    } finally { await testContext.close(); }
  });

  await runCase("Direct receipt preserves draft on price conflict and safely reloads current prices", async () => {
    const testContext = await browser.newContext({ storageState, serviceWorkers: "block" });
    try {
      const page = await testContext.newPage();
      const product = await fixture();
      const reference = `CONFLICT-${randomUUID().slice(0, 8)}`;
      await page.goto(`${baseUrl}/app/compras/cargar`);
      const form = page.locator(".direct-purchase-form");
      await form.locator('[name="notes"]').fill(reference);
      const line = await add(page, product);
      const received = line.getByRole("textbox", { name: `Cantidad recibida de ${product.name}`, exact: true });
      const retail = line.getByRole("textbox", { name: `Precio minorista ($) de ${product.name}`, exact: true });
      await received.fill("2");
      await retail.fill("16000");
      await value(owner.from("products").update({ retail_price: 15000 }).eq("id", product.id));
      await form.getByRole("button", { name: "Guardar e ingresar stock", exact: true }).click();
      await form.getByRole("alert").waitFor({ timeout: 15_000 });
      assert.equal(await received.inputValue(), "2");
      assert.equal((await value(owner.from("purchase_orders").select("id").eq("reference", reference))).length, 0);
      assert.equal((await value(owner.from("products").select("current_stock").eq("id", product.id).single())).current_stock, 0);
      page.once("dialog", (dialog) => dialog.accept());
      await form.getByRole("button", { name: "Recargar precios actuales", exact: true }).click();
      assert.equal(await received.inputValue(), "2", "Refreshing prices preserves quantities");
      assert.equal(await retail.inputValue(), "15.000");
      await retail.fill("16000");
      await form.getByRole("button", { name: "Guardar e ingresar stock", exact: true }).click();
      await page.getByRole("heading", { name: "Ingreso de mercadería registrado", exact: true }).waitFor();
      await saved(product, 2, 9000, 16000, 12000);
    } finally {
      const page = testContext.pages()[0];
      if (page && await page.locator(".direct-purchase-form").count()) {
        await page.screenshot({ path: path.join(artifacts, "direct-purchase-conflict.png"), fullPage: true });
        await writeFile(path.join(artifacts, "direct-purchase-conflict.json"), JSON.stringify(await page.locator(".direct-purchase-form").evaluate((form) => ({
          text: form.innerText,
          invalid: Array.from(form.elements).filter((element) => element.willValidate && !element.validity.valid).map((element) => ({ name: element.name, value: element.value, message: element.validationMessage })),
          items: form.querySelector('[name="items"]').value,
        })), null, 2));
      }
      await testContext.close();
    }
  });

  await runCase("Concurrent direct-receipt retries increment stock only once", async () => {
    const product = await fixture();
    const requestId = randomUUID();
    const payload = {
      p_organization_id: organizationId, p_request_id: requestId,
      p_notes: `RETRY-${requestId}`, p_items: [{ product_id: product.id, quantity: 6, unit_cost: 9000, retail_price: 14000, wholesale_price: 12000, original_cost_price: 9000, original_retail_price: 14000, original_wholesale_price: 12000 }],
    };
    const newId = randomUUID();
    payload.p_items.push({ ...payload.p_items[0], product_id: newId, new_product: { name: "Nuevo ingreso concurrente", sku: `000-${newId}`, barcode: null, unit: "unidad" } });
    const [first, second] = await Promise.all([value(owner.rpc("load_inventory_entry", payload)), value(owner.rpc("load_inventory_entry", payload))]);
    assert.equal(first, second);
    assert.equal((await value(owner.from("products").select("current_stock").eq("id", product.id).single())).current_stock, 6);
    assert.equal((await value(owner.from("products").select("current_stock").eq("id", newId).single())).current_stock, 6);
    const ledger = await value(owner.from("inventory_movements").select("id").like("notes", `%RETRY-${requestId}`));
    assert.equal(ledger.length, 2);
  });

  await runCase("Existing purchase creation and later receipt still work", async () => {
    const testContext = await browser.newContext({ storageState, serviceWorkers: "block" });
    try {
      const page = await testContext.newPage();
      const product = await fixture();
      const reference = `LEGACY-${randomUUID().slice(0, 8)}`;
      await page.goto(`${baseUrl}/app/compras`);
      await page.getByRole("button", { name: "Crear orden", exact: true }).click();
      const form = page.locator("#crear-orden form");
      await form.locator('select[name="supplier_id"]').selectOption(supplierId);
      await form.getByRole("textbox", { name: "Buscar producto", exact: true }).fill(product.name);
      await form.getByRole("button").filter({ hasText: product.name }).click();
      await form.getByRole("spinbutton", { name: `Cantidad de ${product.name}`, exact: true }).fill("2");
      await form.locator('[name="reference"]').fill(reference);
      await form.getByRole("button", { name: "Guardar orden", exact: true }).click();
      const order = await waitOrder(owner, reference, "draft");
      await page.goto(`${baseUrl}/app/compras?orden=${order.id}`);
      await page.getByRole("button", { name: "Marcar enviada", exact: true }).click();
      await waitOrder(owner, reference, "sent");
      await page.reload();
      await page.getByRole("spinbutton", { name: `Cantidad recibida de ${product.name}`, exact: true }).fill("2");
      await page.getByRole("button", { name: "Confirmar ingreso", exact: true }).click();
      await waitOrder(owner, reference, "received");
      await saved(product, 2, 9000, 14000, 12000);
    } finally { await testContext.close(); }
  });

  await runCase("Concurrent new-product entries reject cross-field duplicate identifiers", async () => {
    const token = randomUUID().slice(0, 8);
    const sku = `NEW-SKU-${token}`;
    const barcode = `NEW-BAR-${token}`;
    const makePayload = (reverse) => ({
      p_organization_id: organizationId, p_request_id: randomUUID(), p_items: [{
        product_id: randomUUID(), quantity: 2, unit_cost: 10, retail_price: 20, wholesale_price: null,
        original_cost_price: 0, original_retail_price: 0, original_wholesale_price: null,
        new_product: { name: `Concurrent new ${token}`, sku: reverse ? barcode : sku, barcode: reverse ? sku : barcode, unit: "unidad" },
      }],
    });
    const results = await Promise.all([owner.rpc("load_inventory_entry", makePayload(false)), owner.rpc("load_inventory_entry", makePayload(true))]);
    assert.equal(results.filter((result) => !result.error).length, 1);
    assert.equal(results.filter((result) => result.error?.code === "23505").length, 1);
    const products = await value(owner.from("products").select("id,current_stock").in("sku", [sku, barcode]));
    assert.equal(products.length, 1);
    assert.equal(Number(products[0].current_stock), 2);
  });
}
