import { renderMonthlyCharts } from "./js/charts.js";
import {
  escapeHtml,
  formatDate,
  formatMonthRange,
  formatNumber,
  formatPercent,
  initials,
  normalizeSearch,
  postUrl,
  profileUrl,
} from "./js/formatters.js";
import { createNetworkCamera } from "./js/network-camera.js";
import {
  layoutContextNetwork,
  layoutEgoNetwork,
  layoutSecondaryNetwork,
} from "./js/network-layout.js";

const SVG_NS = "http://www.w3.org/2000/svg";

const SOURCE_META = {
  comments: { label: "Comentarios capturados", color: "#3b6ef5" },
  commented_posts: { label: "Publicaciones comentadas", color: "#3b6ef5" },
  mentions: { label: "Menciones", color: "#c44ec5" },
  tagged: { label: "Etiquetas", color: "#e89a24" },
  coauthors: { label: "Coautores", color: "#1d9a6c" },
};

const SCOPE_LABELS = {
  owned: "Publicaciones propias",
  involving: "Publicaciones propias y colaboraciones",
  all: "Todo el archivo",
};

const METRIC_LABELS = {
  combined: "combinada",
  comments: "Comentarios capturados",
  commented_posts: "publicaciones comentadas",
  mentions: "menciones",
  tagged: "cuentas etiquetadas",
  coauthors: "coautores",
};

const state = {
  data: null,
  networkView: "ego",
  metric: "combined",
  minSharedPosts: 1,
  minContextPosts: 1,
  currentPage: "dashboard",
  serverStatus: null,
  weights: {
    comments: 1,
    commented_posts: 1,
    mentions: 1,
    tagged: 1,
    coauthors: 1,
  },
  selectedUsername: null,
  selectedEdgeId: null,
  selectedContextId: null,
  topLimit: 35,
  search: "",
  loading: false,
  toastTimer: null,
};

const elements = {};
let networkCamera = null;

function cacheElements() {
  const ids = [
    "startScreen",
    "appShell",
    "startDropZone",
    "startUploadButton",
    "startFileInput",
    "startStatus",
    "resumeButton",
    "homeButton",
    "sourceStatus",
    "uploadButton",
    "fileInput",
    "dashboardPage",
    "manualPage",
    "backToDashboard",
    "mainName",
    "heroDescription",
    "mainForm",
    "mainAccount",
    "qualityBanner",
    "qualityText",
    "methodologyButton",
    "kpiGrid",
    "scopeSelect",
    "networkKicker",
    "networkDescriptionText",
    "networkDescription",
    "egoViewButton",
    "egoViewLabel",
    "coViewButton",
    "contextViewButton",
    "viewSwitchNote",
    "metricSelect",
    "weightToggle",
    "weightPanel",
    "topRange",
    "topRangeText",
    "topRangeValue",
    "commentsWeight",
    "commentsWeightValue",
    "commentedPostsWeight",
    "commentedPostsWeightValue",
    "mentionsWeight",
    "mentionsWeightValue",
    "taggedWeight",
    "taggedWeightValue",
    "coauthorsWeight",
    "coauthorsWeightValue",
    "minSharedControl",
    "minSharedRange",
    "minSharedValue",
    "coCommentNote",
    "coQualityCounts",
    "minContextControl",
    "minContextRange",
    "minContextValue",
    "contextNote",
    "contextQualityCounts",
    "networkStage",
    "networkSvg",
    "networkEdges",
    "networkNodes",
    "networkEmpty",
    "networkEmptyTitle",
    "networkEmptyText",
    "networkLoading",
    "networkTooltip",
    "networkSummary",
    "egoLegend",
    "coLegend",
    "contextLegend",
    "networkHint",
    "zoomInButton",
    "zoomOutButton",
    "resetZoomButton",
    "zoomLevel",
    "networkFooterNote",
    "centerGlowCircle",
    "accountInspector",
    "mainProfileLink",
    "mixList",
    "mixFootnote",
    "tableKicker",
    "tableTitle",
    "accountColumn",
    "scoreColumn",
    "commentsColumn",
    "postsColumn",
    "mentionsColumn",
    "taggedColumn",
    "coauthorsColumn",
    "tableSubtitle",
    "accountSearch",
    "downloadCsv",
    "relationshipsBody",
    "tableFooter",
    "postList",
    "generatedAt",
    "monthlyRangeBadge",
    "manualSourceName",
    "manualAccount",
    "manualPostCount",
    "manualCoverage",
    "manualLimitations",
    "toast",
  ];

  for (const id of ids) {
    elements[id] = document.getElementById(id);
  }
}

function setStartStatus(message, type = "neutral") {
  elements.startStatus.textContent = message;
  elements.startStatus.classList.toggle("error", type === "error");
  elements.startStatus.classList.toggle("success", type === "success");
}

function showStartScreen() {
  elements.startScreen.hidden = false;
  elements.appShell.hidden = true;
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function showDashboard() {
  elements.startScreen.hidden = true;
  elements.appShell.hidden = false;
  setPage("dashboard");
}

function validateApifyPayload(payload) {
  if (!Array.isArray(payload)) {
    throw new Error("El archivo debe contener una lista JSON de publicaciones.");
  }
  if (!payload.length) {
    throw new Error("El archivo JSON no contiene publicaciones.");
  }
  const post = payload.find((item) => item && typeof item === "object");
  if (!post) {
    throw new Error("No se encontró ningún registro de publicación válido.");
  }
  if (typeof post.ownerUsername !== "string" || !post.ownerUsername.trim()) {
    throw new Error("El campo ownerUsername no tiene el formato esperado.");
  }
  const hasPostIdentity = ["id", "shortCode", "timestamp"].some((field) =>
    Object.hasOwn(post, field),
  );
  const hasEngagementFields = [
    "likesCount",
    "commentsCount",
    "latestComments",
    "mentions",
    "taggedUsers",
  ].some((field) => Object.hasOwn(post, field));
  if (!hasPostIdentity || !hasEngagementFields) {
    throw new Error(
      "La estructura no parece corresponder a una descarga de Apify Instagram Scraper.",
    );
  }
}

function showToast(message, isError = false) {
  window.clearTimeout(state.toastTimer);
  elements.toast.textContent = message;
  elements.toast.classList.toggle("error", isError);
  elements.toast.hidden = false;
  state.toastTimer = window.setTimeout(() => {
    elements.toast.hidden = true;
  }, isError ? 6500 : 3600);
}

function setBusy(isBusy, message = "Actualizando el análisis…") {
  state.loading = isBusy;
  elements.networkStage.setAttribute("aria-busy", String(isBusy));
  elements.networkLoading.hidden = !isBusy;
  if (isBusy) {
    elements.networkEmpty.hidden = true;
    if (state.data) elements.qualityText.textContent = message;
  }
}

function setQualityError(message) {
  elements.qualityBanner.classList.add("is-error");
  elements.qualityText.textContent = message;
}

function clearQualityError() {
  elements.qualityBanner.classList.remove("is-error");
}

function buildApiUrl() {
  const main = elements.mainAccount.value.trim().replace(/^@/, "");
  const scope = elements.scopeSelect.value;
  const params = new URLSearchParams({ main, scope });
  return `/api/analysis?${params.toString()}`;
}

async function parseResponse(response) {
  let payload;
  try {
    payload = await response.json();
  } catch {
    throw new Error(`El servidor respondió con un estado ${response.status}.`);
  }
  if (!response.ok) {
    throw new Error(payload.error || `Error HTTP ${response.status}.`);
  }
  return payload;
}

async function loadAnalysis({ announce = false } = {}) {
  if (state.loading) return;
  setBusy(true);
  try {
    const response = await fetch(buildApiUrl(), {
      headers: { Accept: "application/json" },
      cache: "no-store",
    });
    const payload = await parseResponse(response);
    state.data = payload;
    state.selectedUsername = null;
    state.selectedEdgeId = null;
    state.selectedContextId = null;
    state.search = "";
    state.minSharedPosts = 1;
    state.minContextPosts = 1;
    elements.accountSearch.value = "";
    elements.mainAccount.value = payload.main.username;
    elements.scopeSelect.value = payload.scope;
    clearQualityError();
    renderAll();
    if (announce) showToast(`Análisis actualizado para @${payload.main.username}.`);
  } catch (error) {
    setQualityError(error.message);
    showToast(error.message, true);
    if (state.data) {
      elements.mainAccount.value = state.data.main.username;
      elements.scopeSelect.value = state.data.scope;
    }
  } finally {
    setBusy(false);
  }
}

async function uploadDataset(file) {
  if (!file) return;
  if (!file.name.toLocaleLowerCase("es").endsWith(".json")) {
    const message = "Selecciona un archivo con extensión .json.";
    setStartStatus(message, "error");
    showToast(message, true);
    return;
  }
  if (file.size > 50 * 1024 * 1024) {
    const message = "El archivo supera el límite de 50 MB.";
    setStartStatus(message, "error");
    showToast(message, true);
    return;
  }

  setStartStatus(`Validando ${file.name}…`);
  setBusy(true, `Leyendo ${file.name}…`);
  try {
    const text = await file.text();
    let rawPayload;
    try {
      rawPayload = JSON.parse(text.replace(/^\uFEFF/, ""));
    } catch {
      throw new Error("El archivo no contiene un JSON válido.");
    }
    validateApifyPayload(rawPayload);

    const params = new URLSearchParams({
      scope: elements.scopeSelect.value,
      name: file.name,
    });
    const response = await fetch(`/api/analysis?${params.toString()}`, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json; charset=utf-8",
      },
      body: text,
    });
    const payload = await parseResponse(response);
    state.data = payload;
    state.serverStatus = {
      has_data: true,
      source_name: payload.source_name,
      main_account: payload.main.username,
    };
    state.selectedUsername = null;
    state.selectedEdgeId = null;
    state.selectedContextId = null;
    state.search = "";
    state.minSharedPosts = 1;
    state.minContextPosts = 1;
    elements.accountSearch.value = "";
    elements.mainAccount.value = payload.main.username;
    elements.scopeSelect.value = payload.scope;
    clearQualityError();
    renderAll();
    showDashboard();
    setStartStatus(`Archivo cargado: ${file.name}`, "success");
    showToast(`Archivo cargado: ${file.name}`);
  } catch (error) {
    setStartStatus(error.message, "error");
    if (!elements.appShell.hidden) {
      setQualityError(error.message);
      showToast(error.message, true);
    }
  } finally {
    elements.fileInput.value = "";
    elements.startFileInput.value = "";
    setBusy(false);
  }
}

