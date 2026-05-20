const SVG_NS = "http://www.w3.org/2000/svg";

const cities = window.TransitCities || {};
const gta = cities.gta;
const coordinateStoragePrefix = "transit-builder:coordinates:v2:";

const els = {
  citySummary: document.querySelector("#city-summary"),
  citySelect: document.querySelector("#city-select"),
  map: document.querySelector("#map"),
  linePalette: document.querySelector("#line-palette"),
  milestoneList: document.querySelector("#milestone-list"),
  sourceLinks: document.querySelector("#source-links"),
  playToggle: document.querySelector("#play-toggle"),
  undoButton: document.querySelector("#undo-button"),
  resetButton: document.querySelector("#reset-button"),
  buildMode: document.querySelector("#build-mode"),
  inspectMode: document.querySelector("#inspect-mode"),
  placeMode: document.querySelector("#place-mode"),
  zoomOutButton: document.querySelector("#zoom-out-button"),
  zoomInButton: document.querySelector("#zoom-in-button"),
  zoomResetButton: document.querySelector("#zoom-reset-button"),
  zoomLevelValue: document.querySelector("#zoom-level-value"),
  pixelLocationValue: document.querySelector("#pixel-location-value"),
  pointEditor: document.querySelector("#point-editor"),
  pointStationSelect: document.querySelector("#point-station-select"),
  pointX: document.querySelector("#point-x"),
  pointY: document.querySelector("#point-y"),
  applyPointButton: document.querySelector("#apply-point-button"),
  exportCoordinatesButton: document.querySelector("#export-coordinates-button"),
  resetPointsButton: document.querySelector("#reset-points-button"),
  coordinatesOutput: document.querySelector("#coordinates-output"),
  dayValue: document.querySelector("#day-value"),
  selectedLineValue: document.querySelector("#selected-line-value"),
  messageValue: document.querySelector("#message-value"),
  budgetValue: document.querySelector("#budget-value"),
  ridershipValue: document.querySelector("#ridership-value"),
  coverageValue: document.querySelector("#coverage-value"),
  pressureValue: document.querySelector("#pressure-value"),
  stationName: document.querySelector("#station-name"),
  stationRole: document.querySelector("#station-role"),
  stationDemand: document.querySelector("#station-demand"),
  stationStatus: document.querySelector("#station-status"),
};

const state = {
  city: gta,
  selectedCrewId: gta.crews[0].id,
  selectedStationId: null,
  mode: "build",
  builtLinks: [],
  history: [],
  budget: gta.startBudget,
  day: 1,
  running: true,
  message: "Click two stations to add an expansion link.",
  milestoneRewards: new Set(),
  coordinateOverrides: {},
  selectedPointStationId: null,
  viewport: null,
  isPanning: false,
  panStart: null,
  pointerWasPanning: false,
  suppressNextMapClick: false,
  hoverPoint: null,
};

let stationById = new Map();
let baseLinks = new Set();
let baseServed = new Set();
let timerId = null;

function boot() {
  loadCity("gta");
  bindControls();
  startTimer();
}

function loadCity(cityId) {
  state.city = cities[cityId];
  state.selectedCrewId = state.city.crews[0].id;
  state.selectedStationId = null;
  state.mode = "build";
  state.builtLinks = [];
  state.history = [];
  state.budget = state.city.startBudget;
  state.day = 1;
  state.running = true;
  state.message = "Click two stations to add an expansion link.";
  state.milestoneRewards = new Set();
  state.coordinateOverrides = loadCoordinateOverrides(state.city.id);
  state.selectedPointStationId = state.city.stations[0]?.id || null;
  state.viewport = getFullViewport(state.city);
  state.isPanning = false;
  state.panStart = null;
  state.pointerWasPanning = false;
  state.suppressNextMapClick = false;
  state.hoverPoint = null;

  refreshStationMap();
  baseLinks = collectBaseLinks(state.city);
  baseServed = collectBaseServed(state.city);

  els.citySummary.textContent = state.city.summary;
  renderSources();
  renderPalette();
  renderPointStationOptions();
  render();
}

