import { loadAllStrategies, deleteStrategy, saveStrategy, updateStrategy } from "./file_handler.js"; // your API functions
import { Strategy } from "../classes/Strategy.js";
import { Task } from "../classes/Task.js";
import { Action } from "../classes/Action.js";


let strategies = [];
let selected_strategy = null;
let actionsContainer = document.getElementById("side-panel");
const actionSelect = document.getElementById("action-select");
const newTaskCheckBox = document.getElementById("task-checkbox");
const modal = document.getElementById("action-modal");
const go_to_args = ["x", "y", "speed"];
const orientate_args = ["angle"];
const bezier_args = ["x1", "y1", "x2", "y2", "x3", "y3", "backup x", "backup y", "speed"];
const set_position_args = ["x", "y", "angle"];
const prepare_for_start_args = ["x", "y", "theta"];
const wait_enf_game_args = ["duration"];
const steal_args = ["sx count","fx count"];

function getArgsTableForCommand(command) {
  if (command.includes("go_to")) return go_to_args;
  if (command.includes("bezier")) return bezier_args;
  if (command.includes("orientate")) return orientate_args;
  if (command.includes("set_position")) return set_position_args;
  if (command.includes("prepare_for_start")) return prepare_for_start_args;
  if (command.includes("wait_end_game")) return wait_enf_game_args;
  if (command.includes("steal")) return steal_args;
  return [];
}

function formatActionParams(params) {
  if (Array.isArray(params)) {
    return params.join(", ");
  }
  if (params && typeof params === "object") {
    return Object.entries(params)
      .map(([k, v]) => `${k}=${v}`)
      .join(", ");
  }
  return "";
}

function getOrderedActions(strategy) {
  if (!strategy || !Array.isArray(strategy.tasks)) return [];

  const ordered = [];
  strategy.tasks.forEach((task, taskIndex) => {
    if (!task || !Array.isArray(task.sequence)) return;
    task.sequence.forEach((action, actionIndex) => {
      ordered.push({ task, action, taskIndex, actionIndex });
    });
  });
  return ordered;
}

function getOrderedActionIndex(strategy, task, action) {
  const ordered = getOrderedActions(strategy);
  return ordered.findIndex(item => item.task === task && item.action === action);
}

function getPoseBeforeOrderedAction(strategy, orderedIndex) {
  const ordered = getOrderedActions(strategy);
  if (orderedIndex < 0 || orderedIndex > ordered.length) return null;

  let pose = null;
  for (let i = 0; i < orderedIndex; i++) {
    const step = ordered[i].action;
    if (!step || !step.command) continue;
    const params = Array.isArray(step.params) ? step.params : [];

    if (step.command.includes("set_position") && params.length >= 3) {
      pose = { x: parseFloat(params[0]), y: parseFloat(params[1]), theta: parseFloat(params[2]) };
    } else if (step.command.includes("go_to") && params.length >= 2) {
      pose = { x: parseFloat(params[0]), y: parseFloat(params[1]), theta: pose ? pose.theta : 0 };
    } else if (step.command.includes("bezier") && params.length >= 6) {
      pose = { x: parseFloat(params[4]), y: parseFloat(params[5]), theta: pose ? pose.theta : 0 };
    }
  }

  return pose;
}

function getNextGoToTargetAfterOrderedAction(strategy, orderedIndex) {
  const ordered = getOrderedActions(strategy);
  if (orderedIndex < 0 || orderedIndex >= ordered.length) return null;

  for (let i = orderedIndex + 1; i < ordered.length; i++) {
    const step = ordered[i].action;
    if (!step || !step.command) continue;
    if (step.command.includes("go_to") && Array.isArray(step.params) && step.params.length >= 2) {
      return { x: parseFloat(step.params[0]), y: parseFloat(step.params[1]) };
    }
  }

  return null;
}

function computePutDownInsertDistanceMm(strategy, task, action) {
  const actionIndex = getOrderedActionIndex(strategy, task, action);
  if (actionIndex < 0) return null;

  const pose = getPoseBeforeOrderedAction(strategy, actionIndex);
  const target = getNextGoToTargetAfterOrderedAction(strategy, actionIndex);
  if (!pose || !target) return null;

  const dx = target.x - pose.x;
  const dy = target.y - pose.y;
  const distance = Math.hypot(dx, dy);
  return Number.isFinite(distance) ? distance : null;
}

function recomputeAllPutDownInsertDistances(strategy) {
  if (!strategy || !Array.isArray(strategy.tasks)) return;

  strategy.tasks.forEach(task => {
    if (!task || !Array.isArray(task.sequence)) return;
    task.sequence.forEach(action => {
      if (!action || !action.command || !action.command.includes("put_down")) return;

      const existingParams = (action.params && typeof action.params === "object" && !Array.isArray(action.params))
        ? action.params
        : {};
      const hasLegacyDistance = Number.isFinite(parseFloat(existingParams.insert_distance_mm));
      const enabled = existingParams.use_computed_insert_distance === true || hasLegacyDistance;

      if (!enabled) {
        action.params = {};
        return;
      }

      const computed = computePutDownInsertDistanceMm(strategy, task, action);
      if (Number.isFinite(computed) && computed > 0.0) {
        const paramsObj = existingParams;
        paramsObj.use_computed_insert_distance = true;
        paramsObj.insert_distance_mm = parseFloat(computed.toFixed(1));
        action.params = paramsObj;
      } else {
        action.params = { use_computed_insert_distance: true };
      }
    });
  });
}

function refreshPutDownInsertDistanceDisplay() {
  if (modal.classList.contains("hidden")) return;
  if (!contextAction || !contextAction.command || !contextAction.command.includes("put_down")) return;

  const distanceValue = document.getElementById("modal-putdown-insert-distance");
  const retreatCheck = document.getElementById("modal-putdown-insert-enabled");
  if (!distanceValue || !retreatCheck) return;

  const paramsObj = (contextAction.params && typeof contextAction.params === "object" && !Array.isArray(contextAction.params))
    ? contextAction.params
    : {};
  const enabled = paramsObj.use_computed_insert_distance === true || Number.isFinite(parseFloat(paramsObj.insert_distance_mm));

  const computedDistance = computePutDownInsertDistanceMm(selected_strategy, contextTask, contextAction);
  const distance = (enabled && Number.isFinite(computedDistance) && computedDistance > 0.0) ? computedDistance : 0.0;

  retreatCheck.checked = enabled;
  distanceValue.textContent = distance.toFixed(1);
}

