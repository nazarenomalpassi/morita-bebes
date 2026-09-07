import { Buffer } from "node:buffer";

import { revalidatePath } from "next/cache";

import { getCurrentOrganization } from "@/lib/data/current-organization";
import { commitInventoryImport } from "@/lib/import/commit-inventory";
import {
  analyzeInventoryWorkbook,
  inventoryAnalysisPreview,
  InventoryWorkbookError,
} from "@/lib/import/inventory";
import {
  INVENTORY_IMPORT_MAX_BYTES,
  type InventoryApiResponse,
} from "@/lib/import/types";
import { createServerSupabaseClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

function json(body: InventoryApiResponse, status = 200) {
  return Response.json(body, {
    status,
    headers: { "Cache-Control": "no-store" },
  });
}

function safeFilename(value: string) {
  return value.replace(/[\u0000-\u001f\u007f]/g, "").trim().slice(0, 255);
}

export async function POST(request: Request) {
  const origin = request.headers.get("origin");
  if (origin && origin !== new URL(request.url).origin) {
    return json({ error: "La solicitud no pertenece a este sitio." }, 403);
  }

  const declaredLength = Number(request.headers.get("content-length") ?? 0);
  if (declaredLength > INVENTORY_IMPORT_MAX_BYTES + 256 * 1024) {
    return json({ error: "El archivo supera el límite de 2 MB." }, 413);
  }

  const supabase = await createServerSupabaseClient();
  const organization = await getCurrentOrganization(supabase);
  if (!organization) return json({ error: "No hay una sesión activa." }, 401);

  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return json({ error: "No se pudo leer el archivo enviado." }, 400);
  }

  const mode = formData.get("mode");
  const file = formData.get("file");
  if (mode !== "analyze" && mode !== "commit") {
    return json({ error: "La operación solicitada no es válida." }, 400);
  }
  if (!(file instanceof File) || file.size === 0) {
    return json({ error: "Seleccioná un archivo de inventario." }, 400);
  }
  if (file.size > INVENTORY_IMPORT_MAX_BYTES) {
    return json({ error: "El archivo supera el límite de 2 MB." }, 413);
  }
  if (!file.name.toLowerCase().endsWith(".xlsx")) {
    return json({ error: "El archivo debe estar en formato .xlsx." }, 400);
  }

  const filename = safeFilename(file.name);
  if (!filename) return json({ error: "El archivo no tiene un nombre válido." }, 400);

  try {
    const buffer = Buffer.from(await file.arrayBuffer());
    const analysis = await analyzeInventoryWorkbook(buffer, filename);
    if (mode === "analyze") {
      return json({ mode: "analyze", analysis: inventoryAnalysisPreview(analysis) });
    }

    if (organization.role !== "owner" && organization.role !== "admin") {
      return json({ error: "Solo propietarios y administradores pueden importar." }, 403);
    }
    const expectedHash = formData.get("fileHash");
    if (typeof expectedHash !== "string" || expectedHash !== analysis.fileHash) {
      return json({ error: "El archivo cambió desde el análisis. Volvé a analizarlo." }, 409);
    }
    const { data } = await supabase.auth.getClaims();
    const userId = data?.claims?.sub;
    if (!userId) return json({ error: "La sesión venció. Volvé a ingresar." }, 401);

    const result = await commitInventoryImport({
      analysis,
      organizationId: organization.id,
      supabase,
      userId,
    });
    revalidatePath("/app");
    revalidatePath("/app/productos");
    revalidatePath("/app/categorias");
    return json({ mode: "commit", result });
  } catch (error) {
    if (error instanceof InventoryWorkbookError) {
      return json({ error: error.message }, 422);
    }
    console.error("Inventory import failed", error);
    return json(
      {
        error: "No se pudo completar la importación. Volvé a intentar o revisá el lote.",
      },
      500,
    );
  }
}