function bindControls() {
  els.citySelect.addEventListener("change", (event) => {
    loadCity(event.target.value);
  });

  els.playToggle.addEventListener("click", () => {
    state.running = !state.running;
    state.message = state.running
      ? "Simulation running. Watch pressure and coverage change."
      : "Simulation paused. Plan your next expansion.";
    render();
  });

  els.undoButton.addEventListener("click", undoLastBuild);
  els.resetButton.addEventListener("click", () => loadCity(state.city.id));

  els.buildMode.addEventListener("click", () => setMode("build"));
  els.inspectMode.addEventListener("click", () => setMode("inspect"));
  els.placeMode.addEventListener("click", () => setMode("place"));
  els.map.addEventListener("click", handleMapPlacement);
  els.map.addEventListener("wheel", handleMapWheel, { passive: false });
  els.map.addEventListener("pointerdown", handleMapPointerDown);
  els.map.addEventListener("pointermove", handleMapPointerMove);
  els.map.addEventListener("pointerup", handleMapPointerUp);
  els.map.addEventListener("pointercancel", handleMapPointerUp);
  els.map.addEventListener("pointerleave", handleMapPointerLeave);
  els.zoomOutButton.addEventListener("click", () => zoomBy(1 / 1.25));
  els.zoomInButton.addEventListener("click", () => zoomBy(1.25));
  els.zoomResetButton.addEventListener("click", resetMapViewport);

  els.pointStationSelect.addEventListener("change", (event) => {
    state.selectedPointStationId = event.target.value;
    state.selectedStationId = event.target.value;
    updatePointInputs();
    render();
  });
  els.applyPointButton.addEventListener("click", applyPointInputs);
  els.exportCoordinatesButton.addEventListener("click", () => exportCoordinates());
  els.resetPointsButton.addEventListener("click", resetPointOverrides);
}

function setMode(mode) {
  state.mode = mode;
  if (mode === "place") {
    state.running = false;
    state.selectedStationId = state.selectedPointStationId;
    state.message = "Choose a station, then click its exact map location.";
  } else {
    state.selectedStationId = mode === "inspect" ? state.selectedStationId : null;
    state.message =
      mode === "build"
        ? "Click two stations to add an expansion link."
        : "Click any station to inspect demand and service.";
  }
  render();
}

function startTimer() {
  if (timerId) window.clearInterval(timerId);
  timerId = window.setInterval(() => {
    if (!state.running) return;
    state.day += 1;
    evaluateMilestones(true);
    if (state.day % 4 === 0 && state.budget < state.city.startBudget + 55) {
      state.budget += 4;
      state.message = "Regional funding ticked up by $4M.";
    }
    render();
  }, 2600);
}

function renderPalette() {
  els.linePalette.replaceChildren();

  state.city.crews.forEach((crew) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = `crew-button ${crew.id === state.selectedCrewId ? "active" : ""}`;
    button.style.setProperty("--crew", crew.color);
    button.title = `${crew.name} expansion crew`;
    button.innerHTML = `
      <span class="crew-swatch" aria-hidden="true"></span>
      <span class="crew-name">${crew.name}</span>
      <span class="crew-count">${countCrewLinks(crew.id)}</span>
    `;
    button.addEventListener("click", () => {
      state.selectedCrewId = crew.id;
      state.message = `${crew.name} crew selected.`;
      renderPalette();
      renderStats();
    });
    els.linePalette.append(button);
  });
}

function renderSources() {
  els.sourceLinks.replaceChildren();
  state.city.sources.forEach((source) => {
    const item = document.createElement("li");
    const link = document.createElement("a");
    link.href = source.url;
    link.target = "_blank";
    link.rel = "noreferrer";
    link.textContent = source.label;
    item.append(link);
    els.sourceLinks.append(item);
  });
}

function render() {
  renderControls();
  renderMap();
  renderStats();
  renderMilestones();
  renderInspector();
}

function renderControls() {
  els.playToggle.innerHTML = state.running
    ? '<span aria-hidden="true">II</span>'
    : '<span aria-hidden="true">&#9658;</span>';
  els.playToggle.title = state.running ? "Pause simulation" : "Resume simulation";
  els.playToggle.setAttribute("aria-label", els.playToggle.title);

  els.buildMode.classList.toggle("active", state.mode === "build");
  els.inspectMode.classList.toggle("active", state.mode === "inspect");
  els.placeMode.classList.toggle("active", state.mode === "place");
  els.pointEditor.hidden = state.mode !== "place";
  els.dayValue.textContent = `Day ${state.day}`;

  const crew = getCrew(state.selectedCrewId);
  els.selectedLineValue.textContent =
    state.mode === "place" ? "Point editor active" : `${crew.name} crew selected`;
  els.messageValue.textContent = state.message;
  renderZoomControls();
  renderPixelLocator();
  renderPointEditor();
}

function renderMap() {
  els.map.replaceChildren();
  const mapWidth = state.city.image?.width || 1000;
  const mapHeight = state.city.image?.height || 680;
  ensureViewport(mapWidth, mapHeight);
  applyMapViewBox();
  els.map.classList.toggle("image-backed", Boolean(state.city.image));

  drawBackground();
  drawSuggestedLinks();
  if (!state.city.image) drawRoutes();
  drawPlayerLinks();
  drawStations();
}

function getMapSize(city = state.city) {
  return {
    width: city.image?.width || 1000,
    height: city.image?.height || 680,
  };
}

