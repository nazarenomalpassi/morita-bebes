"use client";

import {
  AlertTriangle,
  CheckCircle2,
  DatabaseZap,
  FileSpreadsheet,
  LoaderCircle,
  RotateCcw,
  ScanSearch,
  Upload,
  XCircle,
} from "lucide-react";
import Link from "next/link";
import { useMemo, useRef, useState } from "react";

import {
  INVENTORY_IMPORT_MAX_BYTES,
  type InventoryAnalysisPreview,
  type InventoryApiResponse,
  type InventoryCommitResult,
  type InventoryImportIssue,
} from "@/lib/import/types";

type BusyMode = "analyze" | "commit" | null;
type IssueFilter = "all" | "warning" | "error";

const number = new Intl.NumberFormat("es-AR", { maximumFractionDigits: 3 });
function rawValue(issue: InventoryImportIssue) {
  if (!issue.field) return "-";
  const value = issue.rawData[issue.field];
  return value === null || value === undefined || value === "" ? "Vacío" : String(value);
}

function ResultSummary({ result }: { result: InventoryCommitResult }) {
  const successful = result.batchStatus !== "failed";
  return (
    <section className="mt-8 border-y border-[var(--line)] py-6" aria-live="polite">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex items-start gap-3">
          <span className={successful ? "operation-icon operation-icon-mint" : "operation-icon bg-[var(--rose)] text-[var(--danger)]"}>
            {successful ? <CheckCircle2 size={20} /> : <XCircle size={20} />}
          </span>
          <div>
            <h2 className="text-lg font-bold">
              {result.alreadyImported ? "Este archivo ya fue procesado" : successful ? "Importación terminada" : "Importación con fallos"}
            </h2>
            <p className="mt-1 text-sm text-[var(--ink-muted)]">
              Lote {result.batchId.slice(0, 8)} · {result.importedRows} filas guardadas.
            </p>
          </div>
        </div>
        <Link className="button button-primary" href="/app/productos">
          Ver productos
        </Link>
      </div>
      <div className="stats-grid mt-6">
        <article className="stat-card">
          <DatabaseZap className="text-[var(--plum)]" size={20} />
          <p>Nuevos</p>
          <strong>{number.format(result.productsCreated)}</strong>
        </article>
        <article className="stat-card">
          <RotateCcw className="text-[var(--plum)]" size={20} />
          <p>Actualizados</p>
          <strong>{number.format(result.productsUpdated)}</strong>
        </article>
        <article className="stat-card">
          <CheckCircle2 className="text-[var(--success)]" size={20} />
          <p>Stocks ajustados</p>
          <strong>{number.format(result.stockAdjusted)}</strong>
        </article>
        <article className="stat-card">
          <AlertTriangle className="text-[var(--danger)]" size={20} />
          <p>Filas fallidas</p>
          <strong>{number.format(result.failedRows)}</strong>
        </article>
      </div>
      {result.failures.length ? (
        <div className="data-table-wrap mt-5">
          <table className="data-table min-w-[44rem]">
            <thead><tr><th>Fila</th><th>SKU</th><th>Etapa</th><th>Detalle</th></tr></thead>
            <tbody>
              {result.failures.map((failure) => (
                <tr key={`${failure.stage}-${failure.rowNumber}-${failure.sku}`}>
                  <td>{failure.rowNumber}</td><td className="font-mono text-xs">{failure.sku}</td>
                  <td>{failure.stage === "stock" ? "Stock" : "Producto"}</td><td>{failure.message}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </section>
  );
}

export function InventoryImporter({ canCommit }: { canCommit: boolean }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [analysis, setAnalysis] = useState<InventoryAnalysisPreview | null>(null);
  const [result, setResult] = useState<InventoryCommitResult | null>(null);
  const [busy, setBusy] = useState<BusyMode>(null);
  const [error, setError] = useState<string | null>(null);
  const [issueFilter, setIssueFilter] = useState<IssueFilter>("all");

  const visibleIssues = useMemo(() => {
    if (!analysis) return [];
    const filtered = issueFilter === "all"
      ? analysis.issues
      : analysis.issues.filter((issue) => issue.severity === issueFilter);
    return filtered.slice(0, 150);
  }, [analysis, issueFilter]);

  function chooseFile(nextFile: File | null) {
    setAnalysis(null);
    setResult(null);
    setError(null);
    if (!nextFile) {
      setFile(null);
      return;
    }
    if (!nextFile.name.toLowerCase().endsWith(".xlsx")) {
      setFile(null);
      setError("Seleccioná un archivo .xlsx.");
      return;
    }
    if (nextFile.size > INVENTORY_IMPORT_MAX_BYTES) {
      setFile(null);
      setError("El archivo supera el límite de 2 MB.");
      return;
    }
    setFile(nextFile);
  }

  async function submit(mode: "analyze" | "commit") {
    if (!file || busy) return;
    if (mode === "commit" && (!analysis || !canCommit)) return;
    setBusy(mode);
    setError(null);
    try {
      const body = new FormData();
      body.set("file", file);
      body.set("mode", mode);
      if (analysis) body.set("fileHash", analysis.fileHash);
      const response = await fetch("/api/importar/inventario", { body, method: "POST" });
      const payload = (await response.json()) as InventoryApiResponse;
      if (!response.ok || "error" in payload) {
        throw new Error("error" in payload ? payload.error : "No se pudo procesar el archivo.");
      }
      if (payload.mode === "analyze") {
        setAnalysis(payload.analysis);
        setResult(null);
        setIssueFilter("all");
      } else {
        setResult(payload.result);
      }
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "No se pudo procesar el archivo.");
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="mt-9">
      <div className="flex max-w-lg items-center gap-1 rounded-[7px] bg-[var(--surface-soft)] p-1 text-sm font-bold">
        <span className={`flex min-h-10 flex-1 items-center justify-center gap-2 rounded-[6px] px-3 ${analysis ? "text-[var(--success)]" : "bg-white text-[var(--plum)] shadow-sm"}`}>
          {analysis ? <CheckCircle2 size={17} /> : <ScanSearch size={17} />} Analizar
        </span>
        <span className={`flex min-h-10 flex-1 items-center justify-center gap-2 rounded-[6px] px-3 ${result ? "bg-white text-[var(--success)] shadow-sm" : "text-[var(--ink-muted)]"}`}>
          {result ? <CheckCircle2 size={17} /> : <DatabaseZap size={17} />} Importar
        </span>
      </div>

      <section className="mt-6 border-y border-[var(--line)] py-6">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex min-w-0 items-center gap-3">
            <span className="operation-icon operation-icon-lavender shrink-0"><FileSpreadsheet size={19} /></span>
            <div className="min-w-0">
              <strong className="block truncate text-sm">{file?.name ?? "Sin archivo seleccionado"}</strong>
              <span className="mt-1 block text-xs text-[var(--ink-muted)]">
                {file ? `${number.format(file.size / 1024)} KB` : "Excel .xlsx · máximo 2 MB"}
              </span>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <input
              accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
              className="sr-only"
              onChange={(event) => chooseFile(event.target.files?.[0] ?? null)}
              ref={inputRef}
              type="file"
            />
            <button className="button button-secondary" onClick={() => inputRef.current?.click()} type="button">
              <Upload size={17} /> Seleccionar
            </button>
            <button className="button button-primary" disabled={!file || Boolean(busy)} onClick={() => submit("analyze")} type="button">
              {busy === "analyze" ? <LoaderCircle className="animate-spin" size={17} /> : <ScanSearch size={17} />}
              Analizar
            </button>
          </div>
        </div>
      </section>

      {error ? (
        <div className="mt-5 flex items-start gap-3 border border-[var(--danger)] bg-[var(--rose)] p-4 text-sm text-[var(--danger)]" role="alert">
          <XCircle className="mt-0.5 shrink-0" size={18} /><span>{error}</span>
        </div>
      ) : null}

      {analysis ? (
        <>
          <section className="mt-8" aria-labelledby="analysis-heading">
            <div className="section-heading-row">
              <div><span className="eyebrow">Vista previa</span><h2 id="analysis-heading">Resultado del análisis</h2></div>
              <span className="tag">Hoja {analysis.worksheet}</span>
            </div>
            <div className="stats-grid mt-5">
              <article className="stat-card"><FileSpreadsheet className="text-[var(--plum)]" size={20} /><p>Productos</p><strong>{number.format(analysis.summary.productRows)}</strong></article>
              <article className="stat-card"><ScanSearch className="text-[var(--plum)]" size={20} /><p>GTIN válidos</p><strong>{number.format(analysis.summary.gtinValid)}</strong></article>
              <article className="stat-card"><DatabaseZap className="text-[var(--success)]" size={20} /><p>Stock positivo</p><strong>{number.format(analysis.summary.positiveStockUnits)}</strong></article>
              <article className="stat-card"><AlertTriangle className="text-[var(--danger)]" size={20} /><p>Incidencias</p><strong>{number.format(analysis.issues.length)}</strong></article>
            </div>
            <div className="mt-5 grid gap-3 border-y border-[var(--line)] py-4 text-sm sm:grid-cols-2 xl:grid-cols-4">
              <p><span className="text-[var(--ink-muted)]">SKUs generados</span><strong className="mt-1 block">{analysis.summary.generatedSkus}</strong></p>
              <p><span className="text-[var(--ink-muted)]">Sin proveedor</span><strong className="mt-1 block">{analysis.summary.missingSupplier}</strong></p>
              <p><span className="text-[var(--ink-muted)]">Stock negativo</span><strong className="mt-1 block">{analysis.summary.negativeStock}</strong></p>
              <p><span className="text-[var(--ink-muted)]">Productos inactivos</span><strong className="mt-1 block">{analysis.summary.inactiveProducts}</strong></p>
            </div>
          </section>

          <section className="mt-9" aria-labelledby="issues-heading">
            <div className="flex flex-wrap items-end justify-between gap-4">
              <div><span className="eyebrow">Control de calidad</span><h2 className="mt-2 text-lg font-bold" id="issues-heading">Incidencias</h2></div>
              <div className="flex gap-1 rounded-[7px] bg-[var(--surface-soft)] p-1 text-xs font-bold">
                {(["all", "error", "warning"] as const).map((filter) => (
                  <button
                    className={`min-h-9 rounded-[6px] px-3 ${issueFilter === filter ? "bg-white text-[var(--plum)] shadow-sm" : "text-[var(--ink-muted)]"}`}
                    key={filter}
                    onClick={() => setIssueFilter(filter)}
                    type="button"
                  >
                    {filter === "all" ? "Todas" : filter === "error" ? `Errores (${analysis.summary.issueCounts.errors})` : `Avisos (${analysis.summary.issueCounts.warnings})`}
                  </button>
                ))}
              </div>
            </div>
            <div className="data-table-wrap mt-4">
              <table className="data-table min-w-[68rem]">
                <thead><tr><th>Fila</th><th>Producto</th><th>Campo</th><th>Estado</th><th>Detalle</th><th>Valor original</th></tr></thead>
                <tbody>
                  {visibleIssues.map((issue, index) => (
                    <tr key={`${issue.rowNumber}-${issue.code}-${index}`}>
                      <td>{issue.rowNumber}</td>
                      <td><strong>{issue.productName ?? "Fila sin producto"}</strong><small className="font-mono">{issue.sku ?? "Sin SKU"}</small></td>
                      <td>{issue.field ?? "General"}</td>
                      <td><span className={issue.severity === "error" ? "table-status table-status-alert" : "table-status text-[var(--ink-muted)]"}>{issue.severity === "error" ? <XCircle size={15} /> : <AlertTriangle size={15} />}{issue.severity === "error" ? "Error" : "Aviso"}</span></td>
                      <td>{issue.message}</td><td className="max-w-48 truncate font-mono text-xs" title={rawValue(issue)}>{rawValue(issue)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {visibleIssues.length < (issueFilter === "all" ? analysis.issues.length : analysis.issues.filter((issue) => issue.severity === issueFilter).length) ? (
              <p className="mt-3 text-xs text-[var(--ink-muted)]">Se muestran las primeras 150 incidencias del filtro.</p>
            ) : null}
          </section>

          <section className="mt-9 flex flex-wrap items-center justify-between gap-4 border-y border-[var(--line)] py-5">
            <div>
              <strong className="text-sm">Confirmar lote analizado</strong>
              <p className="mt-1 text-xs text-[var(--ink-muted)]">Hash {analysis.fileHash.slice(0, 16)}…</p>
            </div>
            <button className="button button-primary" disabled={!canCommit || Boolean(busy) || Boolean(result)} onClick={() => submit("commit")} type="button">
              {busy === "commit" ? <LoaderCircle className="animate-spin" size={17} /> : <DatabaseZap size={17} />}
              Importar inventario
            </button>
            {!canCommit ? <p className="w-full text-xs text-[var(--danger)]">Tu perfil puede analizar, pero no confirmar importaciones.</p> : null}
          </section>
        </>
      ) : null}

      {result ? <ResultSummary result={result} /> : null}
    </div>
  );
}
