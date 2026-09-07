import "server-only";

import { createHash } from "node:crypto";

import type { SupabaseClient } from "@supabase/supabase-js";

import type {
  Database,
  Json,
  Tables,
  TablesInsert,
  TablesUpdate,
} from "@/types/database";

import type {
  InventoryCommitResult,
  InventoryImportFailure,
  InventoryImportIssue,
  InventoryWorkbookAnalysis,
  ParsedInventoryProduct,
} from "./types";

type ImportBatch = Tables<"import_batches">;
type ExistingProduct = Pick<
  Tables<"products">,
  | "barcode"
  | "brand_id"
  | "category_id"
  | "current_stock"
  | "id"
  | "is_active"
  | "min_stock"
  | "sku"
  | "target_stock"
  | "unit"
  | "wholesale_price"
>;
type ProductMutation = {
  existed: boolean;
  product: ParsedInventoryProduct;
  row: Pick<Tables<"products">, "current_stock" | "id" | "sku">;
};
type SavedProduct = ProductMutation["row"];

const PRODUCT_CONCURRENCY = 8;
const STOCK_CONCURRENCY = 5;
const ISSUE_CHUNK_SIZE = 200;
const QUERY_CHUNK_SIZE = 100;

function normalizedName(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toUpperCase();
}

function slugify(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 100);
}

function chunks<T>(values: T[], size: number) {
  return Array.from({ length: Math.ceil(values.length / size) }, (_, index) =>
    values.slice(index * size, (index + 1) * size),
  );
}

async function mapLimited<T, Result>(
  values: T[],
  limit: number,
  worker: (value: T, index: number) => Promise<Result>,
) {
  const results = new Array<Result>(values.length);
  let cursor = 0;
  const workers = Array.from({ length: Math.min(limit, values.length) }, async () => {
    while (true) {
      const index = cursor;
      cursor += 1;
      if (index >= values.length) return;
      results[index] = await worker(values[index], index);
    }
  });
  await Promise.all(workers);
  return results;
}

function adjustmentId(organizationId: string, fileHash: string, sku: string) {
  const hex = createHash("sha256")
    .update(`${organizationId}:${fileHash}:${sku}`)
    .digest("hex")
    .slice(0, 32)
    .split("");
  hex[12] = "5";
  hex[16] = ((Number.parseInt(hex[16], 16) & 0x3) | 0x8).toString(16);
  const value = hex.join("");
  return `${value.slice(0, 8)}-${value.slice(8, 12)}-${value.slice(12, 16)}-${value.slice(16, 20)}-${value.slice(20)}`;
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : "Error inesperado durante la importación.";
}

function mutableProductPayload(
  payload: TablesInsert<"products">,
): TablesUpdate<"products"> {
  return {
    barcode: payload.barcode,
    brand_id: payload.brand_id,
    category_id: payload.category_id,
    cost_price: payload.cost_price,
    is_active: payload.is_active,
    min_stock: payload.min_stock,
    name: payload.name,
    retail_price: payload.retail_price,
  };
}

async function ensureCategories(
  supabase: SupabaseClient<Database>,
  organizationId: string,
  names: string[],
) {
  const { data: existing, error } = await supabase
    .from("categories")
    .select("id, name")
    .eq("organization_id", organizationId);
  if (error) throw new Error(`No se pudieron consultar las categorías: ${error.message}`);

  const byName = new Map((existing ?? []).map((row) => [normalizedName(row.name), row.id]));
  let created = 0;
  for (const name of names) {
    const lookup = normalizedName(name);
    if (byName.has(lookup)) continue;
    const { data, error: insertError } = await supabase
      .from("categories")
      .insert({
        name,
        organization_id: organizationId,
        slug: slugify(name),
        sort_order: 500,
      })
      .select("id")
      .single();
    if (insertError) {
      if (insertError.code !== "23505") {
        throw new Error(`No se pudo crear la categoría ${name}: ${insertError.message}`);
      }
      const { data: refreshed, error: refreshError } = await supabase
        .from("categories")
        .select("id, name")
        .eq("organization_id", organizationId);
      if (refreshError) throw new Error(`No se pudo recuperar la categoría ${name}.`);
      const match = refreshed?.find((row) => normalizedName(row.name) === lookup);
      if (!match) throw new Error(`La categoría ${name} colisiona con otro registro.`);
      byName.set(lookup, match.id);
      continue;
    }
    byName.set(lookup, data.id);
    created += 1;
  }
  return { byName, created };
}

