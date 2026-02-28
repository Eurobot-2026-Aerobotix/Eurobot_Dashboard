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
const wait_enf_game_args = ["duration"];
const options = [
    new Action("STM", "set_position"),
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
    new Action("RASP_PI","wait_end_game")
  ];
let contextAction = null;
let contextTask = null;
let hovered_point_index = null;
let robot_on_map = null;

let undoStack = [];
let redoStack = [];


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
  update_smooth_or_not(selected_strategy).then(() => {
    renderTasks();
    renderMap();
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

  renderTasks();
  renderMap();
  updateStrategy(selected_strategy);
}

function redo() {
  if (redoStack.length === 0) return;

  const state = redoStack.pop();
  undoStack.push(state);

  selected_strategy = JSON.parse(state);

  renderTasks();
  renderMap();
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
      actionDiv.textContent =
        `${action.device} - ${action.command}(${action.params.join(", ")}) ` +
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

    let args_table = [];
    document.getElementById("command_label").textContent =
      "Command: " + command;

    if (command.includes("go_to")) args_table = go_to_args;
    else if (command.includes("bezier")) args_table = bezier_args;
    else if (command.includes("orientate")) args_table = orientate_args;
    else if (command.includes("set_position")) args_table = set_position_args;
    else if (command.includes("wait_end_game")) args_table = wait_enf_game_args;

    const argsContainer = document.getElementById("args-container");
    argsContainer.innerHTML = "";

    args_table.forEach(arg => {
      const label = document.createElement("label");
      label.textContent = arg;

      const input = document.createElement("input");
      input.type = "decimal";
      input.dataset.argName = arg;

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
      input.value = contextAction.params[i] ?? "";
    });

    modal.classList.remove("hidden");
    document.getElementById("action-context-menu").classList.add("hidden");
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

  if (!selected_strategy) return;

  let currentPos = { x: 0, y: 0 };
  selected_strategy.tasks.forEach(task => {
    task.sequence.forEach(action => {

      const backwards = action.command.includes("_backwards");

      if (action.command.includes("set_position")) {
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
  svg.appendChild(c);
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

    phi = rad_to_deg(Math.atan2(x - prevX, y - prevY)) + (action.command.includes("backwards") ? 180 : 0);
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
    hightlightAction(action);
    if (isSecondary) return;
    let [x, y, phi] = calculate_x_y_phi_after_action(el, action);
    draw_robot_on_map(cachedOverlayElement_viewer, x, y, phi);
  });
  
  el.addEventListener("mouseout", e => {
    unHightlightActions();
    if (isSecondary) return;
    clear_robot_off_map(cachedOverlayElement_viewer);
  });

  el.addEventListener("mousedown", e => {
    dragging = true;
    e.stopPropagation();
    if (isSecondary) return;
    let [x, y, phi] = calculate_x_y_phi_after_action(el, action);
    draw_robot_on_map(cachedOverlayElement_viewer, x, y, phi);
    
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

      el.setAttribute("cx", y);
      el.setAttribute("cy", x);

      updateActionParamsFromDrag(action, paramIndexX, paramIndexY, y, x);
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
  let args_table = [];
  document.getElementById("command_label").textContent = "Command: "+command;
  // Decide which argument table to use
  if (command.includes("go_to")) {
    args_table = go_to_args;
  } 
  else if (command.includes("bezier")) {
    args_table = bezier_args;
  } 
  else if (command.includes("orientate")) {
    args_table = orientate_args;
  }
  else if (command.includes("set_position")) {
    args_table = set_position_args;
  }
  else if (command.includes("wait_end_game")) {
    args_table = wait_enf_game_args;
  }
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
      input.value = "1100"; // default speed
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
  if (inputs.length > 0){
    inputs[0].focus();
  }
});

document.getElementById("back-btn").addEventListener("click", () => {
  sessionStorage.setItem("refreshOnce", "1");
  window.history.back();
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

    const params = [];
    const command = contextAction.command;
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