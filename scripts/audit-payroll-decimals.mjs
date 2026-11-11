import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";

async function value(request) {
  const { data, error } = await request;
  if (error) throw new Error(error.message);
  return data;
}

/** Financial writes are allowed only in the disposable local audit database. */
export async function auditPayrollDecimals({ page, baseUrl, artifacts, attempt, owner, organizationId, methods }) {
  assert(["localhost", "127.0.0.1"].includes(new URL(baseUrl).hostname));
  const cash = methods.find((method) => method.code === "cash");
  const transfer = methods.find((method) => method.code === "transfer");
  assert(cash && transfer, "Cash and transfer fixtures are required");

  for (const existingSettlement of [false, true]) {
    await attempt(existingSettlement ? "Pending payroll payment accepts decimal cents" : "Monthly payroll settlement accepts comma cents on mobile", async () => {
      const employee = await value(owner.from("employees").insert({
        organization_id: organizationId, first_name: "Decimal", last_name: `Payroll ${randomUUID().slice(0, 8)}`, base_salary: 0,
      }).select().single());
      const period = "2026-10";
      await value(owner.rpc("set_employee_compensation", {
        p_organization_id: organizationId, p_employee_id: employee.id,
        p_base_salary: 717663.95, p_commission_percentage: 0, p_effective_from: `${period}-01`,
      }));
      if (existingSettlement) await value(owner.rpc("settle_employee_payroll", {
        p_organization_id: organizationId, p_employee_id: employee.id, p_period_month: `${period}-01`,
      }));
      const before = await value(owner.from("cash_accounts").select("payment_method_id,current_balance").eq("organization_id", organizationId));

      await page.setViewportSize(existingSettlement ? { width: 1366, height: 768 } : { width: 390, height: 844 });
      await page.goto(`${baseUrl}/app/personal?mes=${period}&empleado=${employee.id}${existingSettlement ? "" : `&liquidar=${employee.id}`}`);
      await page.locator("h1:visible").waitFor();
      if (existingSettlement) await page.getByText("Registrar pago", { exact: true }).click();
      const form = page.locator(".payroll-payment-form");
      await form.getByLabel("Pago combinado", { exact: true }).check();
      const cashInput = form.getByRole("textbox", { name: cash.name, exact: true });
      const transferInput = form.getByRole("textbox", { name: transfer.name, exact: true });
      assert.equal(await transferInput.getAttribute("inputmode"), "decimal");
      const cashAmount = existingSettlement ? 300000.05 : 300000;
      const transferAmount = existingSettlement ? 417663.90 : 417663.95;
      await cashInput.fill(String(cashAmount));
      await transferInput.fill("417663");
      await transferInput.press(existingSettlement ? "." : ",");
      assert.equal(await transferInput.inputValue(), "417663.", "Entering the decimal separator must not clear it");
      await transferInput.pressSequentially(existingSettlement ? "90" : "95");
      await cashInput.focus();
      assert.equal(await transferInput.inputValue(), existingSettlement ? "417663.90" : "417663.95");
      const submit = form.getByRole("button", { name: existingSettlement ? "Marcar como pagado" : "Confirmar liquidación y pago", exact: true });
      assert(await submit.isEnabled(), "Exact decimal allocations must enable confirmation");
      const payload = JSON.parse(await form.locator('[name="payments"]').inputValue());
      assert.deepEqual(payload, [
        { payment_method_id: cash.id, amount: cashAmount },
        { payment_method_id: transfer.id, amount: transferAmount },
      ]);

      await transferInput.fill("417663.96");
      assert(await submit.isDisabled(), "Mismatched cents must prevent payment");
      await form.getByRole("button", { name: `Completar restante en ${transfer.name}`, exact: true }).click();
      assert.equal(await transferInput.inputValue(), existingSettlement ? "417663.90" : "417663.95");
      assert(await submit.isEnabled());
      await page.screenshot({ path: path.join(artifacts, `payroll-decimals-${existingSettlement ? "pending-desktop" : "settlement-mobile"}.png`), fullPage: true });
      assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), "Payroll fields must not overflow the viewport");

      if (!existingSettlement) page.once("dialog", (dialog) => dialog.accept());
      await submit.click();
      let settlement;
      for (let i = 0; i < 40; i++) {
        settlement = await value(owner.from("payroll_settlements").select("id,status,net_salary").eq("employee_id", employee.id).is("voided_at", null).maybeSingle());
        if (settlement?.status === "paid") break;
        await delay(250);
      }
      assert.equal(settlement?.status, "paid", "Payroll confirmation must persist a paid settlement");
      assert.equal(Number(settlement.net_salary), 717663.95);
      const payments = await value(owner.from("payroll_settlement_payments").select("payment_method_id,amount").eq("settlement_id", settlement.id));
      assert.equal(payments.length, 2);
      assert.equal(Number(payments.find((payment) => payment.payment_method_id === cash.id)?.amount), cashAmount);
      assert.equal(Number(payments.find((payment) => payment.payment_method_id === transfer.id)?.amount), transferAmount);
      const movements = await value(owner.from("cash_movements").select("signed_amount").eq("reference_type", "payroll_settlement").eq("reference_id", settlement.id));
      assert.equal(movements.length, 2);
      assert.equal(movements.reduce((sum, movement) => sum + Math.round(Number(movement.signed_amount) * 100), 0), -71766395);
      const after = await value(owner.from("cash_accounts").select("payment_method_id,current_balance").eq("organization_id", organizationId));
      for (const [method, amount] of [[cash, cashAmount], [transfer, transferAmount]]) {
        const previous = Number(before.find((account) => account.payment_method_id === method.id).current_balance);
        const current = Number(after.find((account) => account.payment_method_id === method.id).current_balance);
        assert.equal(Math.round(previous * 100) - Math.round(current * 100), Math.round(amount * 100));
      }
      await page.reload();
      await page.locator("h1:visible").waitFor();
      const persisted = await value(owner.from("payroll_settlement_payments").select("id").eq("settlement_id", settlement.id));
      assert.equal(persisted.length, 2, "Reload must not duplicate payments");
    });
  }
}
