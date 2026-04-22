import { loadAllStrategies, loadPAMIStrategies, savePamiStrategy, deleteStrategy, saveStrategy, updateStrategy } from "./file_handler.js"; // your API functions
import { Pami_Strategy } from "../classes/Pami_Strategy.js";


let strategies = [];
let selected_strategy = null;
let loaded_strategies = {}; // Store strategies for each PAMI { pami_number: strategy }
let visible_pamis = new Set([1]); // Default: show PAMI 1
let isViewAllMode = false; // Track if we're in multi-PAMI mode
const pami_colors = {
  1: "#E74C3C",  // Bold Red
  2: "#00BCD4",  // Bold Cyan
  3: "#FFC107",  // Bold Orange
  4: "#27AE60",  // Bold Green
  5: "#E91E63",  // Bold Pink
  6: "#9C27B0",  // Bold Purple
  7: "#FF5722"   // Bold Deep Orange
};
let actionsContainer = document.getElementById("side-panel");
const actionSelect = document.getElementById("action-select");
const modal = document.getElementById("action-modal");
const go_to_args = ["x", "y", "speed"];
const go_to_args_pami7 = ["x", "y", "speed", "direction"];
const orientate_args = ["angle"];
const rotate_args = ["angle"];
const set_position_args = ["x", "y", "angle"];
const bezier_args = ["x1", "y1", "x2", "y2", "x3", "y3", "speed", "direction"]
const pick_up_args = ["right", "left", "up_down"];
const put_down_args = ["in_nest", "bechwayya"];
const move_forward_args = ["distance", "speed", "direction"];
const walking_args = [];
const delay_args = ["duration"];
const commandCodes = [
  { label: "delay", args: delay_args },
  { label: "go_to", args: go_to_args },
  { label: "orientate", args: orientate_args },
  { label: "set_position", args: set_position_args },
  { label: "bezier", args: bezier_args },
  { label: "wait_for", args: delay_args }
];
const commandCodesPami7 = [
  { label: "delay", args: delay_args },
  { label: "go_to", args: go_to_args_pami7 },
  { label: "orientate", args: orientate_args },
  { label: "set_position", args: set_position_args },
  { label: "bezier", args: bezier_args },
  { label: "wait_for", args: delay_args },
  { label: "backwards", args: [] },
  { label: "pickup", args: pick_up_args },
  { label: "putdown", args: put_down_args },
  { label: "walking_position", args: [] },
  { label: "prepare", args: [] },
  { label: "letgo", args: [] },
  { label: "move_forward", args: move_forward_args },
  { label: "rotate", args: rotate_args }
];
let contextActionIndex = null;
let contextPamiNumber = null;
const robots_on_map = new Map();
let undoStack = [];
let redoStack = [];
let zoomMode = false;
let zoomApplied = false;
let zoomRegion = null;
let isSelectingZoomRect = false;
let zoomStartPoint = null;
const simulationState = {
  running: false,
  targetPamis: []
};
const simulationHighlightKeyByPami = new Map();
const simulationHighlightTimeoutByPami = new Map();
const SIM_SPEED_MULTIPLIER = 0.8;
const ACCEL_DECEL_TIME_FACTOR = 1.5;

function getCommandCatalog(strategy) {
  return strategy?.pami_number === 7 ? commandCodesPami7 : commandCodes;
}

function getCommandConfig(strategy, commandType) {
  return getCommandCatalog(strategy)[commandType] || null;
}

function getActionDisplayText(strategy, action) {
  const commandConfig = getCommandConfig(strategy, action[0]);
  if (!commandConfig) return "unknown()";

  const command = commandConfig.label.toLowerCase();
  const args = action.slice(1);

  if (strategy.pami_number === 7) {
    if (command === "delay" || command === "wait_for") {
      return `${command}(${args[0]}ms)`;
    }

    if (command === "go_to") {
      return args.length > 3
        ? `go_to(${args[0]}, ${args[1]}, ${args[2]}, ${args[3]})`
        : `go_to(${args[0]}, ${args[1]}, ${args[2]})`;
    }

    if (command === "orientate") {
      return `orientate(${args[0]})`;
    }

    if (command === "rotate") {
      return `rotate(${args[0]})`;
    }

    if (command === "set_position") {
      return `set_position(${args[0]}, ${args[1]}, ${args[2]})`;
    }

    if (command === "bezier") {
      return `bezier(${args[0]}, ${args[1]}, ${args[2]}, ${args[3]}, ${args[4]}, ${args[5]}, ${args[6]}, ${args[7]})`;
    }

    if (command === "pickup") {
      return `pickup(right:${args[0]}, left:${args[1]}, up_down:${args[2]})`;
    }

    if (command === "putdown") {
      return `putdown(in_nest:${args[0] ?? 0}, bechwayya:${args[1] ?? 0})`;
    }

    if (command === "move_forward") {
      return `move_forward(distance:${args[0] ?? 0}, speed:${args[1] ?? 0}, direction:${args[2] ?? 0})`;
    }

    return `${command}()`;
  }

  if (command === "delay" || command === "wait_for") {
    return `${command}(${args[0]}ms)`;
  }

  if (command === "go_to") {
    return `go_to(${args[0]}, ${args[1]}, ${args[2]})`;
  }

  if (command === "orientate") {
    return `orientate(${args[0]})`;
  }

  if (command === "set_position") {
    return `set_position(${args[0]}, ${args[1]}, ${args[2]})`;
  }

  if (command === "bezier") {
    return `bezier(${args[0]}, ${args[1]}, ${args[2]}, ${args[3]}, ${args[4]}, ${args[5]}, ${args[6]})`;
  }

  return `${command}()`;
}

// ------------------------------
// Load selected strategy
// ------------------------------
function create_strategy(strategy_name, pami_number) {
    const new_strategy = new Pami_Strategy(strategy_name, pami_number, []);
    savePamiStrategy(new_strategy);
    return new_strategy;
}

async function get_selected_strategy() {
  const params = new URLSearchParams(window.location.search);
  const strategy_name = params.get("name");
  const pami_number = parseInt(params.get("pami"));
  const viewAll = params.get("viewAll") === "true";
  isViewAllMode = viewAll;
  strategies = await loadPAMIStrategies();
  
  // Load all PAMIs for this strategy
  for (let i = 1; i <= 7; i++) {
    let found = false;
    for (let strategy of strategies) {
      if (strategy.strategy_name === strategy_name && strategy.pami_number === i) {
        loaded_strategies[i] = strategy;
        found = true;
        break;
      }
    }
    if (!found) {
      loaded_strategies[i] = create_strategy(strategy_name, i);
    }
  }
  
  // Set the default selected strategy
  selected_strategy = loaded_strategies[pami_number];
  
  // Initialize undo stack
  undoStack.length = 0;
  undoStack.push(JSON.stringify(loaded_strategies));
  redoStack.length = 0;
  
  if (viewAll) {
    // Multi-PAMI mode: show selector and all PAMIs
    document.getElementById("pami-selector").classList.remove("hidden");
    
    // Check appropriate PAMIs in the UI
    const checkboxes = document.querySelectorAll(".pami-checkbox");
    checkboxes.forEach(checkbox => {
      checkbox.checked = true;
      visible_pamis.add(parseInt(checkbox.dataset.pami));
    });
    
    document.querySelector("title").textContent = "Multi-PAMI - " + strategy_name;
  } else {
    // Single-PAMI mode: hide selector, show only selected PAMI
    document.getElementById("pami-selector").classList.add("hidden");
    visible_pamis.clear();
    visible_pamis.add(pami_number);
    document.querySelector("title").textContent = "PAMI " + pami_number + " - " + strategy_name;
  }
  
  renderTasks(viewAll);
  
  // Setup PAMI checkbox listeners only in multi-PAMI mode
  if (viewAll) {
    setupPamiCheckboxes();
  }
}

// ------------------------------
// Setup PAMI checkbox listeners
// ------------------------------
function setupPamiCheckboxes() {
  const checkboxes = document.querySelectorAll(".pami-checkbox");
  const allCheckbox = document.getElementById("pami-all-checkbox");
  
  // Individual checkbox change handler
  checkboxes.forEach(checkbox => {
    checkbox.addEventListener("change", (e) => {
      const pamiNum = parseInt(e.target.dataset.pami);
      if (e.target.checked) {
        visible_pamis.add(pamiNum);
      } else {
        visible_pamis.delete(pamiNum);
      }
      
      // Update ALL checkbox state
      updateAllCheckboxState();
      
      renderTasks(isViewAllMode);
      renderMap();
    });
  });
  
  // ALL checkbox handler
  allCheckbox.addEventListener("change", (e) => {
    const isChecked = e.target.checked;
    
    checkboxes.forEach(checkbox => {
      checkbox.checked = isChecked;
      const pamiNum = parseInt(checkbox.dataset.pami);
      
      if (isChecked) {
        visible_pamis.add(pamiNum);
      } else {
        visible_pamis.delete(pamiNum);
      }
    });
    
    renderTasks(isViewAllMode);
    renderMap();
  });
  
  // Initialize ALL checkbox state
  updateAllCheckboxState();
}

