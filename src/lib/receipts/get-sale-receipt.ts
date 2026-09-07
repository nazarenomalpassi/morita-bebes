import type { SupabaseClient } from "@supabase/supabase-js";

import { parseSaleReceipt } from "@/lib/receipts/sale-receipt";
import type { Database } from "@/types/database";

export async function getSaleReceipt(
  supabase: SupabaseClient<Database>,
  saleId: string,
) {
  const { data, error } = await supabase.rpc("get_sale_receipt", {
    p_sale_id: saleId,
  });

  if (error?.code === "P0002") return null;
  if (error) throw new Error(`No se pudo recuperar el comprobante: ${error.message}`);

  return parseSaleReceipt(data);
}