function getFullViewport(city = state.city) {
  const size = getMapSize(city);
  return {
    x: 0,
    y: 0,
    width: size.width,
    height: size.height,
  };
}

function ensureViewport(mapWidth = getMapSize().width, mapHeight = getMapSize().height) {
  if (!state.viewport) {
    state.viewport = { x: 0, y: 0, width: mapWidth, height: mapHeight };
  }
  state.viewport = clampViewport(state.viewport, mapWidth, mapHeight);
}

function clampViewport(viewport, mapWidth = getMapSize().width, mapHeight = getMapSize().height) {
  const width = Math.min(Math.max(viewport.width, mapWidth / 8), mapWidth);
  const height = Math.min(Math.max(viewport.height, mapHeight / 8), mapHeight);
  return {
    x: Math.min(Math.max(viewport.x, 0), mapWidth - width),
    y: Math.min(Math.max(viewport.y, 0), mapHeight - height),
    width,
    height,
  };
}

function applyMapViewBox() {
  const viewport = state.viewport || getFullViewport();
  els.map.setAttribute(
    "viewBox",
    `${Math.round(viewport.x)} ${Math.round(viewport.y)} ${Math.round(viewport.width)} ${Math.round(viewport.height)}`,
  );
  renderZoomControls();
}

function renderZoomControls() {
  if (!els.zoomLevelValue || !state.viewport) return;

  const size = getMapSize();
  const zoomLevel = size.width / state.viewport.width;
  els.zoomLevelValue.textContent = `${Math.round(zoomLevel * 100)}%`;
  els.zoomOutButton.disabled = zoomLevel <= 1.01;
  els.zoomInButton.disabled = zoomLevel >= 7.99;
}

function renderPixelLocator() {
  if (!els.pixelLocationValue) return;

  els.pixelLocationValue.textContent = state.hoverPoint
    ? `x ${state.hoverPoint.x}, y ${state.hoverPoint.y}`
    : "x --, y --";
}

function zoomBy(factor, centerPoint = null) {
  ensureViewport();
  const size = getMapSize();
  const current = state.viewport;
  const currentZoom = size.width / current.width;
  const nextZoom = Math.min(8, Math.max(1, currentZoom * factor));
  const nextWidth = size.width / nextZoom;
  const nextHeight = size.height / nextZoom;
  const center =
    centerPoint || {
      x: current.x + current.width / 2,
      y: current.y + current.height / 2,
    };
  const relativeX = (center.x - current.x) / current.width;
  const relativeY = (center.y - current.y) / current.height;

  state.viewport = clampViewport(
    {
      x: center.x - relativeX * nextWidth,
      y: center.y - relativeY * nextHeight,
      width: nextWidth,
      height: nextHeight,
    },
    size.width,
    size.height,
  );
  applyMapViewBox();
}

function resetMapViewport() {
  state.viewport = getFullViewport();
  state.message = "Map view reset.";
  applyMapViewBox();
  renderControls();
}

function drawBackground() {
  if (state.city.image) {
    els.map.append(
      svg("image", {
        class: "map-base-image",
        href: state.city.image.src,
        x: 0,
        y: 0,
        width: state.city.image.width,
        height: state.city.image.height,
        preserveAspectRatio: "xMidYMid meet",
      }),
    );
    return;
  }

  const land = svg("rect", {
    class: "map-land",
    x: 0,
    y: 0,
    width: 1000,
    height: 680,
  });
  els.map.append(land);

  for (let x = 60; x < 1000; x += 80) {
    els.map.append(
      svg("line", { class: "map-grid-line", x1: x, y1: 0, x2: x, y2: 680 }),
    );
  }
  for (let y = 50; y < 680; y += 70) {
    els.map.append(
      svg("line", { class: "map-grid-line", x1: 0, y1: y, x2: 1000, y2: y }),
    );
  }

  els.map.append(
    svg("path", {
      class: "map-lake",
      d: "M0 590 C120 568 260 580 390 555 C520 532 650 560 780 522 C870 496 935 506 1000 494 L1000 680 L0 680 Z",
    }),
  );
  els.map.append(
    svg("path", {
      class: "map-lake-shore",
      d: "M0 590 C120 568 260 580 390 555 C520 532 650 560 780 522 C870 496 935 506 1000 494",
    }),
  );

  state.city.mapLabels.forEach((item) => {
    const label = svg("text", {
      class: "area-label",
      x: item.x,
      y: item.y,
    });
    label.textContent = item.label;
    els.map.append(label);
  });
}