function saveToUndoStack() {
  if (undoStack.length > 100) undoStack.shift();
  undoStack.push(JSON.stringify(loaded_strategies));
  redoStack.length = 0;
}

function undo() {
  if (undoStack.length < 2) return;

  redoStack.push(undoStack.pop());

  loaded_strategies = JSON.parse(
    undoStack[undoStack.length - 1]
  );

  renderTasks(isViewAllMode);
  renderMap();
  
  // Save all PAMIs
  Object.values(loaded_strategies).forEach(strategy => {
    savePamiStrategy(strategy);
  });
}

function redo() {
  if (redoStack.length === 0) return;

  const state = redoStack.pop();
  undoStack.push(state);

  loaded_strategies = JSON.parse(state);

  renderTasks(isViewAllMode);
  renderMap();
  
  // Save all PAMIs
  Object.values(loaded_strategies).forEach(strategy => {
    savePamiStrategy(strategy);
  });
}

function updateAllCheckboxState() {
  const allCheckbox = document.getElementById("pami-all-checkbox");
  const checkboxes = document.querySelectorAll(".pami-checkbox");
  const checkedCount = Array.from(checkboxes).filter(cb => cb.checked).length;
  
  if (checkedCount === 0) {
    allCheckbox.checked = false;
    allCheckbox.indeterminate = false;
  } else if (checkedCount === checkboxes.length) {
    allCheckbox.checked = true;
    allCheckbox.indeterminate = false;
  } else {
    allCheckbox.checked = false;
    allCheckbox.indeterminate = true;
  }
}

// ------------------------------
// Render tasks and actions
// ------------------------------
function renderTasks(isMultiMode = true) {
    actionsContainer.innerHTML = "";
    
    if (!isMultiMode) {
      // Single-PAMI mode: render like the old viewer (simple list)
      const pamiNum = Array.from(visible_pamis)[0];
      const strategy = loaded_strategies[pamiNum];
      if (!strategy) return;
      
      const taskBox = document.createElement("div");
      taskBox.classList.add("task-box");

      const legend = document.createElement("label");
      legend.type = "text";
      legend.value = `Actions`;
      legend.classList.add("task-legend");

      taskBox.appendChild(legend);

      const actionList = document.createElement("div");
      actionList.classList.add("action-list");

      strategy.sequence.forEach((action, actionIndex) => {
        const actionDiv = document.createElement("div");
        actionDiv.classList.add("action-item");
        
        actionDiv.textContent = getActionDisplayText(strategy, action);

        actionDiv.draggable = true;
        actionDiv.dataset.actionIndex = actionIndex;
        actionDiv.dataset.pamiNumber = pamiNum;

        setupActionEventListeners(actionDiv, actionIndex, pamiNum, actionList);
        actionList.appendChild(actionDiv);
      });

      setupActionListDropZone(actionList, pamiNum);

      taskBox.appendChild(actionList);
      actionsContainer.appendChild(taskBox);
      
    } else {
      // Multi-PAMI mode: render with colored boxes for each PAMI
      visible_pamis.forEach(pamiNum => {
        const strategy = loaded_strategies[pamiNum];
        if (!strategy) return;
        
        const pamiBox = document.createElement("div");
        pamiBox.classList.add("pami-task-box");
        pamiBox.style.borderColor = pami_colors[pamiNum];

        const header = document.createElement("div");
        header.classList.add("pami-task-header");
        header.style.backgroundColor = pami_colors[pamiNum] + "33";
        
        const colorIndicator = document.createElement("span");
        colorIndicator.classList.add("pami-color-indicator");
        colorIndicator.style.backgroundColor = pami_colors[pamiNum];
        
        const headerText = document.createElement("span");
        headerText.textContent = `PAMI ${pamiNum}`;
        
        header.appendChild(colorIndicator);
        header.appendChild(headerText);
        pamiBox.appendChild(header);

        const actionList = document.createElement("div");
        actionList.classList.add("action-list");

        strategy.sequence.forEach((action, actionIndex) => {
          const actionDiv = document.createElement("div");
          actionDiv.classList.add("action-item");
          actionDiv.style.borderLeft = `4px solid ${pami_colors[pamiNum]}`;
          
          actionDiv.textContent = getActionDisplayText(strategy, action);

          actionDiv.draggable = true;
          actionDiv.dataset.actionIndex = actionIndex;
          actionDiv.dataset.pamiNumber = pamiNum;

          setupActionEventListeners(actionDiv, actionIndex, pamiNum, actionList);
          actionList.appendChild(actionDiv);
        });

        setupActionListDropZone(actionList, pamiNum);

        pamiBox.appendChild(actionList);
        actionsContainer.appendChild(pamiBox);
      });
    }

  setupContextMenuHandlers();
}

function setupActionEventListeners(actionDiv, actionIndex, pamiNum, actionList) {
        actionDiv.addEventListener("mouseenter", () => {
          highlightMapPoints(actionIndex, pamiNum);
        });

        actionDiv.addEventListener("mouseleave", () => {
          unhighlightMapPoints();
        });

        actionDiv.addEventListener("dragstart", e => {
          actionDiv.classList.add("dragging");
          e.dataTransfer.effectAllowed = "move";
          e.dataTransfer.setData(
            "text/plain",
            JSON.stringify({
              fromAction: actionIndex,
              fromPami: pamiNum
            })
          );
        });

        actionDiv.addEventListener("dragend", () => {
          actionDiv.classList.remove("dragging");
        });

        /* ---------- DRAG OVER ---------- */
        actionDiv.addEventListener("dragover", e => {
          e.preventDefault();
          actionDiv.classList.add("drag-over");
        });

        actionDiv.addEventListener("dragleave", () => {
          actionDiv.classList.remove("drag-over");
        });

        /* ---------- DROP (INSERT HERE) ---------- */
        actionDiv.addEventListener("drop", e => {
          e.preventDefault();
          actionDiv.classList.remove("drag-over");

          const data = JSON.parse(e.dataTransfer.getData("text/plain"));
          const {fromAction, fromPami } = data;
          const toAction = actionIndex;
          const toPami = pamiNum;

          if (fromAction == null || fromPami == null) return;
          
          // Only allow drag within same PAMI
          if (fromPami !== toPami) return;

          const movedAction = loaded_strategies[fromPami].sequence.splice(fromAction, 1)[0];

          const insertIndex = fromAction < toAction ? toAction - 1 : toAction;

          loaded_strategies[toPami].sequence.splice(insertIndex, 0, movedAction);

          saveToUndoStack();
          renderTasks(isViewAllMode);
          renderMap();
          savePamiStrategy(loaded_strategies[toPami]);
        });

        /* ---------- CONTEXT MENU ---------- */
        actionDiv.addEventListener("contextmenu", e => {
          e.preventDefault();

          contextActionIndex = actionIndex;
          contextPamiNumber = pamiNum;

          const menu = document.getElementById("action-context-menu");
          menu.style.left = `${e.clientX}px`;
          menu.style.top = `${e.clientY}px`;
          menu.classList.remove("hidden");
        });
}

function setupActionListDropZone(actionList, pamiNum) {
      /* ---------- DROP AT END OF TASK ---------- */
      actionList.addEventListener("dragover", e => e.preventDefault());

      actionList.addEventListener("drop", e => {
        if (e.target !== actionList) return;

        const data = JSON.parse(e.dataTransfer.getData("text/plain"));
        const { fromAction, fromPami } = data;

        if (fromAction == null || fromPami == null) return;
        
        // Only allow within same PAMI
        if (fromPami !== pamiNum) return;

        const movedAction = loaded_strategies[fromPami].sequence.splice(fromAction, 1)[0];

        loaded_strategies[pamiNum].sequence.push(movedAction);

        saveToUndoStack();
        renderTasks(isViewAllMode);
        renderMap();
        savePamiStrategy(loaded_strategies[pamiNum]);
      });
}