function renderHeader() {
  const { data } = state;
  const { main, summary } = data;
  const displayName = main.full_name || `@${main.username}`;
  elements.mainName.textContent = displayName;
  elements.sourceStatus.textContent = data.source_name;
  elements.sourceStatus.title = data.source_name;
  elements.egoViewLabel.textContent = `@${main.username} ↔ otros`;
  elements.heroDescription.textContent =
    `${formatNumber(summary.selected_posts)} ${SCOPE_LABELS[data.scope].toLocaleLowerCase("es")} ` +
    `entre ${formatMonthRange(summary.date_start, summary.date_end)}, con ${formatNumber(summary.total_likes)} likes ` +
    `y ${formatNumber(summary.reported_comments)} comentarios reportados.`;

  elements.qualityText.textContent =
    `El JSON informa ${formatNumber(summary.reported_comments)} comentarios, pero conserva ` +
    `${formatNumber(summary.captured_comments)} entradas en latestComments ` +
    `(${formatPercent(summary.comment_coverage)} de cobertura). Los likes son agregados y no identifican cuentas.`;

  elements.generatedAt.textContent = `Análisis generado el ${formatDate(data.generated_at, true)}`;
  elements.monthlyRangeBadge.textContent = `${formatNumber(data.monthly_series.items.length)} meses con actividad`;
  elements.manualSourceName.textContent = data.source_name;
  elements.manualAccount.textContent = `@${main.username}`;
  elements.manualPostCount.textContent = formatNumber(summary.selected_posts);
  elements.manualCoverage.textContent = formatPercent(summary.comment_coverage);
  elements.mainProfileLink.href = profileUrl(main.username);
  elements.mainProfileLink.innerHTML = `Abrir @${escapeHtml(main.username)} <span aria-hidden="true">↗</span>`;
}

function renderKpis() {
  const { summary } = state.data;
  const secondarySummary = state.data.secondary_network.summary;
  const contextSummary = state.data.context_network.summary;
  let relationshipCard;
  if (state.networkView === "co") {
    relationshipCard = {
      label: "Cuentas co-comentadoras",
      value: secondarySummary.connected_accounts,
      note: `${formatNumber(secondarySummary.edges)} vínculos inferidos`,
      icon: "⌁",
    };
  } else if (state.networkView === "context") {
    relationshipCard = {
      label: "Contextos únicos",
      value: contextSummary.relationships,
      note: `${formatNumber(contextSummary.posts_with_context)} publicaciones con contexto`,
      icon: "◇",
    };
  } else {
    relationshipCard = {
      label: "Cuentas conectadas",
      value: summary.connected_accounts,
      note: "en al menos una fuente de relación",
      icon: "◎",
    };
  }
  const cards = [
    {
      label: "Publicaciones",
      value: summary.selected_posts,
      note:
        summary.other_author_posts > 0 && state.data.scope !== "all"
          ? `${formatNumber(summary.other_author_posts)} de otras autoras en el archivo`
          : "en el alcance seleccionado",
      icon: "▦",
      accent: true,
    },
    {
      label: "Likes totales",
      value: summary.total_likes,
      note: "agregados en las publicaciones",
      icon: "♡",
    },
    {
      label: "Comentarios",
      value: summary.reported_comments,
      note: "total informado por Instagram",
      icon: "◌",
    },
    {
      label: "Muestra observada",
      value: summary.captured_comments,
      note: `${formatPercent(summary.comment_coverage)} del total reportado`,
      icon: "⌁",
    },
    relationshipCard,
  ];

  elements.kpiGrid.innerHTML = cards
    .map(
      (card) => `
        <article class="kpi-card${card.accent ? " kpi-accent" : ""}">
          <div class="kpi-head">
            <span class="kpi-label">${escapeHtml(card.label)}</span>
            <span class="kpi-icon" aria-hidden="true">${escapeHtml(card.icon)}</span>
          </div>
          <strong class="kpi-value">${formatNumber(card.value)}</strong>
          <small class="kpi-note" title="${escapeHtml(card.note)}">${escapeHtml(card.note)}</small>
        </article>
      `,
    )
    .join("");
}

function renderScopeOptions() {
  const { data } = state;
  const suffixes = {
    owned: "propias",
    involving: "con participación",
    all: "en archivo",
  };
  for (const option of elements.scopeSelect.options) {
    const count = data.scopes[option.value];
    option.textContent = `${option.textContent.replace(/\s+\(\d+\)$/, "")} · ${formatNumber(count)} ${suffixes[option.value]}`;
    option.disabled = count === 0;
  }
  elements.scopeSelect.value = data.scope;
}

function scoreFor(account) {
  if (state.metric !== "combined") {
    return Number(account[state.metric] || 0);
  }
  return Object.entries(state.weights).reduce(
    (total, [source, weight]) => total + Number(account[source] || 0) * Number(weight),
    0,
  );
}

function sourceFor(account) {
  if (state.metric !== "combined") return state.metric;
  const contributions = Object.entries(state.weights)
    .map(([source, weight]) => ({ source, value: Number(account[source] || 0) * weight }))
    .sort((a, b) => b.value - a.value);
  return contributions[0]?.value > 0 ? contributions[0].source : "comments";
}

function rankedRelationships() {
  return [...state.data.relationships]
    .map((account) => ({ ...account, score: scoreFor(account) }))
    .filter((account) => account.score > 0)
    .sort(
      (a, b) =>
        b.score - a.score ||
        b.combined_score - a.combined_score ||
        a.username.localeCompare(b.username, "es"),
    );
}

function createSvgElement(tag, attributes = {}) {
  const element = document.createElementNS(SVG_NS, tag);
  for (const [name, value] of Object.entries(attributes)) {
    element.setAttribute(name, String(value));
  }
  return element;
}

function showNetworkTooltip(event, account) {
  const tooltip = elements.networkTooltip;
  const color = SOURCE_META[sourceFor(account)].color;
  const firstComment = account.comment_excerpts?.[0]?.text;
  tooltip.innerHTML = `
    <div class="tooltip-head">
      <span class="tooltip-avatar" style="background:${color}">${escapeHtml(initials(account))}</span>
      <span class="tooltip-title">
        <strong>${escapeHtml(account.full_name || account.username)}</strong>
        <span>@${escapeHtml(account.username)}</span>
      </span>
    </div>
    <div class="tooltip-score">
      <span>${escapeHtml(METRIC_LABELS[state.metric])}</span>
      <b>${formatNumber(scoreFor(account))}</b>
    </div>
    ${firstComment ? `<p class="comment-excerpt">“${escapeHtml(firstComment.slice(0, 115))}”</p>` : ""}
  `;
  tooltip.hidden = false;
  placeNetworkTooltip(event, tooltip);
}

function hideNetworkTooltip() {
  elements.networkTooltip.hidden = true;
}