function drawSuggestedLinks() {
  const existing = getAllLinkKeys();
  state.city.suggestedLinks.forEach(([fromId, toId]) => {
    const key = linkKey(fromId, toId);
    if (existing.has(key)) return;

    const from = stationById.get(fromId);
    const to = stationById.get(toId);
    if (!from || !to) return;

    els.map.append(
      svg("line", {
        class: "candidate-link",
        x1: from.x,
        y1: from.y,
        x2: to.x,
        y2: to.y,
      }),
    );
  });
}

function drawRoutes() {
  state.city.routes.forEach((route) => {
    const points = route.stations
      .map((id) => stationById.get(id))
      .filter(Boolean)
      .map((station) => `${station.x},${station.y}`)
      .join(" ");

    const polyline = svg("polyline", {
      class: `route-line base ${route.mode === "go" ? "go" : ""}`,
      points,
      style: `--route-color: ${route.color}; --route-width: ${route.width || 7}`,
    });
    els.map.append(polyline);

    const labelStation = stationById.get(route.labelAt);
    if (labelStation) {
      const label = svg("text", {
        class: "route-label",
        x: labelStation.x + 13,
        y: labelStation.y - 14,
      });
      label.textContent = route.name;
      els.map.append(label);
    }
  });
}

function drawPlayerLinks() {
  state.builtLinks.forEach((link) => {
    const from = stationById.get(link.from);
    const to = stationById.get(link.to);
    const crew = getCrew(link.crewId);
    if (!from || !to || !crew) return;

    els.map.append(
      svg("line", {
        class: "route-line player",
        x1: from.x,
        y1: from.y,
        x2: to.x,
        y2: to.y,
        style: `--route-color: ${crew.color}`,
      }),
    );
  });
}

function drawStations() {
  const servedStations = getServedStations();
  const pressureByStation = getStationPressure(servedStations);
  const imageScale = getImageScale();

  state.city.stations.forEach((sourceStation) => {
    const station = stationById.get(sourceStation.id) || sourceStation;
    const served = servedStations.has(station.id);
    const selected = state.selectedStationId === station.id;
    const group = svg("g", {
      class: `station-node ${served ? "served" : "unserved"} ${selected ? "selected" : ""}`,
      "data-station-id": station.id,
      role: "button",
      tabindex: "0",
      "aria-label": `${station.name}. ${served ? "Served" : "Unserved"} station.`,
    });

    group.addEventListener("click", (event) => {
      event.stopPropagation();
      handleStationAction(station.id);
    });
    group.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        handleStationAction(station.id);
      }
    });

    const pressure = pressureByStation.get(station.id) || 0;
    if (pressure > 0.35) {
      group.append(
        svg("circle", {
          class: "demand-ring",
          cx: station.x,
          cy: station.y,
          r:
            stationRadius(station) +
            7 * imageScale +
            pressure * (state.city.image ? 7 * imageScale : 4),
          style: `--demand-color: ${pressure > 0.7 ? "#e95f45" : "#f0b63f"}`,
        }),
      );
    }

    group.append(
      svg("circle", {
        class: "station-dot",
        cx: station.x,
        cy: station.y,
        r: stationRadius(station),
      }),
    );
    group.append(
      svg("circle", {
        class: "station-core",
        cx: station.x,
        cy: station.y,
        r: stationCoreRadius(station),
        style: `--station-color: ${stationColor(station.type, served)}`,
      }),
    );
    group.append(
      svg("circle", {
        class: "station-hit",
        "data-testid": `station-hit-${station.id}`,
        cx: station.x,
        cy: station.y,
        r: state.city.image ? 30 * imageScale : 17,
      }),
    );

    if ((station.label && !state.city.image) || selected) {
      const label = svg("text", {
        class: `station-label ${station.label ? "" : "small"}`,
        x: station.x + labelOffset(station).x,
        y: station.y + labelOffset(station).y,
      });
      label.textContent = station.name;
      group.append(label);
    }

    els.map.append(group);
  });
}

function handleStationAction(stationId) {
  if (state.mode === "place") {
    state.selectedPointStationId = stationId;
    state.selectedStationId = stationId;
    state.message = `${stationById.get(stationId).name} selected for placement.`;
    updatePointInputs();
    render();
    return;
  }

  if (state.mode === "inspect") {
    state.selectedStationId = stationId;
    state.message = `${stationById.get(stationId).name} selected.`;
    render();
    return;
  }

  if (!state.selectedStationId) {
    state.selectedStationId = stationId;
    state.message = `${stationById.get(stationId).name} selected. Pick a second station.`;
    render();
    return;
  }

  if (state.selectedStationId === stationId) {
    state.selectedStationId = null;
    state.message = "Selection cleared. Pick a station to start a link.";
    render();
    return;
  }

  buildLink(state.selectedStationId, stationId);
}

