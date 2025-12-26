import { loadAllStrategies, deleteStrategy, saveStrategy, updateStrategy } from "./file_handler.js"; // your API functions
import { Strategy } from "./classes/Strategy.js";
import { Task } from "./classes/Task.js";
import { Action } from "./classes/Action.js";


let strategies = [];
let selected_strategy = null;
let actionsContainer = document.getElementById("side-panel");
const actionSelect = document.getElementById("action-select");
const newTaskCheckBox = document.getElementById("task-checkbox");
const modal = document.getElementById("action-modal");
const go_to_args = ["x", "y", "speed"];
const orientate_args = ["angle"];
const bezier_args = ["x1", "y1", "x2", "y2", "x3", "y3", "speed"];
const set_position_args = ["x", "y", "angle"]
let contextAction = null;
let contextTask = null;

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
  renderTasks();
}

get_selected_strategy();

// ------------------------------
// Render tasks and actions
// ------------------------------
function renderTasks() {
  actionsContainer.innerHTML = "";
  if (!selected_strategy) return;

  selected_strategy.tasks.forEach((task, taskIndex) => {
    const taskBox = document.createElement("div");
    taskBox.classList.add("task-box");

    const legend = document.createElement("div");
    legend.textContent = task.name || `Task ${taskIndex + 1}`;
    legend.classList.add("task-legend");
    taskBox.appendChild(legend);

    const actionList = document.createElement("div");
    actionList.classList.add("action-list");

    task.sequence.forEach((action, actionIndex) => {
      const actionDiv = document.createElement("div");
      actionDiv.classList.add("action-item");
      actionDiv.textContent = `${action.device} - ${action.command}(${action.params.join(", ")}) with${action.wait?"":"out"} waiting`;
      actionDiv.draggable = true;
      actionDiv.dataset.taskIndex = taskIndex;
      actionDiv.dataset.actionIndex = actionIndex;

      // Drag events
      actionDiv.addEventListener("dragstart", e => {
        actionDiv.classList.add("dragging");
        e.dataTransfer.setData("text/plain", JSON.stringify({
          fromTask: taskIndex,
          fromAction: actionIndex
        }));
      });
      actionDiv.addEventListener("dragend", () => actionDiv.classList.remove("dragging"));

      actionList.appendChild(actionDiv);

      actionDiv.addEventListener("contextmenu", e => {
        e.preventDefault();

        contextAction = action;
        contextTask = task;

        const menu = document.getElementById("action-context-menu");
        menu.style.left = `${e.clientX}px`;
        menu.style.top = `${e.clientY}px`;
        menu.classList.remove("hidden");
      });
    });

    // Drop target
    actionList.addEventListener("dragover", e => e.preventDefault());
    actionList.addEventListener("drop", e => {
      e.preventDefault();
      const data = JSON.parse(e.dataTransfer.getData("text/plain"));
      const fromTask = data.fromTask;
      const fromAction = data.fromAction;
      const toTask = taskIndex;

      if (fromTask === undefined || fromAction === undefined) return;

      // Move action
      const movedAction = selected_strategy.tasks[fromTask].sequence.splice(fromAction, 1)[0];
      selected_strategy.tasks[toTask].sequence.push(movedAction);

      renderTasks();
      updateStrategy(selected_strategy); // save/update
    });
    
    taskBox.appendChild(actionList);
    actionsContainer.appendChild(taskBox);
  });
  document.addEventListener("click", () => {
    document.getElementById("action-context-menu").classList.add("hidden");
  });
  document.getElementById("ctx-delete").addEventListener("click", () => {
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
      selected_strategy.tasks.forEach((task, i) => {
        task.name = `Task ${i + 1}`;
      });
    }

    contextAction = null;
    contextTask = null;

    document.getElementById("action-context-menu").classList.add("hidden");

    renderTasks();
    updateStrategy(selected_strategy);
  });
  document.getElementById("ctx-modify").addEventListener("click", () => {
    if (!contextAction) return;

    let command = contextAction.command;
    document.getElementById("modal-wait").checked = contextAction.wait;

    // Trigger arg input regeneration
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
    }else if (command.includes("set_position")) {
      args_table = set_position_args;
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

      label.appendChild(input);
      argsContainer.appendChild(label);
    });

    // Fill params
    const inputs = document.querySelectorAll("#args-container input");
    inputs.forEach((input, i) => {
      input.value = contextAction.params[i] ?? "";
    });

    modal.classList.remove("hidden");
    document.getElementById("action-context-menu").classList.add("hidden");
  });
}

// ------------------------------
// Populate Add Action dropdown
// ------------------------------
function populateAddList() {
  const options = [
    new Action("STM", "set_position"),
    new Action("STM", "go_to"),
    new Action("STM", "go_to_backwards"),
    new Action("STM", "orientate"),
    new Action("STM", "bezier"),
    new Action("STM", "bezier_backwards"),
    new Action("ESP_front", "pick_up"),
    new Action("ESP_front", "put_down"),
    new Action("ESP_front", "prepare"),
    new Action("ESP_back", "pick_up"),
    new Action("ESP_back", "put_down"),
    new Action("ESP_back", "prepare"),
  ];
  actionSelect.innerHTML = '<option value="">select action</option>';
  options.forEach((a, i) => {
    const opt = document.createElement("option");
    opt.value = i+1;
    opt.textContent = `${a.device} - ${a.command}`;
    actionSelect.appendChild(opt);
  });
}

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
  const argsContainer = document.getElementById("args-container");
  argsContainer.innerHTML = "";

  // Create inputs dynamically
  args_table.forEach(arg => {
    const label = document.createElement("label");
    label.textContent = arg;

    const input = document.createElement("input");
    input.type = "decimal";
    input.dataset.argName = arg;

    label.appendChild(input);
    argsContainer.appendChild(label);
  });
  modal.classList.remove("hidden");
});