async function ensureBrands(
  supabase: SupabaseClient<Database>,
  organizationId: string,
  names: string[],
) {
  const { data: existing, error } = await supabase
    .from("brands")
    .select("id, name")
    .eq("organization_id", organizationId);
  if (error) throw new Error(`No se pudieron consultar las marcas: ${error.message}`);

  const byName = new Map((existing ?? []).map((row) => [normalizedName(row.name), row.id]));
  let created = 0;
  for (const name of names) {
    const lookup = normalizedName(name);
    if (byName.has(lookup)) continue;
    const { data, error: insertError } = await supabase
      .from("brands")
      .insert({ name, organization_id: organizationId })
      .select("id")
      .single();
    if (insertError) {
      if (insertError.code !== "23505") {
        throw new Error(`No se pudo crear la marca ${name}: ${insertError.message}`);
      }
      const { data: refreshed, error: refreshError } = await supabase
        .from("brands")
        .select("id, name")
        .eq("organization_id", organizationId);
      if (refreshError) throw new Error(`No se pudo recuperar la marca ${name}.`);
      const match = refreshed?.find((row) => normalizedName(row.name) === lookup);
      if (!match) throw new Error(`La marca ${name} colisiona con otro registro.`);
      byName.set(lookup, match.id);
      continue;
    }
    byName.set(lookup, data.id);
    created += 1;
  }
  return { byName, created };
}

async function findExistingProducts(
  supabase: SupabaseClient<Database>,
  organizationId: string,
  products: ParsedInventoryProduct[],
) {
  const rows = await mapLimited(chunks(products.map((product) => product.sku), QUERY_CHUNK_SIZE), 4, async (skuChunk) => {
    const { data, error } = await supabase
      .from("products")
      .select("id, sku, barcode, current_stock, min_stock, target_stock, category_id, brand_id, is_active, unit, wholesale_price")
      .eq("organization_id", organizationId)
      .in("sku", skuChunk);
    if (error) throw new Error(`No se pudieron consultar los productos existentes: ${error.message}`);
    return data ?? [];
  });
  return new Map(rows.flat().map((product) => [product.sku, product satisfies ExistingProduct]));
}

async function findIdentifierOwners(
  supabase: SupabaseClient<Database>,
  organizationId: string,
  products: ParsedInventoryProduct[],
) {
  const identifiers = [...new Set(products.flatMap((product) => (product.barcode ? [product.barcode] : [])))];
  const rows = await mapLimited(chunks(identifiers, QUERY_CHUNK_SIZE), 4, async (identifierChunk) => {
    const [barcodeResult, skuResult] = await Promise.all([
      supabase
        .from("products")
        .select("sku, barcode")
        .eq("organization_id", organizationId)
        .in("barcode", identifierChunk),
      supabase
        .from("products")
        .select("sku, barcode")
        .eq("organization_id", organizationId)
        .in("sku", identifierChunk),
    ]);
    if (barcodeResult.error || skuResult.error) {
      throw new Error(`No se pudieron verificar los identificadores: ${barcodeResult.error?.message ?? skuResult.error?.message}`);
    }
    return [...(barcodeResult.data ?? []), ...(skuResult.data ?? [])];
  });
  const owners = new Map<string, Set<string>>();
  for (const row of rows.flat()) {
    for (const identifier of [row.sku, row.barcode]) {
      if (!identifier || !identifiers.includes(identifier)) continue;
      const current = owners.get(identifier) ?? new Set<string>();
      current.add(row.sku);
      owners.set(identifier, current);
    }
  }
  return owners;
}