function handleMapPlacement(event) {
  if (state.suppressNextMapClick) {
    state.suppressNextMapClick = false;
    return;
  }
  if (state.mode !== "place" || !state.selectedPointStationId) return;

  const point = updatePixelLocator(event);
  if (!point) return;

  updateStationCoordinate(state.selectedPointStationId, point.x, point.y);
  const station = stationById.get(state.selectedPointStationId);
  state.selectedStationId = state.selectedPointStationId;
  state.message = `${station.name} placed at ${Math.round(point.x)}, ${Math.round(point.y)}.`;
  render();
}

function handleMapWheel(event) {
  event.preventDefault();
  const point = updatePixelLocator(event);
  zoomBy(event.deltaY < 0 ? 1.2 : 1 / 1.2, point);
}

function handleMapPointerDown(event) {
  updatePixelLocator(event);
  if (event.button !== 0 || event.target.closest?.(".station-node")) return;

  state.isPanning = true;
  state.pointerWasPanning = false;
  state.panStart = {
    pointerId: event.pointerId,
    startX: event.clientX,
    startY: event.clientY,
    lastX: event.clientX,
    lastY: event.clientY,
  };
  els.map.classList.add("is-panning");
  els.map.setPointerCapture?.(event.pointerId);
}

function handleMapPointerMove(event) {
  updatePixelLocator(event);
  if (!state.isPanning || state.panStart?.pointerId !== event.pointerId) return;

  const totalX = event.clientX - state.panStart.startX;
  const totalY = event.clientY - state.panStart.startY;
  const deltaX = event.clientX - state.panStart.lastX;
  const deltaY = event.clientY - state.panStart.lastY;
  state.panStart.lastX = event.clientX;
  state.panStart.lastY = event.clientY;

  if (Math.hypot(totalX, totalY) < 4) return;

  state.pointerWasPanning = true;
  panByScreenDelta(deltaX, deltaY);
  event.preventDefault();
}

function handleMapPointerLeave() {
  state.hoverPoint = null;
  renderPixelLocator();
}

function handleMapPointerUp(event) {
  if (!state.isPanning || state.panStart?.pointerId !== event.pointerId) return;

  els.map.releasePointerCapture?.(event.pointerId);
  els.map.classList.remove("is-panning");
  state.isPanning = false;
  state.panStart = null;

  if (state.pointerWasPanning) {
    state.suppressNextMapClick = true;
    window.setTimeout(() => {
      state.suppressNextMapClick = false;
    }, 0);
  }
  state.pointerWasPanning = false;
}

function panByScreenDelta(deltaX, deltaY) {
  ensureViewport();
  const rect = els.map.getBoundingClientRect();
  const viewport = state.viewport;
  state.viewport = clampViewport({
    x: viewport.x - (deltaX * viewport.width) / rect.width,
    y: viewport.y - (deltaY * viewport.height) / rect.height,
    width: viewport.width,
    height: viewport.height,
  });
  applyMapViewBox();
}

function updatePixelLocator(event) {
  const point = getSvgPoint(event);
  if (!point) return null;

  state.hoverPoint = {
    x: Math.round(point.x),
    y: Math.round(point.y),
  };
  renderPixelLocator();
  return point;
}

function renderPointStationOptions() {
  els.pointStationSelect.replaceChildren();

  [...state.city.stations]
    .sort((a, b) => a.name.localeCompare(b.name))
    .forEach((station) => {
      const option = document.createElement("option");
      option.value = station.id;
      option.textContent = station.name;
      els.pointStationSelect.append(option);
    });
}

function renderPointEditor() {
  if (state.mode !== "place") return;
  if (els.pointStationSelect.value !== state.selectedPointStationId) {
    els.pointStationSelect.value = state.selectedPointStationId || "";
  }
  updatePointInputs();
}

function updatePointInputs() {
  const station = stationById.get(state.selectedPointStationId);
  if (!station) return;

  if (document.activeElement !== els.pointX) els.pointX.value = String(Math.round(station.x));
  if (document.activeElement !== els.pointY) els.pointY.value = String(Math.round(station.y));
}

function applyPointInputs() {
  if (!state.selectedPointStationId) return;

  const x = Number(els.pointX.value);
  const y = Number(els.pointY.value);
  if (!Number.isFinite(x) || !Number.isFinite(y)) {
    state.message = "Point coordinates must be valid numbers.";
    render();
    return;
  }

  updateStationCoordinate(state.selectedPointStationId, x, y);
  const station = stationById.get(state.selectedPointStationId);
  state.selectedStationId = state.selectedPointStationId;
  state.message = `${station.name} coordinates applied.`;
  render();
}

function updateStationCoordinate(stationId, x, y) {
  state.coordinateOverrides[stationId] = {
    x: Math.round(x),
    y: Math.round(y),
  };
  saveCoordinateOverrides();
  refreshStationMap();
}

