import "server-only";

type PageResult<T> = {
  data: T[] | null;
  error: { message: string } | null;
};

export async function fetchAllRows<T>(
  loadPage: (from: number, to: number) => PromiseLike<PageResult<T>>,
  pageSize = 1000,
) {
  const rows: T[] = [];

  for (let page = 0; page < 100; page += 1) {
    const from = page * pageSize;
    const { data, error } = await loadPage(from, from + pageSize - 1);
    if (error) throw new Error(error.message);

    const current = data ?? [];
    rows.push(...current);
    if (current.length < pageSize) return rows;
  }

  throw new Error("La consulta superó el máximo operativo de 100.000 registros.");
}
