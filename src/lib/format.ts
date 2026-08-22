export function formatDecimalDisplay(value: { toString(): string } | string | number | null | undefined) {
  if (value === null || value === undefined) return "-";

  const text = value.toString();
  if (!/^-?\d+(\.\d+)?$/.test(text)) return text;

  return text.replace(/(\.\d*?[1-9])0+$/, "$1").replace(/\.0+$/, "");
}

export function formatRating(value: { toString(): string } | string | number | null | undefined) {
  return formatDecimalDisplay(value);
}