async function openBatch(
  supabase: SupabaseClient<Database>,
  analysis: InventoryWorkbookAnalysis,
  organizationId: string,
  userId: string,
) {
  const { data, error } = await supabase
    .from("import_batches")
    .insert({
      created_by: userId,
      file_hash: analysis.fileHash,
      filename: analysis.filename.slice(0, 255),
      organization_id: organizationId,
      status: "processing",
      total_rows: analysis.summary.productRows,
    })
    .select("id, organization_id, filename, file_hash, status, total_rows, imported_rows, issue_count, summary, created_by, created_at, completed_at")
    .single();
  if (!error && data) return { batch: data, created: true };
  if (error?.code !== "23505") {
    throw new Error(`No se pudo iniciar el lote de importación: ${error?.message ?? "sin detalle"}`);
  }

  const { data: existing, error: existingError } = await supabase
    .from("import_batches")
    .select("id, organization_id, filename, file_hash, status, total_rows, imported_rows, issue_count, summary, created_by, created_at, completed_at")
    .eq("organization_id", organizationId)
    .eq("file_hash", analysis.fileHash)
    .maybeSingle();
  if (existingError || !existing) {
    throw new Error("El archivo ya figura importado, pero no se pudo recuperar su lote.");
  }
  return { batch: existing, created: false };
}

function storedResult(batch: ImportBatch, fileHash: string): InventoryCommitResult {
  const saved =
    batch.summary && typeof batch.summary === "object" && !Array.isArray(batch.summary)
      ? batch.summary
      : {};
  const numeric = (field: string) => {
    const value = (saved as Record<string, Json | undefined>)[field];
    return typeof value === "number" ? value : 0;
  };
  return {
    alreadyImported: true,
    batchId: batch.id,
    batchStatus: batch.status,
    brandsCreated: numeric("brandsCreated"),
    categoriesCreated: numeric("categoriesCreated"),
    failedRows: numeric("failedRows"),
    failures: [],
    fileHash,
    importedRows: batch.imported_rows,
    issuesPersisted: batch.issue_count,
    productsCreated: numeric("productsCreated"),
    productsUpdated: numeric("productsUpdated"),
    stockAdjusted: numeric("stockAdjusted"),
    stockUnchanged: numeric("stockUnchanged"),
  };
}

function issueInsert(
  issue: InventoryImportIssue,
  batchId: string,
  organizationId: string,
): TablesInsert<"import_issues"> {
  return {
    batch_id: batchId,
    field: issue.field,
    message: issue.message.slice(0, 1000),
    organization_id: organizationId,
    raw_data: { ...issue.rawData, _issue_code: issue.code },
    row_number: issue.rowNumber,
    severity: issue.severity,
    sku: issue.sku,
  };
}

async function persistIssues(
  supabase: SupabaseClient<Database>,
  issues: InventoryImportIssue[],
  batchId: string,
  organizationId: string,
) {
  for (const issueChunk of chunks(issues, ISSUE_CHUNK_SIZE)) {
    const { error } = await supabase
      .from("import_issues")
      .insert(issueChunk.map((item) => issueInsert(item, batchId, organizationId)));
    if (error) throw new Error(`No se pudieron guardar las incidencias: ${error.message}`);
  }
}

function operationalIssue(
  product: ParsedInventoryProduct,
  stage: "product" | "stock",
  message: string,
): InventoryImportIssue {
  return {
    code: `${stage}_import_failure`,
    field: stage === "stock" ? "STOCK" : null,
    message,
    productName: product.name,
    rawData: product.raw,
    rowNumber: product.excelRow,
    severity: "error",
    sku: product.sku,
  };
}

async function finalizeBatch(
  supabase: SupabaseClient<Database>,
  batchId: string,
  importedRows: number,
  summary: Json,
  failed: boolean,
) {
  const { error } = await supabase.rpc("finalize_import_batch", {
    p_batch_id: batchId,
    p_failed: failed,
    p_imported_rows: importedRows,
    p_summary: summary,
  });
  if (error) throw new Error(`No se pudo finalizar el lote: ${error.message}`);
}

