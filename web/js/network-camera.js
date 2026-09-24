const BASE = { x: 0, y: 0, width: 1000, height: 680 };
const MIN_ZOOM = 0.65;
const MAX_ZOOM = 4.5;

function clamp(value, minimum, maximum) {
  return Math.min(Math.max(value, minimum), maximum);
}

export function createNetworkCamera(svg, onChange = () => {}) {
  const camera = { x: BASE.width / 2, y: BASE.height / 2, zoom: 1 };
  let drag = null;

  function viewBox() {
    const width = BASE.width / camera.zoom;
    const height = BASE.height / camera.zoom;
    return {
      x: clamp(camera.x - width / 2, BASE.x, BASE.x + BASE.width - width),
      y: clamp(camera.y - height / 2, BASE.y, BASE.y + BASE.height - height),
      width,
      height,
    };
  }

  function render() {
    const current = viewBox();
    svg.setAttribute(
      "viewBox",
      `${current.x} ${current.y} ${current.width} ${current.height}`,
    );
    onChange(camera.zoom);
  }

  function zoomAt(factor, clientX = null, clientY = null) {
    const rect = svg.getBoundingClientRect();
    const oldView = viewBox();
    const relativeX = clientX === null ? 0.5 : (clientX - rect.left) / rect.width;
    const relativeY = clientY === null ? 0.5 : (clientY - rect.top) / rect.height;
    const anchorX = oldView.x + oldView.width * clamp(relativeX, 0, 1);
    const anchorY = oldView.y + oldView.height * clamp(relativeY, 0, 1);
    const nextZoom = clamp(camera.zoom * factor, MIN_ZOOM, MAX_ZOOM);
    const nextWidth = BASE.width / nextZoom;
    const nextHeight = BASE.height / nextZoom;
    camera.x = anchorX - nextWidth * clamp(relativeX, 0, 1);
    camera.y = anchorY - nextHeight * clamp(relativeY, 0, 1);
    camera.zoom = nextZoom;
    render();
  }

  function onWheel(event) {
    event.preventDefault();
    zoomAt(Math.exp(-event.deltaY * 0.0012), event.clientX, event.clientY);
  }

  function onPointerDown(event) {
    if (event.button !== 0 || event.target.closest?.(".network-node, .network-edge")) return;
    drag = {
      pointerId: event.pointerId,
      x: event.clientX,
      y: event.clientY,
      cameraX: camera.x,
      cameraY: camera.y,
      moved: false,
    };
    svg.setPointerCapture(event.pointerId);
    svg.classList.add("is-panning");
  }

  function onPointerMove(event) {
    if (!drag || drag.pointerId !== event.pointerId) return;
    const rect = svg.getBoundingClientRect();
    const current = viewBox();
    const dx = ((event.clientX - drag.x) / Math.max(rect.width, 1)) * current.width;
    const dy = ((event.clientY - drag.y) / Math.max(rect.height, 1)) * current.height;
    if (Math.abs(dx) + Math.abs(dy) > 3) drag.moved = true;
    camera.x = drag.cameraX - dx;
    camera.y = drag.cameraY - dy;
    render();
  }

  function onPointerUp(event) {
    if (!drag || drag.pointerId !== event.pointerId) return;
    if (svg.hasPointerCapture(event.pointerId)) svg.releasePointerCapture(event.pointerId);
    drag = null;
    svg.classList.remove("is-panning");
  }

  svg.addEventListener("wheel", onWheel, { passive: false });
  svg.addEventListener("pointerdown", onPointerDown);
  svg.addEventListener("pointermove", onPointerMove);
  svg.addEventListener("pointerup", onPointerUp);
  svg.addEventListener("pointercancel", onPointerUp);
  render();

  return {
    zoomIn: () => zoomAt(1.28),
    zoomOut: () => zoomAt(1 / 1.28),
    reset: () => {
      camera.x = BASE.width / 2;
      camera.y = BASE.height / 2;
      camera.zoom = 1;
      render();
    },
    getZoom: () => camera.zoom,
  };
}