function renderEgoNetwork() {
  if (!state.data) return;

  const relationships = rankedRelationships().slice(0, state.topLimit);
  const positions = layoutEgoNetwork(relationships.length);
  const edgeLayer = elements.networkEdges;
  const nodeLayer = elements.networkNodes;
  edgeLayer.replaceChildren();
  nodeLayer.replaceChildren();

  const centerX = 500;
  const centerY = 330;
  const maxScore = relationships[0]?.score || 1;

  relationships.forEach((account, index) => {
    const position = positions[index];
    const intensity = Math.sqrt(account.score / maxScore);
    const edge = createSvgElement("line", {
      x1: centerX,
      y1: centerY,
      x2: position.x,
      y2: position.y,
      class: "network-edge",
      stroke: SOURCE_META[sourceFor(account)].color,
      "stroke-opacity": 0.12 + intensity * 0.26,
      "stroke-width": 0.8 + intensity * 5.2,
    });
    edge.dataset.username = account.username;
    edgeLayer.appendChild(edge);
  });

  const centerHalo = createSvgElement("circle", {
    cx: centerX,
    cy: centerY,
    r: 53,
    fill: "none",
    stroke: "#ef5f57",
    "stroke-width": 1.2,
    "stroke-dasharray": "4 7",
    opacity: 0.4,
  });
  const centerGroup = createSvgElement("g", {
    class: "network-node center-node",
    tabindex: "0",
    role: "img",
    "aria-label": `Cuenta principal @${state.data.main.username}`,
  });
  centerGroup.appendChild(centerHalo);
  centerGroup.appendChild(
    createSvgElement("circle", {
      cx: centerX,
      cy: centerY,
      r: 35,
      fill: "#172033",
      class: "node-core",
    }),
  );
  centerGroup.appendChild(
    createSvgElement("text", {
      x: centerX,
      y: centerY + 5,
      "text-anchor": "middle",
      class: "node-label center-label",
    }),
  );
  centerGroup.querySelector("text").textContent = "@" + state.data.main.username.slice(0, 16);
  centerGroup.addEventListener("click", () => selectAccount(null));
  centerGroup.addEventListener("keydown", (event) => {
    if (event.key === "Enter" || event.key === " ") selectAccount(null);
  });
  nodeLayer.appendChild(centerGroup);

  relationships.forEach((account, index) => {
    const position = positions[index];
    const intensity = Math.sqrt(account.score / maxScore);
    const radius = 7 + intensity * 13;
    const color = SOURCE_META[sourceFor(account)].color;
    const selected = state.selectedUsername === account.username;

    const group = createSvgElement("g", {
      class: `network-node${selected ? " selected" : ""}`,
      "data-username": account.username,
      transform: `translate(${position.x} ${position.y})`,
      tabindex: "0",
      role: "button",
      "aria-label": `${account.full_name || account.username}, puntaje ${account.score}`,
    });

    const halo = createSvgElement("circle", {
      r: radius + 5,
      class: "node-halo",
      stroke: color,
    });
    const core = createSvgElement("circle", {
      r: radius,
      fill: color,
      class: "node-core",
    });
    group.append(halo, core);

    const title = createSvgElement("title");
    title.textContent = `@${account.username} · puntaje ${account.score}`;
    group.appendChild(title);

    group.addEventListener("pointerenter", (event) => showNetworkTooltip(event, account));
    group.addEventListener("pointermove", (event) => showNetworkTooltip(event, account));
    group.addEventListener("pointerleave", hideNetworkTooltip);
    group.addEventListener("click", (event) => {
      event.stopPropagation();
      selectAccount(selected ? null : account.username);
    });
    group.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        selectAccount(selected ? null : account.username);
      }
    });
    nodeLayer.appendChild(group);

    if (index < 12) {
      const isLeft = position.x < centerX;
      const isRight = position.x > centerX;
      const labelX = isLeft ? -radius - 7 : isRight ? radius + 7 : 0;
      const anchor = isLeft ? "end" : isRight ? "start" : "middle";
      const label = createSvgElement("text", {
        x: labelX,
        y: 4,
        "text-anchor": anchor,
        class: "node-label",
      });
      label.textContent = `@${account.username.slice(0, 22)}`;
      group.appendChild(label);
    }
  });

  elements.networkEmpty.hidden = relationships.length !== 0;
  elements.networkSvg.hidden = relationships.length === 0;
  elements.networkSummary.textContent = relationships.length
    ? `${formatNumber(relationships.length)} de ${formatNumber(state.data.summary.connected_accounts)} cuentas · ponderación ${METRIC_LABELS[state.metric]}`
    : "No hay cuentas para el criterio seleccionado.";

  applyEgoSelection();
}

function applyEgoSelection() {
  const selected = state.selectedUsername;
  for (const edge of elements.networkEdges.children) {
    const isSelected = edge.dataset.username === selected;
    edge.classList.toggle("focused", Boolean(selected && isSelected));
    edge.classList.toggle("muted", Boolean(selected && !isSelected));
  }
  for (const node of elements.networkNodes.querySelectorAll(".network-node:not(.center-node)")) {
    const isSelected = node.dataset.username === selected;
    node.classList.toggle("muted", Boolean(selected && !isSelected));
  }
}

function secondaryEdgeColor(weight) {
  if (weight >= 3) return "#ef5f57";
  if (weight === 2) return "#e89a24";
  return "#9eb2d1";
}

function placeNetworkTooltip(event, tooltip) {
  const stageRect = elements.networkStage.getBoundingClientRect();
  const width = 230;
  const left = Math.min(
    Math.max(event.clientX - stageRect.left + 14, 8),
    Math.max(stageRect.width - width - 8, 8),
  );
  const top = Math.min(
    Math.max(event.clientY - stageRect.top - 20, 8),
    Math.max(stageRect.height - tooltip.offsetHeight - 8, 8),
  );
  tooltip.style.left = `${left}px`;
  tooltip.style.top = `${top}px`;
}

function showCoAccountTooltip(event, account) {
  const tooltip = elements.networkTooltip;
  const incident = state.data.secondary_network.edges.filter(
    (edge) => edge.source === account.username || edge.target === account.username,
  );
  const repeated = incident.filter((edge) => edge.weight >= 2);
  tooltip.innerHTML = `
    <div class="tooltip-head">
      <span class="tooltip-avatar" style="background:#3b6ef5">${escapeHtml(initials(account))}</span>
      <span class="tooltip-title">
        <strong>${escapeHtml(account.full_name || account.username)}</strong>
        <span>@${escapeHtml(account.username)}</span>
      </span>
    </div>
    <div class="tooltip-score">
      <span>co-comentadores</span><b>${formatNumber(account.secondary_connections)}</b>
    </div>
    <div class="tooltip-score">
      <span>vínculos repetidos (2+)</span><b>${formatNumber(account.repeated_connections)}</b>
    </div>
    ${repeated.length ? `<p class="comment-excerpt">${formatNumber(repeated.length)} coincidencia${repeated.length === 1 ? "" : "s"} en más de una publicación</p>` : ""}
  `;
  tooltip.hidden = false;
  placeNetworkTooltip(event, tooltip);
}

function showCoEdgeTooltip(event, edge) {
  const tooltip = elements.networkTooltip;
  const shared = edge.post_codes.join(", ");
  tooltip.innerHTML = `
    <div class="tooltip-head">
      <span class="tooltip-avatar" style="background:${secondaryEdgeColor(edge.weight)}">↔</span>
      <span class="tooltip-title">
        <strong>@${escapeHtml(edge.source)} ↔ @${escapeHtml(edge.target)}</strong>
        <span>${formatNumber(edge.weight)} ${edge.weight === 1 ? "publicación compartida" : "publicaciones compartidas"}</span>
      </span>
    </div>
    <p class="comment-excerpt">${escapeHtml(shared)}</p>
  `;
  tooltip.hidden = false;
  placeNetworkTooltip(event, tooltip);
}

function renderSecondaryNetwork() {
  if (!state.data?.secondary_network) return;

  const allEdges = state.data.secondary_network.edges.filter(
    (edge) => edge.weight >= state.minSharedPosts,
  );
  const visibleEdges = allEdges.slice(0, state.topLimit);
  const endpointNames = new Set(
    visibleEdges.flatMap((edge) => [edge.source, edge.target]),
  );
  const nodeByUsername = new Map(
    state.data.secondary_network.nodes.map((node) => [node.username, node]),
  );
  const visibleDegree = new Map();
  for (const edge of visibleEdges) {
    visibleDegree.set(edge.source, (visibleDegree.get(edge.source) || 0) + 1);
    visibleDegree.set(edge.target, (visibleDegree.get(edge.target) || 0) + 1);
  }
  const positions = layoutSecondaryNetwork(visibleEdges);
  const edgeLayer = elements.networkEdges;
  const nodeLayer = elements.networkNodes;
  edgeLayer.replaceChildren();
  nodeLayer.replaceChildren();

  visibleEdges.forEach((edge) => {
    const source = positions.get(edge.source);
    const target = positions.get(edge.target);
    if (!source || !target) return;
    const line = createSvgElement("line", {
      x1: source.x,
      y1: source.y,
      x2: target.x,
      y2: target.y,
      class: "network-edge co-edge",
      stroke: secondaryEdgeColor(edge.weight),
      "stroke-opacity": edge.weight === 1 ? 0.2 : 0.48,
      "stroke-width": edge.weight === 1 ? 0.8 : edge.weight === 2 ? 1.8 : 3,
      tabindex: "0",
      role: "button",
      "aria-label": `@${edge.source} y @${edge.target}: ${edge.weight} publicaciones compartidas`,
    });
    line.dataset.edgeId = edge.id;
    line.dataset.source = edge.source;
    line.dataset.target = edge.target;
    line.addEventListener("pointerenter", (event) => showCoEdgeTooltip(event, edge));
    line.addEventListener("pointermove", (event) => showCoEdgeTooltip(event, edge));
    line.addEventListener("pointerleave", hideNetworkTooltip);
    line.addEventListener("click", (event) => {
      event.stopPropagation();
      selectEdge(state.selectedEdgeId === edge.id ? null : edge.id);
    });
    line.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        selectEdge(state.selectedEdgeId === edge.id ? null : edge.id);
      }
    });
    edgeLayer.appendChild(line);
  });

  const orderedNodes = [...endpointNames]
    .map((username) => nodeByUsername.get(username))
    .filter(Boolean)
    .sort(
      (a, b) =>
        (visibleDegree.get(b.username) || 0) - (visibleDegree.get(a.username) || 0) ||
        b.repeated_connections - a.repeated_connections ||
        a.username.localeCompare(b.username, "es"),
    );
  const maxConnections = Math.max(
    ...orderedNodes.map((account) => visibleDegree.get(account.username) || 0),
    1,
  );

  orderedNodes.forEach((account, index) => {
    const position = positions.get(account.username);
    if (!position) return;
    const visibleConnections = visibleDegree.get(account.username) || 1;
    const intensity = Math.sqrt(visibleConnections / maxConnections);
    const radius = 4.5 + intensity * 8;
    const color = account.repeated_connections > 0 ? "#3b6ef5" : "#7185a8";
    const selected = state.selectedUsername === account.username;
    const group = createSvgElement("g", {
      class: `network-node${selected ? " selected" : ""}`,
      "data-username": account.username,
      transform: `translate(${position.x} ${position.y})`,
      tabindex: "0",
      role: "button",
      "aria-label": `${account.full_name || account.username}, ${visibleConnections} co-comentadores visibles`,
    });
    group.appendChild(
      createSvgElement("circle", {
        r: radius + 4,
        fill: "transparent",
        stroke: color,
        class: "node-halo",
      }),
    );
    group.appendChild(
      createSvgElement("circle", {
        r: radius,
        fill: color,
        class: "node-core",
      }),
    );
    const title = createSvgElement("title");
    title.textContent = `@${account.username} · ${visibleConnections} vínculos visibles`;
    group.appendChild(title);
    group.addEventListener("pointerenter", (event) => showCoAccountTooltip(event, account));
    group.addEventListener("pointermove", (event) => showCoAccountTooltip(event, account));
    group.addEventListener("pointerleave", hideNetworkTooltip);
    group.addEventListener("click", (event) => {
      event.stopPropagation();
      selectAccount(selected ? null : account.username);
    });
    group.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        selectAccount(selected ? null : account.username);
      }
    });
    nodeLayer.appendChild(group);

    if (index < 10) {
      const isLeft = position.x < 500;
      const label = createSvgElement("text", {
        x: isLeft ? -radius - 6 : radius + 6,
        y: 4,
        "text-anchor": isLeft ? "end" : "start",
        class: "node-label",
      });
      label.textContent = `@${account.username.slice(0, 20)}`;
      group.appendChild(label);
    }
  });

  elements.centerGlowCircle.hidden = true;
  elements.networkEmpty.hidden = visibleEdges.length !== 0;
  elements.networkSvg.hidden = visibleEdges.length === 0;
  elements.networkEmptyTitle.textContent = "No hay co-comentarios con ese peso";
  elements.networkEmptyText.textContent =
    "Baja las coincidencias mínimas o cambia el alcance de publicaciones.";
  elements.networkSummary.textContent = visibleEdges.length
    ? `${formatNumber(visibleEdges.length)} de ${formatNumber(allEdges.length)} vínculos · ${formatNumber(endpointNames.size)} cuentas visibles`
    : "No hay vínculos otros–otros para el criterio seleccionado.";
  applySecondarySelection();
}