export async function commitInventoryImport(input: {
  analysis: InventoryWorkbookAnalysis;
  organizationId: string;
  supabase: SupabaseClient<Database>;
  userId: string;
}): Promise<InventoryCommitResult> {
  const { analysis, organizationId, supabase, userId } = input;
  const opened = await openBatch(supabase, analysis, organizationId, userId);
  const batch = opened.batch;
  if (batch.status !== "processing") return storedResult(batch, analysis.fileHash);

  let importedRows = 0;
  let issuesPersisted = 0;
  try {
    const categoryNames = [...new Set(analysis.products.flatMap((product) => (product.categoryName ? [product.categoryName] : [])))];
    const brandNames = [...new Set(analysis.products.flatMap((product) => (product.brandName ? [product.brandName] : [])))];
    const [categories, brands, existingBySku, identifierOwners] = await Promise.all([
      ensureCategories(supabase, organizationId, categoryNames),
      ensureBrands(supabase, organizationId, brandNames),
      findExistingProducts(supabase, organizationId, analysis.products),
      findIdentifierOwners(supabase, organizationId, analysis.products),
    ]);

    const preflightIssues = [...analysis.issues];
    const payloadBySku = new Map<string, TablesInsert<"products">>();
    for (const product of analysis.products) {
      const existing = existingBySku.get(product.sku);
      const owners = product.barcode ? identifierOwners.get(product.barcode) : null;
      const conflictingOwners = owners
        ? [...owners].filter((ownerSku) => ownerSku !== product.sku)
        : [];
      const barcode = product.barcode ?? existing?.barcode ?? null;
      if (conflictingOwners.length > 0) {
        preflightIssues.push({
          code: "identifier_owned_by_another_product",
          field: "CODIGO",
          message: `El identificador ${product.barcode} ya pertenece al SKU ${conflictingOwners.join(", ")}; la fila no se importó.`,
          productName: product.name,
          rawData: product.raw,
          rowNumber: product.excelRow,
          severity: "error",
          sku: product.sku,
        });
        continue;
      }

      const importedMin = product.minStock > 0 ? product.minStock : Number(existing?.min_stock ?? 0);
      const minStock =
        existing?.target_stock !== null && existing?.target_stock !== undefined
          ? Math.min(importedMin, Number(existing.target_stock))
          : importedMin;
      payloadBySku.set(product.sku, {
        barcode,
        brand_id: product.brandName
          ? brands.byName.get(normalizedName(product.brandName)) ?? null
          : existing?.brand_id ?? null,
        category_id: product.categoryName
          ? categories.byName.get(normalizedName(product.categoryName)) ?? null
          : existing?.category_id ?? null,
        cost_price: product.costPrice,
        is_active: product.isActive ? (existing?.is_active ?? true) : false,
        min_stock: minStock,
        name: product.name,
        organization_id: organizationId,
        retail_price: product.retailPrice,
        sku: product.sku,
        unit: existing?.unit ?? "unidad",
        wholesale_price: existing?.wholesale_price ?? null,
      });
    }

    let shouldPersistPreflight = opened.created;
    if (!opened.created) {
      const { count, error } = await supabase
        .from("import_issues")
        .select("id", { count: "exact", head: true })
        .eq("batch_id", batch.id)
        .eq("organization_id", organizationId);
      if (error) throw new Error(`No se pudieron consultar las incidencias del lote: ${error.message}`);
      issuesPersisted = count ?? 0;
      shouldPersistPreflight = issuesPersisted === 0;
    }
    if (shouldPersistPreflight) {
      await persistIssues(supabase, preflightIssues, batch.id, organizationId);
      issuesPersisted += preflightIssues.length;
    }

    const productAttempts = await mapLimited(
      analysis.products,
      PRODUCT_CONCURRENCY,
      async (product): Promise<{ failure?: InventoryImportFailure; mutation?: ProductMutation; issue?: InventoryImportIssue }> => {
        const payload = payloadBySku.get(product.sku);
        if (!payload) {
          const message = "No se pudo preparar la fila para guardar.";
          return {
            failure: { message, rowNumber: product.excelRow, sku: product.sku, stage: "product" },
            issue: operationalIssue(product, "product", message),
          };
        }
        let existed = existingBySku.has(product.sku);
        let saved: SavedProduct | null = null;
        let saveError: string | null = null;

        if (existed) {
          const result = await supabase
            .from("products")
            .update(mutableProductPayload(payload))
            .eq("organization_id", organizationId)
            .eq("sku", product.sku)
            .select("id, sku, current_stock")
            .single();
          saved = result.data;
          saveError = result.error?.message ?? null;
        } else {
          const insertResult = await supabase
            .from("products")
            .insert(payload)
            .select("id, sku, current_stock")
            .single();

          if (insertResult.error?.code === "23505") {
            const updateResult = await supabase
              .from("products")
              .update(mutableProductPayload(payload))
              .eq("organization_id", organizationId)
              .eq("sku", product.sku)
              .select("id, sku, current_stock")
              .single();
            existed = Boolean(updateResult.data);
            saved = updateResult.data;
            saveError = updateResult.error?.message ?? null;
          } else {
            saved = insertResult.data;
            saveError = insertResult.error?.message ?? null;
          }
        }

        if (!saved) {
          const message = `No se pudo guardar el producto: ${saveError ?? "sin detalle"}`;
          return {
            failure: { message, rowNumber: product.excelRow, sku: product.sku, stage: "product" },
            issue: operationalIssue(product, "product", message),
          };
        }
        return {
          mutation: {
            existed,
            product,
            row: saved,
          },
        };
      },
    );

    const productFailures = productAttempts.flatMap((attempt) => (attempt.failure ? [attempt.failure] : []));
    const productFailureIssues = productAttempts.flatMap((attempt) => (attempt.issue ? [attempt.issue] : []));
    const mutations = productAttempts.flatMap((attempt) => (attempt.mutation ? [attempt.mutation] : []));
    importedRows = mutations.length;
    if (productFailureIssues.length) {
      await persistIssues(supabase, productFailureIssues, batch.id, organizationId);
      issuesPersisted += productFailureIssues.length;
    }

    const stockAttempts = await mapLimited(
      mutations,
      STOCK_CONCURRENCY,
      async (mutation): Promise<{ adjusted: boolean; failure?: InventoryImportFailure; issue?: InventoryImportIssue }> => {
        const currentStock = Number(mutation.row.current_stock);
        const difference = Math.round((mutation.product.openingStock - currentStock) * 1000) / 1000;
        if (Math.abs(difference) < 0.0005) return { adjusted: false };

        const { error } = await supabase.rpc("adjust_inventory", {
          p_adjustment_id: adjustmentId(organizationId, analysis.fileHash, mutation.product.sku),
          p_organization_id: organizationId,
          p_product_id: mutation.row.id,
          p_quantity_delta: difference,
          p_reason: `Importación ${analysis.filename} fila ${mutation.product.excelRow}`,
          p_unit_cost: mutation.product.costPrice,
        });
        if (!error) return { adjusted: true };
        const message = `Producto guardado, pero no se pudo ajustar el stock: ${error.message}`;
        return {
          adjusted: false,
          failure: {
            message,
            rowNumber: mutation.product.excelRow,
            sku: mutation.product.sku,
            stage: "stock",
          },
          issue: operationalIssue(mutation.product, "stock", message),
        };
      },
    );

    const stockFailures = stockAttempts.flatMap((attempt) => (attempt.failure ? [attempt.failure] : []));
    const stockFailureIssues = stockAttempts.flatMap((attempt) => (attempt.issue ? [attempt.issue] : []));
    if (stockFailureIssues.length) {
      await persistIssues(supabase, stockFailureIssues, batch.id, organizationId);
      issuesPersisted += stockFailureIssues.length;
    }

    const failures = [...productFailures, ...stockFailures];
    const result: InventoryCommitResult = {
      alreadyImported: false,
      batchId: batch.id,
      batchStatus: failures.length ? "failed" : issuesPersisted ? "completed_with_issues" : "completed",
      brandsCreated: brands.created,
      categoriesCreated: categories.created,
      failedRows: new Set(failures.map((failure) => failure.rowNumber)).size,
      failures,
      fileHash: analysis.fileHash,
      importedRows,
      issuesPersisted,
      productsCreated: mutations.filter((mutation) => !mutation.existed).length,
      productsUpdated: mutations.filter((mutation) => mutation.existed).length,
      stockAdjusted: stockAttempts.filter((attempt) => attempt.adjusted).length,
      stockUnchanged: stockAttempts.filter((attempt) => !attempt.adjusted && !attempt.failure).length,
    };
    await finalizeBatch(supabase, batch.id, importedRows, result as unknown as Json, failures.length > 0);
    return result;
  } catch (error) {
    const summary: Json = {
      error: errorMessage(error),
      fileHash: analysis.fileHash,
      importedRows,
    };
    try {
      await finalizeBatch(supabase, batch.id, importedRows, summary, true);
    } catch {
      // Preserve the original import failure; the processing batch remains inspectable.
    }
    throw error;
  }
}
