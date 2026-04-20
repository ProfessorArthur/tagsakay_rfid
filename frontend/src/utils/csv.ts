export function escapeCsvField(value: unknown): string {
  const text = value === null || value === undefined ? "" : String(value);
  const escaped = text.replace(/"/g, '""');
  return `"${escaped}"`;
}

export function buildCsvBlob(
  rows: (unknown[] | string[])[],
  includeBOM = true
): Blob {
  const csv = rows
    .map((row) => row.map((field) => escapeCsvField(field)).join(","))
    .join("\n");
  const withBom = includeBOM ? `\uFEFF${csv}` : csv;
  return new Blob([withBom], { type: "text/csv;charset=utf-8;" });
}