function applySecondarySelection() {
  const selectedEdge = state.data.secondary_network.edges.find(
    (edge) => edge.id === state.selectedEdgeId,
  );
  const selectedAccount = state.selectedUsername;
  for (const line of elements.networkEdges.children) {
    const isEdgeMatch = selectedEdge && line.dataset.edgeId === selectedEdge.id;
    const isAccountMatch =
      selectedAccount &&
      (line.dataset.source === selectedAccount || line.dataset.target === selectedAccount);
    const match = Boolean(isEdgeMatch || isAccountMatch);
    line.classList.toggle("focused", match);
    line.classList.toggle("muted", Boolean((selectedEdge || selectedAccount) && !match));
  }
  for (const node of elements.networkNodes.querySelectorAll(".network-node")) {
    const isSelected = selectedEdge
      ? node.dataset.username === selectedEdge.source || node.dataset.username === selectedEdge.target
      : node.dataset.username === selectedAccount;
    node.classList.toggle("selected", Boolean(isSelected));
    node.classList.toggle("muted", Boolean((selectedEdge || selectedAccount) && !isSelected));
  }
}

function contextColor(type) {
  return type === "location" ? "#0f9f91" : "#7c5ce0";
}

function contextDisplayName(item) {
  if (item.type === "music" && item.artist_name) {
    return `${item.artist_name} — ${item.name}`;
  }
  return item.name;
}

function showContextTooltip(event, item) {
  const tooltip = elements.networkTooltip;
  const typeLabel = item.type === "location" ? "Location Name" : "Music Info";
  tooltip.innerHTML = `
    <div class="tooltip-head">
      <span class="tooltip-avatar" style="background:${contextColor(item.type)}">${item.type === "location" ? "◇" : "♫"}</span>
      <span class="tooltip-title">
        <strong>${escapeHtml(contextDisplayName(item))}</strong>
        <span>${typeLabel}</span>
      </span>
    </div>
    <div class="tooltip-score">
      <span>publicaciones</span><b>${formatNumber(item.weight)}</b>
    </div>
    ${item.post_codes.length ? `<p class="comment-excerpt">${item.post_codes.map((code) => escapeHtml(code)).join(" · ")}</p>` : ""}
  `;
  tooltip.hidden = false;
  placeNetworkTooltip(event, tooltip);
}

function renderContextNetwork() {
  if (!state.data?.context_network) return;
  const allItems = state.data.context_network.relationships
    .filter((item) => item.weight >= state.minContextPosts)
    .sort((a, b) => b.weight - a.weight || a.name.localeCompare(b.name, "es"));
  const visibleItems = allItems.slice(0, state.topLimit);
  const positions = layoutContextNetwork(visibleItems);
  const maxWeight = visibleItems[0]?.weight || 1;
  const edgeLayer = elements.networkEdges;
  const nodeLayer = elements.networkNodes;
  edgeLayer.replaceChildren();
  nodeLayer.replaceChildren();

  visibleItems.forEach((item) => {
    const position = positions.get(item.id);
    if (!position) return;
    const intensity = Math.sqrt(item.weight / maxWeight);
    const edge = createSvgElement("line", {
      x1: 500,
      y1: 330,
      x2: position.x,
      y2: position.y,
      class: "network-edge context-edge",
      stroke: contextColor(item.type),
      "stroke-opacity": 0.16 + intensity * 0.35,
      "stroke-width": 0.9 + intensity * 5,
    });
    edge.dataset.contextId = item.id;
    edge.addEventListener("pointerenter", (event) => showContextTooltip(event, item));
    edge.addEventListener("pointermove", (event) => showContextTooltip(event, item));
    edge.addEventListener("pointerleave", hideNetworkTooltip);
    edge.addEventListener("click", (event) => {
      event.stopPropagation();
      selectContext(state.selectedContextId === item.id ? null : item.id);
    });
    edgeLayer.appendChild(edge);
  });

  const centerGroup = createSvgElement("g", {
    class: "network-node center-node",
    tabindex: "0",
    role: "img",
    "aria-label": `Cuenta principal @${state.data.main.username}`,
  });
  centerGroup.appendChild(
    createSvgElement("circle", {
      cx: 500,
      cy: 330,
      r: 35,
      fill: "#172033",
      class: "node-core",
    }),
  );
  const centerLabel = createSvgElement("text", {
    x: 500,
    y: 335,
    "text-anchor": "middle",
    class: "node-label center-label",
  });
  centerLabel.textContent = `@${state.data.main.username.slice(0, 16)}`;
  centerGroup.appendChild(centerLabel);
  centerGroup.addEventListener("click", () => selectContext(null));
  nodeLayer.appendChild(centerGroup);

  visibleItems.forEach((item) => {
    const position = positions.get(item.id);
    if (!position) return;
    const intensity = Math.sqrt(item.weight / maxWeight);
    const radius = 7 + intensity * 12;
    const color = contextColor(item.type);
    const selected = state.selectedContextId === item.id;
    const group = createSvgElement("g", {
      class: `network-node${selected ? " selected" : ""}`,
      "data-context-id": item.id,
      transform: `translate(${position.x} ${position.y})`,
      tabindex: "0",
      role: "button",
      "aria-label": `${contextDisplayName(item)}, ${item.weight} publicaciones`,
    });
    group.append(
      createSvgElement("circle", {
        r: radius + 5,
        class: "node-halo",
        stroke: color,
      }),
      createSvgElement("circle", {
        r: radius,
        fill: color,
        class: "node-core",
      }),
    );
    group.addEventListener("pointerenter", (event) => showContextTooltip(event, item));
    group.addEventListener("pointermove", (event) => showContextTooltip(event, item));
    group.addEventListener("pointerleave", hideNetworkTooltip);
    group.addEventListener("click", (event) => {
      event.stopPropagation();
      selectContext(selected ? null : item.id);
    });
    group.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        selectContext(selected ? null : item.id);
      }
    });
    nodeLayer.appendChild(group);
    const label = createSvgElement("text", {
      x: position.x < 500 ? -radius - 7 : radius + 7,
      y: 4,
      "text-anchor": position.x < 500 ? "end" : "start",
      class: "node-label",
    });
    label.textContent = contextDisplayName(item).slice(0, 30);
    group.appendChild(label);
  });

  elements.centerGlowCircle.hidden = false;
  elements.networkEmpty.hidden = visibleItems.length !== 0;
  elements.networkSvg.hidden = visibleItems.length === 0;
  elements.networkEmptyTitle.textContent = "No hay lugares ni música para este filtro";
  elements.networkEmptyText.textContent =
    "Baja las repeticiones mínimas o cambia el alcance de las publicaciones.";
  elements.networkSummary.textContent = visibleItems.length
    ? `${formatNumber(visibleItems.length)} de ${formatNumber(allItems.length)} contextos · ${formatNumber(state.data.context_network.summary.posts_with_context)} publicaciones cubiertas`
    : "No hay contextos para el criterio seleccionado.";
  applyContextSelection();
}

