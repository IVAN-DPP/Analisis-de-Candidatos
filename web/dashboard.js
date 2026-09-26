const PAGE_ORDER = ["resumen", "datos", "publicaciones", "audiencia", "colaboraciones", "redes", "evolucion", "hallazgos", "guia"];
const PAGE_META = {
  resumen: { label: "Resumen", title: "Resumen de la cuenta", description: "Una primera lectura de la actividad, la respuesta y los límites de la fuente." },
  datos: { label: "Qué datos tenemos", title: "Qué datos tenemos", description: "Inventario, cobertura y diccionario antes de interpretar cualquier cifra." },
  publicaciones: { label: "Publicaciones", title: "Publicaciones y respuesta", description: "Qué se publicó, cuánto likes tiene cada registro y qué valores destacan." },
  audiencia: { label: "Audiencia", title: "Audiencia que se puede observar", description: "Cuentas identificadas, recurrencia, concentración y presencia por publicación." },
  colaboraciones: { label: "Colaboraciones", title: "Colaboraciones y comparaciones", description: "Cuentas acreditadas y diferencias observables, sin convertir asociación en causalidad." },
  redes: { label: "Redes", title: "Estructura de vínculos", description: "Interacción, colaboración y coincidencia como estructuras observadas." },
  evolucion: { label: "Evolución", title: "Evolución en el tiempo", description: "Series mensuales con escala, colores y contexto de cada periodo." },
  hallazgos: { label: "Hallazgos", title: "Retrato y hallazgos", description: "Una lectura más profunda de la cuenta, con evidencia, preguntas y límites." },
  guia: { label: "Guía", title: "Guía de análisis", description: "Conceptos, fórmulas y ejemplos para entender cada sección del informe." },
};
const COLORS = { blue: "#3b6ef5", coral: "#ef5f57", amber: "#e89a24", green: "#1d9a6c", purple: "#7c5ce0", gray: "#a4adbd", ink: "#172033" };
const $ = (id) => document.getElementById(id);
const numberFormatter = new Intl.NumberFormat("es-ES");
const compactFormatter = new Intl.NumberFormat("es-ES", { notation: "compact", maximumFractionDigits: 1 });
const percentFormatter = new Intl.NumberFormat("es-ES", { style: "percent", minimumFractionDigits: 1, maximumFractionDigits: 1 });
const state = { data: null, page: document.body.dataset.page || "resumen", main: "", scope: "owned", network: "interaction" };

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>'"]/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[character]);
}
function safeUrl(value) {
  try {
    const url = new URL(String(value || ""), window.location.origin);
    return ["http:", "https:"].includes(url.protocol) ? url.href : "#";
  } catch { return "#"; }
}
function formatNumber(value) { return numberFormatter.format(Number(value) || 0); }
function formatCompact(value) { return compactFormatter.format(Number(value) || 0); }
function formatPercent(value) { return percentFormatter.format(Number(value) || 0); }
function formatDate(value, withTime = false) {
  if (!value) return "Sin fecha";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Sin fecha";
  return new Intl.DateTimeFormat("es-ES", withTime ? { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" } : { day: "2-digit", month: "short", year: "numeric" }).format(date).replace(/\./g, "");
}
function formatMonth(value) {
  if (!value) return "—";
  const [year, month] = String(value).split("-").map(Number);
  if (!year || !month) return String(value);
  return new Intl.DateTimeFormat("es-ES", { month: "short", year: "2-digit", timeZone: "UTC" }).format(new Date(Date.UTC(year, month - 1, 1))).replace(/\./g, "");
}
function compactLabel(value, length = 12) { return String(value ?? "—").length > length ? `${String(value).slice(0, length - 1)}…` : String(value ?? "—"); }
function rangeLabel(item) { return `${formatCompact(item.start)}–${formatCompact(item.end)}`; }
function list(value) { return Array.isArray(value) ? value : []; }
function byId(id) { return $(id); }

function setStatus(message, type = "") {
  const target = byId("pageStatus");
  if (!target) return;
  target.className = `page-status ${type}`.trim();
  target.innerHTML = message;
}
function setLoading(message = "Calculando el informe…") {
  const target = byId("pageContent");
  if (target) target.innerHTML = `<div class="loading">${escapeHtml(message)}</div>`;
}
function showNoData() {
  setStatus("<strong>Todavía no hay una fuente cargada.</strong> <a href=\"/\">Carga uno o varios JSON para comenzar.</a>");
  setLoading("No hay datos para dibujar todavía.");
}
async function apiJson(url, options = {}) {
  const response = await fetch(url, options);
  let payload;
  try { payload = await response.json(); } catch { throw new Error(`El servidor respondió con el estado ${response.status}.`); }
  if (!response.ok) throw new Error(payload.error || `Error HTTP ${response.status}.`);
  return payload;
}

function baseLayout(overrides = {}) {
  return {
    autosize: true,
    paper_bgcolor: "#ffffff",
    plot_bgcolor: "#ffffff",
    font: { family: "Inter, Arial, sans-serif", size: 14, color: "#42506a" },
    margin: { l: 58, r: 24, t: 55, b: 55 },
    hoverlabel: { font: { size: 14 } },
    legend: { orientation: "h", y: 1.08, x: 0, font: { size: 13 } },
    xaxis: { automargin: true, tickfont: { size: 14 } },
    yaxis: { automargin: true, tickfont: { size: 14 } },
    ...overrides,
  };
}
function drawPlot(id, traces, layout = {}) {
  const target = byId(id);
  if (!target) return;
  if (!window.Plotly) { target.innerHTML = '<div class="empty">No se pudo cargar Plotly. Revisa la ruta local /assets/plotly.min.js.</div>'; return; }
  const defaults = baseLayout();
  const mergedLayout = { ...defaults, ...layout, xaxis: { ...defaults.xaxis, ...(layout.xaxis || {}) }, yaxis: { ...defaults.yaxis, ...(layout.yaxis || {}) } };
  window.Plotly.newPlot(target, traces, mergedLayout, { responsive: true, displaylogo: false, modeBarButtonsToRemove: ["lasso2d", "select2d"] });
}
function barPlot(id, labels, values, color, title, options = {}) {
  const { customdata, hovertemplate, ...layout } = options;
  drawPlot(id, [{ type: "bar", x: labels, y: values, marker: { color }, text: values, textposition: "outside", cliponaxis: false, customdata, hovertemplate: hovertemplate || "%{x}<br>%{y:,}<extra></extra>" }], { title: { text: title, font: { size: 19 }, x: 0.02, xanchor: "left" }, ...layout });
}
function linePlot(id, labels, series, title, options = {}) {
  const traces = series.map(({ name, values, color, dash }) => ({ type: "scatter", mode: "lines+markers", x: labels, y: values, name, line: { color, width: 3, dash }, marker: { size: 7 }, connectgaps: true, hovertemplate: `%{x}<br>%{y:,}<extra>${escapeHtml(name)}</extra>` }));
  drawPlot(id, traces, { title: { text: title, font: { size: 19 }, x: 0.02, xanchor: "left" }, ...options });
}
function boxPlot(id, values, title) {
  drawPlot(id, [{ type: "box", y: values, name: "Likes", marker: { color: COLORS.blue }, boxpoints: "outliers", hovertemplate: "%{y:,} likes<extra></extra>" }], { title: { text: title, font: { size: 19 }, x: 0.02, xanchor: "left" }, showlegend: false });
}
function boxGroupsPlot(id, groups, title) {
  const traces = groups.map((group) => ({ type: "box", x: group.label, y: group.values, name: group.label, marker: { color: group.color }, boxpoints: "outliers", fillcolor: group.color, opacity: .72, hovertemplate: `${escapeHtml(group.label)}<br>%{y:,} likes<extra></extra>` }));
  drawPlot(id, traces, { title: { text: title, font: { size: 19 }, x: .02, xanchor: "left" }, boxmode: "group", showlegend: true, legend: { orientation: "h", y: 1.08, x: 0 } });
}
function networkPlot(id, network, kind = "interaction") {
  const nodes = list(network?.nodes).sort((a, b) => Number(b.weight || 0) - Number(a.weight || 0));
  if (!nodes.length) { byId(id).innerHTML = '<div class="empty">No hay identidades suficientes para dibujar esta red.</div>'; return; }
  const central = nodes.find((node) => node.is_central);
  const peripheral = nodes.filter((node) => !node.is_central).slice(0, 45);
  const selected = central ? [central, ...peripheral] : peripheral.slice(0, 45);
  const ids = new Set(selected.map((node) => String(node.id)));
  const positions = new Map();
  if (central) positions.set(String(central.id), { x: 0, y: 0 });
  peripheral.forEach((node, index) => {
    const angle = (index / Math.max(peripheral.length, 1)) * Math.PI * 2 - Math.PI / 2;
    const radiusX = kind === "cooccurrence" ? 1.7 : 1.45;
    const radiusY = kind === "cooccurrence" ? 1.15 : 1.05;
    positions.set(String(node.id), { x: Math.cos(angle) * radiusX, y: Math.sin(angle) * radiusY });
  });
  const edgeX = [], edgeY = [];
  list(network?.edges).forEach((edge) => {
    const source = positions.get(String(edge.source)); const target = positions.get(String(edge.target));
    if (!source || !target || !ids.has(String(edge.source)) || !ids.has(String(edge.target))) return;
    edgeX.push(source.x, target.x, null); edgeY.push(source.y, target.y, null);
  });
  const maxWeight = Math.max(...selected.map((node) => Number(node.weight || 0)), 1);
  const nodeX = selected.map((node) => positions.get(String(node.id))?.x || 0);
  const nodeY = selected.map((node) => positions.get(String(node.id))?.y || 0);
  const nodeText = selected.map((node) => `@${node.username || node.id}<br>peso: ${formatNumber(node.weight || 0)}`);
  const nodeColors = selected.map((node) => node.is_central ? COLORS.ink : kind === "collaboration" ? COLORS.green : kind === "cooccurrence" ? COLORS.amber : COLORS.blue);
  const nodeSizes = selected.map((node) => node.is_central ? 27 : 10 + Math.sqrt(Number(node.weight || 0) / maxWeight) * 19);
  drawPlot(id, [
    { type: "scatter", mode: "lines", x: edgeX, y: edgeY, line: { color: kind === "collaboration" ? "rgba(29,154,108,.45)" : kind === "cooccurrence" ? "rgba(232,154,36,.42)" : "rgba(59,110,245,.38)", width: 1.5 }, hoverinfo: "skip", showlegend: false },
    { type: "scatter", mode: "markers+text", x: nodeX, y: nodeY, text: nodeText, textposition: "top center", textfont: { size: 11, color: "#42506a" }, marker: { size: nodeSizes, color: nodeColors, line: { color: "#fff", width: 2 } }, customdata: selected.map((node) => `@${node.username || node.id}`), hovertemplate: "%{customdata}<br>peso: %{marker.size}<extra></extra>", showlegend: false },
  ], { title: { text: kind === "collaboration" ? "Red de colaboración" : kind === "cooccurrence" ? "Red de coincidencia" : "Red de interacción", font: { size: 19 }, x: 0.02, xanchor: "left" }, xaxis: { visible: false, range: [-2.1, 2.1] }, yaxis: { visible: false, range: [-1.45, 1.45], scaleanchor: "x", scaleratio: 1 }, margin: { l: 20, r: 20, t: 55, b: 20 }, height: 530, showlegend: false });
}
function heatmapPlot(id, matrix) {
  if (!matrix?.rows?.length || !matrix?.posts?.length) { byId(id).innerHTML = '<div class="empty">No hay identidades para construir la matriz.</div>'; return; }
  drawPlot(id, [{ type: "heatmap", x: matrix.posts.map((value) => compactLabel(value, 8)), y: matrix.rows.map((row) => `@${compactLabel(row.username, 18)}`), z: matrix.rows.map((row) => row.values), colorscale: [[0, "#eef3ff"], [0.35, "#a9c2ff"], [0.7, "#5d86f7"], [1, "#173b9b"]], hovertemplate: "@%{y}<br>%{x}<br>%{z} interacciones<extra></extra>" }], { title: { text: "Mapa publicación × cuenta", font: { size: 19 }, x: 0.02, xanchor: "left" }, xaxis: { tickangle: -45 }, margin: { l: 150, r: 20, t: 55, b: 100 }, height: 470 });
}

function metricCards(items) { return `<div class="kpi-grid">${items.map(([label, value, note]) => `<article class="kpi"><div class="kpi-label">${escapeHtml(label)}</div><div class="kpi-value">${escapeHtml(value)}</div><div class="kpi-note">${escapeHtml(note)}</div></article>`).join("")}</div>`; }
function cardHead(title, description = "", tag = "") { return `<div class="card-head"><div><h2>${escapeHtml(title)}</h2>${description ? `<p>${escapeHtml(description)}</p>` : ""}</div>${tag ? `<span class="tag">${escapeHtml(tag)}</span>` : ""}</div>`; }
function explanation(shows, observes, caution) { return `<div class="explanation"><div><strong>¿Qué muestra?</strong><p>${escapeHtml(shows)}</p></div><div><strong>¿Qué observamos?</strong><p>${escapeHtml(observes)}</p></div><div class="caution"><strong>¿Qué no concluyo?</strong><p>${escapeHtml(caution)}</p></div></div>`; }
function table(headers, rows) { return `<div class="table-wrap"><table><thead><tr>${headers.map((header) => `<th class="${header.numeric ? "numeric" : ""}">${escapeHtml(header.label || header)}</th>`).join("")}</tr></thead><tbody>${rows.length ? rows.map((row) => `<tr>${headers.map((header) => `<td class="${header.numeric ? "numeric" : ""}">${header.render ? header.render(row) : escapeHtml(row[header.key] ?? "—")}</td>`).join("")}</tr>`).join("") : `<tr><td colspan="${headers.length}" class="empty">No hay datos para esta tabla.</td></tr>`}</tbody></table></div>`; }

function ensureQuickNavigation() {
  if (byId("quickPageNav") || !document.querySelector(".page-hero")) return;
  const nav = document.createElement("nav");
  nav.id = "quickPageNav";
  nav.className = "page-nav page-nav-top";
  nav.setAttribute("aria-label", "Navegación rápida entre niveles");
  nav.innerHTML = '<a data-nav-prev href="#">← Anterior</a><span class="page-position"></span><a data-nav-next href="#">Siguiente →</a><a data-nav-home href="/informe/resumen">Ir al resumen</a>';
  document.querySelector(".page-hero").insertAdjacentElement("afterend", nav);
}
function navigateToPage(page) {
  if (!PAGE_ORDER.includes(page)) return;
  window.location.assign(`/informe/${page}`);
}
function wireNavigationLink(link, page, disabled = false) {
  if (!link) return;
  link.href = disabled ? "#" : `/informe/${page}`;
  link.classList.toggle("disabled", disabled);
  link.setAttribute("aria-disabled", disabled ? "true" : "false");
  if (link.dataset.navigationBound) return;
  link.dataset.navigationBound = "true";
  link.addEventListener("click", (event) => {
    event.preventDefault();
    if (!disabled) navigateToPage(page);
  });
}
function renderShell() {
  const page = state.page;
  const meta = PAGE_META[page] || PAGE_META.resumen;
  const title = byId("pageTitle"); const description = byId("pageDescription");
  if (title) title.textContent = meta.title;
  if (description) description.textContent = meta.description;
  ensureQuickNavigation();
  document.querySelectorAll(".top-nav a").forEach((link) => link.classList.toggle("active", link.dataset.page === page));
  const index = PAGE_ORDER.indexOf(page);
  const previousPage = index > 0 ? PAGE_ORDER[index - 1] : null;
  const nextPage = index < PAGE_ORDER.length - 1 ? PAGE_ORDER[index + 1] : null;
  const previous = byId("previousPage"); const next = byId("nextPage");
  if (previous) { previous.dataset.navPrev = "true"; wireNavigationLink(previous, previousPage, !previousPage); }
  if (next) { next.dataset.navNext = "true"; wireNavigationLink(next, nextPage, !nextPage); }
  document.querySelectorAll("[data-nav-prev]").forEach((link) => wireNavigationLink(link, previousPage, !previousPage));
  document.querySelectorAll("[data-nav-next]").forEach((link) => wireNavigationLink(link, nextPage, !nextPage));
  document.querySelectorAll("[data-nav-home]").forEach((link) => wireNavigationLink(link, "resumen", page === "resumen"));
  document.querySelectorAll(".page-position").forEach((position) => { position.textContent = `Nivel ${index + 1} de ${PAGE_ORDER.length} · ${meta.label}`; });
}

function renderHeader() {
  const data = state.data; if (!data) return;
  state.main = data.main?.username || state.main;
  state.scope = data.scope || state.scope;
  const account = byId("mainAccount"); const scope = byId("scopeSelect");
  if (account) { account.innerHTML = list(data.available_accounts).map((item) => `<option value="${escapeHtml(item.username)}" ${item.username === state.main ? "selected" : ""}>@${escapeHtml(item.username)} · ${formatNumber(item.posts)}</option>`).join(""); }
  if (scope) scope.value = state.scope;
  const source = byId("sourceName"); if (source) { source.textContent = data.source_name || "JSON cargado"; source.title = data.source_name || "JSON cargado"; }
  const coverage = data.data_coverage || {};
  const status = byId("pageStatus");
  if (status) {
    status.className = `page-status ${coverage.likes_identities_available ? "" : "warning"}`;
    status.innerHTML = coverage.likes_identities_available ? `<strong>Cobertura:</strong> hay ${formatNumber(coverage.liker_records)} registros de likes identificados y ${formatNumber(coverage.comment_records)} comentarios identificados. La cobertura puede ser parcial.` : `<strong>Límite de la fuente:</strong> los ${formatNumber(data.profile?.total_likes)} likes son agregados y no revelan quién los dio. La audiencia visible usa ${formatNumber(coverage.comment_records)} comentarios identificados.`;
  }
}

function fallbackNarrative(data) {
  const p = data.profile || {};
  return { title: `Retrato provisional de @${data.main?.username || "la cuenta"}`, summary: `La fuente contiene ${formatNumber(p.posts)} publicaciones y ${formatNumber(p.total_likes)} likes reportados. La lectura describe el archivo, no una evaluación de la persona.`, dimensions: [], questions: data.open_questions || [], limits: data.limitations || [] };
}
function renderNarrative(data) {
  const narrative = data.profile_narrative || fallbackNarrative(data);
  const paragraphs = list(narrative.paragraphs).map((paragraph) => `<p class="narrative-text">${escapeHtml(paragraph)}</p>`).join("");
  const dimensions = list(narrative.dimensions).map((item) => `<article class="dimension"><h3>${escapeHtml(item.title)}</h3><p>${escapeHtml(item.text)}</p><small>Evidencia: ${escapeHtml(item.evidence)}<br>Precaución: ${escapeHtml(item.caution)}</small></article>`).join("");
  return `<article class="card card-pad"><h2 class="narrative-title">${escapeHtml(narrative.title)}</h2><p class="narrative-text">${escapeHtml(narrative.summary)}</p><div class="narrative-paragraphs">${paragraphs}</div><div class="narrative-dimensions">${dimensions}</div></article>`;
}
function renderResumen(data) {
  const p = data.profile || {}; const stats = data.likes_distribution || {}; const types = data.content_types || [];
  const content = `<div class="grid">${metricCards([["Publicaciones", formatNumber(p.posts), "en el alcance seleccionado"], ["Likes reportados", formatCompact(p.total_likes), `${formatNumber(p.likes_known)} publicaciones con dato`], ["Cuentas observadas", formatNumber(p.unique_audience_accounts), "identidades disponibles"], ["Colaboraciones", formatNumber(data.collaborations?.total), `${formatNumber(data.collaborations?.unique_collaborators)} cuentas`], ["Periodo", formatDate(p.date_start), `hasta ${formatDate(p.date_end)}`]])}${renderNarrative(data)}<div class="grid two"><article class="card">${cardHead("Publicaciones por mes", "La serie usa únicamente publicaciones con fecha.")}<div id="summaryPostsChart" class="chart short"></div></article><article class="card">${cardHead("Likes por mes", "Los likes se muestran como magnitud agregada.")}<div id="summaryLikesChart" class="chart short"></div></article></div><article class="card">${cardHead("Tipos de contenido", "El tipo técnico no describe el tema ni la intención.")}<div id="summaryTypesChart" class="chart short"></div></article></div>`;
  byId("pageContent").innerHTML = content;
  const monthly = list(data.temporal?.monthly); const labels = monthly.map((item) => formatMonth(item.period));
  linePlot("summaryPostsChart", labels, [{ name: "Publicaciones", values: monthly.map((item) => Number(item.posts || 0)), color: COLORS.blue }], "Actividad mensual");
  linePlot("summaryLikesChart", labels, [{ name: "Likes", values: monthly.map((item) => Number(item.likes || 0)), color: COLORS.coral }], "Likes agregados por mes");
  barPlot("summaryTypesChart", types.map((item) => item.category), types.map((item) => Number(item.posts || 0)), COLORS.purple, "Publicaciones por categoría", { showlegend: false });
}

function renderDatos(data) {
  const inventory = data.data_inventory || {}; const coverage = data.data_coverage || {};
  const fileRows = list(inventory.files).map((file) => `<tr><td>${escapeHtml(file.name)}</td><td>${escapeHtml(file.inferred_role)}</td><td class="numeric">${formatNumber(file.post_records)}</td><td class="numeric">${formatNumber(file.field_count)}</td><td class="numeric">${formatNumber(file.like_events)}</td><td class="numeric">${formatNumber(file.comment_events)}</td></tr>`).join("");
  const coverageRows = [["Likes agregados", coverage.reported_likes_available, coverage.selected_post_count, "Magnitud; no identifica personas."], ["Identidades de likes", coverage.likes_identities_available, coverage.liker_records, "Sólo las identidades capturadas."], ["Comentarios con autor", coverage.comment_identities_available, coverage.comment_records, "Puede construir audiencia observada."], ["Seguidores", coverage.followers_available, coverage.follower_records, " sólo si hay lista."], ["Colaboraciones", coverage.collaboration_identities_available, coverage.collaboration_records, "Asociaciones registradas."]].map(([name, available, records, text]) => `<tr><td>${escapeHtml(name)}</td><td>${available ? "Sí" : "No"}</td><td class="numeric">${formatNumber(records)}</td><td>${escapeHtml(text)}</td></tr>`).join("");
  byId("pageContent").innerHTML = `<div class="grid"><div class="callout"><strong>Principio de lectura.</strong> Un campo ausente no se rellena con suposiciones. La aplicación separa el dato observado de la interpretación.</div><article class="card">${cardHead("Inventario de archivos", "Cada archivo se presenta antes de convertirlo en métricas.")}<div class="table-wrap"><table><thead><tr><th>Archivo</th><th>Rol inferido</th><th>Posts</th><th>Campos</th><th>Likes identificados</th><th>Comentarios identificados</th></tr></thead><tbody>${fileRows || `<tr><td colspan="6" class="empty">No hay archivos para describir.</td></tr>`}</tbody></table></div></article><article class="card">${cardHead("Cobertura de identidades", "La diferencia entre una cifra agregada y una identidad cambia toda la interpretación.")}<div class="table-wrap"><table><thead><tr><th>Dato</th><th>Disponible</th><th>Registros</th><th>Qué permite decir</th></tr></thead><tbody>${coverageRows}</tbody></table></div></article><article class="card card-pad"><h2>Campos que el archivo realmente entregó</h2><p class="chart-note">El detalle completo está disponible en la guía de datos y en la respuesta JSON de la API.</p><a class="outline-button" href="/GUIA_DE_ANALISIS.md" target="_blank" rel="noopener noreferrer">Abrir guía de análisis</a></article></div>`;
}

function renderPublicaciones(data) {
  const posts = list(data.post_table); const stats = data.likes_distribution || {}; const profile = data.profile || {}; const comparison = data.collaboration_comparison || {};
  const withLikes = posts.filter((post) => post.likes != null).sort((a, b) => Number(b.likes || 0) - Number(a.likes || 0));
  const publicationRows = withLikes.map((post, index) => ({ ...post, publicationLabel: `Publicación ${index + 1}` }));
  const publicationLinks = publicationRows.map((post) => `<a href="${escapeHtml(safeUrl(post.url))}" target="_blank" rel="noopener noreferrer">${escapeHtml(post.publicationLabel)} · ${formatNumber(post.likes)} likes ↗</a>`).join("");
  const monthly = list(data.temporal?.monthly);
  const postRows = posts.map((post) => `<tr><td>${escapeHtml(formatDate(post.date))}</td><td><a href="${escapeHtml(safeUrl(post.url))}" target="_blank" rel="noopener noreferrer">${escapeHtml(compactLabel(post.publication || post.short_code, 32))}</a><br><small>${escapeHtml(post.short_code || "")}</small></td><td class="numeric">${post.likes == null ? "Sin dato" : formatNumber(post.likes)}</td><td>${post.collaboration ? "Sí" : "No"}</td><td>${escapeHtml(post.collaborator || "—")}</td><td>${escapeHtml(post.type || "—")}</td></tr>`).join("");
  const exceptions = list(data.exceptions);
  const comparisonStats = `<div class="comparison-summary"><span><strong>${formatNumber(comparison.collaborative?.posts || 0)}</strong> colaborativas · media <strong>${formatCompact(comparison.collaborative?.mean_likes || 0)}</strong></span><span><strong>${formatNumber(comparison.non_collaborative?.posts || 0)}</strong> no colaborativas · media <strong>${formatCompact(comparison.non_collaborative?.mean_likes || 0)}</strong></span></div>`;
  byId("pageContent").innerHTML = `<div class="grid">${metricCards([["Media", formatCompact(stats.mean), "likes por publicación"], ["Mediana", formatCompact(stats.median), "más resistente a valores extremos"], ["Máximo", formatCompact(stats.stats?.max), "publicación excepcional"], ["P90", formatCompact(stats.percentiles?.p90), "percentil observado"], ["Con dato", formatNumber(profile.likes_known), "publicaciones con likes"]])}<article class="card">${cardHead("Likes por publicación", "Cada barra es una publicación; el orden ayuda a ver los valores extremos.", "Plotly") }<div id="postLikesChart" class="chart tall"></div><div id="publicationLinks" class="publication-links" aria-label="Enlaces de publicaciones">${publicationLinks}</div>${explanation("Likes agregados por publicación.", `Se observan ${formatNumber(withLikes.length)} publicaciones con like disponible.`, "No sabemos quién interactuar ni por qué una publicación recibe más.")}</article><div class="grid two"><article class="card">${cardHead("Evolución de likes") }<div id="postLikesTimeline" class="chart short"></div></article><article class="card">${cardHead("Frecuencia de publicación") }<div id="postFrequencyChart" class="chart short"></div></article></div><div class="grid two"><article class="card">${cardHead("Distribución de likes") }<div id="likesHistogram" class="chart short"></div></article><article class="card">${cardHead("Caja y valores extremos") }<div id="likesBox" class="chart short"></div></article></div><article class="card">${cardHead("Distribución de likes por colaboración", "Dos cajas separan publicaciones colaborativas y no colaborativas; los puntos muestran casos extremos.")}<div id="postCollaborationChart" class="chart short"></div>${comparisonStats}${explanation("Cada caja resume la distribución de likes de un grupo.", "La mediana y los puntos atípicos se leen sin convertir la diferencia en una causa.", "No demuestra que colaborar produzca más likes.")}</article><article class="card">${cardHead("Publicaciones excepcionales", "Se marcan por su distancia al comportamiento observado, no por una causa.")}<div class="table-wrap"><table><thead><tr><th>Publicación</th><th>Fecha</th><th>Likes</th><th>Motivo estadístico</th></tr></thead><tbody>${exceptions.map((item) => `<tr><td><a href="${escapeHtml(safeUrl(item.url))}" target="_blank" rel="noopener noreferrer">${escapeHtml(item.short_code)}</a></td><td>${escapeHtml(formatDate(item.date))}</td><td class="numeric">${formatNumber(item.likes)}</td><td>${escapeHtml(list(item.reasons).join("; "))}</td></tr>`).join("") || `<tr><td colspan="4" class="empty">No hay excepciones con los umbrales actuales.</td></tr>`}</tbody></table></div></article><article class="card">${cardHead("Tabla de publicaciones", "La tabla conserva la evidencia que sostiene las gráficas.")}<div class="table-wrap"><table><thead><tr><th>Fecha</th><th>Publicación</th><th>Likes</th><th>Colaboración</th><th>Colaborador</th><th>Tipo</th></tr></thead><tbody>${postRows}</tbody></table></div><div class="card-pad"><button class="outline-button" id="downloadPosts" type="button">Descargar CSV</button></div></article></div>`;
  barPlot("postLikesChart", publicationRows.map((post) => post.publicationLabel), publicationRows.map((post) => Number(post.likes || 0)), COLORS.coral, "Likes reportados por publicación", { margin: { l: 55, r: 20, t: 55, b: 90 }, xaxis: { tickangle: -35 }, customdata: publicationRows.map((post) => safeUrl(post.url)), hovertemplate: "<b>%{x}</b><br>%{y:,} likes<br><a href='%{customdata}' target='_blank'>Abrir publicación</a><extra></extra>" });
  byId("postLikesChart")?.on?.("plotly_click", (event) => { const url = event.points?.[0]?.customdata; if (url && url !== "#") window.open(url, "_blank", "noopener,noreferrer"); });
  linePlot("postLikesTimeline", monthly.map((item) => formatMonth(item.period)), [{ name: "Likes", values: monthly.map((item) => Number(item.likes || 0)), color: COLORS.coral }], "Likes por mes");
  linePlot("postFrequencyChart", monthly.map((item) => formatMonth(item.period)), [{ name: "Publicaciones", values: monthly.map((item) => Number(item.posts || 0)), color: COLORS.blue }], "Publicaciones por mes");
  const histogram = list(stats.histogram); barPlot("likesHistogram", histogram.map(rangeLabel), histogram.map((item) => Number(item.count || 0)), COLORS.purple, "Publicaciones por intervalo de likes", { showlegend: false, xaxis: { tickangle: -30, automargin: true }, margin: { l: 55, r: 20, t: 55, b: 90 } });
  boxPlot("likesBox", withLikes.map((post) => Number(post.likes || 0)), "Distribución de likes");
  boxGroupsPlot("postCollaborationChart", [
    { label: "No colaborativas", values: posts.filter((post) => !post.collaboration).map((post) => Number(post.likes)).filter(Number.isFinite), color: COLORS.blue },
    { label: "Colaborativas", values: posts.filter((post) => post.collaboration).map((post) => Number(post.likes)).filter(Number.isFinite), color: COLORS.green },
  ], "Likes por grupo de publicación");
  byId("downloadPosts")?.addEventListener("click", () => downloadPosts(posts));
}

function renderAudience(data) {
  const audience = list(data.audience); const concentration = data.concentration || {}; const recurrence = list(data.recurrence?.categories);
  const top = audience.slice().sort((a, b) => Number(b.interactions || 0) - Number(a.interactions || 0)).slice(0, 18);
  const rows = audience.slice().sort((a, b) => Number(b.interactions || 0) - Number(a.interactions || 0)).map((item) => `<tr><td>@${escapeHtml(item.username)}<br><small>${escapeHtml(item.full_name || "")}</small></td><td class="numeric">${formatNumber(item.interactions)}</td><td class="numeric">${formatNumber(item.publications_with_interaction)}</td><td>${escapeHtml(item.recurrence || "—")}</td></tr>`).join("");
  const groups = list(concentration.top_groups);
  const lorenz = list(concentration.lorenz);
  byId("pageContent").innerHTML = `<div class="grid">${metricCards([["Cuentas observadas", formatNumber(audience.length), "identidades disponibles"], ["Interacciones", formatCompact(concentration.total_interactions), "eventos identificados"], ["Top 10", concentration.top_10?.share == null ? "—" : formatPercent(concentration.top_10.share), "de las interacciones observadas"], ["Gini", concentration.gini == null ? "—" : Number(concentration.gini).toFixed(3), "concentración observada"], ["Persistencia", formatNumber(recurrence.find((item) => item.label === "Persistente")?.accounts), "cuentas en categoría persistente"]])}<div class="grid wide"><article class="card">${cardHead("Mapa de audiencia", "La cuenta analizada está al centro; el tamaño sigue la frecuencia identificada.", "Plotly") }<div id="audienceNetwork" class="chart tall"></div>${explanation("Cuentas con una interacción identificable alrededor de la cuenta principal.", "Permite observar repetición y vecindad dentro de la red.", "No demuestra amistad, influencia ni audiencia total.")}</article><article class="card">${cardHead("Cuentas con más señales", "Ordenadas por interacciones identificadas.")}<div id="audienceTop" class="chart tall"></div></article></div><div class="grid two"><article class="card">${cardHead("Concentración", "Participación acumulada de los grupos más grandes.")}<div id="audienceConcentration" class="chart short"></div></article><article class="card">${cardHead("Curva de Lorenz", "La diagonal representa un reparto uniforme.")}<div id="audienceLorenz" class="chart short"></div></article></div><div class="grid two"><article class="card">${cardHead("Recurrencia", "Frecuencia y ventana temporal observadas.")}<div id="audienceRecurrence" class="chart short"></div></article><article class="card">${cardHead("Mapa publicación × cuenta", "Cada celda resume interacciones identificadas.")}<div id="audienceHeatmap" class="chart tall"></div></article></div><article class="card">${cardHead("Cuentas que interactúan", "La tabla es una muestra de identidades, no un censo de seguidores.")}<div class="table-wrap"><table><thead><tr><th>Cuenta</th><th>Interacciones</th><th>Publicaciones</th><th>Recurrencia</th></tr></thead><tbody>${rows || `<tr><td colspan="4" class="empty">No hay identidades de audiencia.</td></tr>`}</tbody></table></div></article></div>`;
  networkPlot("audienceNetwork", data.networks?.interaction, "interaction");
  barPlot("audienceTop", top.map((item) => `@${compactLabel(item.username, 16)}`), top.map((item) => Number(item.interactions || 0)), COLORS.blue, "Interacciones por cuenta", { margin: { l: 55, r: 20, t: 55, b: 110 }, xaxis: { tickangle: -45 } });
  barPlot("audienceConcentration", groups.map((item) => `Top ${item.size}`), groups.map((item) => Number(item.share || 0) * 100), COLORS.amber, "Participación observada (%)", { showlegend: false });
  linePlot("audienceLorenz", lorenz.map((item) => formatPercent(item.x)), [{ name: "Lorenz", values: lorenz.map((item) => Number(item.y || 0) * 100), color: COLORS.coral }], "Curva de Lorenz (%)", { yaxis: { title: "% de interacciones" } });
  barPlot("audienceRecurrence", recurrence.map((item) => item.label), recurrence.map((item) => Number(item.accounts || 0)), COLORS.green, "Cuentas por recurrencia", { showlegend: false });
  heatmapPlot("audienceHeatmap", data.audience_matrix);
}

function renderCollaborations(data) {
  const collaborations = data.collaborations || {}; const comparison = data.collaboration_comparison || {}; const collaborators = list(collaborations.collaborators).slice(0, 18); const monthly = list(collaborations.by_month);
  const overlap = data.networks?.comparison || {}; const union = [...new Set([...list(data.audience).map((item) => item.username), ...list(collaborations.collaborators).map((item) => item.username)])];
  const relationshipMap = new Map(list(data.relationships).map((item) => [item.username, item]));
  const rows = union.map((username) => { const item = relationshipMap.get(username) || { username, interactions: 0, collaborations: 0 }; return `<tr><td>@${escapeHtml(username)}</td><td class="numeric">${formatNumber(item.interactions)}</td><td class="numeric">${formatNumber(item.collaborations)}</td><td>${item.interactions && item.collaborations ? "Ambas" : item.interactions ? "Interacción" : "Colaboración"}</td></tr>`; }).join("");
  byId("pageContent").innerHTML = `<div class="grid">${metricCards([["Posts colaborativas", formatNumber(collaborations.posts), "en el alcance"], ["Cuentas colaboradoras", formatNumber(collaborations.unique_collaborators), "identificadas"], ["Total de colaboraciones", formatNumber(collaborations.total), "registros por cuenta y post"], ["Media colaborativa", formatCompact(comparison.collaborative?.mean_likes), "likes promedio"], ["Diferencia relativa", comparison.difference?.relative_mean_difference == null ? "—" : formatPercent(comparison.difference.relative_mean_difference), "comparación descriptiva"]])}<div class="grid two"><article class="card">${cardHead("Cuentas colaboradoras", "Top por número de colaboraciones registradas.")}<div id="collaboratorChart" class="chart tall"></div></article><article class="card">${cardHead("Evolución mensual", "Colaboraciones distintas por mes.")}<div id="collaborationTimeline" class="chart tall"></div></article></div><article class="card">${cardHead("Comparación de grupos", "Se muestra el tamaño de cada grupo para no ocultar sus diferencias.")}<div id="collaborationComparison" class="chart short"></div>${explanation("Promedios de likes en publicaciones colaborativas y no colaborativas.", comparison.difference?.interpretation || "La diferencia es descriptiva.", "No demuestra que colaborar cause más likes.")}</article><article class="card">${cardHead("Interacción y colaboración", "Una cuenta puede aparecer en ambas redes o sólo en una.")}<div class="table-wrap"><table><thead><tr><th>Cuenta</th><th>Interacciones</th><th>Colaboraciones</th><th>Presencia</th></tr></thead><tbody>${rows || `<tr><td colspan="4" class="empty">No hay cuentas para comparar.</td></tr>`}</tbody></table></div></article></div>`;
  barPlot("collaboratorChart", collaborators.map((item) => `@${compactLabel(item.username, 16)}`), collaborators.map((item) => Number(item.collaborations || 0)), COLORS.green, "Colaboraciones por cuenta", { margin: { l: 55, r: 20, t: 55, b: 110 }, xaxis: { tickangle: -45 } });
  linePlot("collaborationTimeline", monthly.map((item) => formatMonth(item.month)), [{ name: "Colaboraciones", values: monthly.map((item) => Number(item.collaborations || 0)), color: COLORS.green }], "Colaboraciones por mes");
  const groupLabels = ["Colaborativas", "No colaborativas"]; const groupValues = [Number(comparison.collaborative?.mean_likes || 0), Number(comparison.non_collaborative?.mean_likes || 0)];
  barPlot("collaborationComparison", groupLabels, groupValues, COLORS.green, "Likes promedio por grupo", { showlegend: false });
}

function renderNetworks(data) {
  const networks = data.networks || {}; const selected = networks[state.network] || networks.interaction || {}; const comparison = networks.comparison || {}; const bridges = list(networks.co_occurrence?.bridge_accounts);
  const options = [["interaction", "Interacción"], ["collaboration", "Colaboración"], ["co_occurrence", "Coincidencia"]].filter(([key]) => list(networks[key]?.nodes).length);
  byId("pageContent").innerHTML = `<div class="grid"><div class="grid two"><article class="card card-pad"><label for="networkSelect"><strong>Tipo de red</strong></label><select id="networkSelect" class="control-input">${options.map(([key, label]) => `<option value="${key}" ${key === state.network ? "selected" : ""}>${label}</option>`).join("")}</select><p class="chart-note">Selecciona una red para cambiar la lectura. El tamaño de los nodos es frecuencia observada.</p></article><article class="card card-pad"><h2>Resumen de estructura</h2><p class="narrative-text">Nodos: <strong>${formatNumber(selected.summary?.nodes)}</strong> · Vínculos: <strong>${formatNumber(selected.summary?.edges)}</strong> · Componentes: <strong>${formatNumber(selected.summary?.connected_components)}</strong></p><p class="chart-note">Una red describe conexiones del archivo, no una jerarquía social.</p></article></div><article class="card">${cardHead("Mapa de red", "Las aristas tienen el significado específico del tipo elegido.", "Plotly") }<div id="networkChart" class="chart tall"></div>${explanation("Nodos y vínculos de la red seleccionada.", "Permite observar centralidad, comunidades y puentes dentro de la estructura.", "La coincidencia en una publicación no prueba conversación directa.")}</article><div class="grid two"><article class="card">${cardHead("Comparación de redes") }<div id="networkComparison" class="chart short"></div></article><article class="card">${cardHead("Cuentas puente", "Posiciones con mayor conectividad en la red de coincidencia.")}<div class="table-wrap"><table><thead><tr><th>Cuenta</th><th>Grado</th><th>Intermediación</th></tr></thead><tbody>${bridges.slice(0, 20).map((item) => `<tr><td>@${escapeHtml(item.username)}</td><td class="numeric">${formatNumber(item.degree)}</td><td class="numeric">${Number(item.betweenness || 0).toFixed(2)}</td></tr>`).join("") || `<tr><td colspan="3" class="empty">No hay puentes identificados.</td></tr>`}</tbody></table></div></article></div><article class="card card-pad"><h2>Comunidades de la red</h2><p class="narrative-text">${list(selected.communities).length ? `Se observan ${list(selected.communities).length} componentes. Son conjuntos de cuentas con más vínculos entre sí que con el resto; no son grupos sociales demostrados.` : "No hay suficientes vínculos para separar comunidades."}</p></article></div>`;
  networkPlot("networkChart", selected, state.network);
  const comparisonRows = [{ label: "Ambas", value: list(comparison.both).length }, { label: "Sólo interacción", value: list(comparison.interaction_only).length }, { label: "Sólo colaboración", value: list(comparison.collaboration_only).length }];
  barPlot("networkComparison", comparisonRows.map((item) => item.label), comparisonRows.map((item) => item.value), COLORS.purple, "Cuentas por tipo de presencia", { showlegend: false });
  byId("networkSelect")?.addEventListener("change", (event) => { state.network = event.target.value; renderNetworks(state.data); });
}

function renderEvolution(data) {
  const monthly = list(data.temporal?.monthly);
  const audience = monthly.map((item) => ({ ...item, active_count: list(item.active_accounts).length, new_count: list(item.new_accounts).length, inactive_count: list(item.inactive_accounts).length }));
  byId("pageContent").innerHTML = `<div class="grid"><div class="grid two"><article class="card">${cardHead("Actividad de la cuenta", "Publicaciones, comentarios y colaboraciones; los likes se muestran aparte para no mezclar escalas.")}${`<div class="legend"><span><i style="background:${COLORS.blue}"></i>Publicaciones</span><span><i style="background:${COLORS.amber}"></i>Comentarios</span><span><i style="background:${COLORS.green}"></i>Colaboraciones</span></div>`}<div id="evolutionActivityChart" class="chart tall"></div>${explanation("Actividad editorial y colaborativa por mes.", "Permite ver cambios de ritmo sin que los likes oculten las demás señales.", "No demuestra que una señal cause otra.")}</article><article class="card">${cardHead("Likes por mes", "Los likes tienen una escala y una tarjeta separadas.")}${`<div class="legend"><span><i style="background:${COLORS.coral}"></i>Likes agregados</span></div>`}<div id="evolutionLikesChart" class="chart tall"></div>${explanation("Suma mensual de likes reportados.", "Permite comparar la respuesta observada con el ritmo de publicación.", "Los likes agregados no identifican a las personas que interactuaron.")}</article></div><article class="card">${cardHead("Historia de la audiencia observada", "Cuentas activas, nuevas y no observadas en cada mes.")}${`<div class="legend"><span><i style="background:${COLORS.blue}"></i>Activas</span><span><i style="background:${COLORS.coral}"></i>Nuevas</span><span><i style="background:${COLORS.gray}"></i>No observadas</span></div>`}<div id="audienceEvolutionChart" class="chart tall"></div>${explanation("La serie de cuentas con interacción identificada.", "Permite ver entradas y cambios de presencia.", "No significa que una cuenta haya dejado de existir.")}</article><article class="card card-pad"><h2>Cómo leer el tiempo</h2><p class="narrative-text">El primer y último mes dependen de la descarga. Un pico de likes puede reflejar una publicación, una fecha, una colaboración o una forma de captura distinta. Para comparar, revise primero la página de Publicaciones y el contenido de cada periodo.</p></article></div>`;
  const labels = monthly.map((item) => formatMonth(item.period));
  linePlot("evolutionActivityChart", labels, [{ name: "Publicaciones", values: monthly.map((item) => Number(item.posts || 0)), color: COLORS.blue }, { name: "Comentarios", values: monthly.map((item) => Number(item.reported_comments || 0)), color: COLORS.amber }, { name: "Colaboraciones", values: monthly.map((item) => Number(item.collaborations || 0)), color: COLORS.green }], "Actividad mensual");
  linePlot("evolutionLikesChart", labels, [{ name: "Likes", values: monthly.map((item) => Number(item.likes || 0)), color: COLORS.coral }], "Likes por mes");
  linePlot("audienceEvolutionChart", labels, [{ name: "Activas", values: audience.map((item) => item.active_count), color: COLORS.blue }, { name: "Nuevas", values: audience.map((item) => item.new_count), color: COLORS.coral }, { name: "No observadas", values: audience.map((item) => item.inactive_count), color: COLORS.gray }], "Cuentas observadas por mes");
}

function renderFindings(data) {
  const findings = list(data.findings); const correlations = list(data.correlations); const narrative = data.profile_narrative || fallbackNarrative(data);
  const questions = [...list(narrative.questions), ...list(data.open_questions)];
  byId("pageContent").innerHTML = `<div class="grid">${renderNarrative(data)}<article class="card card-pad"><div class="callout warning"><strong>Cómo leer este retrato.</strong> La descripción profunda habla del comportamiento visible de la cuenta en los archivos. No diagnostica personalidad, intención, valores ni vida privada; cada dimensión conserva su evidencia y su cautela.</div></article><div class="grid two">${findings.map((finding, index) => `<article class="card card-pad"><span class="tag">Hallazgo ${String(index + 1).padStart(2, "0")}</span><h2>${escapeHtml(finding.title)}</h2><p class="narrative-text">${escapeHtml(finding.evidence)}</p><p class="chart-note"><strong>Visualización:</strong> ${escapeHtml(finding.visualization)}</p><p class="chart-note"><strong>Precaución:</strong> ${escapeHtml(finding.caution)}</p></article>`).join("")}</div>${correlations.length ? `<article class="card">${cardHead("Asociaciones estadísticas", "Correlaciones descriptivas; no son modelos causales.")}<div class="table-wrap"><table><thead><tr><th>Relación</th><th>n</th><th>Pearson</th><th>Spearman</th><th>Lectura</th></tr></thead><tbody>${correlations.map((item) => `<tr><td>${escapeHtml(item.label)}</td><td class="numeric">${formatNumber(item.n)}</td><td class="numeric">${item.pearson ?? "—"}</td><td class="numeric">${item.spearman ?? "—"}</td><td>${escapeHtml(item.interpretation || item.strength || "—")}</td></tr>`).join("")}</tbody></table></div></article>` : ""}<div class="grid two"><article class="card card-pad"><h2>Preguntas para investigar</h2><ul>${questions.map((question) => `<li>${escapeHtml(question)}</li>`).join("")}</ul></article><article class="card card-pad"><h2>Límites que deben viajar con el informe</h2><ul>${list(narrative.limits).concat(list(data.limitations)).map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul></article></div></div>`;
}

function renderPage() {
  renderShell();
  if (!state.data) return;
  renderHeader();
  ({ resumen: renderResumen, datos: renderDatos, publicaciones: renderPublicaciones, audiencia: renderAudience, colaboraciones: renderCollaborations, redes: renderNetworks, evolucion: renderEvolution, hallazgos: renderFindings }[state.page] || renderResumen)(state.data);
}
async function loadData() {
  setLoading("Calculando el informe y preparando las gráficas…");
  const query = new URLSearchParams({ scope: state.scope });
  if (state.main) query.set("main", state.main);
  try {
    state.data = await apiJson(`/api/analysis?${query.toString()}`);
    state.main = state.data.main?.username || state.main;
    renderPage();
  } catch (error) {
    if (String(error.message).includes("Todavía no hay")) { showNoData(); return; }
    setStatus(`<strong>No se pudo cargar el informe.</strong> ${escapeHtml(error.message)}`, "error");
    setLoading("No se pudo calcular el informe.");
  }
}
function downloadPosts(posts) {
  const headers = ["date", "short_code", "url", "likes", "collaboration", "collaborator", "type", "content_category"];
  const csv = [headers.join(","), ...posts.map((post) => headers.map((key) => `"${String(post[key] ?? "").replaceAll('"', '""')}"`).join(","))].join("\n");
  const link = document.createElement("a"); link.href = URL.createObjectURL(new Blob([`\ufeff${csv}`], { type: "text/csv;charset=utf-8" })); link.download = "publicaciones.csv"; link.click(); URL.revokeObjectURL(link.href);
}
function bindControls() {
  byId("mainAccount")?.addEventListener("change", (event) => { state.main = event.target.value; loadData(); });
  byId("scopeSelect")?.addEventListener("change", (event) => { state.scope = event.target.value; loadData(); });
  byId("refreshButton")?.addEventListener("click", loadData);
}
bindControls();
renderShell();
loadData();