function setupContextMenuHandlers() {

  document.addEventListener("click", () => {
    document.getElementById("action-context-menu").classList.add("hidden");
  });

  document.getElementById("ctx-delete").onclick = () => {
    if (contextActionIndex == null || contextPamiNumber == null) return;

    loaded_strategies[contextPamiNumber].sequence.splice(contextActionIndex, 1);
    
    const pamiToSave = contextPamiNumber;

    contextActionIndex = null;
    contextPamiNumber = null;

    document.getElementById("action-context-menu").classList.add("hidden");

    saveToUndoStack();
    renderTasks(isViewAllMode);
    renderMap();
    savePamiStrategy(loaded_strategies[pamiToSave]);
  };

  document.getElementById("ctx-modify").onclick = () => {
    if (contextActionIndex == null || contextPamiNumber == null) return;
    
    const strategy = loaded_strategies[contextPamiNumber];
    const command_type = strategy.sequence[contextActionIndex][0];
    const commandList = getCommandCatalog(strategy);
    const commandConfig = commandList[command_type];
    const command = commandConfig ? commandConfig.label : "unknown";

    let args_table = [];
    document.getElementById("command_label").textContent =
      "Command: " + command;

    if (commandConfig) {
      args_table = commandConfig.args;
    }

    const argsContainer = document.getElementById("args-container");
    argsContainer.innerHTML = "";

    args_table.forEach(arg => {
      const label = document.createElement("label");
      label.textContent = arg;

      const input = document.createElement("input");
      input.type = "decimal";
      input.dataset.argName = arg;
      if (arg === "up_down") {
        input.placeholder = "1: up, 2: down";
      }

      label.appendChild(input);
      argsContainer.appendChild(label);
    });

    const inputs = document.querySelectorAll("#args-container input");
    inputs.forEach(input => input.addEventListener("keydown",(e) => {
      if (e.key === "Enter") {
        const nextInput = input.parentElement.nextElementSibling;
        if (nextInput && nextInput.querySelector("input")) {
          nextInput.querySelector("input").focus();
        } else {
          document.getElementById("modal-confirm").click();
        }
      }
    }));
    inputs.forEach((input, i) => {
      input.value = strategy.sequence[contextActionIndex][i+1] ?? "";
    });

    modal.classList.remove("hidden");
    document.getElementById("action-context-menu").classList.add("hidden");
    inputs[0].focus();
  };
}

// ------------------------------
// Populate Add Action dropdown
// ------------------------------
function populateAddList() {
  const options = getCommandCatalog(selected_strategy);
  actionSelect.innerHTML = '<option value="">select action</option>';
  options.forEach((a, i) => {
    const opt = document.createElement("option");
    opt.value = i;
    opt.textContent = a.label;
    actionSelect.appendChild(opt);
  });
}

function addDefs(svg) {
  let defsHTML = '<defs><marker id="arrowhead" markerWidth="10" markerHeight="7" refX="10" refY="3.5" orient="auto"><polygon points="0 0, 10 3.5, 0 7" fill="#667eea"/></marker>';
  
  // Add arrowheads for each PAMI color
  for (let i = 1; i <= 7; i++) {
    defsHTML += `<marker id="arrowhead-${i}" markerWidth="10" markerHeight="7" refX="10" refY="3.5" orient="auto">
      <polygon points="0 0, 10 3.5, 0 7" fill="${pami_colors[i]}"/>
    </marker>`;
  }
  
  defsHTML += '</defs>';
  svg.innerHTML = defsHTML;
}

function mapToScreen(x, y) {
  const projection = getMapProjectionState();

  const baseCx = projection.baseX + (y / 3000) * projection.baseWidth;
  const baseCy = projection.baseY + (x / 2000) * projection.baseHeight;

  return {
    cx: baseCx * projection.scale + projection.translateX,
    cy: baseCy * projection.scale + projection.translateY
  };
}

function screenToMap(cx, cy) {
  const projection = getMapProjectionState();

  const baseCx = (cx - projection.translateX) / projection.scale;
  const baseCy = (cy - projection.translateY) / projection.scale;

  const normY = (baseCx - projection.baseX) / projection.baseWidth;
  const normX = (baseCy - projection.baseY) / projection.baseHeight;

  return {
    x: Math.max(0, Math.min(2000, normX * 2000)),
    y: Math.max(0, Math.min(3000, normY * 3000))
  };
}

function getBaseMapViewport() {
  const img = document.getElementById("map");
  const mapAspect = (img.naturalWidth && img.naturalHeight)
    ? img.naturalWidth / img.naturalHeight
    : 3000 / 2000;

  const boxW = img.clientWidth;
  const boxH = img.clientHeight;
  const boxAspect = boxW / boxH;

  let displayedWidth;
  let displayedHeight;
  let offsetX;
  let offsetY;

  if (boxAspect > mapAspect) {
    displayedHeight = boxH;
    displayedWidth = displayedHeight * mapAspect;
    offsetX = (boxW - displayedWidth) / 2;
    offsetY = 0;
  } else {
    displayedWidth = boxW;
    displayedHeight = displayedWidth / mapAspect;
    offsetX = 0;
    offsetY = (boxH - displayedHeight) / 2;
  }

  return {
    x: offsetX,
    y: offsetY,
    width: displayedWidth,
    height: displayedHeight
  };
}

function getMapProjectionState() {
  const mapWrapper = document.getElementById("map-wrapper");
  const baseViewport = getBaseMapViewport();

  if (!zoomApplied || !zoomRegion) {
    return {
      baseX: baseViewport.x,
      baseY: baseViewport.y,
      baseWidth: baseViewport.width,
      baseHeight: baseViewport.height,
      scale: 1,
      translateX: 0,
      translateY: 0
    };
  }

  const selX = baseViewport.x + zoomRegion.x * baseViewport.width;
  const selY = baseViewport.y + zoomRegion.y * baseViewport.height;
  const selW = Math.max(1, zoomRegion.w * baseViewport.width);
  const selH = Math.max(1, zoomRegion.h * baseViewport.height);

  const scale = Math.min(
    mapWrapper.clientWidth / selW,
    mapWrapper.clientHeight / selH
  );

  const selectedDisplayedWidth = selW * scale;
  const selectedDisplayedHeight = selH * scale;
  const extraX = (mapWrapper.clientWidth - selectedDisplayedWidth) / 2;
  const extraY = (mapWrapper.clientHeight - selectedDisplayedHeight) / 2;

  return {
    baseX: baseViewport.x,
    baseY: baseViewport.y,
    baseWidth: baseViewport.width,
    baseHeight: baseViewport.height,
    scale,
    translateX: extraX - selX * scale,
    translateY: extraY - selY * scale
  };
}

function toBaseCoordinates(viewportX, viewportY) {
  return { x: viewportX, y: viewportY };
}

function applyZoomTransform() {
  const map = document.getElementById("map");
  const overlay = document.getElementById("map-overlay");

  if (!zoomApplied || !zoomRegion) {
    map.style.transform = "";
    overlay.style.transform = "";
    map.style.transformOrigin = "";
    overlay.style.transformOrigin = "";
    return;
  }

  const projection = getMapProjectionState();
  const transformValue = `translate(${projection.translateX}px, ${projection.translateY}px) scale(${projection.scale})`;

  map.style.transformOrigin = "top left";
  map.style.transform = transformValue;
  overlay.style.transformOrigin = "top left";
  overlay.style.transform = "";
}

function setZoomMode(isEnabled) {
  zoomMode = isEnabled;
  const mapWrapper = document.getElementById("map-wrapper");
  const zoomBtn = document.getElementById("zoom-btn");

  mapWrapper.classList.toggle("zoom-mode", isEnabled);
  zoomBtn.classList.toggle("zoom-active", isEnabled);
}

function removeZoomSelectionRect() {
  const existingRect = document.getElementById("zoom-selection-rect");
  if (existingRect) {
    existingRect.remove();
  }
}

function getRelativePointInWrapper(e) {
  const mapWrapper = document.getElementById("map-wrapper");
  const rect = mapWrapper.getBoundingClientRect();
  const x = Math.max(0, Math.min(e.clientX - rect.left, rect.width));
  const y = Math.max(0, Math.min(e.clientY - rect.top, rect.height));
  return { x, y };
}

function startZoomSelection(e) {
  if (!zoomMode || zoomApplied || e.button !== 0) return;

  const mapWrapper = document.getElementById("map-wrapper");
  isSelectingZoomRect = true;
  zoomStartPoint = getRelativePointInWrapper(e);

  removeZoomSelectionRect();
  const selectionRect = document.createElement("div");
  selectionRect.id = "zoom-selection-rect";
  selectionRect.style.left = `${zoomStartPoint.x}px`;
  selectionRect.style.top = `${zoomStartPoint.y}px`;
  selectionRect.style.width = "0px";
  selectionRect.style.height = "0px";
  mapWrapper.appendChild(selectionRect);

  e.preventDefault();
  e.stopPropagation();
}

function updateZoomSelection(e) {
  if (!zoomMode || !isSelectingZoomRect || !zoomStartPoint) return;

  const current = getRelativePointInWrapper(e);
  const left = Math.min(zoomStartPoint.x, current.x);
  const top = Math.min(zoomStartPoint.y, current.y);
  const width = Math.abs(current.x - zoomStartPoint.x);
  const height = Math.abs(current.y - zoomStartPoint.y);

  const selectionRect = document.getElementById("zoom-selection-rect");
  if (!selectionRect) return;

  selectionRect.style.left = `${left}px`;
  selectionRect.style.top = `${top}px`;
  selectionRect.style.width = `${width}px`;
  selectionRect.style.height = `${height}px`;

  e.preventDefault();
}