function applyContextSelection() {
  const selected = state.selectedContextId;
  for (const edge of elements.networkEdges.children) {
    const match = edge.dataset.contextId === selected;
    edge.classList.toggle("focused", Boolean(selected && match));
    edge.classList.toggle("muted", Boolean(selected && !match));
  }
  for (const node of elements.networkNodes.querySelectorAll(".network-node[data-context-id]")) {
    const match = node.dataset.contextId === selected;
    node.classList.toggle("selected", match);
    node.classList.toggle("muted", Boolean(selected && !match));
  }
}

function renderNetwork() {
  if (state.networkView === "co") {
    renderSecondaryNetwork();
  } else if (state.networkView === "context") {
    renderContextNetwork();
  } else {
    elements.centerGlowCircle.hidden = false;
    elements.networkEmptyTitle.textContent = "No hay vínculos con el criterio elegido";
    elements.networkEmptyText.textContent =
      "Cambia la fuente de relación o aumenta alguno de sus pesos.";
    renderEgoNetwork();
  }
}

function selectContext(contextId) {
  state.selectedContextId = contextId;
  state.selectedEdgeId = null;
  state.selectedUsername = null;
  renderNetwork();
  renderInspector();
  renderTable();
}

function selectEdge(edgeId) {
  state.selectedEdgeId = edgeId;
  state.selectedUsername = null;
  state.selectedContextId = null;
  renderNetwork();
  renderInspector();
  renderTable();
}

function selectAccount(username) {
  state.selectedUsername = username;
  state.selectedEdgeId = null;
  state.selectedContextId = null;
  renderNetwork();
  renderInspector();
  renderTable();
}

function renderCoEdgeInspector(edge) {
  const nodeByUsername = new Map(
    state.data.secondary_network.nodes.map((node) => [node.username, node]),
  );
  const source = nodeByUsername.get(edge.source);
  const target = nodeByUsername.get(edge.target);
  elements.accountInspector.innerHTML = `
    <p class="section-kicker">Inspector de vínculo</p>
    <div class="inspector-heading">
      <div class="avatar" style="background:${secondaryEdgeColor(edge.weight)}">↔</div>
      <div>
        <h3>${formatNumber(edge.weight)} ${edge.weight === 1 ? "publicación compartida" : "publicaciones compartidas"}</h3>
        <p>Relación inferida, no interacción directa demostrada.</p>
      </div>
    </div>
    <div class="pair-accounts inspector-pair">
      <span class="pair-account"><a href="${profileUrl(edge.source)}" target="_blank" rel="noopener noreferrer">@${escapeHtml(edge.source)}</a><span>${escapeHtml(source?.full_name || "Cuenta A")}</span></span>
      <span class="pair-arrow">↔</span>
      <span class="pair-account"><a href="${profileUrl(edge.target)}" target="_blank" rel="noopener noreferrer">@${escapeHtml(edge.target)}</a><span>${escapeHtml(target?.full_name || "Cuenta B")}</span></span>
    </div>
    <p class="comment-excerpt">${edge.post_codes.map((code) => escapeHtml(code)).join(" · ")}</p>
  `;
  elements.mainProfileLink.href = profileUrl(edge.source);
  elements.mainProfileLink.innerHTML = `Abrir @${escapeHtml(edge.source)} <span aria-hidden="true">↗</span>`;
}

function renderContextInspector(item) {
  const typeLabel = item.type === "location" ? "Location Name" : "Music Info";
  const color = contextColor(item.type);
  elements.accountInspector.innerHTML = `
    <p class="section-kicker">Inspector de contexto</p>
    <div class="inspector-heading">
      <div class="avatar" style="background:${color}">${item.type === "location" ? "◇" : "♫"}</div>
      <div>
        <h3>${escapeHtml(contextDisplayName(item))}</h3>
        <p>${typeLabel} · ${formatNumber(item.weight)} ${item.weight === 1 ? "publicación" : "publicaciones"}</p>
      </div>
    </div>
    <div class="evidence-list">
      <div class="evidence-row"><span>Tipo de fuente</span><b>${escapeHtml(typeLabel)}</b><div class="evidence-track"><div class="evidence-fill" style="width:100%;background:${color}"></div></div></div>
      <div class="evidence-row"><span>Publicaciones</span><b>${formatNumber(item.weight)}</b><div class="evidence-track"><div class="evidence-fill" style="width:100%;background:${color}"></div></div></div>
    </div>
    <p class="comment-excerpt">${item.post_codes.map((code) => escapeHtml(code)).join(" · ")}</p>
  `;
  elements.mainProfileLink.href = profileUrl(state.data.main.username);
  elements.mainProfileLink.innerHTML = `Abrir @${escapeHtml(state.data.main.username)} <span aria-hidden="true">↗</span>`;
}

function renderInspector() {
  const profileLink = elements.mainProfileLink;
  if (state.networkView === "context" && state.selectedContextId) {
    const selectedContext = state.data.context_network.relationships.find(
      (item) => item.id === state.selectedContextId,
    );
    if (selectedContext) {
      renderContextInspector(selectedContext);
      return;
    }
  }
  if (state.networkView === "co" && state.selectedEdgeId) {
    const selectedEdge = state.data.secondary_network.edges.find(
      (edge) => edge.id === state.selectedEdgeId,
    );
    if (selectedEdge) {
      renderCoEdgeInspector(selectedEdge);
      return;
    }
  }

  const accountCollection =
    state.networkView === "co"
      ? state.data.secondary_network.nodes
      : state.data.relationships;
  const selected = accountCollection.find(
    (account) => account.username === state.selectedUsername,
  );

  if (!selected) {
    const isCo = state.networkView === "co";
    const isContext = state.networkView === "context";
    const title = isCo
      ? "Relación otros–otros"
      : isContext
        ? "Lugar y música"
        : escapeHtml(state.data.main.full_name || `@${state.data.main.username}`);
    const description = isCo
      ? "Selecciona un nodo o una arista para inspeccionar las coincidencias."
      : isContext
        ? "Selecciona un lugar o una pista para ver sus publicaciones."
        : "Selecciona una cuenta conectada para ver su evidencia.";
    elements.accountInspector.innerHTML = `
      <p class="section-kicker">${isCo ? "Lector de co-comentadores" : isContext ? "Lector de contexto" : "Inspector de nodo"}</p>
      <div class="central-summary">
        <div class="avatar avatar-center" aria-hidden="true">${isCo ? "↔" : isContext ? "◇" : "@"}</div>
        <div>
          <h3>${title}</h3>
          <p>${description}</p>
        </div>
      </div>
    `;
    profileLink.href = profileUrl(state.data.main.username);
    profileLink.innerHTML = `Abrir @${escapeHtml(state.data.main.username)} <span aria-hidden="true">↗</span>`;
    return;
  }

  if (state.networkView === "co") {
    const maxEvidence = Math.max(
      selected.secondary_connections,
      selected.repeated_connections,
      selected.single_post_connections,
      selected.comments_captured,
      selected.commented_posts,
      1,
    );
    const evidence = [
      ["secondary_connections", "Cuentas co-comentadoras", "#3b6ef5"],
      ["repeated_connections", "Vínculos repetidos (2+)", "#e89a24"],
      ["single_post_connections", "Vínculos de una publicación", "#9eb2d1"],
      ["comments_captured", "Comentarios capturados", "#3b6ef5"],
      ["commented_posts", "Publicaciones comentadas", "#7185a8"],
    ];
    profileLink.href = profileUrl(selected.username);
    profileLink.innerHTML = `Abrir @${escapeHtml(selected.username)} <span aria-hidden="true">↗</span>`;
    elements.accountInspector.innerHTML = `
      <p class="section-kicker">Inspector de nodo</p>
      <div class="inspector-heading">
        <div class="avatar" style="background:#3b6ef5">${escapeHtml(initials(selected))}</div>
        <div>
          <h3>${escapeHtml(selected.full_name)} ${selected.verified ? '<span class="verified-badge" title="Verificada">●</span>' : ""}</h3>
          <p>@${escapeHtml(selected.username)} · componente ${formatNumber(selected.component + 1)}</p>
        </div>
      </div>
      <div class="evidence-list">
        ${evidence
          .map(([source, label, color]) => {
            const value = selected[source];
            const width = Math.max((value / maxEvidence) * 100, value > 0 ? 4 : 0);
            return `<div class="evidence-row"><span>${escapeHtml(label)}</span><b>${formatNumber(value)}</b><div class="evidence-track"><div class="evidence-fill" style="width:${width}%;background:${color}"></div></div></div>`;
          })
          .join("")}
      </div>
    `;
    return;
  }

  const maxEvidence = Math.max(
    selected.comments_captured,
    selected.commented_posts,
    selected.mentions,
    selected.tagged,
    selected.coauthors,
    1,
  );
  const evidence = [
    ["comments", "Comentarios capturados"],
    ["commented_posts", "Publicaciones comentadas"],
    ["mentions", "Menciones"],
    ["tagged", "Publicaciones etiquetadas"],
    ["coauthors", "Publicaciones con coautoría"],
  ];
  const firstComment = selected.comment_excerpts?.[0]?.text;
  profileLink.href = profileUrl(selected.username);
  profileLink.innerHTML = `Abrir @${escapeHtml(selected.username)} <span aria-hidden="true">↗</span>`;

  elements.accountInspector.innerHTML = `
    <p class="section-kicker">Inspector de nodo</p>
    <div class="inspector-heading">
      <div class="avatar" style="background:${SOURCE_META[sourceFor(selected)].color}">${escapeHtml(initials(selected))}</div>
      <div>
        <h3>${escapeHtml(selected.full_name)} ${selected.verified ? '<span class="verified-badge" title="Verificada">●</span>' : ""}</h3>
        <p>@${escapeHtml(selected.username)} · ${formatNumber(selected.related_post_codes.length)} publicaciones relacionadas</p>
      </div>
    </div>
    <div class="evidence-list">
      ${evidence
        .map(([source, label]) => {
          const value = selected[source];
          const width = Math.max((value / maxEvidence) * 100, value > 0 ? 4 : 0);
          return `
            <div class="evidence-row">
              <span>${escapeHtml(label)}</span>
              <b>${formatNumber(value)}</b>
              <div class="evidence-track"><div class="evidence-fill" style="width:${width}%;background:${SOURCE_META[source].color}"></div></div>
            </div>
          `;
        })
        .join("")}
    </div>
    ${firstComment ? `<p class="comment-excerpt">“${escapeHtml(firstComment.slice(0, 180))}”</p>` : ""}
  `;
}

