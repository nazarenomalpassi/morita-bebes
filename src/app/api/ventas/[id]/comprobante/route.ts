import { readFile } from "node:fs/promises";
import path from "node:path";

import { getSaleReceipt } from "@/lib/receipts/get-sale-receipt";
import { generateSaleReceiptPdf } from "@/lib/receipts/pdf";
import { receiptFileName } from "@/lib/receipts/sale-receipt";
import { createServerSupabaseClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id)) {
    return Response.json({ error: "Venta inválida." }, { status: 400 });
  }

  const supabase = await createServerSupabaseClient();
  const receipt = await getSaleReceipt(supabase, id);
  if (!receipt) return Response.json({ error: "Comprobante no encontrado." }, { status: 404 });

  const brandDirectory = path.join(process.cwd(), "public", "brand");
  const [logoSvg, regularFont, boldFont, scriptFont] = await Promise.all([
    readFile(path.join(brandDirectory, "morita-logo.svg"), "utf8"),
    readFile(path.join(brandDirectory, "morita-body-regular.ttf")),
    readFile(path.join(brandDirectory, "morita-body-bold.ttf")),
    readFile(path.join(brandDirectory, "morita-script.ttf")),
  ]);
  const pdf = await generateSaleReceiptPdf(receipt, logoSvg, {
    regular: regularFont,
    bold: boldFont,
    script: scriptFont,
  });
  const fileName = receiptFileName(receipt);

  return new Response(new Uint8Array(pdf), {
    headers: {
      "Cache-Control": "private, no-store, max-age=0",
      "Content-Disposition": `attachment; filename="${fileName}"`,
      "Content-Length": String(pdf.length),
      "Content-Type": "application/pdf",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