function finishZoomSelection(e) {
  if (!zoomMode || !isSelectingZoomRect || !zoomStartPoint) return;

  const endPoint = getRelativePointInWrapper(e);
  const baseViewport = getBaseMapViewport();

  const left = Math.min(zoomStartPoint.x, endPoint.x);
  const top = Math.min(zoomStartPoint.y, endPoint.y);
  const width = Math.abs(endPoint.x - zoomStartPoint.x);
  const height = Math.abs(endPoint.y - zoomStartPoint.y);

  const selectionRight = left + width;
  const selectionBottom = top + height;
  const mapRight = baseViewport.x + baseViewport.width;
  const mapBottom = baseViewport.y + baseViewport.height;

  const clampedLeft = Math.max(left, baseViewport.x);
  const clampedTop = Math.max(top, baseViewport.y);
  const clampedRight = Math.min(selectionRight, mapRight);
  const clampedBottom = Math.min(selectionBottom, mapBottom);
  const clampedWidth = Math.max(0, clampedRight - clampedLeft);
  const clampedHeight = Math.max(0, clampedBottom - clampedTop);

  isSelectingZoomRect = false;
  zoomStartPoint = null;
  removeZoomSelectionRect();

  if (clampedWidth < 20 || clampedHeight < 20) {
    setZoomMode(false);
    return;
  }

  zoomRegion = {
    x: (clampedLeft - baseViewport.x) / baseViewport.width,
    y: (clampedTop - baseViewport.y) / baseViewport.height,
    w: clampedWidth / baseViewport.width,
    h: clampedHeight / baseViewport.height
  };

  zoomApplied = true;
  setZoomMode(false);
  applyZoomTransform();
  renderMap();
}

function renderMap() {
    const svg = document.getElementById("map-overlay");
    svg.innerHTML = "";
    addDefs(svg);

    // Render paths for all visible PAMIs
    visible_pamis.forEach(pamiNum => {
      const strategy = loaded_strategies[pamiNum];
      if (!strategy) return;
      
      const color = pami_colors[pamiNum];

      let currentPos = { x: 0, y: 0 };
      let currentAngle = 0;
      strategy.sequence.forEach((action, actionIndex) => {

        if (action[0] == 3) {
          const [x, y] = [action[1], action[2]];
          currentPos = { x, y };
          currentAngle = normalizeAngle(parseFloat(action[3]) || 0);
          drawPoint(svg, x, y, "robot", actionIndex, 1, 2, false, color, pamiNum);
        }

        else if (action[0] == 1) {
          const [x, y] = [action[1], action[2]];
          drawArrow(svg, currentPos, { x, y }, 0, color, pamiNum);
          drawPoint(svg, x, y,"", actionIndex, 1, 2, false, color, pamiNum);
          const dx = parseFloat(x) - parseFloat(currentPos.x);
          const dy = parseFloat(y) - parseFloat(currentPos.y);
          if (Math.hypot(dx, dy) > 1e-3) {
            currentAngle = normalizeAngle(rad_to_deg(Math.atan2(dy, dx)));
          }
          currentPos = { x, y };
        }

        else if (action[0] == 2) {
          drawRotateIcon(svg, currentPos, color);
          currentAngle = normalizeAngle(parseFloat(action[1]) || currentAngle);
        }
        else if (action[0] == 13) {
          drawRotateIcon(svg, currentPos, color);
          currentAngle = normalizeAngle(currentAngle + (parseFloat(action[1]) || 0));
        }
        else if (action[0] == 4){
          drawBezier(svg, currentPos, action.slice(1), 0, actionIndex, color, pamiNum);
          const [ x1, y1, x2, y2, x3, y3 ] = action.slice(1);
          const endDx = parseFloat(x3) - parseFloat(x2);
          const endDy = parseFloat(y3) - parseFloat(y2);
          if (Math.hypot(endDx, endDy) > 1e-3) {
            currentAngle = normalizeAngle(rad_to_deg(Math.atan2(endDy, endDx)));
          } else {
            const startDx = parseFloat(x1) - parseFloat(currentPos.x);
            const startDy = parseFloat(y1) - parseFloat(currentPos.y);
            if (Math.hypot(startDx, startDy) > 1e-3) {
              currentAngle = normalizeAngle(rad_to_deg(Math.atan2(startDy, startDx)));
            }
          }
          currentPos = { x: x3, y: y3 };
        }
        else if (action[0] == 12) {
          const distance = parseFloat(action[1]);
          const direction = parseFloat(action[3]);
          const sign = Number.isFinite(direction) && direction < 0 ? -1 : 1;
          const delta = (Number.isFinite(distance) ? distance : 0) * sign;
          const rad = deg_to_rad(currentAngle);
          const x = parseFloat(currentPos.x) + delta * Math.cos(rad);
          const y = parseFloat(currentPos.y) + delta * Math.sin(rad);
          drawArrow(svg, currentPos, { x, y }, sign < 0 ? 1 : 0, color, pamiNum);
          currentPos = { x, y };
        }
      });
    });
}
function drawBezier(svg, start, params, backwards, actionIndex, color, pamiNum) {
  const [x1,y1,x2,y2,x3,y3] = params;

  const p0 = mapToScreen(start.x, start.y);
  const p1 = mapToScreen(x1, y1);
  const p2 = mapToScreen(x2, y2);
  const p3 = mapToScreen(x3, y3);

  drawDiscountinousLine(svg, start, { x: x1, y: y1 }, color); // Draw discontinuous line to first point
  drawDiscountinousLine(svg, { x: x2, y: y2 }, { x: x3, y: y3 }, color); // Draw discontinuous line to last point

  // Draw black outline first (thicker)
  const outline = document.createElementNS("http://www.w3.org/2000/svg", "path");
  outline.setAttribute(
    "d",
    `M ${p0.cx} ${p0.cy} C ${p1.cx} ${p1.cy}, ${p2.cx} ${p2.cy}, ${p3.cx} ${p3.cy}`
  );
  outline.classList.add(backwards ? "backward" : "forward");
  outline.setAttribute("fill", "none");
  outline.style.strokeWidth = "5";
  outline.style.stroke = "#000000";
  outline.setAttribute("marker-end", "none");
  svg.appendChild(outline);

  // Draw colored path on top
  const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
  path.setAttribute(
    "d",
    `M ${p0.cx} ${p0.cy} C ${p1.cx} ${p1.cy}, ${p2.cx} ${p2.cy}, ${p3.cx} ${p3.cy}`
  );
  path.classList.add(backwards ? "backward" : "forward");
  path.setAttribute("fill", "none");
  path.style.strokeWidth = "2";
  path.style.stroke = color;

  svg.appendChild(path);

  drawPoint(svg, params[0], params[1], "", actionIndex, 1, 2, true, color, pamiNum);
  drawPoint(svg, params[2], params[3], "", actionIndex, 3, 4, true, color, pamiNum);
  drawPoint(svg, params[4], params[5], "", actionIndex, 5, 6, false, color, pamiNum);
  // add arrowhead at end of bezier like drawArrow
  path.setAttribute("marker-end", `url(#arrowhead-${pamiNum})`);
}

function drawDiscountinousLine(svg, from, to, color) {
  const p1 = mapToScreen(from.x, from.y);
  const p2 = mapToScreen(to.x, to.y);

  // Draw black outline first (thicker)
  const outline = document.createElementNS("http://www.w3.org/2000/svg", "line");
  outline.setAttribute("x1", p1.cx);
  outline.setAttribute("y1", p1.cy);
  outline.setAttribute("x2", p2.cx);
  outline.setAttribute("y2", p2.cy);
  outline.style.stroke = "#000000";
  outline.setAttribute("marker-end", "none");
  outline.style.strokeWidth = "4";
  outline.setAttribute("stroke-dasharray", "10,10");
  outline.setAttribute("opacity", "0.5");
  svg.appendChild(outline);

  // Draw colored line on top
  const l = document.createElementNS("http://www.w3.org/2000/svg", "line");
  l.setAttribute("x1", p1.cx);
  l.setAttribute("y1", p1.cy);
  l.setAttribute("x2", p2.cx);
  l.setAttribute("y2", p2.cy);

  l.style.stroke = color || "white";
  l.setAttribute("marker-end", "none");
  l.style.strokeWidth = "2";
  l.setAttribute("stroke-dasharray", "10,10");
  l.setAttribute("opacity", "0.5");

  svg.appendChild(l);
}