function renderMix() {
  const sourceConfig = [
    ["comments", "Comentarios", "blue"],
    ["mentions", "menciones", "magenta"],
    ["tagged", "etiquetas", "amber"],
    ["coauthors", "coautores", "green"],
  ];
  const maxOccurrences = Math.max(
    ...sourceConfig.map(([source]) => state.data.sources[source].occurrences),
    1,
  );

  elements.mixList.innerHTML = sourceConfig
    .map(([source, label, color]) => {
      const item = state.data.sources[source];
      const width = (item.occurrences / maxOccurrences) * 100;
      return `
        <div class="mix-row">
          <div class="mix-label">
            <span><i style="background:var(--${color === "blue" ? "blue" : color})"></i>${escapeHtml(label)}</span>
            <b>${formatNumber(item.occurrences)}</b>
          </div>
          <div class="mix-track"><div class="mix-fill ${color}" style="width:${width}%"></div></div>
        </div>
      `;
    })
    .join("");
  elements.mixFootnote.textContent = `${formatNumber(
    state.data.summary.connected_accounts,
  )} cuentas únicas. Las cifras son ocurrencias de relación, no personas clasificadas.`;
}

function filteredRelationships() {
  const query = normalizeSearch(state.search);
  return rankedRelationships().filter((account) => {
    if (!query) return true;
    return normalizeSearch(
      `${account.username} ${account.full_name} ${account.last_seen || ""}`,
    ).includes(query);
  });
}

function filteredSecondaryEdges() {
  const query = normalizeSearch(state.search);
  return state.data.secondary_network.edges.filter((edge) => {
    if (edge.weight < state.minSharedPosts) return false;
    if (!query) return true;
    return normalizeSearch(
      `${edge.source} ${edge.target} ${edge.post_codes.join(" ")}`,
    ).includes(query);
  });
}

function filteredContextRelationships() {
  const query = normalizeSearch(state.search);
  return state.data.context_network.relationships.filter((item) => {
    if (item.weight < state.minContextPosts) return false;
    if (!query) return true;
    return normalizeSearch(
      `${item.type} ${item.name} ${item.artist_name || ""} ${item.post_codes.join(" ")}`,
    ).includes(query);
  });
}

function renderContextTable() {
  const allItems = state.data.context_network.relationships
    .filter((item) => item.weight >= state.minContextPosts)
    .sort((a, b) => b.weight - a.weight || a.name.localeCompare(b.name, "es"));
  const filtered = filteredContextRelationships();
  const locations = allItems.filter((item) => item.type === "location").length;
  const music = allItems.filter((item) => item.type === "music").length;
  const publicationLabel = state.minContextPosts === 1 ? "publicación" : "publicaciones";
  elements.tableSubtitle.textContent = `${formatNumber(locations)} lugares y ${formatNumber(music)} pistas con ${state.minContextPosts}+ ${publicationLabel} en este filtro.`;

  if (!filtered.length) {
    elements.relationshipsBody.innerHTML =
      '<tr><td colspan="7" class="table-empty">No hay coincidencias.</td></tr>';
    elements.tableFooter.textContent = "0 coincidencias";
    return;
  }

  elements.relationshipsBody.innerHTML = filtered
    .map((item) => {
      const color = contextColor(item.type);
      const selected = state.selectedContextId === item.id;
      const typeLabel = item.type === "location" ? "Location Name" : "Music Info";
      return `
        <tr data-context-id="${escapeHtml(item.id)}" class="${selected ? "selected" : ""}" tabindex="0">
          <td>
            <div class="account-cell">
              <span class="account-mini-avatar" style="background:${color}">${item.type === "location" ? "◇" : "♫"}</span>
              <span class="account-copy">
                <strong>${escapeHtml(contextDisplayName(item))}</strong>
                <span>${escapeHtml(typeLabel)}</span>
              </span>
            </div>
          </td>
          <td class="numeric score-cell">${formatNumber(item.weight)}</td>
          <td colspan="5" hidden></td>
        </tr>
      `;
    })
    .join("");

  for (const row of elements.relationshipsBody.querySelectorAll("tr[data-context-id]")) {
    const selectRow = () => selectContext(row.dataset.contextId);
    row.addEventListener("click", selectRow);
    row.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        selectRow();
      }
    });
  }
  elements.tableFooter.textContent = `Mostrando ${formatNumber(filtered.length)} de ${formatNumber(allItems.length)} contextos.`;
}

function renderSecondaryTable() {
  const allEdges = state.data.secondary_network.edges.filter(
    (edge) => edge.weight >= state.minSharedPosts,
  );
  const filtered = filteredSecondaryEdges();
  const repeated = allEdges.filter((edge) => edge.weight >= 2).length;
  elements.tableSubtitle.textContent = `${formatNumber(allEdges.length)} vínculos con ${state.minSharedPosts}+ coincidencia${state.minSharedPosts === 1 ? "" : "s"}; ${formatNumber(repeated)} se repiten en más de una publicación.`;

  if (filtered.length === 0) {
    elements.relationshipsBody.innerHTML =
      '<tr><td colspan="7" class="table-empty">No hay coincidencias.</td></tr>';
    elements.tableFooter.textContent = "0 coincidencias";
    return;
  }

  elements.relationshipsBody.innerHTML = filtered
    .map((edge) => {
      const selected = state.selectedEdgeId === edge.id;
      const weightClass = edge.weight >= 3 ? "strong" : edge.weight === 2 ? "medium" : "";
      return `
        <tr data-edge-id="${escapeHtml(edge.id)}" class="${selected ? "selected" : ""}" tabindex="0">
          <td>
            <div class="pair-cell">
              <span class="pair-accounts">
                <span class="pair-account"><a href="${profileUrl(edge.source)}" target="_blank" rel="noopener noreferrer">@${escapeHtml(edge.source)}</a><span>Cuenta A</span></span>
                <span class="pair-arrow" aria-hidden="true">↔</span>
                <span class="pair-account"><a href="${profileUrl(edge.target)}" target="_blank" rel="noopener noreferrer">@${escapeHtml(edge.target)}</a><span>Cuenta B</span></span>
              </span>
              <span class="pair-weight ${weightClass}" title="Publicaciones compartidas">${formatNumber(edge.weight)}</span>
            </div>
          </td>
          <td class="numeric score-cell">${formatNumber(edge.weight)}</td>
          <td colspan="5" hidden></td>
        </tr>
      `;
    })
    .join("");

  for (const row of elements.relationshipsBody.querySelectorAll("tr[data-edge-id]")) {
    const selectRow = () => selectEdge(row.dataset.edgeId);
    row.addEventListener("click", selectRow);
    row.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        selectRow();
      }
    });
    for (const link of row.querySelectorAll("a")) {
      link.addEventListener("click", (event) => event.stopPropagation());
    }
  }

  elements.tableFooter.textContent = `Mostrando ${formatNumber(filtered.length)} de ${formatNumber(
    allEdges.length,
  )} vínculos inferidos por co-comentario.`;
}

