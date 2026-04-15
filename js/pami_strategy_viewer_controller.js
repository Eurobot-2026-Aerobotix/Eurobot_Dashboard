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
const set_position_args = ["x", "y", "angle"];
const bezier_args = ["x1", "y1", "x2", "y2", "x3", "y3", "speed", "direction"]
const pick_up_args = ["right", "left", "up_down"];
const put_down_args = ["in_nest", "bechwayya"];
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
  { label: "letgo", args: [] }
];
let contextActionIndex = null;
let contextPamiNumber = null;
let robot_on_map = null;
let undoStack = [];
let redoStack = [];

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
  const img = document.getElementById("map");
  const rect = img.getBoundingClientRect();

  return {
    cx: (y / 3000) * rect.width,   // y → right
    cy: (x / 2000) * rect.height   // x → down
  };
}
function screenToMap(cx, cy) {
  const img = document.getElementById("map");
  const rect = img.getBoundingClientRect();

  return {
    x: (cy / rect.height) * 2000, // down = +x
    y: (cx / rect.width) * 3000   // right = +y
  };
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
      strategy.sequence.forEach((action, actionIndex) => {

        if (action[0] == 3) {
          const [x, y] = [action[1], action[2]];
          currentPos = { x, y };
          drawPoint(svg, x, y, "robot", actionIndex, 1, 2, false, color, pamiNum);
        }

        else if (action[0] == 1) {
          const [x, y] = [action[1], action[2]];
          drawArrow(svg, currentPos, { x, y }, 0, color, pamiNum);
          drawPoint(svg, x, y,"", actionIndex, 1, 2, false, color, pamiNum);
          currentPos = { x, y };
        }

        else if (action[0] == 2) {
          drawRotateIcon(svg, currentPos, color);
        }
        else if (action[0] == 4){
          drawBezier(svg, currentPos, action.slice(1), 0, actionIndex, color, pamiNum);
          const [ , , , , x3, y3 ] = action.slice(1);
          currentPos = { x: x3, y: y3 };
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
function hightlightAction(actionIndex, pamiNum) {
  unHightlightActions();

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
function draw_robot_on_map(svg, x, y, angle, pamiNum) {
  clear_robot_off_map(svg);

  const { cx, cy } = mapToScreen(x, y);

  const color = pami_colors[pamiNum] || "rgba(243, 20, 255, 1)";

  const robot = document.createElementNS("http://www.w3.org/2000/svg", "g");
  robot.setAttribute(
    "transform",
    `translate(${cx}, ${cy}) rotate(${90 - angle})`
  );

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

  robot.appendChild(rect);
  robot.appendChild(arrow);
  svg.appendChild(robot);
  robot_on_map = robot;
}
function clear_robot_off_map(svg) {
  if (robot_on_map) {
    try {
      svg.removeChild(robot_on_map);
    } catch (e) {}
    robot_on_map = null;
  }
}
function rad_to_deg(rad) {
  return rad * (180 / Math.PI);
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

        phi = rad_to_deg(Math.atan2(x - prevX, y - prevY)) ;
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
let activeDragHandler = null;
let activeMouseUpHandler = null;

function enableDrag(el, actionIndex, paramIndexX, paramIndexY, pamiNum) {
  let dragging = false;
  
  // Cache DOM elements
  if (!cachedMapElement) cachedMapElement = document.getElementById("map");
  if (!cachedOverlayElement) cachedOverlayElement = document.getElementById("map-overlay");

  el.addEventListener("mouseover", e => {
    hightlightAction(actionIndex, pamiNum);
    let [x, y, phi] = calculate_x_y_phi_after_action(el, actionIndex, pamiNum);
    draw_robot_on_map(cachedOverlayElement, x, y, phi, pamiNum);
  });
  
  el.addEventListener("mouseout", e => {
    unHightlightActions();
    clear_robot_off_map(cachedOverlayElement);
  });

  el.addEventListener("mousedown", e => {
    dragging = true;
    e.stopPropagation();
    let [x, y, phi] = calculate_x_y_phi_after_action(el, actionIndex, pamiNum);
    draw_robot_on_map(cachedOverlayElement, x, y, phi, pamiNum);
    
    // Remove previous handlers if they exist to prevent memory leaks
    if (activeDragHandler) window.removeEventListener("mousemove", activeDragHandler);
    if (activeMouseUpHandler) window.removeEventListener("mouseup", activeMouseUpHandler);
    
    // Create new handlers
    const rect = cachedMapElement.getBoundingClientRect();
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

      el.setAttribute("cx", y);
      el.setAttribute("cy", x);

      updateActionParamsFromDrag(actionIndex, paramIndexX, paramIndexY, y, x, pamiNum);
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