function renderPutDownRetreatControls(existingParams = null) {
  const argsContainer = document.getElementById("args-container");
  argsContainer.innerHTML = "";

  const computedDistance = computePutDownInsertDistanceMm(selected_strategy, contextTask, contextAction);

  const checkLabel = document.createElement("label");
  checkLabel.classList.add("checkbox");
  const retreatCheck = document.createElement("input");
  retreatCheck.type = "checkbox";
  retreatCheck.id = "modal-putdown-insert-enabled";
  checkLabel.appendChild(retreatCheck);
  checkLabel.appendChild(document.createTextNode(" Use computed insert distance from next go_to target"));
  argsContainer.appendChild(checkLabel);

  const distanceLabel = document.createElement("label");
  distanceLabel.textContent = "insert distance (mm): ";
  const distanceValue = document.createElement("span");
  distanceValue.id = "modal-putdown-insert-distance";
  distanceValue.classList.add("modal-putdown-distance-value");
  distanceLabel.appendChild(distanceValue);
  argsContainer.appendChild(distanceLabel);

  const paramsObj = (existingParams && typeof existingParams === "object" && !Array.isArray(existingParams))
    ? existingParams
    : {};
  const enabled = paramsObj.use_computed_insert_distance === true || Number.isFinite(parseFloat(paramsObj.insert_distance_mm));
  const distance = (enabled && Number.isFinite(computedDistance) && computedDistance > 0.0) ? computedDistance : 0.0;

  retreatCheck.checked = enabled;
  distanceValue.textContent = distance.toFixed(1);

  retreatCheck.addEventListener("change", () => {
    if (!retreatCheck.checked) {
      distanceValue.textContent = "0.0";
      return;
    }
    const updatedDistance = computePutDownInsertDistanceMm(selected_strategy, contextTask, contextAction);
    distanceValue.textContent = (Number.isFinite(updatedDistance) && updatedDistance > 0.0)
      ? updatedDistance.toFixed(1)
      : "0.0";
  });
}