function drawPoint(svg, x, y, cls = "", actionIndex, paramIndexX, paramIndexY, secondary=false, color="#667eea", pamiNum) {
  const { cx, cy } = mapToScreen(x, y);

  const c = document.createElementNS("http://www.w3.org/2000/svg", "circle");
  c.setAttribute("cx", cx);
  c.setAttribute("cy", cy);
  c.setAttribute("r", 6);
  c.classList.add("map-point");
  c.style.fill = color;
  c.style.stroke = "#000000";
  c.style.strokeWidth = "2";
  if (secondary){
    c.classList.add("secondary");
  }
  if (cls) c.classList.add(cls);
  c.dataset.actionIndex = actionIndex;
  c.dataset.pamiNumber = pamiNum;

  enableDrag(c, actionIndex , paramIndexX, paramIndexY, pamiNum);
  svg.appendChild(c);
}

function drawArrow(svg, from, to, backwards, color, pamiNum) {
  const p1 = mapToScreen(from.x, from.y);
  const p2 = mapToScreen(to.x, to.y);

  // Draw black outline first (thicker)
  const outline = document.createElementNS("http://www.w3.org/2000/svg", "line");
  outline.setAttribute("x1", p1.cx);
  outline.setAttribute("y1", p1.cy);
  outline.setAttribute("x2", p2.cx);
  outline.setAttribute("y2", p2.cy);
  outline.classList.add("arrow", backwards ? "backward" : "forward");
  outline.style.stroke = "#000000";
  outline.style.strokeWidth = "4";
  outline.setAttribute("marker-end", "none");
  svg.appendChild(outline);

  // Draw colored line on top
  const l = document.createElementNS("http://www.w3.org/2000/svg", "line");
  l.setAttribute("x1", p1.cx);
  l.setAttribute("y1", p1.cy);
  l.setAttribute("x2", p2.cx);
  l.setAttribute("y2", p2.cy);
  l.classList.add("arrow", backwards ? "backward" : "forward");
  l.style.stroke = color;
  l.style.strokeWidth = "2";
  l.setAttribute("marker-end", `url(#arrowhead-${pamiNum})`);

  svg.appendChild(l);
}

function drawIcon(svg, pos, symbol, color) {
  const { cx, cy } = mapToScreen(pos.x, pos.y);

  const t = document.createElementNS("http://www.w3.org/2000/svg", "text");
  t.setAttribute("x", cx + 5);
  t.setAttribute("y", cy - 5);
  t.textContent = symbol;
  t.classList.add("icon");
  if (color) t.setAttribute("fill", color);

  svg.appendChild(t);
}

function drawRotateIcon(svg, pos, color) {
  drawIcon(svg, pos, "🔄", color);
}
function updateActionParamsFromDrag(actionIndex, paramIndexX, paramIndexY, cx, cy, pamiNum) {
  const { x, y } = screenToMap(cx, cy);

  loaded_strategies[pamiNum].sequence[actionIndex][paramIndexX] = x.toFixed(2);
  loaded_strategies[pamiNum].sequence[actionIndex][paramIndexY] = y.toFixed(2);
}
function hightlightAction(actionIndex, pamiNum, preserveExisting = false) {
  if (!preserveExisting) {
    unHightlightActions();
  }

  const actionItems = document.querySelectorAll(".action-item");
  actionItems.forEach((item) => {
    if (
      Number(item.dataset.actionIndex) === Number(actionIndex) &&
      Number(item.dataset.pamiNumber) === Number(pamiNum)
    ) {
      item.classList.add("highlighted");
    }
  });
}
function unHightlightActions() {
  const actionItems = document.querySelectorAll(".action-item");
  actionItems.forEach((item) => {
    item.classList.remove("highlighted");
  });
}

function highlightMapPoints(actionIndex, pamiNum, preserveExisting = false) {
  if (!preserveExisting) {
    unhighlightMapPoints();
  }

  const mapPoints = document.querySelectorAll(".map-point");
  mapPoints.forEach((point) => {
    if (
      Number(point.dataset.actionIndex) === Number(actionIndex) &&
      Number(point.dataset.pamiNumber) === Number(pamiNum)
    ) {
      point.classList.add("map-point-highlighted");
    }
  });
}

function unhighlightMapPoints() {
  const mapPoints = document.querySelectorAll(".map-point");
  mapPoints.forEach((point) => {
    point.classList.remove("map-point-highlighted");
  });
}
function draw_robot_on_map(svg, x, y, angle, pamiNum) {
  clear_robot_off_map(svg, pamiNum);

  const { cx, cy } = mapToScreen(x, y);
  const projection = getMapProjectionState();
  const robotScale = projection.scale;

  const color = pami_colors[pamiNum] || "rgba(243, 20, 255, 1)";

  const robot = document.createElementNS("http://www.w3.org/2000/svg", "g");
  robot.setAttribute("transform", `translate(${cx}, ${cy}) rotate(${90 - angle})`);

  const scaledRobot = document.createElementNS("http://www.w3.org/2000/svg", "g");
  scaledRobot.setAttribute("transform", `scale(${robotScale})`);

  /* Robot body - different size for pami 7 */
  const rect = document.createElementNS("http://www.w3.org/2000/svg", "rect");
  if (pamiNum === 7) {
    // Pami 7: 110mm x 130mm (map is 3000mm wide)
    rect.setAttribute("width", svg.clientWidth * (110 / 3000));
    rect.setAttribute("height", svg.clientWidth * (130 / 3000));
  } else {
    // Default pami size
    rect.setAttribute("width", svg.clientWidth * 0.025);
    rect.setAttribute("height", svg.clientWidth * 0.03);
  }
  rect.setAttribute("x", -rect.getAttribute("width") / 2);
  rect.setAttribute("y", -rect.getAttribute("height") / 2);
  rect.setAttribute("fill", color);
  rect.setAttribute("fill-opacity", "0.5");
  rect.setAttribute("stroke", color);
  rect.setAttribute("stroke-width", "2");

  /* Centered direction arrow */
  const arrow = document.createElementNS("http://www.w3.org/2000/svg", "polygon");
  arrow.setAttribute(
    "points",
    "6,0 -4,-4 -4,4"   // centered arrow, pointing +X, 3 times bigger
  );
  arrow.setAttribute("fill", color);
  arrow.setAttribute("fill-opacity", "1");

  scaledRobot.appendChild(rect);
  scaledRobot.appendChild(arrow);
  robot.appendChild(scaledRobot);
  svg.appendChild(robot);
  robots_on_map.set(pamiNum, robot);
}
function clear_robot_off_map(svg, pamiNum = null) {
  if (pamiNum != null) {
    const robot = robots_on_map.get(pamiNum);
    if (robot) {
      try {
        svg.removeChild(robot);
      } catch (e) {}
      robots_on_map.delete(pamiNum);
    }
    return;
  }

  robots_on_map.forEach((robot) => {
    try {
      svg.removeChild(robot);
    } catch (e) {}
  });
  robots_on_map.clear();
}
function rad_to_deg(rad) {
  return rad * (180 / Math.PI);
}

function deg_to_rad(deg) {
  return deg * (Math.PI / 180);
}

function normalizeAngle(deg) {
  let value = deg % 360;
  if (value < 0) value += 360;
  return value;
}

function shortestAngleDelta(from, to) {
  return ((to - from + 540) % 360) - 180;
}

function lerp(a, b, t) {
  return a + (b - a) * t;
}

function cubicBezierPoint(t, p0, p1, p2, p3) {
  const mt = 1 - t;
  const mt2 = mt * mt;
  const t2 = t * t;
  return {
    x: mt2 * mt * p0.x + 3 * mt2 * t * p1.x + 3 * mt * t2 * p2.x + t2 * t * p3.x,
    y: mt2 * mt * p0.y + 3 * mt2 * t * p1.y + 3 * mt * t2 * p2.y + t2 * t * p3.y
  };
}

function cubicBezierTangent(t, p0, p1, p2, p3) {
  const mt = 1 - t;
  return {
    x: 3 * mt * mt * (p1.x - p0.x) + 6 * mt * t * (p2.x - p1.x) + 3 * t * t * (p3.x - p2.x),
    y: 3 * mt * mt * (p1.y - p0.y) + 6 * mt * t * (p2.y - p1.y) + 3 * t * t * (p3.y - p2.y)
  };
}

function approximateBezierLength(p0, p1, p2, p3, samples = 24) {
  let total = 0;
  let prev = p0;
  for (let i = 1; i <= samples; i++) {
    const t = i / samples;
    const current = cubicBezierPoint(t, p0, p1, p2, p3);
    total += Math.hypot(current.x - prev.x, current.y - prev.y);
    prev = current;
  }
  return total;
}

function easeInOutCubic(t) {
  // Stretch accel/decel phases (x1.5) by increasing curve exponent.
  const exponent = Math.max(1, ACCEL_DECEL_TIME_FACTOR * 3);
  return t < 0.5
    ? 0.5 * Math.pow(2 * t, exponent)
    : 1 - 0.5 * Math.pow(2 * (1 - t), exponent);
}

