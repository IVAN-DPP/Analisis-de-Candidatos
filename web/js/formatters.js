const numberFormatter = new Intl.NumberFormat("es-ES");
const percentFormatter = new Intl.NumberFormat("es-ES", {
  style: "percent",
  minimumFractionDigits: 1,
  maximumFractionDigits: 1,
});
const compactFormatter = new Intl.NumberFormat("es-ES", {
  notation: "compact",
  maximumFractionDigits: 1,
});

export function formatNumber(value) {
  return numberFormatter.format(Number(value) || 0);
}

export function formatPercent(value) {
  return percentFormatter.format(Number(value) || 0);
}

export function formatCompact(value) {
  return compactFormatter.format(Number(value) || 0);
}

export function formatDate(value, includeTime = false) {
  if (!value) return "Sin fecha";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Sin fecha";
  const options = includeTime
    ? {
        day: "2-digit",
        month: "short",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      }
    : { day: "2-digit", month: "short", year: "numeric" };
  return new Intl.DateTimeFormat("es-ES", options)
    .format(date)
    .replace(/\./g, "");
}

export function formatMonthRange(start, end) {
  if (!start || !end) return "sin rango de fechas";
  const first = new Date(start);
  const last = new Date(end);
  const monthFormatter = new Intl.DateTimeFormat("es-ES", {
    month: "short",
    year: "numeric",
  });
  return `${monthFormatter.format(first).replace(/\./g, "")} — ${monthFormatter
    .format(last)
    .replace(/\./g, "")}`;
}

export function escapeHtml(value) {
  return String(value ?? "").replace(
    /[&<>'"]/g,
    (character) =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        "'": "&#39;",
        '"': "&quot;",
      })[character],
  );
}

export function normalizeSearch(value) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("es");
}

export function profileUrl(username) {
  return `https://www.instagram.com/${encodeURIComponent(username)}/`;
}

export function postUrl(shortCode) {
  return `https://www.instagram.com/p/${encodeURIComponent(shortCode)}/`;
}

export function initials(account) {
  const source = account?.full_name || account?.username || account?.name || "@";
  const pieces = source.replace(/^@/, "").split(/[\s._-]+/).filter(Boolean);
  const value = pieces.length > 1 ? `${pieces[0][0]}${pieces[1][0]}` : source.slice(0, 2);
  return value.toLocaleUpperCase("es");
}