function buildArgsUI(command, existingParams = null) {
  if (command.includes("put_down")) {
    renderPutDownRetreatControls(existingParams);
    return;
  }

  const args_table = getArgsTableForCommand(command);
  const argsContainer = document.getElementById("args-container");
  argsContainer.innerHTML = "";

  args_table.forEach(arg => {
    const label = document.createElement("label");
    label.textContent = arg;

    const input = document.createElement("input");
    input.type = "decimal";
    input.dataset.argName = arg;
    if (!existingParams && arg === "speed") {
      input.value = "1100";
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

  if (Array.isArray(existingParams)) {
    inputs.forEach((input, i) => {
      input.value = existingParams[i] ?? "";
    });
  }
}

function getModalParamsForCommand(command) {
  if (command.includes("put_down")) {
    const enabled = !!document.getElementById("modal-putdown-insert-enabled")?.checked;
    if (!enabled) return {};
    const parsed = parseFloat(document.getElementById("modal-putdown-insert-distance")?.textContent ?? "0");
    return {
      use_computed_insert_distance: true,
      insert_distance_mm: Number.isNaN(parsed) ? 250.0 : parsed,
    };
  }

  const params = [];
  if (command.includes("go_to") || command.includes("bezier")){
    document.querySelectorAll("#args-container input").forEach(input => {
      const value = parseFloat(input.value) || 1000;
      params.push(value != 0 ? value : 1200);
    });
  } else{
    document.querySelectorAll("#args-container input").forEach(input => {
      const value = parseFloat(input.value) || 0;
      params.push(value != 0 ? value : 0);
    });
  }
  return params;
}

const options = [
    new Action("STM", "set_position"),
  new Action("RASP_PI", "prepare_for_start"),
    new Action("STM", "go_to"),
    new Action("STM", "go_to_backwards"),
    new Action("STM", "bezier"),
    new Action("STM", "bezier_backwards"),
    new Action("STM", "orientate"),
    new Action("ESP_front", "pick_up"),
    new Action("ESP_front", "put_down"),
    new Action("ESP_back", "pick_up"),
    new Action("ESP_back", "put_down"),
    new Action("RASP_PI", "Wait for manual start"),
    new Action("RASP_PI", "Start pamiyeet"),
    new Action("RASP_PI","wait_end_game"),
    new Action("RASP_PI","steal")
  ];
let contextAction = null;
let contextTask = null;
let hovered_point_index = null;
let robot_on_map = null;
let hoveredAction = null;
const actionPointMap = new WeakMap();
const actionItemMap = new WeakMap();
let simulationHighlightedAction = null;
let simulationHighlightTimeoutId = null;

let undoStack = [];
let redoStack = [];
let zoomMode = false;
let zoomApplied = false;
let zoomRegion = null;
let isSelectingZoomRect = false;
let zoomStartPoint = null;
const simulationState = {
  running: false
};


// ------------------------------
// Load selected strategy
// ------------------------------
async function get_selected_strategy() {
  strategies = await loadAllStrategies();
  const params = new URLSearchParams(window.location.search);
  const name = params.get("name");
  for (let strategy of strategies) {
    if (strategy.name === name) selected_strategy = strategy;
  }
  document.querySelector("title").textContent = selected_strategy.name;
  undoStack.length = 0;
  undoStack.push(JSON.stringify(selected_strategy));
  renderTasks();
}

function update(){
  recomputeAllPutDownInsertDistances(selected_strategy);
  update_smooth_or_not(selected_strategy).then(() => {
    renderTasks();
    renderMap();
    refreshPutDownInsertDistanceDisplay();
    updateStrategy(selected_strategy);
  });
  if (undoStack.length > 100) undoStack.shift();
  undoStack.push(JSON.stringify(selected_strategy));
  redoStack.length = 0;
}

function undo() {
  if (undoStack.length < 2) return;

  redoStack.push(undoStack.pop());

  selected_strategy = JSON.parse(
    undoStack[undoStack.length - 1]
  );

  recomputeAllPutDownInsertDistances(selected_strategy);
  renderTasks();
  renderMap();
  refreshPutDownInsertDistanceDisplay();
  updateStrategy(selected_strategy);
}

function redo() {
  if (redoStack.length === 0) return;

  const state = redoStack.pop();
  undoStack.push(state);

  selected_strategy = JSON.parse(state);

  recomputeAllPutDownInsertDistances(selected_strategy);
  renderTasks();
  renderMap();
  refreshPutDownInsertDistanceDisplay();
  updateStrategy(selected_strategy);
}

async function update_smooth_or_not(strategy) {
  strategy.tasks.forEach(task => {
    for (let i = 0; i < task.sequence.length; i++) {
      if (task.sequence[i].command.includes("go_to")) {
        let next = null;
        if (i + 1 < task.sequence.length){
          next = task.sequence[i + 1];
        }

        if (next && next.command.includes("pick")) {
          if (task.sequence[i].params.length == 3) {
            task.sequence[i].params.push(1);
          }else{
            task.sequence[i].params[3] = 1;
          }
        }else{
          if (task.sequence[i].params.length > 3) {
            task.sequence[i].params[3] = 0;
          }
        }
      }else if (task.sequence[i].command.includes("bezier")) {
        let next = null;
        if (i + 1 < task.sequence.length){
          next = task.sequence[i + 1];
        }

        if (next && next.command.includes("pick")) {
          if (task.sequence[i].params.length == 9) {
            task.sequence[i].params.push(1);
          }else{
            task.sequence[i].params[9] = 1;
          }
        }else{
          if (task.sequence[i].params.length > 9) {
            task.sequence[i].params[9] = 0;
          }
        }
      }
    }
  });
  await update_waiting_or_not(strategy);
}

async function update_waiting_or_not(strategy){
  let espSeen = false;
  strategy.tasks.forEach(task => {

    task.sequence.forEach(action => {
      if (action.device.includes("ESP")) {
        action.wait = true;
        espSeen = true;
      } 
      else if (action.device.includes("STM") && espSeen) {
        action.wait = true;
        espSeen = false;
      } 
      else {
        action.wait = false;
      }
    });
  });
}

async function apply_tasks_logic(strategy) {
  const isESP = a => a.device.startsWith("ESP");
  const isSTM = a => a.device.includes("STM");
  const isWaitManual = a =>
    a.device.includes("RASP") && a.command.includes("manual");
  const isSetPosition = a =>
    a.device.includes("STM") && a.command.includes("position");
  // 1. save task names
  const savedNames = strategy.tasks.map(t => t.description);
  let nameIndex = 0;
  let autoIndex = 1;

  // 2. flatten actions
  const flatActions = strategy.tasks.flatMap(t => t.sequence);

  const newTasks = [];
  let currentTask = null;

  const startTask = () => {
    const name =
      savedNames[nameIndex] ??
      `Task ${++autoIndex}`;

    if (nameIndex < savedNames.length) nameIndex++;

    currentTask = {
      description: name,
      sequence: []
    };
  };

  for (let i = 0; i < flatActions.length; i++) {
    const action = flatActions[i];
    const next = flatActions[i + 1];

    if (!currentTask) startTask();

    // special case: Wait for manual start + set_position
    if (action && isWaitManual(action)) {
      currentTask.sequence.push(action);
      if (next && isSetPosition(next)) {
        currentTask.sequence.push(next);
        i++; // consume next
      }
      newTasks.push(currentTask);
      currentTask = null;
      continue;
    }
    else if (action && isSetPosition(action)) {
      currentTask.sequence.push(action);
      if (next && isWaitManual(next)) {
        currentTask.sequence.push(next);
        i++; // consume next
      }
      newTasks.push(currentTask);
      currentTask = null;
      continue;
    }

    currentTask.sequence.push(action);

    // ESP logic: close task after ESP
    if (isESP(action)) {
      newTasks.push(currentTask);
      currentTask = null;
    } 
    console.log(currentTask);
  }

  // push remaining task if not empty
  if (currentTask && currentTask.sequence.length) {
    newTasks.push(currentTask);
  }

  // 3. replace tasks
  strategy.tasks = newTasks;
}

// ------------------------------
// Render tasks and actions
// ------------------------------
function renderTasks() {
  actionsContainer.innerHTML = "";
  if (!selected_strategy) return;
  selected_strategy.tasks = selected_strategy.tasks.filter(task => task.sequence.length > 0);
  
  selected_strategy.tasks.forEach((task, taskIndex) => {
    const taskBox = document.createElement("div");
    taskBox.classList.add("task-box");

    const legend = document.createElement("input");
    legend.type = "text";
    legend.value = task.description || `Task ${taskIndex + 1}`;
    legend.classList.add("task-legend");

    legend.addEventListener("change", (e) => {
      // put your logic here
      if (e.target.value.trim() != "") {
        selected_strategy.tasks[taskIndex].description = e.target.value;
        update();
      }
    });
    legend.addEventListener("keydown",(e) => {
      if (e.key === "Enter") {
        legend.blur();
      }
    });

    taskBox.appendChild(legend);

    const actionList = document.createElement("div");
    actionList.classList.add("action-list");

    task.sequence.forEach((action, actionIndex) => {
      const actionDiv = document.createElement("div");
      actionDiv.classList.add("action-item");
      if (hoveredAction === action) {
        actionDiv.classList.add("highlighted");
      }
      registerActionItem(action, actionDiv);
      const renderedParams = formatActionParams(action.params);
      actionDiv.textContent =
        `${action.device} - ${action.command}(${renderedParams}) ` +
        `with${action.wait ? "" : "out"} waiting`;

      actionDiv.draggable = true;
      actionDiv.dataset.taskIndex = taskIndex;
      actionDiv.dataset.actionIndex = actionIndex;

      /* ---------- DRAG START / END ---------- */
      actionDiv.addEventListener("dragstart", e => {
        actionDiv.classList.add("dragging");
        e.dataTransfer.effectAllowed = "move";
        e.dataTransfer.setData(
          "text/plain",
          JSON.stringify({
            fromTask: taskIndex,
            fromAction: actionIndex
          })
        );
      });

      actionDiv.addEventListener("dragend", () => {
        actionDiv.classList.remove("dragging");
      });

      actionDiv.addEventListener("mouseenter", () => {
        actionDiv.classList.add("highlighted");
        setHoveredAction(action);
      });

      actionDiv.addEventListener("mouseleave", () => {
        actionDiv.classList.remove("highlighted");
        clearHoveredAction(action);
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
        const { fromTask, fromAction } = data;
        const toTask = taskIndex;
        const toAction = actionIndex;

        if (fromTask == null || fromAction == null) return;

        const movedAction =
          selected_strategy.tasks[fromTask].sequence.splice(fromAction, 1)[0];

        const insertIndex =
          fromTask === toTask && fromAction < toAction
            ? toAction - 1
            : toAction;

        selected_strategy.tasks[toTask].sequence.splice(
          insertIndex,
          0,
          movedAction
        );

        update();
      });

      /* ---------- CONTEXT MENU ---------- */
      actionDiv.addEventListener("contextmenu", e => {
        e.preventDefault();

        contextAction = action;
        contextTask = task;

        const menu = document.getElementById("action-context-menu");
        menu.style.left = `${e.clientX}px`;
        menu.style.top = `${e.clientY}px`;
        menu.classList.remove("hidden");
      });

      actionList.appendChild(actionDiv);
    });

    /* ---------- DROP AT END OF TASK ---------- */
    actionList.addEventListener("dragover", e => e.preventDefault());

    actionList.addEventListener("drop", e => {
      if (e.target !== actionList) return;

      const data = JSON.parse(e.dataTransfer.getData("text/plain"));
      const { fromTask, fromAction } = data;

      if (fromTask == null || fromAction == null) return;

      const movedAction =
        selected_strategy.tasks[fromTask].sequence.splice(fromAction, 1)[0];

      selected_strategy.tasks[taskIndex].sequence.push(movedAction);

      update();
    });

    taskBox.appendChild(actionList);
    actionsContainer.appendChild(taskBox);
  });

  /* ---------- GLOBAL CONTEXT MENU HANDLERS ---------- */

  document.addEventListener("click", () => {
    document.getElementById("action-context-menu").classList.add("hidden");
  });

  document.getElementById("ctx-delete").onclick = () => {
    if (!contextAction || !contextTask) return;

    const idx = contextTask.sequence.indexOf(contextAction);
    if (idx !== -1) {
      contextTask.sequence.splice(idx, 1);
    }

    if (contextTask.sequence.length === 0) {
      const taskIndex = selected_strategy.tasks.indexOf(contextTask);
      if (taskIndex !== -1) {
        selected_strategy.tasks.splice(taskIndex, 1);
      }
      
    }

    contextAction = null;
    contextTask = null;

    document.getElementById("action-context-menu").classList.add("hidden");

    update();
  };

  document.getElementById("ctx-modify").onclick = () => {
    if (!contextAction) return;

    const command = contextAction.command;
    document.getElementById("modal-wait").checked = contextAction.wait;

    document.getElementById("command_label").textContent =
      "Command: " + command;
    buildArgsUI(command, contextAction.params);

    modal.classList.remove("hidden");
    document.getElementById("action-context-menu").classList.add("hidden");
    const inputs = document.querySelectorAll("#args-container input:not([type='checkbox'])");
    if (inputs.length > 0){
      inputs[0].focus();
    }
  };

  document.getElementById("ctx-add-after").onclick = () => {

    let taskIndex = selected_strategy.tasks.indexOf(contextTask);
    let actionIndex = contextTask.sequence.indexOf(contextAction);
    const isLastAction = actionIndex === contextTask.sequence.length - 1;
    if (isLastAction){
      selected_strategy.tasks.splice(
        taskIndex+1, 
        0, 
        new Task(`Task ${selected_strategy.tasks.length + 1}`, [])
      );
      actionIndex = 0;
      taskIndex++;
    }else{
      actionIndex++;
    }
    contextTask = selected_strategy.tasks[taskIndex];
    const modalContent = document.createElement("div");
    modalContent.classList.add("modal-content");

    const backdrop = document.createElement("div");
    backdrop.classList.add("backdrop");

    const title = document.createElement("h3");
    title.textContent = "wach tebbi tzid";
    modalContent.appendChild(title);

    const buttonsContainer = document.createElement("div");
    buttonsContainer.style.display = "flex";
    buttonsContainer.style.flexDirection = "column";
    buttonsContainer.style.gap = "10px";

    options.forEach((option, idx) => {
      const btn = document.createElement("button");
      btn.textContent = `${option.device} - ${option.command}`;
      btn.style.padding = "10px";
      btn.style.cursor = "pointer";
      
      btn.addEventListener("click", () => {
        const newAction = new Action(option.device, option.command, [], false);
        selected_strategy.tasks[taskIndex].sequence.splice(actionIndex, 0, newAction);
        
        document.body.removeChild(backdrop);
        document.body.removeChild(modalContent);
        
        contextAction = selected_strategy.tasks[taskIndex].sequence[actionIndex];
        document.getElementById("ctx-modify").click();
      });
      
      buttonsContainer.appendChild(btn);
    });

    modalContent.appendChild(buttonsContainer);
    document.body.appendChild(backdrop);
    document.body.appendChild(modalContent);

    backdrop.addEventListener("click", () => {
      document.body.removeChild(backdrop);
      document.body.removeChild(modalContent);
    });
  };
}

// ------------------------------
// Populate Add Action dropdown
// ------------------------------
function populateAddList() {
  actionSelect.innerHTML = '<option value="">select action</option>';
  options.forEach((a, i) => {
    const opt = document.createElement("option");
    opt.value = i+1;
    opt.textContent = `${a.device} - ${a.command}`;
    actionSelect.appendChild(opt);
  });
}

function addDefs(svg) {
  svg.innerHTML = `
    <defs>
      <marker id="arrowhead-red" markerWidth="10" markerHeight="7"
        refX="10" refY="3.5" orient="auto">
        <polygon points="0 0, 10 3.5, 0 7" fill="red"/>
      </marker>
      <marker id="arrowhead-blue" markerWidth="10" markerHeight="7"
        refX="10" refY="3.5" orient="auto">
        <polygon points="0 0, 10 3.5, 0 7" fill="blue"/>
      </marker>
    </defs>
  `;
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

function renderMap() {
  const svg = document.getElementById("map-overlay");
  svg.innerHTML = "";
  addDefs(svg);

  if (!selected_strategy) return;

  let currentPos = { x: 0, y: 0 };
  selected_strategy.tasks.forEach(task => {
    task.sequence.forEach(action => {

      const backwards = action.command.includes("_backwards");

      if (action.command.includes("set_position") || action.command.includes("prepare_for_start")) {
        const [x, y] = action.params;
        currentPos = { x, y };
        drawPoint(svg, x, y, "robot", action, 0, 1);
      }

      else if (action.command.includes("go_to")) {
        const [x, y] = action.params;
        drawArrow(svg, currentPos, { x, y }, backwards);
        drawPoint(svg, x, y,"", action, 0, 1);
        currentPos = { x, y };
      }

      else if (action.command.includes("bezier")) {
        drawBezier(svg, currentPos, action.params, backwards, action);
        const [ , , , , x3, y3 ] = action.params;
        currentPos = { x: x3, y: y3 };
      }

      else if (action.command.includes("orientate")) {
        drawRotateIcon(svg, currentPos);
      }

      else if (action.command.includes("pick_up")) {
        drawIcon(svg, currentPos, "⬆️");
      }

      else if (action.command.includes("down")) {
        drawIcon(svg, currentPos, "⬇️");
      }
    });
  });
}

function drawPoint(svg, x, y, cls = "", action, paramIndexX, paramIndexY, secondary=false) {
  const { cx, cy } = mapToScreen(x, y);

  const c = document.createElementNS("http://www.w3.org/2000/svg", "circle");
  c.setAttribute("cx", cx);
  c.setAttribute("cy", cy);
  c.setAttribute("r", 6);
  c.classList.add("map-point");
  if (secondary){
    c.classList.add("secondary");
  }
  if (cls) c.classList.add(cls);

  enableDrag(c, action , paramIndexX, paramIndexY);
  registerActionPoint(action, c);
  svg.appendChild(c);
}

function registerActionPoint(action, pointElement) {
  if (!action) return;

  let points = actionPointMap.get(action);
  if (!points) {
    points = new Set();
    actionPointMap.set(action, points);
  }

  points.add(pointElement);

  if (hoveredAction === action) {
    pointElement.classList.add("map-point-hovered");
  }
}

function registerActionItem(action, itemElement) {
  if (!action || !itemElement) return;
  actionItemMap.set(action, itemElement);
}

function clearSimulationActionHighlight() {
  if (simulationHighlightTimeoutId) {
    clearTimeout(simulationHighlightTimeoutId);
    simulationHighlightTimeoutId = null;
  }

  if (!simulationHighlightedAction) return;

  const previousItem = actionItemMap.get(simulationHighlightedAction);
  if (previousItem) {
    previousItem.classList.remove("simulation-active");
    previousItem.classList.remove("simulation-hit");
  }
  simulationHighlightedAction = null;
}

function markSimulationActionReached(action) {
  if (!action) return;

  if (simulationHighlightedAction && simulationHighlightedAction !== action) {
    const previousItem = actionItemMap.get(simulationHighlightedAction);
    if (previousItem) {
      previousItem.classList.remove("simulation-active");
      previousItem.classList.remove("simulation-hit");
    }
  }

  simulationHighlightedAction = action;
  const item = actionItemMap.get(action);
  if (item) {
    item.classList.add("simulation-active");
    item.classList.remove("simulation-hit");
    void item.offsetWidth;
    item.classList.add("simulation-hit");
    item.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }

  setHoveredAction(action);

  if (simulationHighlightTimeoutId) {
    clearTimeout(simulationHighlightTimeoutId);
  }
  simulationHighlightTimeoutId = window.setTimeout(() => {
    const currentItem = actionItemMap.get(action);
    if (currentItem && simulationHighlightedAction === action) {
      currentItem.classList.remove("simulation-hit");
    }
    simulationHighlightTimeoutId = null;
  }, 650);
}

function setActionPointHover(action, isHovered) {
  const points = actionPointMap.get(action);
  if (!points) return;

  points.forEach(point => {
    point.classList.toggle("map-point-hovered", isHovered);
  });
}

function setHoveredAction(action) {
  if (hoveredAction === action) return;

  clearHoveredAction();
  hoveredAction = action;
  setActionPointHover(action, true);
}

function clearHoveredAction(action = hoveredAction) {
  if (!action) return;

  setActionPointHover(action, false);

  if (hoveredAction === action) {
    hoveredAction = null;
  }
}

function drawArrow(svg, from, to, backwards) {
  const p1 = mapToScreen(from.x, from.y);
  const p2 = mapToScreen(to.x, to.y);

  const l = document.createElementNS("http://www.w3.org/2000/svg", "line");
  l.setAttribute("x1", p1.cx);
  l.setAttribute("y1", p1.cy);
  l.setAttribute("x2", p2.cx);
  l.setAttribute("y2", p2.cy);
  l.classList.add("arrow", backwards ? "backward" : "forward");
  l.setAttribute("marker-end", backwards ? "url(#arrowhead-blue)" : "url(#arrowhead-red)");

  svg.appendChild(l);
}
function drawDiscountinousLine(svg, from, to) {
  const p1 = mapToScreen(from.x, from.y);
  const p2 = mapToScreen(to.x, to.y);

  const l = document.createElementNS("http://www.w3.org/2000/svg", "line");
  l.setAttribute("x1", p1.cx);
  l.setAttribute("y1", p1.cy);
  l.setAttribute("x2", p2.cx);
  l.setAttribute("y2", p2.cy);

  l.setAttribute("stroke", "white");
  l.setAttribute("marker-end", "none");
  l.setAttribute("stroke-width", "2"); // Increase the stroke width to make the line thicker
  l.setAttribute("stroke-dasharray", "10,10"); // Set dash pattern: 10px dash, 10px gap
  l.setAttribute("opacity", "0.5"); // Optional: make the line semi-transparent

  svg.appendChild(l);
}

function drawBezier(svg, start, params, backwards, action) {
  const [x1,y1,x2,y2,x3,y3] = params;

  const p0 = mapToScreen(start.x, start.y);
  const p1 = mapToScreen(x1, y1);
  const p2 = mapToScreen(x2, y2);
  const p3 = mapToScreen(x3, y3);

  drawDiscountinousLine(svg, start, { x: x1, y: y1 }); // Draw discontinuous line to first point
  drawDiscountinousLine(svg, { x: x2, y: y2 }, { x: x3, y: y3 }); // Draw discontinuous line to last point

  const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
  path.setAttribute(
    "d",
    `M ${p0.cx} ${p0.cy} C ${p1.cx} ${p1.cy}, ${p2.cx} ${p2.cy}, ${p3.cx} ${p3.cy}`
  );
  path.classList.add(backwards ? "backward" : "forward");
  path.setAttribute("fill", "none");
  path.setAttribute("stroke-width", "2");

  svg.appendChild(path);

  drawPoint(svg, params[0], params[1], "", action, 0, 1, true);
  drawPoint(svg, params[2], params[3], "", action, 2, 3, true);
  drawPoint(svg, params[4], params[5], "", action, 4, 5);
  // add arrowhead at end of bezier like drawArrow
  path.setAttribute("marker-end", backwards ? "url(#arrowhead-blue)" : "url(#arrowhead-red)");
  path.setAttribute("stroke", backwards ? "blue" : "red");
}
function drawIcon(svg, pos, symbol) {
  const { cx, cy } = mapToScreen(pos.x, pos.y);

  const t = document.createElementNS("http://www.w3.org/2000/svg", "text");
  t.setAttribute("x", cx + 5);
  t.setAttribute("y", cy - 5);
  t.textContent = symbol;
  t.classList.add("icon");

  svg.appendChild(t);
}

function drawRotateIcon(svg, pos) {
  drawIcon(svg, pos, "🔄");
}
function updateActionParamsFromDrag(action, paramIndexX, paramIndexY, cx, cy) {
  const { x, y } = screenToMap(cx, cy);

  action.params[paramIndexX] = x.toFixed(2);
  action.params[paramIndexY] = y.toFixed(2);

  recomputeAllPutDownInsertDistances(selected_strategy);
  refreshPutDownInsertDistanceDisplay();

  renderMap();
}
function hightlightAction(action) {
  let index = 0;
  selected_strategy.tasks.forEach(task => {
    task.sequence.forEach(a => {
      if (a === action) {
        const actionItems = document.querySelectorAll(".action-item");
        actionItems[index].classList.add("highlighted");
      }
      index++;
    });
  });
}
function unHightlightActions() {
  const actionItems = document.querySelectorAll(".action-item");
  actionItems.forEach(item => {
    item.classList.remove("highlighted");
  });
}
function draw_robot_on_map(svg, x, y, angle) {
  clear_robot_off_map(svg);

  const { cx, cy } = mapToScreen(x, y);

  const color =
    selected_strategy.color === "yellow"
      ? "rgb(255, 255, 0)"
      : "rgb(50, 162, 199)";

  const robot = document.createElementNS("http://www.w3.org/2000/svg", "g");
  robot.setAttribute(
    "transform",
    `translate(${cx}, ${cy}) rotate(${90 - angle})`
  );

  /* Robot body */
  const rect = document.createElementNS("http://www.w3.org/2000/svg", "rect");
  rect.setAttribute("width", svg.clientWidth * 0.1);
  rect.setAttribute("height", svg.clientWidth * 0.096);
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
    "18,0 -12,-12 -12,12"   // centered arrow, pointing +X, 3 times bigger
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
  return t < 0.5
    ? 4 * t * t * t
    : 1 - Math.pow(-2 * t + 2, 3) / 2;
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

function getPutDownAirAngle(action, robotAngle) {
  if (!action || !action.device) return normalizeAngle(robotAngle);

  const deviceName = action.device.toLowerCase();
  if (deviceName.includes("back")) return normalizeAngle(robotAngle + 180);
  if (deviceName.includes("front")) return normalizeAngle(robotAngle);

  return normalizeAngle(robotAngle);
}

function drawAirBlowEffect(svg, x, y, angle, action) {
  const { cx, cy } = mapToScreen(x, y);
  const blowAngle = getPutDownAirAngle(action, angle);

  const burst = document.createElementNS("http://www.w3.org/2000/svg", "g");
  burst.classList.add("air-blow-effect");
  burst.setAttribute("transform", `translate(${cx}, ${cy}) rotate(${90 - blowAngle})`);

  const streaks = [
    { x1: 18, y1: 20, x2: 44, y2: 20, opacity: 1.0 },
    { x1: 16, y1: 12, x2: 38, y2: 9, opacity: 0.85 },
    { x1: 16, y1: 28, x2: 38, y2: 31, opacity: 0.85 },
    { x1: 22, y1: 5, x2: 33, y2: 2, opacity: 0.65 },
    { x1: 22, y1: 35, x2: 33, y2: 38, opacity: 0.65 }
  ];

  streaks.forEach(data => {
    const line = document.createElementNS("http://www.w3.org/2000/svg", "line");
    line.classList.add("air-blow-streak");
    line.setAttribute("x1", data.x1);
    line.setAttribute("y1", data.y1);
    line.setAttribute("x2", data.x2);
    line.setAttribute("y2", data.y2);
    line.setAttribute("opacity", data.opacity);
    burst.appendChild(line);
  });

  svg.appendChild(burst);
  window.setTimeout(() => {
    if (burst.parentNode) {
      burst.parentNode.removeChild(burst);
    }
  }, 700);
}

async function animateLinearMotion(pose, targetX, targetY, backwards) {
  const startX = pose.x;
  const startY = pose.y;
  const dx = targetX - startX;
  const dy = targetY - startY;
  const distance = Math.hypot(dx, dy);
  const duration = Math.max(420, Math.min(3600, distance * 2.0));

  await animateProgress(duration, (t) => {
    const x = lerp(startX, targetX, t);
    const y = lerp(startY, targetY, t);
    pose.x = x;
    pose.y = y;

    if (distance > 1e-3) {
      const heading = rad_to_deg(Math.atan2(dy, dx)) + (backwards ? 180 : 0);
      pose.angle = normalizeAngle(heading);
    }

    draw_robot_on_map(document.getElementById("map-overlay"), pose.x, pose.y, pose.angle);
  });

  pose.x = targetX;
  pose.y = targetY;
}

async function animateBezierMotion(pose, params, backwards) {
  const p0 = { x: pose.x, y: pose.y };
  const p1 = { x: parseFloat(params[0]), y: parseFloat(params[1]) };
  const p2 = { x: parseFloat(params[2]), y: parseFloat(params[3]) };
  const p3 = { x: parseFloat(params[4]), y: parseFloat(params[5]) };

  const distance = approximateBezierLength(p0, p1, p2, p3);
  const duration = Math.max(520, Math.min(4200, distance * 2.2));

  await animateProgress(duration, (t) => {
    const pt = cubicBezierPoint(t, p0, p1, p2, p3);
    const tangent = cubicBezierTangent(t, p0, p1, p2, p3);
    const tangentSize = Math.hypot(tangent.x, tangent.y);

    pose.x = pt.x;
    pose.y = pt.y;

    if (tangentSize > 1e-4) {
      const heading = rad_to_deg(Math.atan2(tangent.y, tangent.x)) + (backwards ? 180 : 0);
      pose.angle = normalizeAngle(heading);
    }

    draw_robot_on_map(document.getElementById("map-overlay"), pose.x, pose.y, pose.angle);
  });

  pose.x = p3.x;
  pose.y = p3.y;
}

async function animateRotation(pose, targetAngle) {
  const startAngle = normalizeAngle(pose.angle);
  const destination = normalizeAngle(targetAngle);
  const delta = shortestAngleDelta(startAngle, destination);
  const duration = Math.max(320, Math.min(1800, Math.abs(delta) * 9));

  await animateProgress(duration, (t) => {
    pose.angle = normalizeAngle(startAngle + delta * t);
    draw_robot_on_map(document.getElementById("map-overlay"), pose.x, pose.y, pose.angle);
  });

  pose.angle = destination;
}

function getDesiredHeadingForAction(action, pose) {
  if (!action || !action.command) return null;

  const cmd = action.command;
  const params = Array.isArray(action.params) ? action.params : [];

  if (cmd.includes("orientate") && params.length >= 1) {
    const target = parseFloat(params[0]);
    return Number.isFinite(target) ? normalizeAngle(target) : null;
  }

  if (cmd.includes("go_to") && params.length >= 2) {
    const tx = parseFloat(params[0]);
    const ty = parseFloat(params[1]);
    if (!Number.isFinite(tx) || !Number.isFinite(ty)) return null;

    const dx = tx - pose.x;
    const dy = ty - pose.y;
    if (Math.hypot(dx, dy) < 1e-3) return null;

    const backwards = cmd.includes("backwards");
    return normalizeAngle(rad_to_deg(Math.atan2(dy, dx)) + (backwards ? 180 : 0));
  }

  if (cmd.includes("bezier") && params.length >= 2) {
    const x1 = parseFloat(params[0]);
    const y1 = parseFloat(params[1]);
    if (!Number.isFinite(x1) || !Number.isFinite(y1)) return null;

    const dx = x1 - pose.x;
    const dy = y1 - pose.y;
    if (Math.hypot(dx, dy) < 1e-3) return null;

    const backwards = cmd.includes("backwards");
    return normalizeAngle(rad_to_deg(Math.atan2(dy, dx)) + (backwards ? 180 : 0));
  }

  return null;
}

function stopSimulation(clearRobot = true) {
  simulationState.running = false;

  const btn = document.getElementById("simulate-btn");
  if (btn) {
    btn.classList.remove("simulating");
    btn.textContent = "Simulate";
  }

  if (clearRobot) {
    clear_robot_off_map(document.getElementById("map-overlay"));
  }

  clearSimulationActionHighlight();
  clearHoveredAction();
}

async function simulateStrategy() {
  if (!selected_strategy || !Array.isArray(selected_strategy.tasks)) return;

  if (simulationState.running) {
    stopSimulation(true);
    return;
  }

  simulationState.running = true;
  const btn = document.getElementById("simulate-btn");
  btn.classList.add("simulating");
  btn.textContent = "Stop";

  const svg = document.getElementById("map-overlay");
  const pose = { x: 0, y: 0, angle: 0 };

  try {
    draw_robot_on_map(svg, pose.x, pose.y, pose.angle);

    for (const task of selected_strategy.tasks) {
      if (!simulationState.running) break;
      if (!task || !Array.isArray(task.sequence)) continue;

      for (const action of task.sequence) {
        if (!simulationState.running) break;
        if (!action || !action.command) continue;

        const cmd = action.command;
        const params = Array.isArray(action.params) ? action.params : [];

        const desiredHeading = getDesiredHeadingForAction(action, pose);
        if (Number.isFinite(desiredHeading)) {
          const delta = Math.abs(shortestAngleDelta(pose.angle, desiredHeading));
          if (delta > 0.8) {
            await animateRotation(pose, desiredHeading);
            if (!simulationState.running) break;
          }
        }

        if (cmd.includes("set_position") && params.length >= 3) {
          pose.x = parseFloat(params[0]);
          pose.y = parseFloat(params[1]);
          pose.angle = normalizeAngle(parseFloat(params[2]) || 0);
          draw_robot_on_map(svg, pose.x, pose.y, pose.angle);
          markSimulationActionReached(action);
          await pauseSimulation(180);
          continue;
        }

        if (cmd.includes("go_to") && params.length >= 2) {
          const backwards = cmd.includes("backwards");
          await animateLinearMotion(pose, parseFloat(params[0]), parseFloat(params[1]), backwards);
          markSimulationActionReached(action);
          continue;
        }

        if (cmd.includes("bezier") && params.length >= 6) {
          const backwards = cmd.includes("backwards");
          await animateBezierMotion(pose, params, backwards);
          markSimulationActionReached(action);
          continue;
        }

        if (cmd.includes("orientate") && params.length >= 1) {
          await animateRotation(pose, parseFloat(params[0]) || 0);
          continue;
        }

        if (cmd.includes("put_down")) {
          drawAirBlowEffect(svg, pose.x, pose.y, pose.angle, action);
          await pauseSimulation(420);
          continue;
        }

        if (cmd.includes("pick_up")) {
          await pauseSimulation(240);
          continue;
        }

        if (cmd.includes("wait_end_game")) {
          const durationSec = parseFloat(params[0]);
          const ms = Number.isFinite(durationSec) ? Math.max(250, Math.min(3000, durationSec * 1000)) : 500;
          await pauseSimulation(ms);
          continue;
        }

        await pauseSimulation(150);
      }
    }
  } finally {
    stopSimulation(false);
  }
}

function calculate_x_y_phi_after_action(point, action) {
  const svg = document.getElementById("map-overlay");
  const points = svg.querySelectorAll(".map-point");
  let x = point.getAttribute("cx");
  let y = point.getAttribute("cy");
  let phi = 0;
  if (action.command.includes("position")) { 
    phi = action.params[2];
  } else{
    const prevPoint = points[Array.from(points).indexOf(point) - 1];
    const prevX = prevPoint ? parseFloat(prevPoint.getAttribute("cx")) : point.getAttribute("cx");
    const prevY = prevPoint ? parseFloat(prevPoint.getAttribute("cy")) : point.getAttribute("cy");

    phi = rad_to_deg(Math.atan2(y - prevY, x - prevX)) + (action.command.includes("backwards") ? 180 : 0);
  }

  selected_strategy.tasks.forEach(task => {
    for (let i = 0; i < task.sequence.length - 1; i++) {
      if (task.sequence[i] === action) {
        const next = task.sequence[i + 1];

        if (next.command.includes("orientate")) {
          phi = next.params[0];
        }

        return; // stop after first match
      }
    }
  });
  const xy = screenToMap(x, y);
  return [xy.x, xy.y, phi];
}

// Cache DOM elements and mousemove handler to prevent memory leaks
let cachedMapElement_viewer = null;
let cachedOverlayElement_viewer = null;
let activeDragHandler_viewer = null;
let activeMouseUpHandler_viewer = null;

function enableDrag(el, action, paramIndexX, paramIndexY) {
  let dragging = false;
  const isSecondary = el.classList.contains("secondary");
  
  // Cache DOM elements
  if (!cachedMapElement_viewer) cachedMapElement_viewer = document.getElementById("map");
  if (!cachedOverlayElement_viewer) cachedOverlayElement_viewer = document.getElementById("map-overlay");

  el.addEventListener("mouseover", e => {
    if (simulationState.running) return;
    hightlightAction(action);
    if (isSecondary) return;
    let [x, y, phi] = calculate_x_y_phi_after_action(el, action);
    draw_robot_on_map(cachedOverlayElement_viewer, x, y, phi);
  });
  
  el.addEventListener("mouseout", e => {
    if (simulationState.running) return;
    unHightlightActions();
    if (isSecondary) return;
    clear_robot_off_map(cachedOverlayElement_viewer);
  });

  el.addEventListener("mousedown", e => {
    if (zoomMode) return;
    dragging = true;
    e.stopPropagation();
    if (!isSecondary) {
      let [x, y, phi] = calculate_x_y_phi_after_action(el, action);
      draw_robot_on_map(cachedOverlayElement_viewer, x, y, phi);
    }
    
    // Remove previous handlers if they exist to prevent memory leaks
    if (activeDragHandler_viewer) window.removeEventListener("mousemove", activeDragHandler_viewer);
    if (activeMouseUpHandler_viewer) window.removeEventListener("mouseup", activeMouseUpHandler_viewer);
    
    // Create new handlers
    const rect = cachedMapElement_viewer.getBoundingClientRect();
    let lastUpdate = 0;
    const throttleMs = 16; // ~60fps
    
    activeDragHandler_viewer = (e) => {
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

      updateActionParamsFromDrag(action, paramIndexX, paramIndexY, basePoint.x, basePoint.y);
      if (!isSecondary) {
        let [x1, y1, phi] = calculate_x_y_phi_after_action(el, action);
        draw_robot_on_map(cachedOverlayElement_viewer, x1, y1, phi);
      }
    };
    
    activeMouseUpHandler_viewer = () => {
      if (!dragging) return;
      dragging = false;
      
      // Clean up handlers after drag ends
      window.removeEventListener("mousemove", activeDragHandler_viewer);
      window.removeEventListener("mouseup", activeMouseUpHandler_viewer);
      activeDragHandler_viewer = null;
      activeMouseUpHandler_viewer = null;
      
      update();
    };
    
    window.addEventListener("mousemove", activeDragHandler_viewer);
    window.addEventListener("mouseup", activeMouseUpHandler_viewer);
  });
}

///////////////////////////////////////////////////////////////////////////

document.getElementById("add-action-btn").addEventListener("click", () => {
  const index = actionSelect.value;
  if (index == "" || !selected_strategy) return;
  const opt = actionSelect.options[index];
  const [device, command] = opt.textContent.split(" - ");
  document.getElementById("command_label").textContent = "Command: "+command;
  buildArgsUI(command, null);
  modal.classList.remove("hidden");
  let inputs = document.querySelectorAll("#args-container input:not([type='checkbox'])");
  if (inputs.length > 0){
    inputs[0].focus();
  }
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

document.getElementById("apply-tasks-btn").addEventListener("click", () => {
  apply_tasks_logic(selected_strategy).then(() => {
    update();
  });
});

document.getElementById("modal-cancel").addEventListener("click", () => {
  modal.classList.add("hidden");
  contextAction = null;
  contextTask = null;
  if (undoStack.length > 0 ){
    selected_strategy = JSON.parse(
      undoStack[undoStack.length - 1]
    );
  }
  renderTasks();
  renderMap();
});

document.getElementById("modal-confirm").addEventListener("click", () => {
  if (contextAction == null){
    const index = actionSelect.value;
    if (newTaskCheckBox.checked){
      selected_strategy.tasks.push(new Task(`Task ${selected_strategy.tasks.length + 1 }`, []));
    }
    newTaskCheckBox.checked = false;
    const opt = actionSelect.options[index];
    const [device, command] = opt.textContent.split(" - ");
    const params = getModalParamsForCommand(command);
    const wait = document.getElementById("modal-wait").checked;

    if (!device || !command) return;

    const action = new Action(device, command, params, wait);

    // Add to last task (or selected task if you add selection later)
    if (selected_strategy.tasks.length === 0) {
      selected_strategy.tasks.push(new Task("Task 1", []));
    }

    selected_strategy.tasks[selected_strategy.tasks.length - 1].sequence.push(action);
  }else{
    const wait = document.getElementById("modal-wait").checked;

    const command = contextAction.command;
    const params = getModalParamsForCommand(command);

    if (contextAction) {
      // MODIFY
      contextAction.params = params;
      contextAction.wait = wait;
      contextAction = null;
      contextTask = null;
    } else {
      // ADD (existing behavior)
      selected_strategy.tasks.at(-1).sequence.push(
        new Action(device, command, params, wait)
      );
    }
  }
  modal.classList.add("hidden");
  update();
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