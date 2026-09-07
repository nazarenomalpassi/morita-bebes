import "server-only";

import { createHash } from "node:crypto";

import ExcelJS from "exceljs";

import {
  isScientificNotationIdentifier,
  isValidGtin,
  normalizeProductIdentifier,
} from "../product-identifiers";

import type {
  InventoryAnalysisPreview,
  InventoryImportIssue,
  InventoryWorkbookAnalysis,
  ParsedInventoryProduct,
  RawInventoryRow,
} from "./types";

const EXPECTED_HEADERS = [
  "CODIGO",
  "DETALLE",
  "FAMILIA",
  "PROVEEDOR",
  "MARCA",
  "P.COSTO",
  "P.VENTA",
  "IVA",
  "P.LISTA2",
  "P.LISTA3",
  "P.MAYOR",
  "STOCK",
  "STOCK MIN",
  "STOCK IDEAL",
] as const;
const MAX_SOURCE_ROWS = 5_000;

const CATEGORY_NAMES = new Map([
  ["ARTICULOS", "Artículos"],
  ["PANALES", "Pañales"],
  ["HIGIENE", "Higiene"],
  ["ROPA Y ACCESORIOS", "Ropa y accesorios"],
  ["JUGUETES", "Juguetes"],
  ["TELA", "Tela"],
]);

const BRAND_NAMES = new Map([
  ["A WISH DECO", "A Wish Deco"],
  ["AVENT", "Avent"],
  ["BEBEFANTITOS", "Bebefantitos"],
  ["BIKIT", "Bikit"],
  ["CHICCO", "Chicco"],
  ["DUFFY", "Duffy"],
  ["DURAVIT", "Duravit"],
  ["ESTRELLA", "Estrella"],
  ["HUGGIES", "Huggies"],
  ["LOOPI", "Loopi"],
  ["MARVEL", "Marvel"],
  ["NUK", "NUK"],
  ["WOODY TOYS", "Woody Toys"],
]);

const KNOWN_BRANDS = [...BRAND_NAMES.entries()].sort(
  ([left], [right]) => right.length - left.length,
);

function text(value: unknown) {
  if (value === null || value === undefined) return "";
  return String(value).replace(/\s+/g, " ").trim();
}

