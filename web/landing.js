const $ = (id) => document.getElementById(id);
const input = $("fileInput");
const dropZone = $("dropZone");
const status = $("uploadStatus");
const serverButton = $("loadServerButton");
const continueLink = $("continueLink");

function setStatus(message, type = "") { status.textContent = message; status.className = `upload-status ${type}`; }
async function request(url, options = {}) { const response = await fetch(url, options); let payload; try { payload = await response.json(); } catch { throw new Error(`El servidor respondió con ${response.status}.`); } if (!response.ok) throw new Error(payload.error || `Error HTTP ${response.status}.`); return payload; }
function openInforme() { window.location.href = "/informe/resumen"; }
async function checkStatus() {
  try {
    const statusData = await request("/api/status");
    if (statusData.has_data) { continueLink.hidden = false; setStatus("Hay un informe cargado en memoria. Puedes continuar o reemplazarlo."); }
    if (statusData.available_files?.length) { serverButton.hidden = false; serverButton.textContent = `Usar ${statusData.available_files.length} JSON del servidor`; }
  } catch (error) { setStatus(error.message, "error"); }
}
async function uploadFiles(files) {
  if (!files.length) return;
  const total = [...files].reduce((sum, file) => sum + file.size, 0);
  if (total > 100 * 1024 * 1024) { setStatus("La carga supera el límite local de 100 MB.", "error"); return; }
  setStatus("Leyendo y validando los archivos…");
  try {
    const payload = { files: [] };
    for (const file of files) payload.files.push({ name: file.name, payload: JSON.parse(await file.text()) });
    await request("/api/analysis", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
    openInforme();
  } catch (error) { setStatus(`No se pudo cargar la fuente: ${error.message}`, "error"); }
}
$("chooseFilesButton").addEventListener("click", () => input.click());
input.addEventListener("change", () => uploadFiles([...input.files]));
["dragenter", "dragover"].forEach((eventName) => dropZone.addEventListener(eventName, (event) => { event.preventDefault(); dropZone.classList.add("dragging"); }));
["dragleave", "drop"].forEach((eventName) => dropZone.addEventListener(eventName, (event) => { event.preventDefault(); dropZone.classList.remove("dragging"); }));
dropZone.addEventListener("drop", (event) => uploadFiles([...event.dataTransfer.files]));
dropZone.addEventListener("click", (event) => { if (event.target !== $("chooseFilesButton")) input.click(); });
dropZone.addEventListener("keydown", (event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); input.click(); } });
serverButton.addEventListener("click", async () => { setStatus("Cargando los JSON del servidor…"); try { await request("/api/load-server", { method: "POST" }); openInforme(); } catch (error) { setStatus(error.message, "error"); } });
checkStatus();