document.getElementById("back-btn").addEventListener("click", () => {
  window.history.back();
});

document.getElementById("modal-cancel").addEventListener("click", () => {
  modal.classList.add("hidden");
  contextAction = null;
  contextTask = null;
});

document.getElementById("modal-confirm").addEventListener("click", () => {
  if (contextAction == null){
    const index = actionSelect.value;
    if (newTaskCheckBox.checked){
      selected_strategy.tasks.push(new Task(`Task ${selected_strategy.tasks.length + 1 }`, []));
    }
    const opt = actionSelect.options[index];
    const [device, command] = opt.textContent.split(" - ");
    const params = [];
    document.querySelectorAll("#args-container input").forEach(input => {
      params.push(parseFloat(input.value) || 0);
    });
    const wait = document.getElementById("modal-wait").checked;

    if (!device || !command) return;

    const action = new Action(device, command, params, wait);

    // Add to last task (or selected task if you add selection later)
    if (selected_strategy.tasks.length === 0) {
      selected_strategy.tasks.push(new Task("Task 1", []));
    }

    selected_strategy.tasks[selected_strategy.tasks.length - 1].sequence.push(action);

    modal.classList.add("hidden");

    renderTasks();
    updateStrategy(selected_strategy);
  }else{
    const wait = document.getElementById("modal-wait").checked;

    const params = [];
    document.querySelectorAll("#args-container input").forEach(input => {
      params.push(parseFloat(input.value) || 0);
    });

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

    modal.classList.add("hidden");
    renderTasks();
    updateStrategy(selected_strategy);
  }
});

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

        drawPoint(svg, x, y, "robot");
      }

      else if (action.command.includes("go_to")) {
        const [x, y] = action.params;
        drawArrow(svg, currentPos, { x, y }, backwards);
        drawPoint(svg, x, y);
        currentPos = { x, y };
      }

      else if (action.command.includes("bezier")) {
        drawBezier(svg, currentPos, action.params, backwards);
        const [ , , , , x3, y3 ] = action.params;
        currentPos = { x: x3, y: y3 };
      }

      else if (action.command.includes("orientate")) {
        drawRotateIcon(svg, currentPos);
      }

      else if (action.command.includes("pick_up")) {
        drawIcon(svg, currentPos, "⏳");
      }

      else if (action.command.includes("drop")) {
        drawIcon(svg, currentPos, "📦");
      }
    });
  });
}

function drawPoint(svg, x, y, cls = "") {
  const { cx, cy } = mapToScreen(x, y);

  const c = document.createElementNS("http://www.w3.org/2000/svg", "circle");
  c.setAttribute("cx", cx);
  c.setAttribute("cy", cy);
  c.setAttribute("r", 6);
  c.classList.add("map-point", cls);

  enableDrag(c, x, y);
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

function drawBezier(svg, start, params, backwards) {
  const [x1,y1,x2,y2,x3,y3] = params;

  const p0 = mapToScreen(start.x, start.y);
  const p1 = mapToScreen(x1, y1);
  const p2 = mapToScreen(x2, y2);
  const p3 = mapToScreen(x3, y3);

  const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
  path.setAttribute(
    "d",
    `M ${p0.cx} ${p0.cy} C ${p1.cx} ${p1.cy}, ${p2.cx} ${p2.cy}, ${p3.cx} ${p3.cy}`
  );
  path.classList.add(backwards ? "backward" : "forward");
  path.setAttribute("fill", "none");
  path.setAttribute("stroke-width", "2");

  svg.appendChild(path);

  [x1,y1,x2,y2,x3,y3].forEach((_, i) => {
    if (i % 2 === 0)
      drawPoint(svg, params[i], params[i+1]);
  });
}
function drawIcon(svg, pos, symbol) {
  const { cx, cy } = mapToScreen(pos.x, pos.y);

  const t = document.createElementNS("http://www.w3.org/2000/svg", "text");
  t.setAttribute("x", cx + 10);
  t.setAttribute("y", cy - 10);
  t.textContent = symbol;
  t.classList.add("icon");

  svg.appendChild(t);
}

function drawRotateIcon(svg, pos) {
  drawIcon(svg, pos, "↻");
}

function enableDrag(el, x, y) {
  let dragging = false;

  el.addEventListener("mousedown", e => {
    dragging = true;
  });

  window.addEventListener("mousemove", e => {
    if (!dragging) return;
    el.setAttribute("cx", e.offsetX);
    el.setAttribute("cy", e.offsetY);
    // here you update action.params accordingly
  });

  window.addEventListener("mouseup", () => dragging = false);
}
populateAddList();
renderMap();