function key(value: unknown) {
  return text(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase();
}

function numberValue(value: unknown) {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  const raw = text(value);
  if (!raw) return null;

  const sanitized = raw.replace(/[$\s]/g, "");
  const normalized = sanitized.includes(",")
    ? sanitized.includes(".")
      ? sanitized.replace(/\./g, "").replace(",", ".")
      : sanitized.replace(",", ".")
    : sanitized;
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

function round(value: number, decimals: number) {
  const factor = 10 ** decimals;
  return Math.round((value + Number.EPSILON) * factor) / factor;
}

function cellValue(cell: ExcelJS.Cell): string | number | null {
  const value = cell.value;
  if (value === null || value === undefined) return null;
  if (typeof value === "string" || typeof value === "number") return value;
  if (typeof value === "boolean") return value ? "true" : "false";
  if (value instanceof Date) return value.toISOString();
  if ("richText" in value) return value.richText.map((part) => part.text).join("");
  if ("result" in value) {
    const result = value.result;
    return typeof result === "string" || typeof result === "number"
      ? result
      : result === null || result === undefined
        ? null
        : String(result);
  }
  if ("text" in value) return value.text;
  return cell.text || null;
}

function identifierCellValue(cell: ExcelJS.Cell): string | number | null {
  const value = cell.value;
  if (typeof value !== "number") return cellValue(cell);
  if (!Number.isSafeInteger(value)) return cell.text || String(value);

  const displayed = cell.text.trim();
  if (/^0\d+$/.test(displayed) && Number(displayed) === value) return displayed;
  return String(value);
}

function rawRow(row: ExcelJS.Row): RawInventoryRow {
  return Object.fromEntries(
    EXPECTED_HEADERS.map((header, index) => [
      header,
      header === "CODIGO"
        ? identifierCellValue(row.getCell(index + 1))
        : cellValue(row.getCell(index + 1)),
    ]),
  );
}

function isGhostRow(raw: RawInventoryRow) {
  const identityBlank = ["CODIGO", "DETALLE", "FAMILIA", "PROVEEDOR", "MARCA"].every(
    (header) => !text(raw[header]),
  );
  const numericDefault = [
    "P.COSTO",
    "P.VENTA",
    "P.LISTA2",
    "P.LISTA3",
    "P.MAYOR",
    "STOCK",
    "STOCK MIN",
    "STOCK IDEAL",
  ].every((header) => {
    const value = numberValue(raw[header]);
    return value === null || value === 0;
  });
  return identityBlank && numericDefault;
}

function canonicalCategory(value: unknown) {
  const normalized = key(value);
  if (!normalized) return null;
  return CATEGORY_NAMES.get(normalized) ?? text(value);
}

function canonicalBrand(value: unknown) {
  const normalized = key(value);
  if (!normalized) return null;
  return BRAND_NAMES.get(normalized) ?? text(value);
}

function inferBrand(name: string) {
  const normalizedName = key(name);
  const match = KNOWN_BRANDS.find(([brand]) => {
    const escaped = brand.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return new RegExp(`(^|[^A-Z0-9])${escaped}(?=$|[^A-Z0-9])`).test(normalizedName);
  });
  return match?.[1] ?? null;
}

function issue(
  issues: InventoryImportIssue[],
  product: { name: string | null; raw: RawInventoryRow; row: number; sku: string | null },
  input: Pick<InventoryImportIssue, "code" | "field" | "message" | "severity">,
) {
  issues.push({
    ...input,
    productName: product.name,
    rawData: product.raw,
    rowNumber: product.row,
    sku: product.sku,
  });
}

export class InventoryWorkbookError extends Error {}

export async function analyzeInventoryWorkbook(
  buffer: Buffer,
  filename: string,
): Promise<InventoryWorkbookAnalysis> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(Uint8Array.from(buffer).buffer);

  const worksheet = workbook.worksheets.find((candidate) =>
    EXPECTED_HEADERS.every(
      (header, index) => key(cellValue(candidate.getRow(1).getCell(index + 1))) === header,
    ),
  );
  if (!worksheet) {
    throw new InventoryWorkbookError(
      `No se encontró una hoja con los encabezados esperados: ${EXPECTED_HEADERS.join(", ")}.`,
    );
  }

  const sourceRows = Math.max(worksheet.rowCount - 1, 0);
  if (sourceRows > MAX_SOURCE_ROWS) {
    throw new InventoryWorkbookError(
      `El archivo tiene ${sourceRows} filas; el máximo permitido es ${MAX_SOURCE_ROWS}.`,
    );
  }
  const candidates = Array.from({ length: sourceRows }, (_, offset) => {
    const rowNumber = offset + 2;
    return { raw: rawRow(worksheet.getRow(rowNumber)), rowNumber };
  });
  const meaningful = candidates.filter(({ raw }) => !isGhostRow(raw));
  const ghostRows = candidates.length - meaningful.length;

  const codeCounts = new Map<string, number>();
  for (const { raw } of meaningful) {
    const sourceCode = normalizeProductIdentifier(raw.CODIGO);
    if (sourceCode) codeCounts.set(sourceCode, (codeCounts.get(sourceCode) ?? 0) + 1);
  }

  const products: ParsedInventoryProduct[] = [];
  const issues: InventoryImportIssue[] = [];
  const seenSourceCodes = new Set<string>();
  const usedSkus = new Set<string>();
  let brandsExplicit = 0;
  let brandsInferred = 0;
  let generatedSkus = 0;
  let gtinValid = 0;
  let inactiveProducts = 0;
  let missingBrand = 0;
  let missingCategory = 0;
  let missingStock = 0;
  let missingSupplier = 0;
  let negativeStock = 0;
  let positiveStockProducts = 0;
  let positiveStockUnits = 0;
  let zeroCost = 0;
  let zeroRetail = 0;
  const ivaValues: Record<string, number> = {};
  const categories: Record<string, number> = {};

  for (const { raw, rowNumber } of meaningful) {
    const name = text(raw.DETALLE);
    const issueContext = { name: name || null, raw, row: rowNumber, sku: null as string | null };
    if (name.length < 2 || name.length > 180) {
      issue(issues, issueContext, {
        code: "invalid_name",
        field: "DETALLE",
        message: "La fila no se puede importar porque no tiene un nombre de producto válido.",
        severity: "error",
      });
      continue;
    }

    const rawSourceCode = raw.CODIGO === null || raw.CODIGO === undefined
      ? ""
      : String(raw.CODIGO);
    const normalizedSourceCode = normalizeProductIdentifier(rawSourceCode);
    const scientificCode = isScientificNotationIdentifier(normalizedSourceCode);
    const sourceCode = normalizedSourceCode && !scientificCode ? normalizedSourceCode : null;
    const duplicatedCode = sourceCode ? seenSourceCodes.has(sourceCode) : false;
    if (sourceCode) seenSourceCodes.add(sourceCode);
    let sku = sourceCode ?? "";
    const mustGenerateSku = !sku || sku === "CODIGO" || duplicatedCode || sku.length > 80;
    if (mustGenerateSku) {
      sku = `LEG-R${rowNumber}`;
      generatedSkus += 1;
    }
    if (usedSkus.has(sku)) {
      sku = `LEG-R${rowNumber}`;
      generatedSkus += mustGenerateSku ? 0 : 1;
    }
    usedSkus.add(sku);
    issueContext.sku = sku;

    if (scientificCode) {
      issue(issues, issueContext, {
        code: "scientific_notation_code",
        field: "CODIGO",
        message: "El código está en notación científica y no se importó porque no puede reconstruirse con seguridad.",
        severity: "error",
      });
    } else if (!sourceCode) {
      issue(issues, issueContext, {
        code: "generated_sku_missing_code",
        field: "CODIGO",
        message: `No había código; se generó el SKU ${sku}.`,
        severity: "warning",
      });
    } else if (sourceCode === "CODIGO") {
      issue(issues, issueContext, {
        code: "generated_sku_literal_code",
        field: "CODIGO",
        message: `El valor “CODIGO” no es utilizable; se generó el SKU ${sku}.`,
        severity: "warning",
      });
    } else if (duplicatedCode) {
      issue(issues, issueContext, {
        code: "generated_sku_duplicate_code",
        field: "CODIGO",
        message: `El código ${sourceCode} está repetido; se generó el SKU ${sku}.`,
        severity: "warning",
      });
    } else if (sourceCode.startsWith("-") || sourceCode.endsWith("-")) {
      issue(issues, issueContext, {
        code: "suspicious_code_format",
        field: "CODIGO",
        message: `El código ${sourceCode} tiene un formato inusual y conviene revisarlo.`,
        severity: "warning",
      });
    } else if (sourceCode.length > 80) {
      issue(issues, issueContext, {
        code: "generated_sku_long_code",
        field: "CODIGO",
        message: `El código supera 80 caracteres; se generó el SKU ${sku}.`,
        severity: "warning",
      });
    }

    if (rawSourceCode && rawSourceCode !== normalizedSourceCode) {
      issue(issues, issueContext, {
        code: "normalized_code_characters",
        field: "CODIGO",
        message: `Se eliminaron espacios o caracteres invisibles del código; se guardará ${normalizedSourceCode}.`,
        severity: "warning",
      });
    }

    if (sourceCode && /^\d+$/.test(sourceCode) && [8, 13].includes(sourceCode.length) && !isValidGtin(sourceCode)) {
      issue(issues, issueContext, {
        code: "invalid_ean_check_digit",
        field: "CODIGO",
        message: `El código ${sourceCode} tiene longitud EAN, pero el dígito verificador no coincide.`,
        severity: "warning",
      });
    }

    const barcode = sourceCode && !duplicatedCode && sourceCode.length <= 80 ? sourceCode : null;
    if (sourceCode && isValidGtin(sourceCode)) gtinValid += 1;

    const categoryName = canonicalCategory(raw.FAMILIA);
    if (categoryName) categories[categoryName] = (categories[categoryName] ?? 0) + 1;
    else {
      missingCategory += 1;
      issue(issues, issueContext, {
        code: "missing_category",
        field: "FAMILIA",
        message: "La categoría quedó pendiente de completar.",
        severity: "warning",
      });
    }

    let brandName = canonicalBrand(raw.MARCA);
    let inferredBrand = false;
    if (brandName) brandsExplicit += 1;
    else {
      brandName = inferBrand(name);
      inferredBrand = Boolean(brandName);
      if (inferredBrand) brandsInferred += 1;
      else {
        missingBrand += 1;
        issue(issues, issueContext, {
          code: "missing_brand",
          field: "MARCA",
          message: "La marca quedó pendiente de completar.",
          severity: "warning",
        });
      }
    }

    const supplier = key(raw.PROVEEDOR);
    missingSupplier += 1;
    issue(issues, issueContext, {
      code: supplier && supplier !== "PROVEEDOR" ? "supplier_not_imported" : "missing_supplier",
      field: "PROVEEDOR",
      message:
        supplier && supplier !== "PROVEEDOR"
          ? "El proveedor legado no se vinculó automáticamente y quedó pendiente de revisión."
          : "El proveedor quedó pendiente de completar.",
      severity: "warning",
    });

    const rawCost = numberValue(raw["P.COSTO"]);
    const rawRetail = numberValue(raw["P.VENTA"]);
    const costPrice = round(Math.max(rawCost ?? 0, 0), 2);
    const retailPrice = round(Math.max(rawRetail ?? 0, 0), 2);
    if (costPrice === 0) {
      zeroCost += 1;
      issue(issues, issueContext, {
        code: "zero_cost",
        field: "P.COSTO",
        message: "El costo es cero; el producto se importará inactivo.",
        severity: "error",
      });
    }
    if (retailPrice === 0) {
      zeroRetail += 1;
      issue(issues, issueContext, {
        code: "zero_retail_price",
        field: "P.VENTA",
        message: "El precio de venta es cero; el producto se importará inactivo.",
        severity: "error",
      });
    }
    if (costPrice > 0 && retailPrice / costPrice > 3) {
      issue(issues, issueContext, {
        code: "price_ratio_outlier",
        field: "P.VENTA",
        message: `El precio de venta es ${(retailPrice / costPrice).toFixed(1)} veces el costo; requiere revisión.`,
        severity: "warning",
      });
    }

    const rawStock = numberValue(raw.STOCK);
    let openingStock = 0;
    if (rawStock === null) {
      missingStock += 1;
      issue(issues, issueContext, {
        code: "missing_stock",
        field: "STOCK",
        message: "El stock estaba vacío y se normalizó a cero.",
        severity: "error",
      });
    } else if (rawStock < 0) {
      negativeStock += 1;
      issue(issues, issueContext, {
        code: "negative_stock",
        field: "STOCK",
        message: `El stock ${rawStock} no es válido y se normalizó a cero.`,
        severity: "error",
      });
    } else {
      openingStock = round(rawStock, 3);
      if (openingStock > 0) {
        positiveStockProducts += 1;
        positiveStockUnits += openingStock;
      }
    }

    const rawMinimum = numberValue(raw["STOCK MIN"]);
    const minStock = round(Math.max(rawMinimum ?? 0, 0), 3);
    const rawIdeal = numberValue(raw["STOCK IDEAL"]);
    if (rawIdeal === null || rawIdeal <= 0) {
      issue(issues, issueContext, {
        code: "missing_target_stock",
        field: "STOCK IDEAL",
        message: "El stock objetivo quedó pendiente de completar.",
        severity: "warning",
      });
    }

    const iva = numberValue(raw.IVA);
    const ivaLabel = iva === null ? "vacío" : String(iva);
    ivaValues[ivaLabel] = (ivaValues[ivaLabel] ?? 0) + 1;

    const isActive = costPrice > 0 && retailPrice > 0;
    if (!isActive) inactiveProducts += 1;
    products.push({
      barcode,
      brandName,
      categoryName,
      costPrice,
      excelRow: rowNumber,
      inferredBrand,
      isActive,
      minStock,
      name,
      openingStock,
      raw,
      retailPrice,
      sku,
      sourceCode,
    });
  }

  const errorCount = issues.filter((item) => item.severity === "error").length;
  const duplicateCodeRows = [...codeCounts.values()].reduce(
    (count, occurrences) => count + Math.max(occurrences - 1, 0),
    0,
  );

  return {
    fileHash: createHash("sha256").update(buffer).digest("hex"),
    filename,
    headers: [...EXPECTED_HEADERS],
    issues,
    products,
    summary: {
      brandsExplicit,
      brandsInferred,
      categories,
      duplicateCodeRows,
      generatedSkus,
      ghostRows,
      gtinValid,
      inactiveProducts,
      issueCounts: { errors: errorCount, warnings: issues.length - errorCount },
      ivaValues,
      missingBrand,
      missingCategory,
      missingStock,
      missingSupplier,
      negativeStock,
      positiveStockProducts,
      positiveStockUnits: round(positiveStockUnits, 3),
      productRows: products.length,
      sourceRows,
      unit: { assumed: "unidad", sourceColumnPresent: false },
      zeroCost,
      zeroRetail,
    },
    worksheet: worksheet.name,
  };
}

export function inventoryAnalysisPreview(
  analysis: InventoryWorkbookAnalysis,
): InventoryAnalysisPreview {
  return {
    fileHash: analysis.fileHash,
    filename: analysis.filename,
    headers: analysis.headers,
    issues: analysis.issues,
    productPreview: analysis.products.slice(0, 40).map((product) => ({
      barcode: product.barcode,
      brandName: product.brandName,
      categoryName: product.categoryName,
      costPrice: product.costPrice,
      excelRow: product.excelRow,
      isActive: product.isActive,
      name: product.name,
      openingStock: product.openingStock,
      retailPrice: product.retailPrice,
      sku: product.sku,
    })),
    summary: analysis.summary,
    worksheet: analysis.worksheet,
  };
}