function renderTable() {
  if (state.networkView === "co") {
    renderSecondaryTable();
    return;
  }
  if (state.networkView === "context") {
    renderContextTable();
    return;
  }
  const allRanked = rankedRelationships();
  const filtered = filteredRelationships();
  elements.tableSubtitle.textContent = `${formatNumber(allRanked.length)} cuentas con puntaje positivo; pesos visibles, sin normalización.`;

  if (filtered.length === 0) {
    elements.relationshipsBody.innerHTML =
      '<tr><td colspan="7" class="table-empty">No hay coincidencias.</td></tr>';
    elements.tableFooter.textContent = "0 coincidencias";
    return;
  }

  elements.relationshipsBody.innerHTML = filtered
    .map((account) => {
      const color = SOURCE_META[sourceFor(account)].color;
      const selected = state.selectedUsername === account.username;
      return `
        <tr data-username="${escapeHtml(account.username)}" class="${selected ? "selected" : ""}" tabindex="0">
          <td>
            <div class="account-cell">
              <span class="account-mini-avatar" style="background:${color}">${escapeHtml(initials(account))}</span>
              <span class="account-copy">
                <a href="${profileUrl(account.username)}" target="_blank" rel="noopener noreferrer">@${escapeHtml(account.username)}</a>
                <span>${escapeHtml(account.full_name || "Sin nombre público")}</span>
              </span>
            </div>
          </td>
          <td class="numeric score-cell">${formatNumber(account.score)}</td>
          <td class="numeric">${formatNumber(account.comments_captured)}</td>
          <td class="numeric">${formatNumber(account.commented_posts)}</td>
          <td class="numeric">${formatNumber(account.mentions)}</td>
          <td class="numeric">${formatNumber(account.tagged)}</td>
          <td class="numeric">${formatNumber(account.coauthors)}</td>
        </tr>
      `;
    })
    .join("");

  for (const row of elements.relationshipsBody.querySelectorAll("tr[data-username]")) {
    const selectRow = () => selectAccount(row.dataset.username);
    row.addEventListener("click", selectRow);
    row.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        selectRow();
      }
    });
    row.querySelector("a")?.addEventListener("click", (event) => event.stopPropagation());
  }

  elements.tableFooter.textContent = `Mostrando ${formatNumber(filtered.length)} de ${formatNumber(
    allRanked.length,
  )} cuentas con puntaje positivo.`;
}

function renderPosts() {
  const posts = [...state.data.posts]
    .sort((a, b) => b.likes + b.reported_comments - (a.likes + a.reported_comments))
    .slice(0, 10);

  if (posts.length === 0) {
    elements.postList.innerHTML = '<p class="table-empty">No hay publicaciones en este alcance.</p>';
    return;
  }

  elements.postList.innerHTML = posts
    .map((post, index) => {
      const caption = post.caption.trim() || "Publicación sin texto en el pie";
      const coverage = post.reported_comments
        ? Math.min(post.captured_comments / post.reported_comments, 1)
        : null;
      const coverageText = coverage === null ? "Sin comentarios" : `${Math.round(coverage * 100)}% muestra`;
      return `
        <article class="post-card">
          <span class="post-rank">${String(index + 1).padStart(2, "0")}</span>
          <div class="post-body">
            <div class="post-meta">
              <time datetime="${escapeHtml(post.timestamp || "")}">${escapeHtml(formatDate(post.timestamp))}</time>
              <span class="post-author">@${escapeHtml(post.owner_username || "desconocida")}</span>
            </div>
            <a class="post-caption" href="${postUrl(post.short_code)}" target="_blank" rel="noopener noreferrer" title="${escapeHtml(caption)}">${escapeHtml(caption)}</a>
            <div class="post-metrics">
              <span title="Likes">♡ ${formatNumber(post.likes)}</span>
              <span title="Comentarios reportados">◌ ${formatNumber(post.reported_comments)}</span>
              <span class="coverage-chip" title="Comentarios presentes en latestComments">${escapeHtml(coverageText)}</span>
            </div>
          </div>
        </article>
      `;
    })
    .join("");
}

function renderLimitations() {
  elements.manualLimitations.innerHTML = state.data.quality.limitations
    .map((limitation) => `<li>${escapeHtml(limitation)}</li>`)
    .join("");
}

function updateTableMode() {
  const isCo = state.networkView === "co";
  const isContext = state.networkView === "context";
  const compact = isCo || isContext;
  elements.tableKicker.textContent = isCo
    ? "Co-comentarios"
    : isContext
      ? "Contexto"
      : "Ranking";
  elements.tableTitle.textContent = isCo
    ? "Vínculos entre cuentas"
    : isContext
      ? "Lugares y música"
      : "Cuentas relacionadas";
  elements.accountColumn.textContent = isCo ? "Cuenta A ↔ Cuenta B" : isContext ? "Contexto" : "Cuenta";
  elements.scoreColumn.textContent = isCo || isContext ? "Publicaciones" : "Puntaje";
  elements.commentsColumn.hidden = compact;
  elements.postsColumn.hidden = compact;
  elements.mentionsColumn.hidden = compact;
  elements.taggedColumn.hidden = compact;
  elements.coauthorsColumn.hidden = compact;
  elements.accountSearch.placeholder = isCo
    ? "Buscar en pares"
    : isContext
      ? "Buscar lugar o música"
      : "Buscar cuenta";
}

function updateNetworkControls() {
  const isCo = state.networkView === "co";
  const isContext = state.networkView === "context";
  const isEgo = state.networkView === "ego";
  const secondarySummary = state.data.secondary_network.summary;
  const contextSummary = state.data.context_network.summary;

  elements.egoViewButton.classList.toggle("active", isEgo);
  elements.coViewButton.classList.toggle("active", isCo);
  elements.contextViewButton.classList.toggle("active", isContext);
  elements.egoViewButton.setAttribute("aria-selected", String(isEgo));
  elements.coViewButton.setAttribute("aria-selected", String(isCo));
  elements.contextViewButton.setAttribute("aria-selected", String(isContext));
  elements.viewSwitchNote.textContent = isCo
    ? "La cuenta principal queda fuera del centro: las aristas unen únicamente cuentas periféricas."
    : isContext
      ? "La cuenta principal conecta con cada lugar o pista observada en sus publicaciones."
      : "La cuenta principal se mantiene fija al centro.";

  elements.networkKicker.textContent = isCo
    ? "Co-comment network"
    : isContext
      ? "Context network"
      : "Ego network";
  elements.networkDescriptionText.textContent = isCo
    ? "Dos cuentas están conectadas si comentan la misma publicación; el peso cuenta publicaciones compartidas."
    : isContext
      ? "Cada arista une la cuenta con un Location Name o Music Info; el peso cuenta publicaciones."
      : "El grosor de cada vínculo representa su ponderación dentro del criterio elegido.";
  elements.networkDescription.textContent = isCo
    ? "Red de co-comentadores; las cuentas con más enlaces visibles se colocan más cerca."
    : isContext
      ? "Red entre la cuenta principal y sus lugares y pistas musicales observadas."
      : "La cuenta principal aparece en el centro y los vínculos usan el criterio seleccionado.";
  elements.metricSelect.closest("label").hidden = !isEgo;
  elements.weightToggle.hidden = !isEgo;
  elements.minSharedControl.hidden = !isCo;
  elements.minContextControl.hidden = !isContext;
  elements.coCommentNote.hidden = !isCo;
  elements.contextNote.hidden = !isContext;
  elements.egoLegend.hidden = !isEgo;
  elements.coLegend.hidden = !isCo;
  elements.contextLegend.hidden = !isContext;
  elements.networkHint.textContent = isCo
    ? "Pasa sobre una arista para ver las publicaciones compartidas"
    : isContext
      ? "Pasa sobre un lugar o una pista para ver sus publicaciones"
      : "Pasa sobre un nodo y haz clic para inspeccionarlo";
  elements.networkFooterNote.innerHTML = isCo
    ? "Las coincidencias no prueban una relación social directa."
    : isContext
      ? "Una ubicación o una pista describen el contenido publicado."
      : '<i class="center-example"></i> La cuenta central no participa en su propio puntaje.';

  const maxTop = isCo ? 200 : 100;
  elements.topRange.max = String(maxTop);
  if (state.topLimit > maxTop) state.topLimit = maxTop;
  elements.topRange.value = String(state.topLimit);
  elements.topRangeText.textContent = isCo ? "Vínculos visibles" : isContext ? "Contextos visibles" : "Cuentas visibles";
  elements.topRangeValue.value = String(state.topLimit);
  elements.minSharedRange.value = String(state.minSharedPosts);
  elements.minSharedValue.value = String(state.minSharedPosts);
  const maxContextWeight = Math.max(
    ...state.data.context_network.relationships.map((item) => item.weight),
    1,
  );
  elements.minContextRange.max = String(Math.max(2, maxContextWeight));
  if (state.minContextPosts > Number(elements.minContextRange.max)) {
    state.minContextPosts = 1;
  }
  elements.minContextRange.value = String(state.minContextPosts);
  elements.minContextValue.value = String(state.minContextPosts);
  elements.coQualityCounts.innerHTML = `
    <span>${formatNumber(secondarySummary.single_post_edges)} con 1 coincidencia</span>
    <span>${formatNumber(secondarySummary.repeated_edges)} repetidos</span>
    <span>componente mayor: ${formatNumber(secondarySummary.largest_component)}</span>
  `;
  elements.contextQualityCounts.innerHTML = `
    <span>${formatNumber(contextSummary.unique_locations)} lugares</span>
    <span>${formatNumber(contextSummary.unique_music_items)} pistas</span>
    <span>${formatNumber(contextSummary.posts_with_context)} publicaciones</span>
  `;

  document.querySelector(".network-controls")?.classList.toggle("co-mode", isCo || isContext);
  updateTableMode();
}

function updateWeightControls() {
  const pairings = [
    ["comments", "commentsWeight", "commentsWeightValue"],
    ["commented_posts", "commentedPostsWeight", "commentedPostsWeightValue"],
    ["mentions", "mentionsWeight", "mentionsWeightValue"],
    ["tagged", "taggedWeight", "taggedWeightValue"],
    ["coauthors", "coauthorsWeight", "coauthorsWeightValue"],
  ];
  for (const [source, inputId, outputId] of pairings) {
    elements[inputId].value = String(state.weights[source]);
    elements[outputId].value = String(state.weights[source]);
  }
  const combined = state.networkView === "ego" && state.metric === "combined";
  elements.weightToggle.disabled = !combined;
  if (!combined) {
    elements.weightToggle.setAttribute("aria-expanded", "false");
    elements.weightPanel.hidden = true;
  }
}