function animateProgress(durationMs, onFrame) {
  const clampedDuration = Math.max(1, durationMs);
  return new Promise(resolve => {
    const start = performance.now();

    const step = (now) => {
      if (!simulationState.running) {
        resolve(false);
        return;
      }

      const linearT = Math.min(1, (now - start) / clampedDuration);
      const t = easeInOutCubic(linearT);
      onFrame(t);

      if (linearT >= 1) {
        resolve(true);
      } else {
        requestAnimationFrame(step);
      }
    };

    requestAnimationFrame(step);
  });
}

function pauseSimulation(durationMs) {
  return animateProgress(durationMs, () => {});
}

function getSimulationTargetPamis() {
  if (visible_pamis.size === 0) return [];

  if (isViewAllMode) {
    return Array.from(visible_pamis)
      .filter(pamiNum => loaded_strategies[pamiNum] && Array.isArray(loaded_strategies[pamiNum].sequence) && loaded_strategies[pamiNum].sequence.length > 0);
  }

  const firstVisible = Array.from(visible_pamis)[0];
  if (!firstVisible || !loaded_strategies[firstVisible]) return [];
  if (!Array.isArray(loaded_strategies[firstVisible].sequence) || loaded_strategies[firstVisible].sequence.length === 0) return [];
  return [firstVisible];
}

function getActionElement(actionIndex, pamiNum) {
  return document.querySelector(`.action-item[data-action-index="${actionIndex}"][data-pami-number="${pamiNum}"]`);
}

function clearSimulationActionHighlight(pamiNum = null) {
  const clearOne = (targetPami) => {
    const timeoutId = simulationHighlightTimeoutByPami.get(targetPami);
    if (timeoutId) {
      clearTimeout(timeoutId);
      simulationHighlightTimeoutByPami.delete(targetPami);
    }

    const key = simulationHighlightKeyByPami.get(targetPami);
    if (!key) return;

    const [, actionIndex] = key.split(":").map(v => Number(v));
    const item = getActionElement(actionIndex, targetPami);
    if (item) {
      item.classList.remove("simulation-active");
      item.classList.remove("simulation-hit");
    }
    simulationHighlightKeyByPami.delete(targetPami);
  };

  if (pamiNum != null) {
    clearOne(pamiNum);
    return;
  }

  Array.from(simulationHighlightKeyByPami.keys()).forEach(clearOne);
}

function markSimulationActionReached(actionIndex, pamiNum) {
  const key = `${pamiNum}:${actionIndex}`;
  const previousKey = simulationHighlightKeyByPami.get(pamiNum);
  if (previousKey && previousKey !== key) {
    const [, prevIndex] = previousKey.split(":").map(v => Number(v));
    const prevItem = getActionElement(prevIndex, pamiNum);
    if (prevItem) {
      prevItem.classList.remove("simulation-active");
      prevItem.classList.remove("simulation-hit");
    }
  }

  simulationHighlightKeyByPami.set(pamiNum, key);
  const item = getActionElement(actionIndex, pamiNum);
  if (item) {
    item.classList.add("simulation-active");
    item.classList.remove("simulation-hit");
    void item.offsetWidth;
    item.classList.add("simulation-hit");
    item.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }

  hightlightAction(actionIndex, pamiNum, true);
  highlightMapPoints(actionIndex, pamiNum, true);

  const previousTimeout = simulationHighlightTimeoutByPami.get(pamiNum);
  if (previousTimeout) {
    clearTimeout(previousTimeout);
  }
  const timeoutId = window.setTimeout(() => {
    const current = getActionElement(actionIndex, pamiNum);
    if (current && simulationHighlightKeyByPami.get(pamiNum) === key) {
      current.classList.remove("simulation-hit");
    }
    simulationHighlightTimeoutByPami.delete(pamiNum);
  }, 650);
  simulationHighlightTimeoutByPami.set(pamiNum, timeoutId);
}

function isBackwardMotion(action, strategy) {
  if (!action || !strategy) return false;
  if (strategy.pami_number !== 7) return false;
  if (action[0] !== 1 && action[0] !== 4) return false;

  const direction = parseFloat(action[action.length - 1]);
  return Number.isFinite(direction) && direction < 0;
}

function getDesiredHeadingForAction(action, pose, strategy) {
  if (!action) return null;

  // orientate is absolute target heading
  if (action[0] === 2 && action.length >= 2) {
    const target = parseFloat(action[1]);
    return Number.isFinite(target) ? normalizeAngle(target) : null;
  }

  if (action[0] === 1 && action.length >= 3) {
    const tx = parseFloat(action[1]);
    const ty = parseFloat(action[2]);
    if (!Number.isFinite(tx) || !Number.isFinite(ty)) return null;

    const dx = tx - pose.x;
    const dy = ty - pose.y;
    if (Math.hypot(dx, dy) < 1e-3) return null;

    return normalizeAngle(rad_to_deg(Math.atan2(dy, dx)) + (isBackwardMotion(action, strategy) ? 180 : 0));
  }

  if (action[0] === 4 && action.length >= 3) {
    const x1 = parseFloat(action[1]);
    const y1 = parseFloat(action[2]);
    if (!Number.isFinite(x1) || !Number.isFinite(y1)) return null;

    const dx = x1 - pose.x;
    const dy = y1 - pose.y;
    if (Math.hypot(dx, dy) < 1e-3) return null;

    return normalizeAngle(rad_to_deg(Math.atan2(dy, dx)) + (isBackwardMotion(action, strategy) ? 180 : 0));
  }

  return null;
}

function drawAirBlowEffect(svg, x, y, angle, pamiNum) {
  const { cx, cy } = mapToScreen(x, y);
  const burst = document.createElementNS("http://www.w3.org/2000/svg", "g");
  burst.classList.add("air-blow-effect");
  burst.setAttribute("transform", `translate(${cx}, ${cy}) rotate(${90 - normalizeAngle(angle)})`);

  const streaks = [
    { x1: 14, y1: 16, x2: 36, y2: 16, opacity: 1.0 },
    { x1: 12, y1: 10, x2: 32, y2: 8, opacity: 0.85 },
    { x1: 12, y1: 22, x2: 32, y2: 24, opacity: 0.85 }
  ];

  streaks.forEach(data => {
    const line = document.createElementNS("http://www.w3.org/2000/svg", "line");
    line.classList.add("air-blow-streak");
    line.setAttribute("x1", data.x1);
    line.setAttribute("y1", data.y1);
    line.setAttribute("x2", data.x2);
    line.setAttribute("y2", data.y2);
    line.setAttribute("opacity", data.opacity);
    line.style.stroke = pami_colors[pamiNum] || "#c8f2ff";
    burst.appendChild(line);
  });

  svg.appendChild(burst);
  window.setTimeout(() => {
    if (burst.parentNode) burst.parentNode.removeChild(burst);
  }, 700);
}

function sanitizeSpeedMmPerSec(speedValue, fallback = 400) {
  const parsed = parseFloat(speedValue);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return parsed * SIM_SPEED_MULTIPLIER;
}

function getActionSpeedMmPerSec(action) {
  if (!Array.isArray(action)) return 400;

  // go_to(x, y, speed[, direction]) -> speed at index 3
  if (action[0] === 1) {
    return sanitizeSpeedMmPerSec(action[3]);
  }

  // bezier(x1, y1, x2, y2, x3, y3, speed[, direction]) -> speed at index 7
  if (action[0] === 4) {
    return sanitizeSpeedMmPerSec(action[7]);
  }

  // move_forward(distance, speed, direction) -> speed at index 2
  if (action[0] === 12) {
    return sanitizeSpeedMmPerSec(action[2]);
  }

  return 400;
}

async function animateLinearMotion(pose, targetX, targetY, backwards, pamiNum, speedMmPerSec) {
  const startX = pose.x;
  const startY = pose.y;
  const dx = targetX - startX;
  const dy = targetY - startY;
  const distance = Math.hypot(dx, dy);
  const speed = sanitizeSpeedMmPerSec(speedMmPerSec);
  const duration = Math.max(120, (distance / speed) * 1000);

  await animateProgress(duration, (t) => {
    pose.x = lerp(startX, targetX, t);
    pose.y = lerp(startY, targetY, t);

    if (distance > 1e-3) {
      pose.angle = normalizeAngle(rad_to_deg(Math.atan2(dy, dx)) + (backwards ? 180 : 0));
    }

    draw_robot_on_map(document.getElementById("map-overlay"), pose.x, pose.y, pose.angle, pamiNum);
  });

  pose.x = targetX;
  pose.y = targetY;
}

