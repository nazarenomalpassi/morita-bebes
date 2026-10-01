import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { cp, mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";
import { chromium } from "playwright";
import AxeBuilder from "@axe-core/playwright";

const root = process.cwd();
const workspace = path.join(os.tmpdir(), "morita-system-audit");
const artifacts = path.join(workspace, "results");
const cli = path.join(root, "node_modules/supabase/dist/supabase.js");
const project = "morita-system-audit";
const baseUrl = "http://localhost:3101";
const report = { startedAt: new Date().toISOString(), database: [], pages: [], flows: [], failures: [] };
let server;
let browser;
let flowPage;

function run(command, args, options = {}) {
  const result = spawnSync(command, args, { cwd: root, encoding: "utf8", maxBuffer: 20 * 1024 * 1024, ...options });
  if (result.status !== 0) throw new Error(`${command}: ${result.stderr || result.stdout || result.error}`);
  return result.stdout;
}

function supabase(args) {
  return run(process.execPath, [cli, ...args, "--workdir", workspace], { timeout: 600_000 });
}

async function value(result, label) {
  const { data, error } = await result;
  if (error) throw new Error(`${label}: ${error.message}`);
  return data;
}

async function attempt(name, callback, target = report.flows) {
  try {
    await callback();
    target.push({ name, passed: true });
    console.log(`PASS ${name}`);
  } catch (error) {
    if (target === report.flows && flowPage) {
      await flowPage.screenshot({ path: path.join(artifacts, `flow-${name.replaceAll(/[^a-zA-Z0-9]/g, "_")}.png`), fullPage: true });
      await writeFile(path.join(artifacts, `flow-${name.replaceAll(/[^a-zA-Z0-9]/g, "_")}.txt`), await flowPage.locator("main").innerText());
    }
    target.push({ name, passed: false, error: error.message });
    report.failures.push({ name, error: error.message });
    console.log(`FAIL ${name}: ${error.message.slice(0, 400)}`);
  }
}

async function waitForServer() {
  for (let i = 0; i < 120; i++) {
    if (server.exitCode !== null) throw new Error("Local app server stopped.");
    try { if ((await fetch(`${baseUrl}/login`)).ok) return; } catch {}
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  throw new Error("Local app server did not start.");
}

async function login(page, email, password) {
  await page.goto(`${baseUrl}/login`);
  await page.locator('[name="email"]').fill(email);
  await page.locator('[name="password"]').fill(password);
  await page.getByRole("button", { name: "Ingresar", exact: true }).click();
  await page.waitForURL("**/app", { timeout: 30_000 });
}

async function inspect(page, route, role, width, height) {
  const name = `${role} ${width} ${route}`;
  await attempt(name, async () => {
    await page.setViewportSize({ width, height });
    const response = await page.goto(`${baseUrl}${route}`, { waitUntil: "domcontentloaded" });
    assert(response.status() < 400, `HTTP ${response.status()}`);
    await page.locator("main").waitFor();
    await page.locator("h1:visible").first().waitFor();
    assert.equal(await page.getByText("No pudimos cargar esta sección", { exact: true }).count(), 0);
    assert.equal(await page.locator("h1:visible").count(), 1, "One visible page heading is required");
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    if (overflow > 1) {
      const elements = await page.evaluate(() => Array.from(document.querySelectorAll("main *")).map((element) => ({ tag: element.tagName, class: element.className, right: element.getBoundingClientRect().right, width: element.getBoundingClientRect().width })).filter((element) => element.right > window.innerWidth + 1));
      await writeFile(path.join(artifacts, `${role}-${width}-overflow-${route.replaceAll("/", "_")}.json`), JSON.stringify(elements, null, 2));
    }
    await page.screenshot({ path: path.join(artifacts, `${role}-${width}-${route.replaceAll("/", "_") || "root"}.png`), fullPage: true });
    assert(overflow <= 1, `Horizontal overflow: ${overflow}px`);
    if (route === "/app/productos") {
      const nameWidth = await page.locator('.product-price-table tbody tr').first().locator('td[data-label="Producto"] strong').evaluate((element) => element.getBoundingClientRect().width);
      assert(nameWidth >= 120, `Product name has insufficient space: ${nameWidth}px`);
    }
    if (route === "/app/ventas" && width <= 640) {
      const fields = await page.locator(".sale-fields").boundingBox();
      const checkout = await page.locator(".sale-checkout").boundingBox();
      assert(checkout.y >= fields.y + fields.height, "Checkout must not cover sale fields");
    }
    const axe = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa"]).analyze();
    const violations = axe.violations.filter((issue) => issue.impact === "critical" || issue.impact === "serious");
    await writeFile(path.join(artifacts, `${role}-${width}-${route.replaceAll("/", "_") || "root"}.json`), JSON.stringify(axe.violations, null, 2));
    assert.equal(violations.length, 0, violations.map((issue) => `${issue.id}: ${issue.nodes.map((node) => node.target).join(";")}`).join(" | "));
  }, report.pages);
}

async function auditDatabase() {
  if (process.env.AUDIT_SKIP_DB === "1") return;
  const currentSuites = new Set(["verify_backdated_expenses_after_closure.sql", "verify_card_payment_surcharges.sql", "verify_daily_cash_closures.sql", "verify_ecommerce_storefront.sql", "verify_employee_permissions.sql", "verify_expense_combined_payments.sql", "verify_functional_audit.sql", "verify_invoker_security.sql", "verify_manual_sale_surcharge.sql", "verify_personnel_payroll_cash_workflow.sql", "verify_safe_sale_submission_and_cancellation.sql", "verify_staff_product_update.sql"]);
  for (const file of (await readdir(path.join(root, "supabase/tests"))).filter((file) => file.startsWith("verify_") && file.endsWith(".sql") && (currentSuites.has(file) || process.env.AUDIT_INCLUDE_LEGACY === "1")).sort()) {
    await attempt(file, async () => {
      const sql = await readFile(path.join(root, "supabase/tests", file), "utf8");
      assert(/^\s*begin;/i.test(sql) && /rollback;/i.test(sql), "SQL tests must roll back all fixture writes");
      // Only the disposable LOCAL test transaction bypasses single-org bootstrap.
      const fixtures = sql.replace(/^\s*begin;/i, "begin;\nalter table public.organizations disable trigger guard_organization_bootstrap;\ncreate policy local_audit_bootstrap on public.organizations for insert to authenticated with check (created_by = auth.uid());");
      run("docker", ["exec", "-i", `supabase_db_${project}`, "psql", "-U", "postgres", "-d", "postgres", "-v", "ON_ERROR_STOP=1"], { input: fixtures, timeout: 120_000 });
    }, report.database);
  }
}

try {
  await mkdir(path.join(workspace, "supabase"), { recursive: true });
  await mkdir(artifacts, { recursive: true });
  const original = await readFile(path.join(root, "supabase/config.toml"), "utf8");
  const config = original.replace('project_id = "morita-bebes"', `project_id = "${project}"`)
    .replace(/543(\d\d)/g, "554$1");
  await writeFile(path.join(workspace, "supabase/config.toml"), config);
  await cp(path.join(root, "supabase/migrations"), path.join(workspace, "supabase/migrations"), { recursive: true });
  await cp(path.join(root, "supabase/seed.sql"), path.join(workspace, "supabase/seed.sql"));
  console.log("Starting isolated LOCAL Supabase on ports 554xx; production is never written.");
  supabase(["start", "--exclude", "realtime,studio,edge-runtime,logflare,vector,supavisor,postgres-meta,imgproxy"]);
  const settings = JSON.parse(supabase(["status", "--output", "json"]));
  assert(new URL(settings.API_URL).hostname === "127.0.0.1", "Only local Supabase is allowed");

  {
    const admin = createClient(settings.API_URL, settings.SERVICE_ROLE_KEY, { auth: { persistSession: false } });
    const password = `Audit-${randomUUID()}-9a!`;
    const users = {};
    for (const role of ["owner", "staff"]) {
      const email = `${role}@audit.local`;
      const existing = (await value(admin.auth.admin.listUsers(), "list local users")).users.find((user) => user.email === email);
      users[role] = existing
        ? (await value(admin.auth.admin.updateUserById(existing.id, { password }), "reset local fixture password")).user
        : (await value(admin.auth.admin.createUser({ email, password, email_confirm: true, user_metadata: { display_name: `Audit ${role}` } }), "create local fixture user")).user;
    }
    const owner = createClient(settings.API_URL, settings.ANON_KEY, { auth: { persistSession: false } });
    await value(owner.auth.signInWithPassword({ email: users.owner.email, password }), "owner sign-in");
    let organization = (await value(admin.from("organizations").select("*").eq("slug", "morita-bebes"), "local organization"))[0];
    if (!organization) organization = await value(owner.from("organizations").insert({ name: "Morita Bebes", slug: "morita-bebes", created_by: users.owner.id }).select().single(), "bootstrap local organization");
    await value(owner.rpc("add_organization_member_by_email", { p_organization_id: organization.id, p_email: users.staff.email, p_role: "staff" }), "staff membership");
    const methods = await value(owner.from("payment_methods").select("*").eq("organization_id", organization.id).eq("is_active", true), "methods");
    const suppliers = await value(owner.from("suppliers").select().eq("organization_id", organization.id), "suppliers");
    const supplier = suppliers[0] ?? await value(owner.from("suppliers").insert({ organization_id: organization.id, business_name: "Proveedor Auditoria", phone: "3511234567" }).select().single(), "supplier fixture");
    let products = await value(owner.from("products").select().eq("organization_id", organization.id).order("name"), "products");
    if (!products.length) {
      products = await value(owner.from("products").insert([
        { organization_id: organization.id, name: "Panales Auditoria", sku: "07791234567890", barcode: "07791234567890", cost_price: 5000, retail_price: 10000, wholesale_price: 9000, unit: "unidad", default_supplier_id: supplier.id },
        { organization_id: organization.id, name: "Sin stock Auditoria", sku: "AUDIT-ZERO", barcode: "AUDIT-ZERO", cost_price: 1000, retail_price: 2000, unit: "unidad" },
      ]).select(), "product fixture");
      await value(owner.rpc("adjust_inventory", { p_organization_id: organization.id, p_product_id: products[0].id, p_quantity_delta: 50, p_reason: "Local audit fixture" }), "stock fixture");
    }
    if (Number(products[0].current_stock) < 10) {
      await value(owner.rpc("adjust_inventory", { p_organization_id: organization.id, p_product_id: products[0].id, p_quantity_delta: 50 - Number(products[0].current_stock), p_reason: "Refill isolated LOCAL audit fixture" }), "refill local stock fixture");
    }
    await value(owner.from("products").update({ is_published: true }).eq("id", products[0].id), "local published product fixture");
    const tracking = await value(owner.from("cash_tracking_settings").select().eq("organization_id", organization.id), "cash tracking");
    if (!tracking.length) await value(owner.rpc("initialize_cash_tracking", { p_organization_id: organization.id, p_tracking_started_at: new Date().toISOString(), p_balances: methods.map((item) => ({ payment_method_id: item.id, amount: ["cash", "transfer"].includes(item.code) ? 1_000_000 : 0 })) }), "initialize fixture cash");
    const employees = await value(owner.from("employees").select().eq("organization_id", organization.id), "employees");
    const employee = employees[0] ?? await value(owner.from("employees").insert({ organization_id: organization.id, first_name: "Audit", last_name: "Staff", user_id: users.staff.id, base_salary: 0, status: "active" }).select().single(), "employee fixture");
    await value(owner.rpc("set_employee_compensation", { p_organization_id: organization.id, p_employee_id: employee.id, p_base_salary: 700000, p_commission_percentage: 1, p_effective_from: "2026-08-01" }), "compensation fixture");
    await value(owner.from("site_settings").upsert({ organization_id: organization.id, whatsapp: "5493511234567" }, { onConflict: "organization_id" }), "local store contact fixture");
    await auditDatabase();
    if (process.env.AUDIT_DB_ONLY !== "1") {
    const appEnvironment = { ...process.env, NEXT_PUBLIC_SUPABASE_URL: settings.API_URL, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: settings.ANON_KEY, SUPABASE_SECRET_KEY: settings.SERVICE_ROLE_KEY };
    const appMode = process.env.AUDIT_PRODUCTION_BUILD === "1" ? "start" : "dev";
    if (appMode === "start" && process.env.AUDIT_REUSE_BUILD !== "1") {
      console.log("Building the production app against isolated LOCAL test services.");
      run(process.execPath, [path.join(root, "node_modules/next/dist/bin/next"), "build"], { env: appEnvironment, timeout: 600_000 });
      report.productionBuild = { passed: true };
    }
    server = spawn(process.execPath, [path.join(root, "node_modules/next/dist/bin/next"), appMode, "--port", "3101"], {
      cwd: root,
      env: appEnvironment,
      stdio: ["ignore", "pipe", "pipe"], windowsHide: true,
    });
    let serverOutput = "";
    server.stdout.on("data", (data) => { serverOutput += data; });
    server.stderr.on("data", (data) => { serverOutput += data; });
    await waitForServer();
    browser = await chromium.launch({ channel: "chrome", headless: true });
    const context = await browser.newContext({ serviceWorkers: "block", reducedMotion: "reduce" });
    const page = await context.newPage();
    flowPage = page;
    const pageErrors = [];
    page.on("pageerror", (error) => pageErrors.push(error.message));
    await login(page, users.owner.email, password);
    const routes = ["/app", "/app/productos", "/app/productos/nuevo", `/app/productos/${products[0].id}`, `/app/productos/${products[0].id}/editar`, "/app/proveedores", "/app/proveedores/nuevo", `/app/proveedores/${supplier.id}/editar`, "/app/categorias", "/app/ventas", "/app/compras", "/app/clientes", "/app/gastos", "/app/caja", "/app/comisionistas", "/app/personal", "/app/reportes", "/app/pedidos-web", "/app/mayoristas", "/app/tienda", "/app/tienda/productos", "/app/usuarios", "/app/auditoria", "/app/configuracion", "/app/importar"];
    if (process.env.AUDIT_SKIP_PAGES !== "1") {
      for (const [width, height] of [[1366, 768], [390, 844]]) for (const route of routes) await inspect(page, route, "owner", width, height);
      for (const [width, height] of [[375, 812], [430, 932], [768, 1024], [1024, 768], [1920, 1080]]) for (const route of ["/app/productos", "/app/ventas", "/app/gastos", "/app/caja", "/app/personal", "/app/pedidos-web"]) await inspect(page, route, "owner", width, height);
    }
    await page.setViewportSize({ width: 390, height: 844 });
    await attempt("Product quick price edit persisted", async () => {
      await page.goto(`${baseUrl}/app/productos`);
      await page.getByRole("button", { name: "Editar precios", exact: true }).first().click();
      const targetPrice = Number(products[0].retail_price) === 12000 ? 12500 : 12000;
      await page.getByRole("dialog").locator('[name="retail_price"]').fill(String(targetPrice));
      await page.getByRole("button", { name: "Guardar precios", exact: true }).click();
      await page.getByText("Precios actualizados correctamente", { exact: false }).first().waitFor();
      const saved = await value(owner.from("products").select("retail_price").eq("id", products[0].id).single(), "verify price");
      assert.equal(saved.retail_price, targetPrice);
    });
    await attempt("Combined expense via UI persisted and debited once", async () => {
      await page.goto(`${baseUrl}/app/gastos`);
      await page.getByText("Nuevo gasto", { exact: true }).click();
      const form = page.locator("form").filter({ has: page.locator('[name="description"]') }).first();
      const description = `Audit combined UI expense ${randomUUID()}`;
      await form.locator('[name="description"]').fill(description);
      await form.locator('[name="amount"]').fill("10000");
      await form.getByLabel("Pago combinado", { exact: true }).check();
      await form.getByLabel("Efectivo", { exact: true }).fill("4000");
      await form.getByLabel("Transferencia", { exact: true }).fill("6000");
      await form.getByRole("button", { name: "Guardar gasto", exact: true }).click();
      await page.locator('.form-success:visible').filter({ hasText: "Gasto registrado" }).first().waitFor();
      const saved = await value(owner.from("expenses").select().eq("description", description).single(), "verify expense");
      assert.equal(saved.payment_allocations.length, 2);
      const movements = await value(owner.from("cash_movements").select("signed_amount").eq("reference_id", saved.id), "verify expense ledger");
      assert.equal(movements.reduce((total, item) => total + item.signed_amount, 0), -10000);
      await page.locator(".data-table tbody").getByText(description, { exact: true }).waitFor();
      const row = page.locator(".data-table tbody tr").filter({ hasText: description });
      await row.locator('summary[title="Corregir gasto"]').click();
      const edit = row.locator(".row-editor-panel form");
      await edit.locator('[name="amount"]').fill("12000");
      await edit.getByLabel("Transferencia", { exact: true }).fill("8000");
      await edit.getByRole("button", { name: "Guardar gasto", exact: true }).click();
      await row.locator('td[data-label="Importe"] strong').filter({ hasText: "12.000" }).waitFor();
      const corrected = await value(owner.from("cash_movements").select("signed_amount").eq("reference_id", saved.id), "verify corrected expense ledger");
      assert.equal(corrected.reduce((sum, item) => sum + item.signed_amount, 0), -12000);
      await row.locator('summary[title="Anular gasto"]').click();
      await row.locator('[name="reason"]').fill("Local audit reversal");
      await row.getByRole("button", { name: "Anular gasto", exact: true }).click();
      await row.getByText("Anulado", { exact: true }).waitFor();
      const reversed = await value(owner.from("cash_movements").select("signed_amount").eq("reference_id", saved.id), "verify cancelled expense ledger");
      assert.equal(reversed.reduce((sum, item) => sum + item.signed_amount, 0), 0);
    });
    await attempt("Mobile drawer keyboard and focus", async () => {
      await page.setViewportSize({ width: 390, height: 844 });
      await page.goto(`${baseUrl}/app`);
      await page.locator("h1:visible").first().waitFor();
      await page.evaluate(() => window.scrollTo(0, 0));
      const button = page.getByRole("button", { name: "Abrir menú", exact: true });
      await button.click();
      assert(await page.locator("#management-drawer").evaluate((drawer) => drawer.contains(document.activeElement)), "Focus must enter drawer");
      await page.keyboard.press("Escape");
      assert.equal(await button.getAttribute("aria-expanded"), "false");
      assert(await button.evaluate((element) => element === document.activeElement), "Focus must return to menu button");
    });
    await attempt("Customer validation preserves input and allows retry", async () => {
      await page.goto(`${baseUrl}/app/clientes`);
      await page.getByText("Nuevo cliente", { exact: true }).click();
      const form = page.locator(".details-panel form").first();
      await form.locator('[name="name"]').fill("A");
      await form.locator('[name="phone"]').fill("3511234567");
      await form.getByRole("button", { name: "Guardar cliente" }).click();
      await form.getByText("Revisá el nombre, correo y datos de contacto.").waitFor();
      assert.equal(await form.locator('[name="phone"]').inputValue(), "3511234567");
      const name = `Cliente Auditoria ${randomUUID().slice(0, 8)}`;
      await form.locator('[name="name"]').fill(name);
      await form.getByRole("button", { name: "Guardar cliente" }).click();
      await page.getByText("Cliente creado.", { exact: true }).first().waitFor();
      assert((await value(owner.from("customers").select("id").eq("name", name), "customer saved")).length === 1);
      await page.locator(".entity-row").getByText(name, { exact: true }).waitFor();
    });
    await attempt("Commission agent creation and route search", async () => {
      await page.goto(`${baseUrl}/app/comisionistas`);
      await page.getByText("Nuevo comisionista", { exact: true }).click();
      const form = page.locator(".details-panel form").first();
      await form.locator('[name="first_name"]').fill("Juan");
      await form.locator('[name="last_name"]').fill(`Auditoria ${randomUUID().slice(0, 6)}`);
      await form.locator('[name="phone"]').fill("3511234567");
      await form.locator('[name="route_description"]').fill("Cordoba - Rio Tercero");
      await form.getByRole("button", { name: "Guardar comisionista" }).click();
      await page.getByText("Comisionista agregado.", { exact: true }).first().waitFor();
      await page.goto(`${baseUrl}/app/comisionistas?q=Cordoba`);
      await page.locator(".commission-agent-card p span").filter({ hasText: "Cordoba - Rio Tercero" }).first().waitFor();
    });
    await attempt("Refresh recovery preserves new unsaved input", async () => {
      await page.goto(`${baseUrl}/app/clientes`);
      await page.getByText("Nuevo cliente", { exact: true }).click();
      await page.evaluate(() => {
        const main = document.querySelector(".management-main");
        const original = main.dataset.renderVersion;
        window.__auditRecoveryMarker = "unchanged";
        window.__auditVersionObserver = new MutationObserver(() => {
          if (main.dataset.renderVersion !== original) main.dataset.renderVersion = original;
        });
        window.__auditVersionObserver.observe(main, { attributes: true, attributeFilter: ["data-render-version"] });
      });
      const form = page.locator(".details-panel form").first();
      await form.locator('[name="name"]').fill(`Recovery Audit ${randomUUID().slice(0, 8)}`);
      await form.getByRole("button", { name: "Guardar cliente", exact: true }).click();
      await form.getByText("Cliente creado.", { exact: true }).waitFor();
      await form.locator('[name="phone"]').fill("3519999999");
      await page.waitForTimeout(3000);
      assert.equal(await form.locator('[name="phone"]').inputValue(), "3519999999");
      assert.equal(await page.evaluate(() => window.__auditRecoveryMarker), "unchanged", "Recovery must not discard newly entered data");
      await page.evaluate(() => window.__auditVersionObserver.disconnect());
    });
    await attempt("Scanner stock zero, repeated scans and 100% discount sale", async () => {
      await page.goto(`${baseUrl}/app/ventas`);
      assert.equal(await page.locator(".sale-product-list").getByText("Sin stock Auditoria", { exact: true }).count(), 0);
      const scanner = page.getByPlaceholder("Código", { exact: true });
      await scanner.fill("AUDIT-ZERO"); await scanner.press("Enter");
      await page.getByText("Producto sin stock", { exact: false }).first().waitFor();
      const before = await value(owner.from("products").select("current_stock").eq("id", products[0].id).single(), "before zero sale");
      await scanner.fill(products[0].barcode); await scanner.press("Enter");
      await page.waitForTimeout(500);
      await scanner.fill(products[0].barcode); await scanner.press("Enter");
      assert.equal(await page.getByLabel("Cantidad", { exact: true }).inputValue(), "2");
      await page.locator('[name="discount"]').fill("100");
      await page.locator('[name="notes"]').fill("Local audit 100% sale");
      await page.getByRole("button", { name: "Registrar retiro sin cobro", exact: true }).click();
      await page.getByRole("dialog").getByRole("button", { name: "Confirmar venta", exact: true }).click();
      await page.locator(".sale-receipt-success-link").waitFor();
      const after = await value(owner.from("products").select("current_stock").eq("id", products[0].id).single(), "after zero sale");
      assert.equal(after.current_stock, before.current_stock - 2);
      const sale = await value(owner.from("sales").select("id,total").eq("notes", "Local audit 100% sale").order("created_at", { ascending: false }).limit(1).single(), "zero sale");
      assert.equal(sale.total, 0);
      assert.equal((await value(owner.from("cash_movements").select("id").eq("reference_id", sale.id), "zero financial impact")).length, 0);
      await page.locator(".sale-receipt-success-link").click();
      await page.locator(".receipt-preview-canvas").waitFor();
      const pdf = await page.request.get(`${baseUrl}/api/ventas/${sale.id}/comprobante`);
      assert.equal(pdf.status(), 200);
      assert((await pdf.body()).subarray(0, 4).toString() === "%PDF");
    });
    await attempt("Invalid URL filters do not crash financial pages", async () => {
      for (const route of ["/app/caja?desde=2026-99-99&hasta=2026-99-99&tipo=constructor", "/app/mayoristas?buscar=(),.%25&estado=invalid"]) {
        await page.goto(`${baseUrl}${route}`);
        assert.equal(await page.getByText("No pudimos cargar esta sección", { exact: true }).count(), 0);
        assert.equal(await page.getByText("No pudimos cargar la caja", { exact: true }).count(), 0);
      }
    });
    await attempt("Hide balances synchronizes globally and survives reload", async () => {
      await page.goto(`${baseUrl}/app/caja`);
      await page.locator('.cash-header-actions').getByRole("button", { name: "Ocultar saldos", exact: true }).click();
      assert.equal(await page.locator(".sensitive-amount:not(.is-hidden)").count(), 0);
      await page.reload();
      await page.locator(".sensitive-amount.is-hidden:visible").first().waitFor();
      await page.locator('.cash-header-actions').getByRole("button", { name: "Mostrar saldos", exact: true }).click();
      assert.equal(await page.locator(".sensitive-amount.is-hidden").count(), 0);
    });
    const staffContext = await browser.newContext({ serviceWorkers: "block", reducedMotion: "reduce" });
    const staffPage = await staffContext.newPage();
    await login(staffPage, users.staff.email, password);
    if (process.env.AUDIT_SKIP_PAGES !== "1") for (const route of ["/app", "/app/productos", `/app/productos/${products[0].id}/editar`, "/app/proveedores", "/app/categorias", "/app/ventas", "/app/compras", "/app/clientes", "/app/gastos", "/app/caja", "/app/comisionistas", "/app/mi-sueldo", "/app/usuarios", "/app/reportes"]) await inspect(staffPage, route, "staff", 390, 844);
    const publicContext = await browser.newContext({ serviceWorkers: "block", reducedMotion: "reduce" });
    const publicPage = await publicContext.newPage();
    if (process.env.AUDIT_SKIP_PAGES !== "1") for (const [width, height] of [[1366, 768], [390, 844], [375, 812], [768, 1024]]) for (const route of ["/login", "/recuperar", "/actualizar-clave", "/tienda", "/tienda/productos", "/tienda/carrito", "/tienda/ingresar", "/tienda/registro", "/tienda/mayoristas", "/tienda/recuperar", "/sin-conexion"]) await inspect(publicPage, route, "public", width, height);
    await attempt("Store cart to web order to paid management sale", async () => {
      const email = `buyer-${randomUUID().slice(0, 8)}@audit.local`;
      await value(admin.auth.admin.createUser({ email, password, email_confirm: true, user_metadata: {
        store_registration: true, organization_slug: "morita-bebes", first_name: "Buyer", last_name: "Audit", phone: "3511234567", locality: "Cordoba", province: "Cordoba", customer_type: "retail",
      } }), "create local buyer");
      const buyerContext = await browser.newContext({ serviceWorkers: "block", reducedMotion: "reduce", viewport: { width: 390, height: 844 } });
      const buyer = await buyerContext.newPage();
      await buyerContext.route("https://wa.me/**", (route) => route.fulfill({ status: 200, contentType: "text/html", body: "<h1>WhatsApp intercepted for local testing</h1>" }));
      await buyer.goto(`${baseUrl}/tienda/ingresar?next=/tienda/productos`);
      await buyer.locator('[name="email"]').fill(email);
      await buyer.locator('[name="password"]').fill(password);
      await buyer.getByRole("button", { name: "Ingresar", exact: true }).click();
      await buyer.waitForURL("**/tienda/productos");
      const add = buyer.getByRole("button", { name: "Agregar Panales Auditoria al carrito", exact: true });
      await add.click(); await add.click();
      const before = await value(owner.from("products").select("current_stock").eq("id", products[0].id).single(), "stock before web order");
      await buyer.goto(`${baseUrl}/tienda/carrito`);
      const note = `Local UI web order ${randomUUID()}`;
      await buyer.locator('[name="notes"]').fill(note);
      await buyer.getByRole("button", { name: "Generar pedido por WhatsApp" }).click();
      await buyer.waitForURL("https://wa.me/**");
      const order = await value(owner.from("web_orders").select("id,order_number,sale_id,total").eq("notes", note).single(), "web order saved");
      assert.equal(order.sale_id, null);
      assert.equal((await value(owner.from("products").select("current_stock").eq("id", products[0].id).single(), "unconfirmed stock")).current_stock, before.current_stock);
      await page.goto(`${baseUrl}/app/pedidos-web?estado=all`);
      const card = page.locator(".web-order-admin-card").filter({ hasText: order.order_number });
      await card.locator("summary").click();
      await card.getByRole("button", { name: "Confirmar venta y cobrar" }).click();
      await page.getByRole("dialog").locator('[name="payment_method_id"]').selectOption(methods.find((item) => item.code === "transfer").id);
      await page.getByRole("dialog").getByRole("button", { name: "Confirmar venta", exact: true }).click();
      await card.getByText("Venta confirmada", { exact: true }).waitFor();
      const saved = await value(owner.from("web_orders").select("sale_id").eq("id", order.id).single(), "confirmed order");
      assert(saved.sale_id);
      assert.equal((await value(owner.from("products").select("current_stock").eq("id", products[0].id).single(), "confirmed stock")).current_stock, before.current_stock - 2);
      const money = await value(owner.from("cash_movements").select("signed_amount").eq("reference_id", saved.sale_id), "confirmed financial entry");
      assert.equal(money.reduce((sum, row) => sum + row.signed_amount, 0), order.total);
      for (const [action, status, label] of [["Pasar a preparación", "preparing", "Preparando"], ["Marcar listo", "ready", "Listo"], ["Marcar entregado", "completed", "Entregado"]]) {
        await card.getByRole("button", { name: action, exact: true }).click();
        await card.locator(".web-order-admin-status").getByText(label, { exact: true }).waitFor();
        assert.equal((await value(owner.from("web_orders").select("status").eq("id", order.id).single(), "order workflow state")).status, status);
      }
      await buyerContext.close();
    });
    await attempt("PWA manifest, first install and offline feedback", async () => {
      const pwaContext = await browser.newContext({ serviceWorkers: "allow", viewport: { width: 390, height: 844 } });
      const pwaPage = await pwaContext.newPage();
      const navigations = [];
      pwaPage.on("framenavigated", (frame) => { if (frame === pwaPage.mainFrame() && frame.url().startsWith(baseUrl)) navigations.push(frame.url()); });
      await pwaPage.goto(`${baseUrl}/login`, { waitUntil: "domcontentloaded" });
      await pwaPage.locator('[name="email"]').fill("unfinished@example.com");
      await pwaPage.evaluate(() => { window.__auditFormMarker = "unfinished"; });
      await pwaPage.evaluate(async () => { await navigator.serviceWorker.ready; });
      await pwaPage.waitForTimeout(1000);
      assert.equal(await pwaPage.evaluate(() => window.__auditFormMarker), "unfinished", `First service worker installation must not reload a form: ${navigations.join(", ")}`);
      assert.equal(await pwaPage.locator('[name="email"]').inputValue(), "unfinished@example.com");
      const manifest = await (await pwaPage.request.get(`${baseUrl}/manifest.webmanifest`)).json();
      assert.equal(manifest.display, "standalone");
      assert(manifest.icons.some((icon) => icon.sizes === "512x512"));
      await pwaContext.setOffline(true);
      await pwaPage.getByText("Sin conexión a Internet", { exact: true }).waitFor();
      await pwaContext.setOffline(false);
      await pwaContext.close();
    });
    await attempt("No uncaught browser exceptions", () => assert.deepEqual(pageErrors, []));
    await writeFile(path.join(artifacts, "server.log"), serverOutput);
    }
  }
} catch (error) {
  report.failures.push({ name: "audit setup", error: error.message });
  console.error(error.message.slice(0, 4000));
} finally {
  if (browser) await browser.close();
  if (server) {
    try {
      if (process.platform === "win32") run("taskkill", ["/PID", String(server.pid), "/T", "/F"]);
      else server.kill("SIGTERM");
    } catch (error) { console.error(error.message.slice(0, 400)); }
  }
  if (process.env.AUDIT_KEEP_DB !== "1") {
    try { supabase(["stop"]); } catch (error) { console.error(error.message.slice(0, 400)); }
  }
  report.finishedAt = new Date().toISOString();
  await writeFile(path.join(artifacts, "audit.json"), JSON.stringify(report, null, 2));
  console.log(`Audit: ${report.database.length} database suites, ${report.pages.length} page checks, ${report.flows.length} flows; ${report.failures.length} failures. Artifacts: ${artifacts}`);
  process.exitCode = report.failures.length ? 1 : 0;
}
