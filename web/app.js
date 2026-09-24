const state = {
  data: null,
  sourceStatus: null,
  network: "interaction",
  postSearch: "",
  audienceSearch: "",
  loading: false,
  toastTimer: null,
};

const $ = (id) => document.getElementById(id);
const numberFormatter = new Intl.NumberFormat("es-ES");
const compactFormatter = new Intl.NumberFormat("es-ES", { notation: "compact", maximumFractionDigits: 1 });
const percentFormatter = new Intl.NumberFormat("es-ES", { style: "percent", minimumFractionDigits: 1, maximumFractionDigits: 1 });

function formatNumber(value) {
  return numberFormatter.format(Number(value) || 0);
}

function formatCompact(value) {
  return compactFormatter.format(Number(value) || 0);
}

function formatPercent(value) {
  return percentFormatter.format(Number(value) || 0);
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>'"]/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "'": "&#39;",
    '"': "&quot;",
  })[character]);
}

function safeUrl(value) {
  try {
    const url = new URL(String(value || ""), window.location.origin);
    return ["http:", "https:"].includes(url.protocol) ? url.href : "#";
  } catch {
    return "#";
  }
}

function normalizeText(value) {
  return String(value ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase("es");
}

function formatDate(value, withTime = false) {
  if (!value) return "Sin fecha";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Sin fecha";
  return new Intl.DateTimeFormat("es-ES", withTime ? { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" } : { day: "2-digit", month: "short", year: "numeric" }).format(date).replace(/\./g, "");
}

function formatMonth(value) {
  if (!value) return "—";
  const [year, month] = String(value).split("-").map(Number);
  if (!year || !month) return value;
  return new Intl.DateTimeFormat("es-ES", { month: "short", year: "2-digit", timeZone: "UTC" }).format(new Date(Date.UTC(year, month - 1, 1))).replace(/\./g, "");
}

function showToast(message, error = false) {
  const toast = $("toast");
  clearTimeout(state.toastTimer);
  toast.textContent = message;
  toast.classList.toggle("error", error);
  toast.hidden = false;
  state.toastTimer = setTimeout(() => { toast.hidden = true; }, error ? 7000 : 3800);
}

function setLoading(value, title = "Leyendo los archivos…", text = "Preparando una copia derivada sin tocar el original.") {
  state.loading = value;
  $("loadingOverlay").hidden = !value;
  $("loadingTitle").textContent = title;
  $("loadingText").textContent = text;
}

async function parseResponse(response) {
  let payload;
  try {
    payload = await response.json();
  } catch {
    throw new Error(`El servidor respondió con el estado ${response.status}.`);
  }
  if (!response.ok) throw new Error(payload.error || `Error HTTP ${response.status}.`);
  return payload;
}

function setUploadStatus(message, type = "neutral") {
  const target = $("uploadStatus");
  target.textContent = message;
  target.classList.toggle("error", type === "error");
  target.classList.toggle("success", type === "success");
}

function showUpload() {
  $("uploadScreen").hidden = false;
  $("appShell").hidden = true;
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function showReport() {
  $("uploadScreen").hidden = true;
  $("appShell").hidden = false;
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function renderAll() {
  if (!state.data) return;
  renderHeader();
  renderKpis();
  renderDataInventory();
  renderPosts();
  renderAudience();
  renderCollaborations();
  renderNetworks();
  renderEvolution();
  renderFindings();
  renderExplanations();
  $("sourceChip").textContent = state.data.source_name || "JSON cargado";
  $("sourceChip").title = state.data.source_name || "JSON cargado";
  $("generatedAt").textContent = `Informe generado el ${formatDate(state.data.generated_at, true)}`;
}

function renderHeader() {
  const { data } = state;
  const { main, profile, scope, data_coverage: coverage } = data;
  $("accountTitle").textContent = main.full_name ? `${main.full_name} · @${main.username}` : `@${main.username}`;
  $("heroLead").textContent = `${formatNumber(profile.posts)} publicaciones entre ${formatDate(profile.date_start)} y ${formatDate(profile.date_end)}. ${formatNumber(profile.total_likes)} likes conocidos y ${formatNumber(profile.unique_audience_accounts)} cuentas con interacción identificada.`;
  $("mainAccount").value = main.username;
  $("scopeSelect").value = scope;
  $("accountSuggestions").innerHTML = (data.available_accounts || []).map((item) => `<option value="${escapeHtml(item.username)}">${formatNumber(item.posts)} publicaciones</option>`).join("");
  $("heroTags").innerHTML = [
    `<span class="soft-tag">${escapeHtml(scope === "owned" ? "Publicaciones propias" : scope === "involving" ? "Incluye colaboraciones" : "Todos los registros")}</span>`,
    `<span class="soft-tag ${coverage.likes_identities_available ? "tag-good" : "tag-warn"}">${coverage.likes_identities_available ? "Likes con identidad disponible" : "Likes sin identidad disponible"}</span>`,
    `<span class="soft-tag">Sin sobrescribir originales</span>`,
  ].join("");
  $("coverageText").textContent = coverage.likes_identities_available
    ? `El archivo permite identificar ${formatNumber(coverage.liker_records)} registros de likes y ${formatNumber(coverage.comment_records)} comentarios. Aun así, la cobertura puede ser parcial.`
    : `Los ${formatNumber(profile.total_likes)} likes son una cifra agregada: el archivo no identifica qué cuentas los dieron. La audiencia de este informe usa ${formatNumber(coverage.comment_records)} comentarios identificados.`;
  $("coverageBanner").classList.toggle("has-warning", !coverage.likes_identities_available);
}

function renderKpis() {
  const { profile, collaborations, recurrence, audience } = state.data;
  const cards = [
    ["Publicaciones", profile.posts, "en el alcance seleccionado", "▦", "coral"],
    ["Likes registrados", profile.total_likes, `${formatNumber(profile.likes_known)} publicaciones con dato; ${formatNumber(profile.likes_missing)} sin dato`, "♡", "blue"],
    ["Cuentas con interacción", profile.unique_audience_accounts, "sólo identidades disponibles", "◎", "green"],
    ["Colaboraciones", collaborations.total, `${formatNumber(collaborations.unique_collaborators)} cuentas diferentes`, "↔", "purple"],
    ["Periodo", profile.date_start ? formatDate(profile.date_start) : "Sin fecha", profile.date_end ? `hasta ${formatDate(profile.date_end)}` : "sin fecha disponible", "◷", "amber"],
  ];
  $("kpiGrid").innerHTML = cards.map(([label, value, note, icon, color]) => `<article class="kpi-card accent-${color}"><div class="kpi-top"><span>${escapeHtml(label)}</span><i aria-hidden="true">${escapeHtml(icon)}</i></div><strong>${escapeHtml(value)}</strong><small>${escapeHtml(note)}</small></article>`).join("");
  $("audienceSummary").innerHTML = [
    ["Cuentas identificadas", formatNumber(audience.length), "Cuentas con likes o comentarios atribuibles"],
    ["Interacciones observadas", formatNumber(state.data.concentration.total_interactions), "Eventos identificados, no likes agregados"],
    ["Persistencia", formatNumber(recurrence.categories.find((item) => item.label === "Persistente")?.accounts || 0), "Cuentas con una ventana temporal amplia"],
    ["Top 10", state.data.concentration.top_10?.share == null ? "—" : formatPercent(state.data.concentration.top_10.share), "Parte de las interacciones identificadas"],
    ["Seguidores", formatNumber(state.data.followers?.unique_accounts || 0), state.data.followers?.available ? "Cuentas en una lista de seguidores" : "No hay lista de seguidores"],
    ["Seguidores que interactúan", formatNumber(state.data.followers?.interacting_accounts || 0), "Sólo si el registro lo indica"],
  ].map(([label, value, note]) => `<div class="mini-stat"><span>${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong><small>${escapeHtml(note)}</small></div>`).join("");
}

function renderDataInventory() {
  const inventory = state.data.data_inventory || { files: [], cross_file_links: [] };
  const coverage = state.data.data_coverage;
  $("dataSummary").innerHTML = `
    <div class="summary-intro"><span class="summary-icon">⌘</span><div><h3>Lectura de la fuente</h3><p>La aplicación exploró la estructura antes de calcular. Los campos que no aparecen no se estiman.</p></div></div>
    <div class="coverage-pills"><span><b>${formatNumber(inventory.post_count || 0)}</b> registros de publicación</span><span><b>${formatNumber(coverage.comment_records)}</b> comentarios identificados</span><span><b>${formatNumber(coverage.liker_records)}</b> likes identificados</span><span><b>${formatNumber(coverage.follower_records)}</b> registros de seguidores</span></div>`;
  $("inventoryGrid").innerHTML = (inventory.files || []).map((file) => {
    const fields = file.available_fields || [];
    const details = new Map((file.field_details || []).map((field) => [field.path, field.description || "Campo disponible en la fuente"]));
    const shown = fields.slice(0, 18);
    return `<article class="inventory-card panel"><div class="inventory-card-head"><div><span class="file-icon">${file.post_records ? "▦" : "◇"}</span><div><h3>${escapeHtml(file.name)}</h3><p>${escapeHtml(file.inferred_role)}</p></div></div><span class="file-count">${formatNumber(file.post_records)} publicaciones</span></div><p class="inventory-note">${formatNumber(file.field_count)} campos detectados. ${file.like_events ? `${formatNumber(file.like_events)} eventos de like. ` : ""}${file.comment_events ? `${formatNumber(file.comment_events)} comentarios. ` : ""}${file.follower_records ? `${formatNumber(file.follower_records)} seguidores.` : ""}</p><div class="field-list">${shown.map((field) => { const path = typeof field === "string" ? field : field.path; return `<span title="${escapeHtml(details.get(path) || "Campo disponible en la fuente")}">${escapeHtml(path.split(".").slice(-1)[0])}</span>`; }).join("")}${fields.length > shown.length ? `<span class="field-more">+${fields.length - shown.length}</span>` : ""}</div></article>`;
  }).join("");
  if (!(inventory.files || []).length) $("inventoryGrid").innerHTML = '<div class="empty-state panel">No se detectaron archivos para describir.</div>';
  const dictionary = new Map();
  (inventory.files || []).forEach((file) => {
    const details = new Map((file.field_details || []).map((field) => [field.path, field.description || "Campo disponible en la fuente"]));
    (file.available_fields || []).forEach((field) => { const path = typeof field === "string" ? field : field.path; dictionary.set(path, details.get(path) || (typeof field === "string" ? "Campo disponible en la fuente" : field.description || "Campo disponible en la fuente")); });
  });
  const preferred = ["id", "shortCode", "ownerUsername", "timestamp", "likesCount", "commentsCount", "latestComments", "likers", "likedBy", "mentions", "taggedUsers", "coauthorProducers", "followers"];
  const orderedFields = [...dictionary.keys()].sort((a, b) => { const ai = preferred.indexOf(a.split(".").at(-1)); const bi = preferred.indexOf(b.split(".").at(-1)); return (ai < 0 ? 99 : ai) - (bi < 0 ? 99 : bi) || a.localeCompare(b); }).slice(0, 18);
  $("dataDictionary").innerHTML = `<div class="dictionary-heading"><div><p class="section-kicker">Diccionario</p><h3>Variables disponibles, en lenguaje sencillo</h3></div><span>${formatNumber(dictionary.size)} campos detectados</span></div><div class="dictionary-grid">${orderedFields.map((field) => `<div><strong>${escapeHtml(field.split(".").at(-1))}</strong><span>${escapeHtml(dictionary.get(field))}</span></div>`).join("")}</div>`;
}

function renderPosts() {
  const all = state.data.post_table || [];
  const query = normalizeText(state.postSearch);
  const filtered = all.filter((post) => !query || normalizeText(`${post.publication} ${post.collaborator} ${post.type} ${post.short_code}`).includes(query));
  const body = $("postsBody");
  if (!filtered.length) {
    body.innerHTML = '<tr><td colspan="6" class="empty-cell">No hay publicaciones que coincidan.</td></tr>';
  } else {
    body.innerHTML = filtered.map((post) => `<tr><td class="date-cell">${escapeHtml(formatDate(post.date))}</td><td><a class="publication-link" href="${escapeHtml(safeUrl(post.url))}" target="_blank" rel="noopener noreferrer">${escapeHtml(post.publication || post.short_code)}</a><small>${escapeHtml(post.short_code)}</small></td><td class="numeric">${post.likes == null ? '<span class="missing-value">Sin dato</span>' : formatNumber(post.likes)}</td><td>${post.collaboration ? '<span class="table-pill positive">Sí</span>' : '<span class="muted-value">No</span>'}</td><td>${escapeHtml(post.collaborator || "—")}</td><td><span class="table-pill">${escapeHtml(post.type || "—")}</span></td></tr>`).join("");
  }
  $("postsFooter").textContent = `Mostrando ${formatNumber(filtered.length)} de ${formatNumber(all.length)} publicaciones.`;
  $("postChartChip").textContent = `${formatNumber(state.data.likes_distribution.stats.count || 0)} con likes`;
  const distributionStats = state.data.likes_distribution?.stats || {};
  $("percentileStrip").innerHTML = [
    ["P25", distributionStats.p25], ["Mediana", distributionStats.median], ["P75", distributionStats.p75], ["P90", distributionStats.p90], ["P95", distributionStats.p95],
  ].map(([label, value]) => `<span><b>${escapeHtml(label)}</b><strong>${value == null ? "—" : formatNumber(value)}</strong></span>`).join("");
  renderLikesByPost(all);
  renderLikesHistogram();
  renderBoxplot();
  renderPostFrequency();
  renderLikesTimeline();
  renderPerformance();
  renderExceptions();
  renderContentTypes();
}

function chartSvg({ width = 760, height = 260, label = "Gráfica", children = "" }) {
  return `<svg viewBox="0 0 ${width} ${height}" role="img" aria-label="${escapeHtml(label)}">${children}</svg>`;
}

function gridLines(width, height, padding, maxValue, formatter = formatCompact) {
  return Array.from({ length: 5 }, (_, index) => {
    const value = (maxValue / 4) * index;
    const y = padding.top + (height - padding.top - padding.bottom) - (value / (maxValue || 1)) * (height - padding.top - padding.bottom);
    return `<line x1="${padding.left}" y1="${y}" x2="${width - padding.right}" y2="${y}" class="chart-grid"/><text x="${padding.left - 8}" y="${y + 4}" text-anchor="end" class="axis-label">${escapeHtml(formatter(value))}</text>`;
  }).join("");
}

function verticalBars(items, valueKey, options = {}) {
  const width = options.width || 760;
  const height = options.height || 260;
  const padding = { top: 18, right: 15, bottom: 48, left: 52 };
  if (!items.length) return '<div class="chart-empty">Sin datos para esta vista.</div>';
  const values = items.map((item) => Number(item[valueKey]) || 0);
  const maxValue = Math.max(...values, 1);
  const plotWidth = width - padding.left - padding.right;
  const plotHeight = height - padding.top - padding.bottom;
  const slot = plotWidth / items.length;
  const barWidth = Math.max(2, Math.min(38, slot * (options.barRatio || 0.64)));
  const every = Math.max(1, Math.ceil(items.length / (options.maxLabels || 8)));
  const bars = items.map((item, index) => {
    const value = Number(item[valueKey]) || 0;
    const barHeight = value ? (value / maxValue) * plotHeight : 2;
    const x = padding.left + index * slot + (slot - barWidth) / 2;
    const y = padding.top + plotHeight - barHeight;
    const showLabel = index % every === 0 || index === items.length - 1;
    return `<g class="bar-group"><title>${escapeHtml(item.label || item.period || item.short_code || "")}: ${escapeHtml(formatNumber(value))}</title><rect x="${x}" y="${y}" width="${barWidth}" height="${barHeight}" rx="${Math.min(5, barWidth / 2)}" fill="${options.color || "#ef5f57"}"></rect>${showLabel ? `<text x="${x + barWidth / 2}" y="${height - 18}" text-anchor="middle" class="axis-label">${escapeHtml(item.shortLabel || item.label || formatMonth(item.period))}</text>` : ""}</g>`;
  }).join("");
  return chartSvg({ width, height, label: options.label, children: `${gridLines(width, height, padding, maxValue, options.axisFormat || formatCompact)}<line x1="${padding.left}" y1="${padding.top + plotHeight}" x2="${width - padding.right}" y2="${padding.top + plotHeight}" class="chart-axis"/>${bars}` });
}

function lineChart(items, series, options = {}) {
  const width = options.width || 760;
  const height = options.height || 280;
  const padding = { top: 20, right: 18, bottom: 50, left: 56 };
  if (!items.length) return '<div class="chart-empty">No hay fechas válidas para esta serie.</div>';
  const allValues = series.flatMap((item) => items.map((row) => Number(row[item.key]) || 0));
  const maxValue = Math.max(...allValues, 1);
  const plotWidth = width - padding.left - padding.right;
  const plotHeight = height - padding.top - padding.bottom;
  const xAt = (index) => padding.left + (items.length === 1 ? plotWidth / 2 : (index / (items.length - 1)) * plotWidth);
  const yAt = (value) => padding.top + plotHeight - (Number(value || 0) / maxValue) * plotHeight;
  const every = Math.max(1, Math.ceil(items.length / (options.maxLabels || 8)));
  const paths = series.map((item) => {
    const points = items.map((row, index) => `${xAt(index)},${yAt(row[item.key])}`).join(" ");
    return `<polyline points="${points}" fill="none" stroke="${item.color}" stroke-width="${item.width || 3}" stroke-linecap="round" stroke-linejoin="round" class="line-series"/>`;
  }).join("");
  const labels = items.map((item, index) => (index % every === 0 || index === items.length - 1) ? `<text x="${xAt(index)}" y="${height - 18}" text-anchor="middle" class="axis-label">${escapeHtml(formatMonth(item.period))}</text>` : "").join("");
  return chartSvg({ width, height, label: options.label, children: `${gridLines(width, height, padding, maxValue, options.axisFormat || formatCompact)}${paths}${labels}` });
}

function scatterPerformance(posts) {
  const items = posts.filter((post) => post.likes != null).sort((a, b) => String(a.date || "").localeCompare(String(b.date || "")));
  if (!items.length) return '<div class="chart-empty">No hay publicaciones con likes para comparar.</div>';
  const width = 760, height = 240, padding = { top: 20, right: 22, bottom: 43, left: 57 };
  const max = Math.max(...items.map((item) => Number(item.likes) || 0), 1);
  const plotWidth = width - padding.left - padding.right, plotHeight = height - padding.top - padding.bottom;
  const xAt = (index) => padding.left + (items.length === 1 ? plotWidth / 2 : (index / (items.length - 1)) * plotWidth);
  const yAt = (value) => padding.top + plotHeight - (Number(value || 0) / max) * plotHeight;
  const dots = items.map((item, index) => `<circle cx="${xAt(index)}" cy="${yAt(item.likes)}" r="${item.collaboration ? 6 : 4.5}" class="performance-dot${item.collaboration ? " collaborative" : ""}"><title>${escapeHtml(item.short_code)} · ${formatNumber(item.likes)} likes${item.collaboration ? " · colaboración" : ""}</title></circle>`).join("");
  return chartSvg({ width, height, label: "Publicaciones frente a likes", children: `${gridLines(width, height, padding, max, formatCompact)}${dots}<line x1="${padding.left}" y1="${padding.top + plotHeight}" x2="${width - padding.right}" y2="${padding.top + plotHeight}" class="chart-axis"/><text x="${padding.left}" y="${height - 15}" class="axis-label">más antiguo</text><text x="${width - padding.right}" y="${height - 15}" text-anchor="end" class="axis-label">más reciente</text>` });
}

function renderPerformance() {
  $("performanceChart").innerHTML = scatterPerformance(state.data.post_table || []);
}

function renderLikesByPost(posts) {
  const items = posts.filter((post) => post.likes != null).sort((a, b) => (a.date || "").localeCompare(b.date || "")).map((post, index) => ({ ...post, shortLabel: String(index + 1), label: post.short_code }));
  $("likesByPostChart").innerHTML = verticalBars(items, "likes", { height: 300, maxLabels: 12, color: "#ef5f57", label: "Likes por publicación" });
}

function renderLikesTimeline() {
  const items = state.data.temporal.monthly || [];
  $("likesTimelineChart").innerHTML = lineChart(items, [{ key: "likes", color: "#ef5f57" }], { label: "Evolución de likes", height: 260 });
}

function renderPostFrequency() {
  const items = state.data.temporal.monthly || [];
  $("postingFrequencyChart").innerHTML = verticalBars(items, "posts", { height: 230, maxLabels: 8, color: "#3b6ef5", label: "Frecuencia de publicaciones" });
}

function renderLikesHistogram() {
  const histogram = state.data.likes_distribution?.histogram || [];
  $("likesHistogramChart").innerHTML = verticalBars(histogram.map((item) => ({ ...item, label: item.label, shortLabel: item.label })), "count", { height: 230, maxLabels: 8, color: "#7c5ce0", label: "Histograma de likes", barRatio: 0.72 });
}

function renderBoxplot() {
  const box = state.data.likes_distribution?.boxplot;
  if (!box || box.median == null) { $("likesBoxplot").innerHTML = '<div class="chart-empty">No hay likes con dato para dibujar la caja.</div>'; return; }
  const width = 520, height = 220, left = 48, right = 28, top = 35, bottom = 48;
  const min = Number(box.min), max = Number(box.max);
  const x = (value) => left + ((value - min) / (max - min || 1)) * (width - left - right);
  const y = (height - top - bottom) / 2 + top;
  const outliers = (box.outliers || []).map((value) => `<circle cx="${x(value)}" cy="${y}" r="4" class="outlier-dot"><title>${escapeHtml(formatNumber(value))} likes</title></circle>`).join("");
  $("likesBoxplot").innerHTML = chartSvg({ width, height, label: "Boxplot de likes", children: `<line x1="${left}" y1="${y}" x2="${width - right}" y2="${y}" class="box-axis"/><line x1="${x(box.lower_whisker)}" y1="${y}" x2="${x(box.q1)}" y2="${y}" class="box-whisker"/><line x1="${x(box.q3)}" y1="${y}" x2="${x(box.upper_whisker)}" y2="${y}" class="box-whisker"/><line x1="${x(box.lower_whisker)}" y1="${y - 20}" x2="${x(box.lower_whisker)}" y2="${y + 20}" class="box-cap"/><line x1="${x(box.upper_whisker)}" y1="${y - 20}" x2="${x(box.upper_whisker)}" y2="${y + 20}" class="box-cap"/><rect x="${x(box.q1)}" y="${y - 28}" width="${Math.max(2, x(box.q3) - x(box.q1))}" height="56" rx="7" class="box-fill"/><line x1="${x(box.median)}" y1="${y - 28}" x2="${x(box.median)}" y2="${y + 28}" class="box-median"/><text x="${x(box.q1)}" y="${height - 16}" text-anchor="middle" class="axis-label">Q1</text><text x="${x(box.median)}" y="${height - 16}" text-anchor="middle" class="axis-label">Mediana</text><text x="${x(box.q3)}" y="${height - 16}" text-anchor="middle" class="axis-label">Q3</text>${outliers}` });
}

function renderExceptions() {
  const exceptions = state.data.exceptions || [];
  $("exceptionsGrid").innerHTML = exceptions.length ? exceptions.map((post) => `<article class="exception-card"><div class="exception-top"><span class="exception-star">✦</span><div><strong>${formatNumber(post.likes)} likes</strong><span>${escapeHtml(formatDate(post.date))}</span></div><span class="table-pill ${post.collaboration ? "positive" : ""}">${post.collaboration ? "Colaborativa" : "Sin colaboración"}</span></div><p>${escapeHtml(post.content_category || post.type || "Publicación")} · ${escapeHtml(post.short_code)}</p><small>${escapeHtml((post.reasons || []).join("; "))}</small><a href="${escapeHtml(safeUrl(post.url))}" target="_blank" rel="noopener noreferrer">Ver publicación ↗</a></article>`).join("") : '<div class="empty-state panel">No se identificaron valores atípicos con los datos disponibles.</div>';
}

function renderContentTypes() {
  const container = $("contentTypes");
  if (!container) return;
  const types = state.data.content_types || [];
  container.innerHTML = `<div class="chart-area small">${verticalBars(types.map((item) => ({ ...item, shortLabel: item.category.slice(0, 5) })), "posts", { height: 210, maxLabels: 6, color: "#2e9fb5", label: "Publicaciones por tipo" })}</div>`;
}

function renderAudience() {
  const audience = state.data.audience || [];
  const query = normalizeText(state.audienceSearch);
  const filtered = audience.filter((account) => !query || normalizeText(`${account.username} ${account.full_name}`).includes(query));
  $("audienceBody").innerHTML = filtered.length ? filtered.map((account) => `<tr><td><div class="account-cell"><span class="account-avatar">${escapeHtml((account.full_name || account.username).slice(0, 2).toUpperCase())}</span><span><a href="https://www.instagram.com/${encodeURIComponent(account.username)}/" target="_blank" rel="noopener noreferrer">@${escapeHtml(account.username)}</a><small>${escapeHtml(account.full_name || "Sin nombre público")}</small></span></div></td><td class="numeric"><strong>${formatNumber(account.interactions)}</strong></td><td class="numeric">${formatNumber(account.publications_with_interaction)}</td><td>${escapeHtml(formatDate(account.first_appearance))}</td><td>${escapeHtml(formatDate(account.last_appearance))}</td><td><span class="table-pill recurrence-${normalizeText(account.recurrence)}">${escapeHtml(account.recurrence)}</span></td></tr>`).join("") : '<tr><td colspan="6" class="empty-cell">No hay identidades de interacción en esta fuente.</td></tr>';
  $("audienceFooter").textContent = `Mostrando ${formatNumber(filtered.length)} de ${formatNumber(audience.length)} cuentas identificadas.`;
  $("audienceMapChip").textContent = `${formatNumber(audience.length)} cuentas`;
  $("heatmapChip").textContent = state.data.audience_matrix?.truncated ? "Vista recortada" : "Mapa completo";
  renderAudienceNetwork();
  renderConcentration();
  renderLorenz();
  renderRecurrence();
  renderAudienceHeatmap();
}

function renderConcentration() {
  const data = state.data.concentration || {};
  const top = [data.top_5, data.top_10, data.top_20].filter(Boolean);
  if (!data.available) { $("concentrationChart").innerHTML = '<div class="chart-empty">No hay identidades para medir concentración.</div>'; return; }
  const width = 620, height = 240, left = 76, right = 30, topY = 28, row = 56;
  const max = Math.max(...top.map((item) => item.share || 0), 1);
  const rows = top.map((item, index) => { const y = topY + index * row; const barWidth = (item.share || 0) / max * (width - left - right); return `<text x="${left - 12}" y="${y + 16}" text-anchor="end" class="axis-label">Top ${item.size}</text><rect x="${left}" y="${y}" width="${width - left - right}" height="26" rx="8" class="track-bar"/><rect x="${left}" y="${y}" width="${Math.max(2, barWidth)}" height="26" rx="8" fill="${["#ef5f57", "#e89a24", "#7c5ce0"][index]}"/><text x="${left + Math.max(2, barWidth) + 8}" y="${y + 18}" class="axis-value">${formatPercent(item.share)}</text>`; }).join("");
  $("concentrationChart").innerHTML = chartSvg({ width, height, label: "Concentración de la audiencia", children: rows });
}

function renderLorenz() {
  const points = state.data.concentration?.lorenz || [];
  if (points.length < 2) { $("lorenzChart").innerHTML = '<div class="chart-empty">No hay suficiente distribución para la curva.</div>'; return; }
  const width = 620, height = 250, left = 46, right = 18, top = 20, bottom = 42;
  const xAt = (value) => left + value * (width - left - right);
  const yAt = (value) => top + (1 - value) * (height - top - bottom);
  const diagonal = `<line x1="${xAt(0)}" y1="${yAt(0)}" x2="${xAt(1)}" y2="${yAt(1)}" class="lorenz-diagonal"/>`;
  const path = points.map((point, index) => `${index ? "L" : "M"}${xAt(point.x)},${yAt(point.y)}`).join(" ");
  $("lorenzChart").innerHTML = chartSvg({ width, height, label: "Curva de Lorenz", children: `${gridLines(width, height, { left, right, top, bottom }, 1, (value) => `${Math.round(value * 100)}%`)}${diagonal}<path d="${path}" class="lorenz-line"/><text x="${left}" y="${height - 15}" class="axis-label">0% cuentas</text><text x="${width - right}" y="${height - 15}" text-anchor="end" class="axis-label">100% cuentas</text>` });
}

function renderRecurrence() {
  const categories = state.data.recurrence?.categories || [];
  $("recurrenceChart").innerHTML = verticalBars(categories.map((item) => ({ ...item, shortLabel: item.label })), "accounts", { height: 230, maxLabels: 3, color: "#1d9a6c", label: "Categorías de recurrencia" });
}

function renderAudienceHeatmap() {
  const matrix = state.data.audience_matrix;
  const container = $("audienceHeatmap");
  if (!matrix || !matrix.rows?.length || !matrix.posts?.length) { container.innerHTML = '<div class="chart-empty">No hay matriz de audiencia porque no se identificaron cuentas.</div>'; return; }
  const max = Math.max(matrix.max_value || 0, 1);
  const header = `<div class="heatmap-row heatmap-header"><span class="heatmap-label"></span>${matrix.posts.map((post) => `<span class="heatmap-column-label" title="${escapeHtml(post)}">${escapeHtml(post.slice(0, 5))}</span>`).join("")}</div>`;
  const rows = matrix.rows.map((row) => `<div class="heatmap-row"><span class="heatmap-label" title="@${escapeHtml(row.username)}">@${escapeHtml(row.username.slice(0, 10))}</span>${row.values.map((value) => `<span class="heatmap-cell" style="--heat:${value / max}" title="@${escapeHtml(row.username)} · ${formatNumber(value)} interacciones"><i></i></span>`).join("")}</div>`).join("");
  container.innerHTML = `<div class="heatmap-scroll" style="--heat-columns:${matrix.posts.length}">${header}${rows}</div><div class="heatmap-scale"><span>Menos</span><i></i><i></i><i></i><i></i><span>Más</span></div>`;
}

function networkColor(index) {
  return ["#3b6ef5", "#ef5f57", "#1d9a6c", "#e89a24", "#8b5cf6", "#0f9f91", "#db2777"][index % 7];
}

function renderNetworkSvg(svgId, edgeId, nodeId, network, kind) {
  const svg = $(svgId);
  if (!svg) return;
  const edgeLayer = $(edgeId);
  const nodeLayer = $(nodeId);
  edgeLayer.replaceChildren();
  nodeLayer.replaceChildren();
  const nodes = network?.nodes || [];
  const edges = network?.edges || [];
  if (!nodes.length) {
    svg.hidden = true;
    return;
  }
  svg.hidden = false;
  const centerX = 500, centerY = 315;
  const central = nodes.find((node) => node.is_central);
  const peripheral = nodes.filter((node) => !node.is_central).sort((a, b) => (b.weight || 0) - (a.weight || 0));
  const visible = peripheral.slice(0, 70);
  const visibleIds = new Set([...(central ? [central.id] : []), ...visible.map((node) => node.id)]);
  const positions = new Map();
  if (central) positions.set(central.id, { x: centerX, y: centerY });
  const maxWeight = Math.max(...visible.map((node) => node.weight || 0), 1);
  visible.forEach((node, index) => {
    const angle = (index / Math.max(visible.length, 1)) * Math.PI * 2 - Math.PI / 2;
    const radiusX = kind === "cooccurrence" ? 330 : 280 + 40 * Math.sin(index * 1.7);
    const radiusY = kind === "cooccurrence" ? 245 : 215 + 25 * Math.cos(index * 1.3);
    positions.set(node.id, { x: centerX + Math.cos(angle) * radiusX, y: centerY + Math.sin(angle) * radiusY });
  });
  const maxEdge = Math.max(...edges.map((edge) => edge.weight || 0), 1);
  edges.filter((edge) => visibleIds.has(edge.source) && visibleIds.has(edge.target)).forEach((edge) => {
    const source = positions.get(edge.source), target = positions.get(edge.target);
    if (!source || !target) return;
    const line = document.createElementNS("http://www.w3.org/2000/svg", "line");
    line.setAttribute("x1", source.x); line.setAttribute("y1", source.y); line.setAttribute("x2", target.x); line.setAttribute("y2", target.y);
    line.setAttribute("class", "network-edge");
    line.setAttribute("stroke", kind === "collaboration" ? "#1d9a6c" : kind === "cooccurrence" ? "#e89a24" : "#3b6ef5");
    line.setAttribute("stroke-opacity", String(0.16 + 0.42 * (edge.weight / maxEdge)));
    line.setAttribute("stroke-width", String(0.8 + 4 * (edge.weight / maxEdge)));
    const title = document.createElementNS("http://www.w3.org/2000/svg", "title");
    title.textContent = `${edge.source} ↔ ${edge.target}: ${formatNumber(edge.weight)} vínculos ponderados`;
    line.appendChild(title);
    edgeLayer.appendChild(line);
  });
  if (central) {
    const group = document.createElementNS("http://www.w3.org/2000/svg", "g");
    group.setAttribute("class", "network-node central-node");
    group.setAttribute("transform", `translate(${centerX} ${centerY})`);
    const halo = document.createElementNS("http://www.w3.org/2000/svg", "circle"); halo.setAttribute("r", "55"); halo.setAttribute("class", "central-halo");
    const circle = document.createElementNS("http://www.w3.org/2000/svg", "circle"); circle.setAttribute("r", "37"); circle.setAttribute("class", "central-circle");
    const text = document.createElementNS("http://www.w3.org/2000/svg", "text"); text.setAttribute("x", "0"); text.setAttribute("y", "5"); text.setAttribute("text-anchor", "middle"); text.setAttribute("class", "central-label"); text.textContent = `@${central.username.slice(0, 14)}`;
    const title = document.createElementNS("http://www.w3.org/2000/svg", "title"); title.textContent = `Cuenta principal @${central.username}`;
    group.append(halo, circle, text, title); nodeLayer.appendChild(group);
  }
  visible.forEach((node, index) => {
    const position = positions.get(node.id);
    if (!position) return;
    const group = document.createElementNS("http://www.w3.org/2000/svg", "g");
    group.setAttribute("class", "network-node");
    group.setAttribute("transform", `translate(${position.x} ${position.y})`);
    const radius = 5 + Math.sqrt((node.weight || 0) / maxWeight) * 12;
    const account = (state.data.audience || []).find((item) => item.username === node.username);
    const interactionColor = account?.likes && !account?.comments ? "#1d9a6c" : account?.comments && !account?.likes ? "#3b6ef5" : "#7c5ce0";
    const circle = document.createElementNS("http://www.w3.org/2000/svg", "circle"); circle.setAttribute("r", radius); circle.setAttribute("fill", kind === "interaction" ? interactionColor : networkColor(index)); circle.setAttribute("class", "network-dot");
    const title = document.createElementNS("http://www.w3.org/2000/svg", "title"); title.textContent = `@${node.username}: ${formatNumber(node.weight)} apariciones ponderadas`;
    group.append(circle, title);
    if (index < 16) {
      const label = document.createElementNS("http://www.w3.org/2000/svg", "text");
      label.setAttribute("x", position.x < centerX ? -radius - 7 : radius + 7); label.setAttribute("y", "4"); label.setAttribute("text-anchor", position.x < centerX ? "end" : "start"); label.setAttribute("class", "network-label"); label.textContent = `@${node.username.slice(0, 17)}`;
      group.appendChild(label);
    }
    nodeLayer.appendChild(group);
  });
}

function renderAudienceNetwork() {
  const network = state.data.networks?.interaction;
  const empty = $("audienceNetworkEmpty");
  if (!network?.nodes?.length || (network.nodes.length <= 1)) { $("audienceNetworkSvg").hidden = true; empty.hidden = false; $("audienceNetworkLegend").innerHTML = ""; return; }
  empty.hidden = true;
  renderNetworkSvg("audienceNetworkSvg", "audienceNetworkEdges", "audienceNetworkNodes", network, "interaction");
  $("audienceNetworkLegend").innerHTML = `<span><i class="legend-dot central"></i> cuenta analizada</span><span><i class="legend-dot account"></i> comentario</span><span><i class="legend-dot collab"></i> like</span><span><i class="legend-dot cooc"></i> ambos</span><span class="legend-note">Tamaño = frecuencia identificada</span>`;
}

function renderCollaborations() {
  const collaborators = state.data.collaborations?.collaborators || [];
  $("collaborationChart").innerHTML = verticalBars(collaborators.slice(0, 16).map((item) => ({ ...item, shortLabel: item.username.slice(0, 5) })), "collaborations", { height: 280, maxLabels: 12, color: "#1d9a6c", label: "Colaboradores vs. número de colaboraciones" });
  $("collaborationTimelineChart").innerHTML = lineChart(state.data.temporal.monthly || [], [{ key: "collaborations", color: "#1d9a6c" }], { height: 260, label: "Evolución de colaboraciones" });
  const comparison = state.data.collaboration_comparison || {};
  const rows = [comparison.collaborative, comparison.non_collaborative].filter(Boolean);
  $("collaborationComparison").innerHTML = rows.map((row, index) => `<div class="comparison-row"><div><strong>${index === 0 ? "Con colaboración" : "Sin colaboración"}</strong><span>${formatNumber(row.posts)} publicaciones</span></div><div class="comparison-track"><i style="width:${Math.min(100, (row.mean_likes || 0) / Math.max(...rows.map((item) => item.mean_likes || 0), 1) * 100)}%;background:${index === 0 ? "#1d9a6c" : "#9aa7ba"}"></i></div><b>${row.mean_likes == null ? "Sin dato" : formatNumber(row.mean_likes)} <small>likes promedio</small></b></div>`).join("") || '<div class="empty-state">No hay datos para comparar.</div>';
  const union = [...new Set([...(state.data.audience || []).map((item) => item.username), ...collaborators.map((item) => item.username)])];
  const byName = new Map((state.data.relationships || []).map((item) => [item.username, item]));
  $("overlapBody").innerHTML = union.length ? union.map((username) => { const row = byName.get(username) || { username, interactions: 0, collaborations: 0 }; const both = row.interactions > 0 && row.collaborations > 0; return `<tr><td><a href="https://www.instagram.com/${encodeURIComponent(username)}/" target="_blank" rel="noopener noreferrer">@${escapeHtml(username)}</a></td><td class="numeric">${formatNumber(row.interactions)}</td><td class="numeric">${formatNumber(row.collaborations)}</td><td>${both ? '<span class="table-pill positive">Sí</span>' : '<span class="muted-value">No</span>'}</td><td>${both ? "En ambas redes" : row.interactions ? "Sólo interacción" : "Sólo colaboración"}</td></tr>`; }).join("") : '<tr><td colspan="5" class="empty-cell">No hay cuentas para comparar.</td></tr>';
  $("overlapFooter").textContent = `${formatNumber((state.data.networks?.comparison?.both || []).length)} cuentas aparecen en ambas redes.`;
  $("overlapChip").textContent = `${formatNumber((state.data.networks?.comparison?.both || []).length)} en ambas`;
}

function renderNetworks() {
  const network = state.data.networks?.[state.network] || state.data.networks?.interaction;
  const labels = { interaction: ["Red de interacción", "Cuentas que interactúan alrededor de la cuenta principal."], collaboration: ["Red de colaboración", "Cuentas acreditadas como coautoras alrededor de la cuenta principal."], cooccurrence: ["Red de coincidencia", "Cuentas que aparecen juntas en una misma publicación; no prueba contacto directo."] };
  $("networkTitle").textContent = labels[state.network][0]; $("networkDescription").textContent = labels[state.network][1];
  const empty = $("mainNetworkEmpty");
  if (!network?.nodes?.length || network.nodes.length <= 1) { $("mainNetworkSvg").hidden = true; empty.hidden = false; $("mainNetworkFooter").textContent = "No hay vínculos identificados para esta red."; } else { empty.hidden = true; renderNetworkSvg("mainNetworkSvg", "mainNetworkEdges", "mainNetworkNodes", network, state.network); $("mainNetworkFooter").textContent = `${formatNumber(network.summary?.nodes || 0)} nodos · ${formatNumber(network.summary?.edges || 0)} vínculos · ${formatNumber(network.summary?.connected_components || 0)} componentes`; }
  $("mainNetworkLegend").innerHTML = `<span><i class="legend-dot ${state.network === "collaboration" ? "collab" : state.network === "cooccurrence" ? "cooc" : "account"}"></i> ${state.network === "collaboration" ? "colaboración" : state.network === "cooccurrence" ? "coincidencia" : "interacción"}</span><span class="legend-note">El tamaño es frecuencia; la distancia es visual</span>`;
  const communities = network?.communities || [];
  $("communitySummary").innerHTML = communities.length ? `<strong>Comunidades observadas</strong>${communities.slice(0, 8).map((component, index) => `<span class="community-chip"><i style="background:${networkColor(index)}"></i>Grupo ${index + 1}: ${formatNumber(component.length)} ${component.length === 1 ? "cuenta" : "cuentas"}</span>`).join("")}<small>Una comunidad es un conjunto de cuentas con más vínculos entre sí que con el resto; no implica amistad ni identidad.</small>` : '<small>No hay suficientes vínculos para separar comunidades.</small>';
  const comparison = state.data.networks?.comparison || {};
  $("networkComparisonChart").innerHTML = verticalBars([{ label: "Ambas", shortLabel: "Ambas", accounts: (comparison.both || []).length }, { label: "Sólo interacción", shortLabel: "Interacción", accounts: (comparison.interaction_only || []).length }, { label: "Sólo colaboración", shortLabel: "Colaboración", accounts: (comparison.collaboration_only || []).length }], "accounts", { height: 240, maxLabels: 3, color: "#7c5ce0", label: "Comparación de redes" });
  const bridges = state.data.networks?.co_occurrence?.bridge_accounts || [];
  $("bridgeBody").innerHTML = bridges.length ? bridges.slice(0, 12).map((item) => `<tr><td><a href="https://www.instagram.com/${encodeURIComponent(item.username)}/" target="_blank" rel="noopener noreferrer">@${escapeHtml(item.username)}</a></td><td class="numeric">${formatNumber(item.degree)}</td><td class="numeric">${formatNumber(item.betweenness)}</td></tr>`).join("") : '<tr><td colspan="3" class="empty-cell">No hay estructura suficiente para identificar puentes.</td></tr>';
  document.querySelectorAll("[data-network]").forEach((button) => button.classList.toggle("active", button.dataset.network === state.network));
}

function renderEvolution() {
  const monthly = state.data.temporal.monthly || [];
  $("evolutionChart").innerHTML = lineChart(monthly, [{ key: "posts", color: "#3b6ef5", width: 2.5 }, { key: "likes", color: "#ef5f57" }, { key: "reported_comments", color: "#e89a24" }, { key: "collaborations", color: "#1d9a6c" }], { height: 320, label: "Línea temporal de la cuenta" });
  const timeline = monthly.map((item) => ({ period: item.period, active: item.interaction_accounts, new: (item.new_accounts || []).length, inactive: (item.inactive_accounts || []).length }));
  $("audienceTimelineChart").innerHTML = lineChart(timeline, [{ key: "active", color: "#3b6ef5" }, { key: "new", color: "#ef5f57" }, { key: "inactive", color: "#a4adbd" }], { height: 280, label: "Historia de la audiencia" });
}

function renderFindings() {
  const findings = state.data.findings || [];
  $("findingsGrid").innerHTML = findings.map((finding, index) => `<article class="finding-card panel"><span class="finding-number">${String(index + 1).padStart(2, "0")}</span><h3>${escapeHtml(finding.title)}</h3><div class="finding-evidence"><strong>Evidencia</strong><p>${escapeHtml(finding.evidence)}</p></div><div class="finding-visual"><span>▧</span> ${escapeHtml(finding.visualization)}</div><small>${escapeHtml(finding.caution)}</small></article>`).join("");
  const correlations = state.data.correlations || [];
  if (correlations.length) {
    const card = document.createElement("article"); card.className = "finding-card panel correlation-card"; card.innerHTML = `<span class="finding-number">↗</span><h3>Asociaciones estadísticas</h3><p>Una correlación describe que dos medidas varían juntas; no demuestra causalidad.</p><div class="correlation-list">${correlations.map((item) => `<div><strong>${escapeHtml(item.label)}</strong><span>${item.pearson == null ? "—" : `r ${item.pearson}`} · ${escapeHtml(item.strength)}</span></div>`).join("")}</div>`;
    $("findingsGrid").appendChild(card);
  }
  $("questionsList").innerHTML = (state.data.open_questions || []).map((item) => `<li>${escapeHtml(item)}</li>`).join("");
  $("limitationsList").innerHTML = (state.data.limitations || []).map((item) => `<li>${escapeHtml(item)}</li>`).join("");
}

function setExplanation(key, shows, observes, caution) {
  const element = document.querySelector(`[data-explanation="${key}"]`);
  if (!element) return;
  element.innerHTML = `<div><strong>¿Qué muestra?</strong><p>${escapeHtml(shows)}</p></div><div><strong>¿Qué podemos observar?</strong><p>${escapeHtml(observes)}</p></div><div class="caution"><strong>¿Qué NO podemos concluir?</strong><p>${escapeHtml(caution)}</p></div>`;
}

function renderExplanations() {
  const data = state.data; const stats = data.likes_distribution?.stats || {}; const concentration = data.concentration || {}; const coverage = data.data_coverage || {};
  setExplanation("postLikes", "Cada barra es una publicación y su altura representa likes conocidos.", stats.mean == null ? "No hay suficientes likes con dato." : `El promedio es ${formatNumber(stats.mean)} y la mediana ${formatNumber(stats.median)}; se pueden comparar las publicaciones entre sí.`, "Un valor alto no identifica quién interactuó ni demuestra una causa.");
  setExplanation("likesTimeline", "La línea une la suma mensual de likes con las publicaciones que tienen fecha.", `${formatNumber(data.profile.posts)} publicaciones y ${formatNumber(data.profile.total_likes)} likes conocidos forman el periodo visible.`, "Una subida simultánea no prueba que una publicación haya causado el cambio.");
  setExplanation("frequency", "Cada barra cuenta publicaciones de un mes.", `La frecuencia media observada es ${formatNumber(data.profile.frequency_per_month)} publicaciones por mes con actividad.`, "Los meses sin fecha o sin publicaciones no se rellenan con suposiciones.");
  setExplanation("performance", "Cada punto representa una publicación; la altura muestra likes y el color marca si tiene colaboración.", "Se ven publicaciones que destacan y otras que permanecen dentro del rango habitual.", "La gráfica no determina por qué una publicación recebeu más likes.");
  setExplanation("histogram", "El histograma agrupa publicaciones en rangos de likes.", stats.p25 != null ? `La mitad central se concentra alrededor de ${formatNumber(stats.p25)}–${formatNumber(stats.p75)} likes.` : "No hay una distribución de likes utilizable.", "Un rango amplio puede reflejar contenido, fecha o simplemente variability observada.");
  setExplanation("boxplot", "La caja muestra el rango central y los puntos son valores alejados.", stats.p95 != null ? `El percentil 95 es ${formatNumber(stats.p95)} likes.` : "No hay caja disponible.", "Un punto atípico no es un error ni una explicación.");
  setExplanation("audienceMap", "La cuenta analizada ocupa el centro y las cuentas periféricas representan interacciones identificadas.", `${formatNumber(data.profile.unique_audience_accounts)} cuentas aparecen alrededor del nodo central.`, "El mapa no demuestra amistad, influencia ni alcance total.");
  setExplanation("concentration", "Las barras muestran qué porcentaje de las interacciones identificadas corresponde a los grupos más recurrentes.", concentration.top_10?.share == null ? "No se puede calcular sin identidades." : `El top 10 representa ${formatPercent(concentration.top_10.share)} de las interacciones observadas.`, "La concentración de comentarios identificados no es concentración de todos los likes.");
  setExplanation("lorenz", "La curva compara la reparto observado con una línea de reparto uniforme.", concentration.gini == null ? "No hay datos suficientes para Gini o Lorenz." : `El índice Gini observado es ${formatNumber(concentration.gini)}; más alto indica más concentración.`, "El índice depende de la cobertura y de las identidades disponibles.");
  setExplanation("recurrence", "Las barras dividen cuentas según cuántas veces aparecen y durante cuánto tiempo.", (data.recurrence?.definition || ""), "Estas etiquetas son una clasificación construida, no una identidad social.");
  setExplanation("heatmap", "Cada fila es una cuenta y cada columna una publicación; una celda más intensa significa más interacciones.", data.audience_matrix?.explanation || "No hay identidades para construir la matriz.", "La matriz no representa la audiencia total ni causality.");
  setExplanation("collaborators", "Cada barra cuenta las publicaciones en las que aparece un colaborador.", `${formatNumber(data.collaborations?.unique_collaborators || 0)} cuentas tienen alguna colaboración registrada.`, "Colaborar en una publicación no demuestra una relación personal completa.");
  setExplanation("collaborationTimeline", "La línea muestra colaboraciones distintas por mes.", "Se observan cambios en la actividad de colaboración del periodo.", "No permite saber si una colaboración cambió el alcance sin más contexto.");
  setExplanation("collaborationComparison", "Compara promedios, medianas y número de publicaciones de dos grupos.", "La diferencia entre grupos es una observación del archivo.", "No demuestra que la colaboración cause más likes.");
  setExplanation("contentTypes", "Agrupa las publicaciones por el tipo técnico declarado en cada registro.", "Se puede comparar cantidad y likes entre imagen, vídeo, reel o carrusel.", "El tipo técnico no describe por sí mismo el tema ni la intención de la publicación.");
  setExplanation("network", "Los nodos son cuentas y las líneas son vínculos observados; el tamaño sigue el peso.", "Las redes permiten ver repetición, componentes y posiciones centrales; la betweenness señala cuentas que conectan partes.", "Una posición central es una posición estructural dentro de los datos, no liderazgo.");
  setExplanation("networkComparison", "Compara cuentas presentes en interacción, colaboración o ambas redes.", "La intersección muestra qué función aparece en cada grupo.", "Las dos redes miden relaciones diferentes y no deben intercambiarse.");
  setExplanation("bridges", "Las cuentas puente son las que tienen mayor posición de conectividad en la red de coincidencia.", "Ayudan a localizar puntos que conectan partes de la red.", "Conectar dos partes no equivale a liderazgo o influencia.");
  setExplanation("evolution", "Las líneas comparan publicaciones, likes, comentarios y colaboraciones a lo largo del tiempo.", "Se puede observar cuándo cambia la actividad y qué señal acompaña ese cambio.", "La simultaneidad no es causalidad.");
  setExplanation("audienceTimeline", "Las líneas muestran cuentas activas, nuevas y no observadas en cada mes.", "Se puede seguir la entrada de cuentas y los cambios de actividad por periodo.", "Que una cuenta no aparezca en un mes no significa que haya dejado de existir o modificado su comportamiento.");
  if (!coverage.likes_identities_available) setExplanation("postLikes", "Cada barra es una publicación; sólo se usan likes agregados porque el archivo no contiene identidades de likers.", `Hay ${formatNumber(data.profile.likes_known)} publicaciones con likes disponibles y ${formatNumber(data.profile.likes_missing)} sin dato.`, "No se puede atribuir un like a una cuenta concreta.");
}

async function loadAnalysis() {
  if (!state.data || state.loading) return;
  setLoading(true, "Actualizando la lectura…", "Recalculando indicadores a partir de la copia en memoria.");
  try {
    const query = new URLSearchParams({ main: $("mainAccount").value.trim().replace(/^@/, ""), scope: $("scopeSelect").value });
    const response = await fetch(`/api/analysis?${query.toString()}`, { headers: { Accept: "application/json" }, cache: "no-store" });
    state.data = await parseResponse(response);
    renderAll();
    showToast(`Lectura actualizada para @${state.data.main.username}.`);
  } catch (error) {
    showToast(error.message, true);
  } finally { setLoading(false); }
}

async function uploadFiles(fileList) {
  const files = [...fileList].filter((file) => file.name.toLocaleLowerCase("es").endsWith(".json"));
  if (!files.length) { setUploadStatus("Selecciona al menos un archivo con extensión .json.", "error"); return; }
  setUploadStatus(`Leyendo ${files.length} ${files.length === 1 ? "archivo" : "archivos"}…`);
  setLoading(true, "Leyendo los archivos…", "Los originales permanecerán intactos; sólo se crea una copia temporal.");
  try {
    const payload = { files: [] };
    for (const file of files) {
      const text = await file.text();
      let parsed;
      try { parsed = JSON.parse(text.replace(/^\uFEFF/, "")); } catch { throw new Error(`${file.name} no contiene un JSON válido.`); }
      payload.files.push({ name: file.name, payload: parsed });
    }
    const response = await fetch("/api/analysis", { method: "POST", headers: { Accept: "application/json", "Content-Type": "application/json" }, body: JSON.stringify(payload) });
    state.data = await parseResponse(response);
    state.sourceStatus = { has_data: true, source_name: state.data.source_name };
    renderAll(); showReport(); setUploadStatus(`${files.length} archivo(s) cargado(s).`, "success"); showToast("Informe listo para explorar.");
  } catch (error) { setUploadStatus(error.message, "error"); showToast(error.message, true); } finally { setLoading(false); $("fileInput").value = ""; }
}

async function loadServerFiles() {
  setLoading(true, "Usando archivos del servidor…", "Se leerán los JSON disponibles sin modificarlos.");
  try {
    const response = await fetch("/api/load-server", { method: "POST", headers: { Accept: "application/json" } });
    state.data = await parseResponse(response);
    renderAll(); showReport(); showToast("Se cargaron los archivos detectados en el servidor.");
  } catch (error) { showToast(error.message, true); } finally { setLoading(false); }
}

function downloadCsv() {
  const rows = state.data?.post_table || [];
  const header = ["fecha", "publicacion", "codigo", "likes", "colaboracion", "colaboradores", "tipo", "posicion_respecto_promedio"];
  const quote = (value) => `"${String(value ?? "").replaceAll('"', '""')}"`;
  const csv = [header.map(quote).join(","), ...rows.map((row) => [row.date, row.publication, row.short_code, row.likes ?? "", row.collaboration ? "sí" : "no", row.collaborator, row.type, row.position_vs_average ?? ""].map(quote).join(","))].join("\n");
  const url = URL.createObjectURL(new Blob(["\ufeff", csv], { type: "text/csv;charset=utf-8" }));
  const link = document.createElement("a"); link.href = url; link.download = `publicaciones-${state.data.main.username}.csv`; document.body.appendChild(link); link.click(); link.remove(); setTimeout(() => URL.revokeObjectURL(url), 0);
}

function downloadNetworkCsv() {
  const network = state.data?.networks?.[state.network];
  if (!network) return;
  const quote = (value) => `"${String(value ?? "").replaceAll('"', '""')}"`;
  const nodes = ["tipo,id,central,peso", ...(network.nodes || []).map((node) => [node.is_central ? "central" : "cuenta", node.id, node.is_central ? "sí" : "no", node.weight].map(quote).join(","))];
  const edges = ["origen,destino,peso,tipo", ...(network.edges || []).map((edge) => [edge.source, edge.target, edge.weight, edge.kind || state.network].map(quote).join(","))];
  const csv = [...nodes, "", ...edges].join("\n");
  const url = URL.createObjectURL(new Blob(["\ufeff", csv], { type: "text/csv;charset=utf-8" }));
  const link = document.createElement("a"); link.href = url; link.download = `red-${state.network}-${state.data.main.username}.csv`; document.body.appendChild(link); link.click(); link.remove(); setTimeout(() => URL.revokeObjectURL(url), 0);
  showToast("Red preparada en CSV; también puedes abrirla en Gephi.");
}

function bindEvents() {
  const fileInput = $("fileInput");
  $("chooseFilesButton").addEventListener("click", (event) => { event.stopPropagation(); fileInput.click(); });
  $("dropZone").addEventListener("click", (event) => { if (event.target !== $("chooseFilesButton")) fileInput.click(); });
  $("dropZone").addEventListener("keydown", (event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); fileInput.click(); } });
  fileInput.addEventListener("change", () => uploadFiles(fileInput.files || []));
  ["dragenter", "dragover"].forEach((name) => $("dropZone").addEventListener(name, (event) => { event.preventDefault(); $("dropZone").classList.add("dragging"); }));
  ["dragleave", "drop"].forEach((name) => $("dropZone").addEventListener(name, (event) => { event.preventDefault(); $("dropZone").classList.remove("dragging"); }));
  $("dropZone").addEventListener("drop", (event) => uploadFiles(event.dataTransfer?.files || []));
  $("loadServerButton").addEventListener("click", loadServerFiles);
  $("replaceButton").addEventListener("click", () => fileInput.click());
  $("accountForm").addEventListener("submit", (event) => { event.preventDefault(); loadAnalysis(); });
  $("scopeSelect").addEventListener("change", loadAnalysis);
  $("postSearch").addEventListener("input", (event) => { state.postSearch = event.target.value; renderPosts(); renderExplanations(); });
  $("audienceSearch").addEventListener("input", (event) => { state.audienceSearch = event.target.value; renderAudience(); });
  $("downloadPosts").addEventListener("click", downloadCsv);
  $("downloadNetwork").addEventListener("click", downloadNetworkCsv);
  document.querySelectorAll("[data-network]").forEach((button) => button.addEventListener("click", () => { state.network = button.dataset.network; renderNetworks(); renderExplanations(); }));
  const sections = [...document.querySelectorAll("main > .report-section")];
  const observer = new IntersectionObserver((entries) => entries.forEach((entry) => { if (entry.isIntersecting) document.querySelectorAll(".nav-link").forEach((link) => link.classList.toggle("active", link.dataset.section === entry.target.id)); }), { rootMargin: "-25% 0px -65% 0px" });
  sections.forEach((section) => observer.observe(section));
}

async function initialize() {
  bindEvents();
  try {
    const response = await fetch("/api/status", { headers: { Accept: "application/json" }, cache: "no-store" });
    state.sourceStatus = await parseResponse(response);
    if (state.sourceStatus.available_files?.length) {
      $("loadServerButton").hidden = false;
      $("loadServerButton").textContent = `Usar ${state.sourceStatus.available_files.length} archivo(s) del servidor`;
    }
  } catch (error) {
    setUploadStatus(`No se pudo comprobar el servidor: ${error.message}`, "error");
  }
  showUpload();
}

if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", initialize, { once: true });
else initialize();
