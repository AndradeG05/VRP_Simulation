export async function api<T>(
  path: string,
  body?: unknown,
  signal?: AbortSignal,
): Promise<T> {
  const response = await fetch(`/api${path}`, {
    method: body === undefined ? "GET" : "POST",
    headers:
      body === undefined ? undefined : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal,
  });
  if (!response.ok) {
    const error = await response
      .json()
      .catch(() => ({ detail: `Erro HTTP ${response.status}` }));
    throw new Error(
      typeof error.detail === "string"
        ? error.detail
        : Array.isArray(error.detail)
          ? error.detail
              .filter((item: { type: string }) => item.type === "value_error")
              .map((item: { msg: string }) => item.msg)
              .join(" ") ||
            "Dados inválidos. Confira os limites dos campos e o formato do arquivo."
          : "Dados inválidos. Confira os limites dos campos e o formato do arquivo.",
    );
  }
  return response.json() as Promise<T>;
}
export const distance = (ticks: number | null | undefined) =>
  ticks == null
    ? "—"
    : (ticks / 1000).toLocaleString("pt-BR", {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      });
export const integer = (value: number) => value.toLocaleString("pt-BR");
export function improvement(
  baseline: number | undefined | null,
  best: number | undefined | null,
): number | null {
  return baseline != null && best != null && baseline > 0
    ? (100 * (baseline - best)) / baseline
    : null;
}
export function downloadJson(name: string, data: unknown) {
  const url = URL.createObjectURL(
    new Blob([JSON.stringify(data, null, 2)], { type: "application/json" }),
  );
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = name;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