function renderAll() {
  renderHeader();
  updateNetworkControls();
  renderKpis();
  renderMonthlyCharts(state.data.monthly_series);
  renderScopeOptions();
  updateWeightControls();
  renderNetwork();
  renderInspector();
  renderMix();
  renderTable();
  renderPosts();
  renderLimitations();
}

function quoteCsv(value) {
  let text = String(value ?? "");
  if (/^[=+\-@]/.test(text)) text = `'${text}`;
  return `"${text.replaceAll('"', '""')}"`;
}

function downloadCsv() {
  const isCo = state.networkView === "co";
  const isContext = state.networkView === "context";
  const rows = isCo
    ? filteredSecondaryEdges()
    : isContext
      ? filteredContextRelationships()
      : filteredRelationships();
  const header = isCo
    ? ["cuenta_a", "cuenta_b", "publicaciones_compartidas", "codigos_publicaciones"]
    : isContext
      ? ["tipo", "nombre", "artista", "publicaciones", "codigos_publicaciones"]
      : [
          "cuenta",
          "nombre",
          "puntaje",
          "comentarios_capturados",
          "publicaciones_comentadas",
          "menciones",
          "publicaciones_etiquetadas",
          "publicaciones_coautoria",
          "ultima_actividad",
        ];
  const dataRows = isCo
    ? rows.map((edge) => [
        edge.source,
        edge.target,
        edge.weight,
        edge.post_codes.join(" "),
      ])
    : isContext
      ? rows.map((item) => [
          item.type === "location" ? "Location Name" : "Music Info",
          item.name,
          item.artist_name || "",
          item.weight,
          item.post_codes.join(" "),
        ])
      : rows.map((account) => [
          account.username,
          account.full_name,
          account.score,
          account.comments_captured,
          account.commented_posts,
          account.mentions,
          account.tagged,
          account.coauthors,
          account.last_seen || "",
        ]);
  const csv = [
    header.map(quoteCsv).join(","),
    ...dataRows.map((row) => row.map(quoteCsv).join(",")),
  ].join("\n");

  const blob = new Blob(["\ufeff", csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = isCo
    ? `co-comentarios-${state.data.main.username}.csv`
    : isContext
      ? `contexto-${state.data.main.username}.csv`
      : `relaciones-${state.data.main.username}-${state.metric}.csv`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
  showToast(
    `CSV preparado con ${formatNumber(rows.length)} ${isCo ? "vínculos" : isContext ? "contextos" : "cuentas"}.`,
  );
}

function setNetworkView(view) {
  if (!["ego", "co", "context"].includes(view) || state.networkView === view) return;
  state.networkView = view;
  state.selectedUsername = null;
  state.selectedEdgeId = null;
  state.selectedContextId = null;
  updateNetworkControls();
  updateWeightControls();
  renderKpis();
  renderNetwork();
  renderInspector();
  renderTable();
  networkCamera?.reset();
}

function setPage(page) {
  if (!["dashboard", "manual"].includes(page)) return;
  state.currentPage = page;
  elements.dashboardPage.hidden = page !== "dashboard";
  elements.manualPage.hidden = page !== "manual";
  for (const button of document.querySelectorAll("[data-page]")) {
    const active = button.dataset.page === page;
    button.classList.toggle("active", active);
    button.setAttribute("aria-selected", String(active));
  }
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function bindEvents() {
  elements.startUploadButton.addEventListener("click", () => elements.startFileInput.click());
  elements.startFileInput.addEventListener("change", () =>
    uploadDataset(elements.startFileInput.files?.[0]),
  );
  elements.uploadButton.addEventListener("click", () => elements.fileInput.click());
  elements.fileInput.addEventListener("change", () => uploadDataset(elements.fileInput.files?.[0]));

  for (const eventName of ["dragenter", "dragover"]) {
    elements.startDropZone.addEventListener(eventName, (event) => {
      event.preventDefault();
      elements.startDropZone.classList.add("dragging");
    });
  }
  for (const eventName of ["dragleave", "drop"]) {
    elements.startDropZone.addEventListener(eventName, (event) => {
      event.preventDefault();
      elements.startDropZone.classList.remove("dragging");
    });
  }
  elements.startDropZone.addEventListener("drop", (event) => {
    uploadDataset(event.dataTransfer?.files?.[0]);
  });
  elements.resumeButton.addEventListener("click", () => {
    showDashboard();
    loadAnalysis({ announce: true });
  });
  elements.homeButton.addEventListener("click", () => {
    if (state.serverStatus?.has_data) {
      elements.resumeButton.hidden = false;
      setStartStatus(
        `Hay un archivo cargado actualmente: ${state.serverStatus.source_name}.`,
        "success",
      );
    } else {
      setStartStatus("Formato requerido: JSON de Apify Instagram Scraper.");
    }
    showStartScreen();
  });

  elements.mainForm.addEventListener("submit", (event) => {
    event.preventDefault();
    loadAnalysis({ announce: true });
  });

  elements.scopeSelect.addEventListener("change", () => loadAnalysis());
  elements.egoViewButton.addEventListener("click", () => setNetworkView("ego"));
  elements.coViewButton.addEventListener("click", () => setNetworkView("co"));
  elements.contextViewButton.addEventListener("click", () => setNetworkView("context"));
  for (const button of document.querySelectorAll("[data-page]")) {
    button.addEventListener("click", () => setPage(button.dataset.page));
  }
  elements.backToDashboard.addEventListener("click", () => setPage("dashboard"));
  elements.minSharedRange.addEventListener("input", (event) => {
    state.minSharedPosts = Number(event.target.value);
    elements.minSharedValue.value = String(state.minSharedPosts);
    state.selectedUsername = null;
    state.selectedEdgeId = null;
    renderNetwork();
    renderInspector();
    renderTable();
  });
  elements.minContextRange.addEventListener("input", (event) => {
    state.minContextPosts = Number(event.target.value);
    elements.minContextValue.value = String(state.minContextPosts);
    state.selectedContextId = null;
    renderNetwork();
    renderInspector();
    renderTable();
  });
  elements.metricSelect.addEventListener("change", () => {
    state.metric = elements.metricSelect.value;
    updateWeightControls();
    renderNetwork();
    renderInspector();
    renderTable();
  });

  elements.weightToggle.addEventListener("click", () => {
    const willOpen = elements.weightPanel.hidden;
    elements.weightPanel.hidden = !willOpen;
    elements.weightToggle.setAttribute("aria-expanded", String(willOpen));
  });

  const weightBindings = [
    ["commentsWeight", "comments"],
    ["commentedPostsWeight", "commented_posts"],
    ["mentionsWeight", "mentions"],
    ["taggedWeight", "tagged"],
    ["coauthorsWeight", "coauthors"],
  ];
  for (const [elementId, source] of weightBindings) {
    elements[elementId].addEventListener("input", (event) => {
      state.weights[source] = Number(event.target.value);
      updateWeightControls();
      renderNetwork();
      renderInspector();
      renderTable();
    });
  }

  elements.zoomInButton.addEventListener("click", () => networkCamera?.zoomIn());
  elements.zoomOutButton.addEventListener("click", () => networkCamera?.zoomOut());
  elements.resetZoomButton.addEventListener("click", () => networkCamera?.reset());
  elements.topRange.addEventListener("input", (event) => {
    state.topLimit = Number(event.target.value);
    elements.topRangeValue.value = String(state.topLimit);
    renderNetwork();
  });

  elements.accountSearch.addEventListener("input", (event) => {
    state.search = event.target.value;
    renderTable();
  });

  elements.downloadCsv.addEventListener("click", downloadCsv);
  elements.methodologyButton.addEventListener("click", () => setPage("manual"));
  elements.networkSvg.addEventListener("click", () => {
    if (state.networkView === "context") {
      selectContext(null);
    } else {
      selectAccount(null);
    }
  });
  window.addEventListener("resize", hideNetworkTooltip);
}

async function initialize() {
  cacheElements();
  networkCamera = createNetworkCamera(elements.networkSvg, (zoom) => {
    elements.zoomLevel.value = `${Math.round(zoom * 100)}%`;
  });
  bindEvents();
  showStartScreen();
  setStartStatus("Comprobando si existe un archivo cargado…");
  setBusy(true, "Cargando la estructura de la fuente…");
  try {
    const response = await fetch("/api/status", {
      headers: { Accept: "application/json" },
      cache: "no-store",
    });
    const status = await parseResponse(response);
    state.serverStatus = status;
    if (status.has_data) {
      elements.resumeButton.hidden = false;
      setStartStatus(
        `Hay un archivo disponible: ${status.source_name}. Puedes continuar o reemplazarlo.`,
        "success",
      );
    } else {
      elements.resumeButton.hidden = true;
      setStartStatus("Formato requerido: JSON de Apify Instagram Scraper.");
    }
  } catch (error) {
    setStartStatus(`No se pudo comprobar el estado del servidor: ${error.message}`, "error");
  } finally {
    setBusy(false);
  }
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", initialize, { once: true });
} else {
  initialize();
}