async function animateBezierMotion(pose, action, backwards, pamiNum, speedMmPerSec) {
  const p0 = { x: pose.x, y: pose.y };
  const p1 = { x: parseFloat(action[1]), y: parseFloat(action[2]) };
  const p2 = { x: parseFloat(action[3]), y: parseFloat(action[4]) };
  const p3 = { x: parseFloat(action[5]), y: parseFloat(action[6]) };

  const distance = approximateBezierLength(p0, p1, p2, p3);
  const speed = sanitizeSpeedMmPerSec(speedMmPerSec);
  const duration = Math.max(120, (distance / speed) * 1000);

  await animateProgress(duration, (t) => {
    const pt = cubicBezierPoint(t, p0, p1, p2, p3);
    const tangent = cubicBezierTangent(t, p0, p1, p2, p3);
    pose.x = pt.x;
    pose.y = pt.y;

    const tangentSize = Math.hypot(tangent.x, tangent.y);
    if (tangentSize > 1e-4) {
      pose.angle = normalizeAngle(rad_to_deg(Math.atan2(tangent.y, tangent.x)) + (backwards ? 180 : 0));
    }

    draw_robot_on_map(document.getElementById("map-overlay"), pose.x, pose.y, pose.angle, pamiNum);
  });

  pose.x = p3.x;
  pose.y = p3.y;
}

async function animateRotation(pose, targetAngle, pamiNum) {
  const startAngle = normalizeAngle(pose.angle);
  const destination = normalizeAngle(targetAngle);
  const delta = shortestAngleDelta(startAngle, destination);
  const duration = Math.max(320, Math.min(1800, Math.abs(delta) * 9));

  await animateProgress(duration, (t) => {
    pose.angle = normalizeAngle(startAngle + delta * t);
    draw_robot_on_map(document.getElementById("map-overlay"), pose.x, pose.y, pose.angle, pamiNum);
  });

  pose.angle = destination;
}

function stopSimulation(clearRobot = true) {
  simulationState.running = false;
  simulationState.targetPamis = [];

  const btn = document.getElementById("simulate-btn");
  if (btn) {
    btn.classList.remove("simulating");
    btn.textContent = "Simulate";
  }

  clearSimulationActionHighlight();
  unHightlightActions();
  unhighlightMapPoints();

  if (clearRobot) {
    clear_robot_off_map(document.getElementById("map-overlay"));
  }
}

async function simulateStrategy() {
  if (simulationState.running) {
    stopSimulation(true);
    return;
  }

  const pamiNums = getSimulationTargetPamis();
  if (pamiNums.length === 0) return;

  simulationState.running = true;
  simulationState.targetPamis = pamiNums;
  const btn = document.getElementById("simulate-btn");
  btn.classList.add("simulating");
  btn.textContent = pamiNums.length === 1
    ? `Stop PAMI ${pamiNums[0]}`
    : "Stop All";

  const svg = document.getElementById("map-overlay");
  const runPamiSimulation = async (pamiNum) => {
    const strategy = loaded_strategies[pamiNum];
    if (!strategy || !Array.isArray(strategy.sequence) || strategy.sequence.length === 0) return;

    const pose = { x: 0, y: 0, angle: 0 };
    draw_robot_on_map(svg, pose.x, pose.y, pose.angle, pamiNum);

    for (let i = 0; i < strategy.sequence.length; i++) {
      if (!simulationState.running) break;

      const action = strategy.sequence[i];
      if (!Array.isArray(action) || action.length === 0) continue;

      const desiredHeading = getDesiredHeadingForAction(action, pose, strategy);
      if (Number.isFinite(desiredHeading)) {
        const delta = Math.abs(shortestAngleDelta(pose.angle, desiredHeading));
        if (delta > 0.8) {
          await animateRotation(pose, desiredHeading, pamiNum);
          if (!simulationState.running) break;
        }
      }

      if (action[0] === 3 && action.length >= 4) {
        pose.x = parseFloat(action[1]);
        pose.y = parseFloat(action[2]);
        pose.angle = normalizeAngle(parseFloat(action[3]) || 0);
        draw_robot_on_map(svg, pose.x, pose.y, pose.angle, pamiNum);
        markSimulationActionReached(i, pamiNum);
        await pauseSimulation(180);
        continue;
      }

      if (action[0] === 1 && action.length >= 3) {
        const backwards = isBackwardMotion(action, strategy);
        const speedMmPerSec = getActionSpeedMmPerSec(action);
        await animateLinearMotion(pose, parseFloat(action[1]), parseFloat(action[2]), backwards, pamiNum, speedMmPerSec);
        markSimulationActionReached(i, pamiNum);
        continue;
      }

      if (action[0] === 4 && action.length >= 7) {
        const backwards = isBackwardMotion(action, strategy);
        const speedMmPerSec = getActionSpeedMmPerSec(action);
        await animateBezierMotion(pose, action, backwards, pamiNum, speedMmPerSec);
        markSimulationActionReached(i, pamiNum);
        continue;
      }

      if (action[0] === 2 && action.length >= 2) {
        await animateRotation(pose, parseFloat(action[1]) || 0, pamiNum);
        markSimulationActionReached(i, pamiNum);
        await pauseSimulation(120);
        continue;
      }

      if (action[0] === 13 && action.length >= 2) {
        const relativeDelta = parseFloat(action[1]) || 0;
        await animateRotation(pose, normalizeAngle(pose.angle + relativeDelta), pamiNum);
        markSimulationActionReached(i, pamiNum);
        await pauseSimulation(120);
        continue;
      }

      if (action[0] === 12 && action.length >= 2) {
        const distance = parseFloat(action[1]);
        const direction = parseFloat(action[3]);
        const sign = Number.isFinite(direction) && direction < 0 ? -1 : 1;
        const signedDistance = (Number.isFinite(distance) ? distance : 0) * sign;
        const rad = deg_to_rad(pose.angle);
        const targetX = pose.x + signedDistance * Math.cos(rad);
        const targetY = pose.y + signedDistance * Math.sin(rad);
        const speedMmPerSec = getActionSpeedMmPerSec(action);
        await animateLinearMotion(pose, targetX, targetY, sign < 0, pamiNum, speedMmPerSec);
        markSimulationActionReached(i, pamiNum);
        continue;
      }

      if (action[0] === 8) {
        drawAirBlowEffect(svg, pose.x, pose.y, pose.angle, pamiNum);
        await pauseSimulation(420);
        continue;
      }

      if (action[0] === 0 || action[0] === 5) {
        const durationMs = parseFloat(action[1]);
        const clamped = Number.isFinite(durationMs)
          ? Math.max(250, Math.min(3000, durationMs))
          : 500;
        await pauseSimulation(clamped);
        continue;
      }

      await pauseSimulation(180);
    }

    clearSimulationActionHighlight(pamiNum);
  };

  try {
    await Promise.all(pamiNums.map(runPamiSimulation));
  } finally {
    stopSimulation(false);
  }
}

function calculate_x_y_phi_after_action(point, actionIndex, pamiNum) {
    const svg = document.getElementById("map-overlay");
    const points = svg.querySelectorAll(".map-point");
    let x = point.getAttribute("cx");
    let y = point.getAttribute("cy");
    let phi = 0;
    let action = loaded_strategies[pamiNum].sequence[actionIndex];
    if (action[0] == 3) { 
        // set_position command - use the angle parameter
        phi = action[3];
    } else if (action[0] == 2) {
        // orientate command - use the angle parameter
        phi = action[1];
    } else{
        const prevPoint = points[Array.from(points).indexOf(point) - 1];
        const prevX = prevPoint ? parseFloat(prevPoint.getAttribute("cx")) : point.getAttribute("cx");
        const prevY = prevPoint ? parseFloat(prevPoint.getAttribute("cy")) : point.getAttribute("cy");

        phi = rad_to_deg(Math.atan2(y - prevY, x - prevX));
    }
    if (actionIndex < loaded_strategies[pamiNum].sequence.length - 1){
        const next = loaded_strategies[pamiNum].sequence[actionIndex + 1];

        if (next[0] == 2) {
            // Next action is orientate - use that angle
            phi = next[1];
        }
    }
    const xy = screenToMap(x, y);
    return [xy.x, xy.y, phi];
}
// Cache DOM elements and mousemove handler to prevent memory leaks
let cachedMapElement = null;
let cachedOverlayElement = null;
let cachedMapWrapperElement = null;
let activeDragHandler = null;
let activeMouseUpHandler = null;

