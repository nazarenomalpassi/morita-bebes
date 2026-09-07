export const INVENTORY_IMPORT_MAX_BYTES = 2 * 1024 * 1024;

export type ImportIssueSeverity = "warning" | "error";

export type RawInventoryRow = Record<string, string | number | null>;

export type InventoryImportIssue = {
  code: string;
  field: string | null;
  message: string;
  productName: string | null;
  rawData: RawInventoryRow;
  rowNumber: number;
  severity: ImportIssueSeverity;
  sku: string | null;
};

export type ParsedInventoryProduct = {
  barcode: string | null;
  brandName: string | null;
  categoryName: string | null;
  costPrice: number;
  excelRow: number;
  inferredBrand: boolean;
  isActive: boolean;
  minStock: number;
  name: string;
  openingStock: number;
  raw: RawInventoryRow;
  retailPrice: number;
  sku: string;
  sourceCode: string | null;
};

export type InventoryAnalysisSummary = {
  brandsExplicit: number;
  brandsInferred: number;
  categories: Record<string, number>;
  duplicateCodeRows: number;
  generatedSkus: number;
  ghostRows: number;
  gtinValid: number;
  inactiveProducts: number;
  issueCounts: { errors: number; warnings: number };
  ivaValues: Record<string, number>;
  missingBrand: number;
  missingCategory: number;
  missingStock: number;
  missingSupplier: number;
  negativeStock: number;
  positiveStockProducts: number;
  positiveStockUnits: number;
  productRows: number;
  sourceRows: number;
  unit: { assumed: "unidad"; sourceColumnPresent: false };
  zeroCost: number;
  zeroRetail: number;
};

export type InventoryWorkbookAnalysis = {
  fileHash: string;
  filename: string;
  headers: string[];
  issues: InventoryImportIssue[];
  products: ParsedInventoryProduct[];
  summary: InventoryAnalysisSummary;
  worksheet: string;
};

export type InventoryAnalysisPreview = Omit<InventoryWorkbookAnalysis, "products"> & {
  productPreview: Array<
    Pick<
      ParsedInventoryProduct,
      | "barcode"
      | "brandName"
      | "categoryName"
      | "costPrice"
      | "excelRow"
      | "isActive"
      | "name"
      | "openingStock"
      | "retailPrice"
      | "sku"
    >
  >;
};

export type InventoryImportFailure = {
  message: string;
  rowNumber: number;
  sku: string;
  stage: "product" | "stock";
};

export type InventoryCommitResult = {
  alreadyImported: boolean;
  batchId: string;
  batchStatus:
    | "processing"
    | "completed"
    | "completed_with_issues"
    | "failed";
  brandsCreated: number;
  categoriesCreated: number;
  failedRows: number;
  failures: InventoryImportFailure[];
  fileHash: string;
  importedRows: number;
  issuesPersisted: number;
  productsCreated: number;
  productsUpdated: number;
  stockAdjusted: number;
  stockUnchanged: number;
};

export type InventoryApiResponse =
  | { mode: "analyze"; analysis: InventoryAnalysisPreview }
  | { mode: "commit"; result: InventoryCommitResult }
  | { error: string };