function resetPointOverrides() {
  state.coordinateOverrides = {};
  window.localStorage.removeItem(getCoordinateStorageKey(state.city.id));
  refreshStationMap();
  state.selectedStationId = state.selectedPointStationId;
  exportCoordinates("Saved point edits reset to the code coordinates.");
  render();
}

function exportCoordinates(message = "Coordinates exported.") {
  const lines = state.city.stations.map((station) => {
    const placed = stationById.get(station.id);
    return `    ${JSON.stringify(station.id)}: { x: ${Math.round(placed.x)}, y: ${Math.round(placed.y)} },`;
  });

  els.coordinatesOutput.value = `  coordinates: {\n${lines.join("\n")}\n  },`;
  els.coordinatesOutput.focus();
  els.coordinatesOutput.select();

  if (navigator.clipboard?.writeText) {
    navigator.clipboard.writeText(els.coordinatesOutput.value).catch(() => {});
  }

  state.message = message;
  els.messageValue.textContent = state.message;
}

function buildLink(fromId, toId) {
  const from = stationById.get(fromId);
  const to = stationById.get(toId);
  const key = linkKey(fromId, toId);
  const allLinks = getAllLinkKeys();

  if (allLinks.has(key)) {
    state.message = "Those stations already have a direct connection.";
    state.selectedStationId = toId;
    render();
    return;
  }

  const distance = getDistance(from, to);
  if (distance > 285) {
    state.message = "That jump is too long for one build. Use an intermediate hub.";
    state.selectedStationId = toId;
    render();
    return;
  }

  const cost = getBuildCost(from, to, distance);
  if (cost > state.budget) {
    state.message = `Need $${cost}M. Your current budget is $${state.budget}M.`;
    state.selectedStationId = fromId;
    render();
    return;
  }

  const link = {
    from: fromId,
    to: toId,
    crewId: state.selectedCrewId,
    cost,
    day: state.day,
  };

  state.builtLinks.push(link);
  state.history.push(link);
  state.budget -= cost;
  state.selectedStationId = toId;
  state.message = `Built ${from.name} to ${to.name} for $${cost}M.`;
  evaluateMilestones(true);
  renderPalette();
  render();
}

function undoLastBuild() {
  const link = state.history.pop();
  if (!link) {
    state.message = "No expansion link to undo.";
    render();
    return;
  }

  const index = state.builtLinks.lastIndexOf(link);
  if (index >= 0) state.builtLinks.splice(index, 1);
  state.budget += link.cost;
  state.selectedStationId = link.from;
  state.message = "Last expansion link removed.";
  recomputeRewards();
  renderPalette();
  render();
}

function renderStats() {
  const servedStations = getServedStations();
  const demand = getDemandStats(servedStations);
  const pressure = getPressure(demand);
  const ridership = Math.max(
    state.city.baseDailyRidershipK,
    Math.round(state.city.baseDailyRidershipK + (demand.served - demand.baseServed) * 18 + state.builtLinks.length * 8),
  );

  els.budgetValue.textContent = `$${state.budget}M`;
  els.ridershipValue.textContent = `${ridership.toLocaleString()}k`;
  els.coverageValue.textContent = `${Math.round(demand.coverage * 100)}%`;
  els.pressureValue.textContent = pressure.label;
  els.pressureValue.style.color = pressure.color;
}

function renderMilestones() {
  const completed = evaluateMilestones(false);
  els.milestoneList.replaceChildren();

  state.city.milestones.forEach((milestone) => {
    const item = document.createElement("li");
    const isComplete = completed.has(milestone.id);
    item.classList.toggle("complete", isComplete);

    const icon = document.createElement("span");
    icon.className = "milestone-icon";
    icon.textContent = isComplete ? "OK" : "$";

    const text = document.createElement("span");
    text.textContent = `${milestone.label} +$${milestone.reward}M`;

    item.append(icon, text);
    els.milestoneList.append(item);
  });
}

function renderInspector() {
  const station = stationById.get(state.selectedStationId) || stationById.get("union");
  const served = getServedStations().has(station.id);

  els.stationName.textContent = station.name;
  els.stationRole.textContent = station.role;
  els.stationDemand.textContent = demandLabel(station.demand);
  els.stationStatus.textContent = served ? "Served" : "Expansion candidate";
}

function evaluateMilestones(applyRewards) {
  const servedStations = getServedStations();
  const completed = new Set();

  state.city.milestones.forEach((milestone) => {
    let isComplete = false;
    if (milestone.type === "served") {
      isComplete = servedStations.has(milestone.station);
    }
    if (milestone.type === "player-link") {
      isComplete = state.builtLinks.some(
        (link) => link.from === milestone.station || link.to === milestone.station,
      );
    }
    if (milestone.type === "connect") {
      isComplete = hasPath(milestone.from, milestone.to, getNetworkLinks());
    }

    if (!isComplete) return;
    completed.add(milestone.id);

    if (applyRewards && !state.milestoneRewards.has(milestone.id)) {
      state.milestoneRewards.add(milestone.id);
      state.budget += milestone.reward;
      state.message = `Milestone complete: ${milestone.label}. +$${milestone.reward}M.`;
    }
  });

  return completed;
}