function enableDrag(el, actionIndex, paramIndexX, paramIndexY, pamiNum) {
  let dragging = false;
  
  // Cache DOM elements
  if (!cachedMapElement) cachedMapElement = document.getElementById("map");
  if (!cachedOverlayElement) cachedOverlayElement = document.getElementById("map-overlay");
  if (!cachedMapWrapperElement) cachedMapWrapperElement = document.getElementById("map-wrapper");

  el.addEventListener("mouseover", e => {
    if (simulationState.running) return;
    hightlightAction(actionIndex, pamiNum);
    let [x, y, phi] = calculate_x_y_phi_after_action(el, actionIndex, pamiNum);
    draw_robot_on_map(cachedOverlayElement, x, y, phi, pamiNum);
  });
  
  el.addEventListener("mouseout", e => {
    if (simulationState.running) return;
    unHightlightActions();
    clear_robot_off_map(cachedOverlayElement);
  });

  el.addEventListener("mousedown", e => {
    if (simulationState.running) return;
    if (zoomMode) return;

    dragging = true;
    e.stopPropagation();
    let [x, y, phi] = calculate_x_y_phi_after_action(el, actionIndex, pamiNum);
    draw_robot_on_map(cachedOverlayElement, x, y, phi, pamiNum);
    
    // Remove previous handlers if they exist to prevent memory leaks
    if (activeDragHandler) window.removeEventListener("mousemove", activeDragHandler);
    if (activeMouseUpHandler) window.removeEventListener("mouseup", activeMouseUpHandler);
    
    // Create new handlers
    const rect = cachedMapWrapperElement.getBoundingClientRect();
    let lastUpdate = 0;
    const throttleMs = 16; // ~60fps
    
    activeDragHandler = (e) => {
      if (!dragging) return;
      
      // Throttle updates for performance
      const now = Date.now();
      if (now - lastUpdate < throttleMs) return;
      lastUpdate = now;

      const x = e.clientY - rect.top;
      const y = e.clientX - rect.left;

      const basePoint = toBaseCoordinates(y, x);

      el.setAttribute("cx", basePoint.x);
      el.setAttribute("cy", basePoint.y);

      updateActionParamsFromDrag(actionIndex, paramIndexX, paramIndexY, basePoint.x, basePoint.y, pamiNum);
      let [x1, y1, phi] = calculate_x_y_phi_after_action(el, actionIndex, pamiNum);
      draw_robot_on_map(cachedOverlayElement, x1, y1, phi, pamiNum);
    };
    
    activeMouseUpHandler = () => {
      if (!dragging) return;
      dragging = false;
      
      // Clean up handlers after drag ends
      window.removeEventListener("mousemove", activeDragHandler);
      window.removeEventListener("mouseup", activeMouseUpHandler);
      activeDragHandler = null;
      activeMouseUpHandler = null;
      
      saveToUndoStack();
      renderTasks(isViewAllMode);
      renderMap();
      savePamiStrategy(loaded_strategies[pamiNum]);
    };
    
    window.addEventListener("mousemove", activeDragHandler);
    window.addEventListener("mouseup", activeMouseUpHandler);
  });
}

///////////////////////////////////////////////////////////////////////////

document.getElementById("add-action-btn").addEventListener("click", () => {
  const index = actionSelect.value;
  if (index === "" || visible_pamis.size === 0) return;
  
  // Use the first visible PAMI to determine which commands to show
  const firstVisiblePami = Array.from(visible_pamis)[0];
  const targetStrategy = loaded_strategies[firstVisiblePami];
  contextPamiNumber = firstVisiblePami;
  
  // Show PAMI selector if in multi-PAMI mode
  const pamiSelectorModal = document.getElementById("pami-selector-modal");
  const pamiSelectDropdown = document.getElementById("pami-select-modal");
  
  if (isViewAllMode && visible_pamis.size > 1) {
    pamiSelectorModal.classList.remove("hidden");
    
    // Populate dropdown with only visible PAMIs
    pamiSelectDropdown.innerHTML = "";
    visible_pamis.forEach(pamiNum => {
      const option = document.createElement("option");
      option.value = pamiNum;
      option.textContent = `PAMI ${pamiNum}`;
      option.style.color = pami_colors[pamiNum];
      pamiSelectDropdown.appendChild(option);
    });
    
    // Set default to first visible PAMI
    pamiSelectDropdown.value = firstVisiblePami;
  } else {
    pamiSelectorModal.classList.add("hidden");
  }
  
  const commandConfig = getCommandConfig(targetStrategy, Number(index));
  if (!commandConfig) return;
  const command = commandConfig.label;
  let args_table = [];
  document.getElementById("command_label").textContent = "Command: "+command;
  // Decide which argument table to use
  args_table = commandConfig.args;
  const argsContainer = document.getElementById("args-container");
  argsContainer.innerHTML = "";

  // Create inputs dynamically
  args_table.forEach(arg => {
    const label = document.createElement("label");
    label.textContent = arg;

    const input = document.createElement("input");
    input.type = "decimal";
    input.dataset.argName = arg;
    if (arg === "speed") {
      input.value = "400"; // default speed
    }
    if (arg === "up_down") {
      input.placeholder = "1: up, 0: down";
    }
    if (arg === "direction") {
      input.value = "1";
      input.placeholder = "enter direction value";
    }
      if (arg === "in_nest" || arg === "bechwayya") {
        input.value = "0";
      }
    label.appendChild(input);
    argsContainer.appendChild(label);
  });
  let inputs = document.querySelectorAll("#args-container input");
  inputs.forEach(input => input.addEventListener("keydown",(e) => {
    if (e.key === "Enter") {
      const nextInput = input.parentElement.nextElementSibling;
      if (nextInput && nextInput.querySelector("input")) {
        nextInput.querySelector("input").focus();
      } else {
        document.getElementById("modal-confirm").click();
      }
    }
  }));
  modal.classList.remove("hidden");
  inputs[0].focus();
});

document.getElementById("back-btn").addEventListener("click", () => {
  sessionStorage.setItem("refreshOnce", "1");
  window.history.back();
});

document.getElementById("zoom-btn").addEventListener("click", () => {
  if (zoomApplied) return;
  setZoomMode(!zoomMode);
});

document.getElementById("simulate-btn").addEventListener("click", () => {
  if (simulationState.running) {
    stopSimulation(true);
    return;
  }
  simulateStrategy();
});

const mapWrapper = document.getElementById("map-wrapper");
mapWrapper.addEventListener("mousedown", startZoomSelection, true);
window.addEventListener("mousemove", updateZoomSelection, true);
window.addEventListener("mouseup", finishZoomSelection, true);
window.addEventListener("resize", () => {
  if (zoomApplied) {
    applyZoomTransform();
    renderMap();
  }
});

document.getElementById("modal-cancel").addEventListener("click", () => {
  modal.classList.add("hidden");
  contextActionIndex = null;
});

document.getElementById("modal-confirm").addEventListener("click", () => {
  let action = null;
  
  // If adding new action (not modifying), check PAMI selector
  let targetPami;
  if (contextActionIndex == null && isViewAllMode && visible_pamis.size > 1) {
    // Use selected PAMI from dropdown
    const pamiSelectDropdown = document.getElementById("pami-select-modal");
    targetPami = parseInt(pamiSelectDropdown.value);
  } else {
    // Use context PAMI (for modify) or first visible (for add in single mode)
    targetPami = contextPamiNumber || Array.from(visible_pamis)[0];
  }
  
  const targetStrategy = loaded_strategies[targetPami];
  
  if (contextActionIndex == null){
    const index = Number(actionSelect.value);

    action = [index];
    const inputs = document.querySelectorAll("#args-container input");
    if (index == 0){
      inputs.forEach(input => {
        const value = parseFloat(input.value) || 1000;
        action.push(value != 0 ? value : 1000);
      });
    } else{
      inputs.forEach(input => {
        const value = parseFloat(input.value) || 0;
        action.push(value != 0 ? value : 0);
      });
    }

    if (!action) return;

    targetStrategy.sequence.push(action);
  }else{
    const commandType = targetStrategy.sequence[contextActionIndex][0];
    action = [commandType];
    const inputs = document.querySelectorAll("#args-container input");
    
    if (commandType == 0){
      inputs.forEach((input) => {
        const value = parseFloat(input.value) || 1000;
        action.push(value != 0 ? value : 1200);
      });
    } else{
      inputs.forEach((input) => {
        const value = parseFloat(input.value) || 0;
        action.push(value != 0 ? value : 0);
      });
    }

    if (contextActionIndex != null) {
      // MODIFY
      targetStrategy.sequence[contextActionIndex] = action;
      contextActionIndex = null;
      contextPamiNumber = null;
    } else {
      // ADD
      targetStrategy.sequence.push(action);
    }
  }
  modal.classList.add("hidden");
  saveToUndoStack();
  renderTasks(isViewAllMode);
  renderMap();
  savePamiStrategy(targetStrategy);
});

document.addEventListener("keydown", (e) => {
  const isCtrl = e.ctrlKey || e.metaKey;

  if (e.key === "Escape" && simulationState.running) {
    e.preventDefault();
    stopSimulation(true);
    return;
  }

  if (isCtrl && e.key === "z") {
    e.preventDefault();
    undo();
  }

  if (isCtrl && e.key === "y") {
    e.preventDefault();
    redo();
  }
});

await get_selected_strategy();
populateAddList();
renderMap();