function recomputeRewards() {
  state.milestoneRewards = evaluateMilestones(false);
  const earned = state.city.milestones.reduce((sum, milestone) => {
    return sum + (state.milestoneRewards.has(milestone.id) ? milestone.reward : 0);
  }, 0);
  const spent = state.builtLinks.reduce((sum, link) => sum + link.cost, 0);
  state.budget = state.city.startBudget + earned - spent;
}

function refreshStationMap() {
  stationById = new Map(
    state.city.stations.map((station) => [
      station.id,
      {
        ...station,
        ...(state.city.coordinates?.[station.id] || {}),
        ...(state.coordinateOverrides?.[station.id] || {}),
      },
    ]),
  );
}

function loadCoordinateOverrides(cityId) {
  try {
    const raw = window.localStorage.getItem(getCoordinateStorageKey(cityId));
    if (!raw) return {};

    const parsed = JSON.parse(raw);
    return Object.fromEntries(
      Object.entries(parsed).filter(([, value]) => {
        return Number.isFinite(value?.x) && Number.isFinite(value?.y);
      }),
    );
  } catch {
    return {};
  }
}

function saveCoordinateOverrides() {
  window.localStorage.setItem(
    getCoordinateStorageKey(state.city.id),
    JSON.stringify(state.coordinateOverrides),
  );
}

function getCoordinateStorageKey(cityId) {
  return `${coordinateStoragePrefix}${cityId}`;
}

function getSvgPoint(event) {
  const screenMatrix = els.map.getScreenCTM();
  let x;
  let y;

  if (screenMatrix) {
    const point = els.map.createSVGPoint();
    point.x = event.clientX;
    point.y = event.clientY;
    const svgPoint = point.matrixTransform(screenMatrix.inverse());
    x = svgPoint.x;
    y = svgPoint.y;
  } else {
    const rect = els.map.getBoundingClientRect();
    const viewBox = els.map.viewBox.baseVal;
    x = ((event.clientX - rect.left) / rect.width) * viewBox.width + viewBox.x;
    y = ((event.clientY - rect.top) / rect.height) * viewBox.height + viewBox.y;
  }

  const mapWidth = state.city.image?.width || els.map.viewBox.baseVal.width;
  const mapHeight = state.city.image?.height || els.map.viewBox.baseVal.height;
  return {
    x: Math.min(mapWidth, Math.max(0, x)),
    y: Math.min(mapHeight, Math.max(0, y)),
  };
}

function getServedStations() {
  const networkLinks = getNetworkLinks();
  const graph = new Map();
  stationById.forEach((_, id) => graph.set(id, new Set()));

  networkLinks.forEach(([from, to]) => {
    graph.get(from)?.add(to);
    graph.get(to)?.add(from);
  });

  const served = new Set();
  const queue = [...baseServed];
  queue.forEach((id) => served.add(id));

  while (queue.length) {
    const current = queue.shift();
    const neighbors = graph.get(current) || [];
    neighbors.forEach((neighbor) => {
      if (served.has(neighbor)) return;
      served.add(neighbor);
      queue.push(neighbor);
    });
  }

  return served;
}

function getNetworkLinks() {
  const links = [];

  state.city.routes.forEach((route) => {
    route.stations.forEach((stationId, index) => {
      const nextId = route.stations[index + 1];
      if (nextId) links.push([stationId, nextId]);
    });
  });

  state.builtLinks.forEach((link) => links.push([link.from, link.to]));
  return links;
}

function hasPath(fromId, toId, links) {
  const graph = new Map();
  stationById.forEach((_, id) => graph.set(id, new Set()));
  links.forEach(([from, to]) => {
    graph.get(from)?.add(to);
    graph.get(to)?.add(from);
  });

  const queue = [fromId];
  const seen = new Set(queue);
  while (queue.length) {
    const current = queue.shift();
    if (current === toId) return true;
    (graph.get(current) || []).forEach((neighbor) => {
      if (seen.has(neighbor)) return;
      seen.add(neighbor);
      queue.push(neighbor);
    });
  }
  return false;
}

function collectBaseLinks(city) {
  const links = new Set();
  city.routes.forEach((route) => {
    route.stations.forEach((stationId, index) => {
      const nextId = route.stations[index + 1];
      if (nextId) links.add(linkKey(stationId, nextId));
    });
  });
  return links;
}

function collectBaseServed(city) {
  const served = new Set();
  city.routes.forEach((route) => {
    route.stations.forEach((stationId) => served.add(stationId));
  });
  return served;
}

function getAllLinkKeys() {
  const links = new Set(baseLinks);
  state.builtLinks.forEach((link) => links.add(linkKey(link.from, link.to)));
  return links;
}

function getDemandStats(servedStations) {
  const total = state.city.stations.reduce((sum, station) => sum + station.demand, 0);
  const served = state.city.stations.reduce(
    (sum, station) => sum + (servedStations.has(station.id) ? station.demand : 0),
    0,
  );
  const base = state.city.stations.reduce(
    (sum, station) => sum + (baseServed.has(station.id) ? station.demand : 0),
    0,
  );

  return {
    total,
    served,
    baseServed: base,
    unserved: total - served,
    coverage: served / total,
  };
}

function getPressure(demand) {
  const score = demand.unserved * (1 + state.day / 40) - state.builtLinks.length * 0.8;
  if (score < 7) return { label: "Low", color: "#2c7552" };
  if (score < 18) return { label: "Rising", color: "#8a6500" };
  if (score < 30) return { label: "Crowded", color: "#b4512d" };
  return { label: "Critical", color: "#be3d3d" };
}

function getStationPressure(servedStations) {
  const pressure = new Map();
  state.city.stations.forEach((station) => {
    if (servedStations.has(station.id) && !station.planned) {
      pressure.set(station.id, Math.max(0, (station.demand - 3) * 0.15));
      return;
    }
    if (servedStations.has(station.id)) {
      pressure.set(station.id, 0.22);
      return;
    }
    pressure.set(station.id, Math.min(1, station.demand / 6 + state.day / 90));
  });
  return pressure;
}

function getBuildCost(from, to, distance) {
  const base = Math.ceil(distance / 12);
  const hubPremium = from.demand >= 5 || to.demand >= 5 ? 4 : 0;
  const waterfrontPremium = from.type === "waterfront" || to.type === "waterfront" ? 3 : 0;
  return base + hubPremium + waterfrontPremium;
}

function countCrewLinks(crewId) {
  return state.builtLinks.filter((link) => link.crewId === crewId).length;
}

function getCrew(crewId) {
  return state.city.crews.find((crew) => crew.id === crewId) || state.city.crews[0];
}

function demandLabel(value) {
  if (value >= 5) return "Very high";
  if (value >= 4) return "High";
  if (value >= 3) return "Medium";
  return "Local";
}

function stationColor(type, served) {
  if (!served) return "#ffffff";
  const colors = {
    airport: "#f0b63f",
    campus: "#7f61d9",
    growth: "#e95f45",
    hub: "#14213d",
    lrt: "#ffffff",
    regional: "#0d7f56",
    subway: "#ffffff",
    waterfront: "#00a8cc",
  };
  return colors[type] || "#ffffff";
}

function stationRadius(station) {
  if (state.city.image) {
    const imageScale = getImageScale();
    if (station.demand >= 5) return 13 * imageScale;
    if (station.demand >= 4) return 11 * imageScale;
    return 9 * imageScale;
  }
  if (station.demand >= 5) return 8;
  if (station.demand >= 4) return 7;
  return 6;
}

function stationCoreRadius(station) {
  if (state.city.image) return Math.max(4, station.demand * 1.35) * getImageScale();
  return Math.max(2.6, station.demand * 0.85);
}

function getImageScale() {
  if (!state.city.image?.gameplayBaseWidth || !state.city.image?.gameplayBaseHeight) return 1;
  const xScale = state.city.image.width / state.city.image.gameplayBaseWidth;
  const yScale = state.city.image.height / state.city.image.gameplayBaseHeight;
  return (xScale + yScale) / 2;
}

function labelOffset(station) {
  if (station.y > 540) return { x: 12, y: -12 };
  if (station.x > 780) return { x: -10, y: -13 };
  if (station.x < 250) return { x: 12, y: -12 };
  return { x: 12, y: 18 };
}

function getDistance(from, to) {
  const xScale = state.city.image?.gameplayBaseWidth
    ? state.city.image.width / state.city.image.gameplayBaseWidth
    : 1;
  const yScale = state.city.image?.gameplayBaseHeight
    ? state.city.image.height / state.city.image.gameplayBaseHeight
    : 1;
  return Math.hypot((from.x - to.x) / xScale, (from.y - to.y) / yScale);
}

function linkKey(fromId, toId) {
  return [fromId, toId].sort().join("--");
}

function svg(tagName, attrs = {}) {
  const node = document.createElementNS(SVG_NS, tagName);
  Object.entries(attrs).forEach(([key, value]) => {
    if (value === undefined || value === null) return;
    node.setAttribute(key, String(value));
  });
  return node;
}

boot();
