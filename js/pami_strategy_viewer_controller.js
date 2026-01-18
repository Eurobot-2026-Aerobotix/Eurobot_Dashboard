import { loadAllStrategies, loadPAMIStrategies, savePamiStrategy, deleteStrategy, saveStrategy, updateStrategy } from "./file_handler.js"; // your API functions
import { Pami_Strategy } from "../classes/Pami_Strategy.js";


let strategies = [];
let selected_strategy = null;
let actionsContainer = document.getElementById("side-panel");
const actionSelect = document.getElementById("action-select");
const modal = document.getElementById("action-modal");
const go_to_args = ["x", "y", "speed"];
const orientate_args = ["angle"];
const set_position_args = ["x", "y", "angle"];
const commandCodes = ["go_to", "orientate", "set_position"];
let contextActionIndex = null;
let robot_on_map = null;

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
  strategies = await loadPAMIStrategies();
  for (let strategy of strategies) {
    if (strategy.strategy_name === strategy_name && strategy.pami_number === pami_number) selected_strategy = strategy;
  }
  if (!selected_strategy) {
    selected_strategy = create_strategy(strategy_name, pami_number);
  }
  document.querySelector("title").textContent = "PAMI " + pami_number + " - " + strategy_name;
  renderTasks();
}

// ------------------------------
// Render tasks and actions
// ------------------------------
function renderTasks() {
    actionsContainer.innerHTML = "";
    if (!selected_strategy) return;
  
    const taskBox = document.createElement("div");
    taskBox.classList.add("task-box");

    const legend = document.createElement("label");
    legend.type = "text";
    legend.value = `Actions`;
    legend.classList.add("task-legend");

    taskBox.appendChild(legend);

    const actionList = document.createElement("div");
    actionList.classList.add("action-list");

    selected_strategy.sequence.forEach((action, actionIndex) => {
      const actionDiv = document.createElement("div");
      actionDiv.classList.add("action-item");
      if (action[0] == 0){
        actionDiv.textContent = `go_to(${action[1]}, ${action[2]}, ${action[3]})`;
      }else if (action[0] == 1){
        actionDiv.textContent = `orientate(${action[1]})`;
      }else if (action[0] == 2){
        actionDiv.textContent = `set_position(${action[1]}, ${action[2]}, ${action[3]})`;
      }

      actionDiv.draggable = true;
      actionDiv.dataset.actionIndex = actionIndex;

      /* ---------- DRAG START / END ---------- */
      actionDiv.addEventListener("dragstart", e => {
        actionDiv.classList.add("dragging");
        e.dataTransfer.effectAllowed = "move";
        e.dataTransfer.setData(
          "text/plain",
          JSON.stringify({
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
        const {fromAction } = data;
        const toAction = actionIndex;

        if (fromAction == null) return;

        const movedAction =
          selected_strategy.sequence.splice(fromAction, 1)[0];

        const insertIndex =
        fromAction < toAction
            ? toAction - 1
            : toAction;

        selected_strategy.sequence.splice(
          insertIndex,
          0,
          movedAction
        );

        renderTasks();
        renderMap();
        savePamiStrategy(selected_strategy);
      });

      /* ---------- CONTEXT MENU ---------- */
      actionDiv.addEventListener("contextmenu", e => {
        e.preventDefault();

        contextActionIndex = actionIndex;

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
      const { fromAction } = data;

      if (fromAction == null) return;

      const movedAction =
        selected_strategy.sequence.splice(fromAction, 1)[0];

      selected_strategy.sequence.push(movedAction);

      renderTasks();
      renderMap();
      savePamiStrategy(selected_strategy);
    });

    taskBox.appendChild(actionList);
    actionsContainer.appendChild(taskBox);

  /* ---------- GLOBAL CONTEXT MENU HANDLERS ---------- */

  document.addEventListener("click", () => {
    document.getElementById("action-context-menu").classList.add("hidden");
  });

  document.getElementById("ctx-delete").onclick = () => {
    if (contextActionIndex == null) return;

    selected_strategy.sequence.splice(contextActionIndex, 1);

    contextActionIndex = null;

    document.getElementById("action-context-menu").classList.add("hidden");

    renderTasks();
    renderMap();
    updateStrategy(selected_strategy);
  };

  document.getElementById("ctx-modify").onclick = () => {
    if (contextActionIndex == null) return;
    const command_type = selected_strategy.sequence[contextActionIndex][0];
    const command = commandCodes[command_type];

    let args_table = [];
    document.getElementById("command_label").textContent =
      "Command: " + command;

    if (command_type == 0) args_table = go_to_args;
    else if (command_type == 1) args_table = orientate_args;
    else if (command_type == 2) args_table = set_position_args;

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
      input.value = selected_strategy.sequence[contextActionIndex][i+1] ?? "";
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
  const options = [
    "go_to",
    "orientate",
    "set_position"
  ];
  actionSelect.innerHTML = '<option value="">select action</option>';
  options.forEach((a, i) => {
    const opt = document.createElement("option");
    opt.value = i+1;
    opt.textContent = a;
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
    selected_strategy.sequence.forEach((action, actionIndex) => {

        if (action[0] == 2) {
        const [x, y] = [action[1], action[2]];
        currentPos = { x, y };
        drawPoint(svg, x, y, "robot", actionIndex, 1, 2);
        }

        else if (action[0] == 0) {
        const [x, y] = [action[1], action[2]];
        drawArrow(svg, currentPos, { x, y }, 0);
        drawPoint(svg, x, y,"", actionIndex, 1, 2);
        currentPos = { x, y };
        }

        else if (action[0] == 1) {
        drawRotateIcon(svg, currentPos);
        }
    });
}

function drawPoint(svg, x, y, cls = "", actionIndex, paramIndexX, paramIndexY, secondary=false) {
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

  enableDrag(c, actionIndex , paramIndexX, paramIndexY);
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
function updateActionParamsFromDrag(actionIndex, paramIndexX, paramIndexY, cx, cy) {
  const { x, y } = screenToMap(cx, cy);

  selected_strategy.sequence[actionIndex][paramIndexX] = x.toFixed(2);
  selected_strategy.sequence[actionIndex][paramIndexY] = y.toFixed(2);

  renderMap();
}
function hightlightAction(actionIndex) {
    const actionItems = document.querySelectorAll(".action-item");
    actionItems[actionIndex].classList.add("highlighted");
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

  const color = "rgba(243, 20, 255, 1)"

  const robot = document.createElementNS("http://www.w3.org/2000/svg", "g");
  robot.setAttribute(
    "transform",
    `translate(${cx}, ${cy}) rotate(${90 - angle})`
  );

  /* Robot body */
  const rect = document.createElementNS("http://www.w3.org/2000/svg", "rect");
  rect.setAttribute("width", svg.clientWidth * 0.025);
  rect.setAttribute("height", svg.clientWidth * 0.03);
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
function calculate_x_y_phi_after_action(point, actionIndex) {
    const svg = document.getElementById("map-overlay");
    const points = svg.querySelectorAll(".map-point");
    let x = point.getAttribute("cx");
    let y = point.getAttribute("cy");
    let phi = 0;
    let action = selected_strategy.sequence[actionIndex];
    if (action[0] == 2) { 
        phi = action[3];
    } else{
        const prevPoint = points[Array.from(points).indexOf(point) - 1];
        const prevX = prevPoint ? parseFloat(prevPoint.getAttribute("cx")) : point.getAttribute("cx");
        const prevY = prevPoint ? parseFloat(prevPoint.getAttribute("cy")) : point.getAttribute("cy");

        phi = rad_to_deg(Math.atan2(x - prevX, y - prevY)) ;
    }
    if (actionIndex < selected_strategy.sequence.length - 1){
        const next = selected_strategy.sequence[actionIndex + 1];

        if (next[0] == 1) {
            phi = next[1];
        }
    }
    const xy = screenToMap(x, y);
    return [xy.x, xy.y, phi];
}
function enableDrag(el, actionIndex, paramIndexX, paramIndexY) {
  let dragging = false;

  el.addEventListener("mouseover", e => {
    hightlightAction(actionIndex);
    let [x, y, phi] = calculate_x_y_phi_after_action(el, actionIndex);
    draw_robot_on_map(document.getElementById("map-overlay"), x, y, phi);
  });
  el.addEventListener("mouseout", e => {
    unHightlightActions();
    clear_robot_off_map(document.getElementById("map-overlay"));
  });

  el.addEventListener("mousedown", e => {
    dragging = true;
    e.stopPropagation();
    let [x, y, phi] = calculate_x_y_phi_after_action(el, actionIndex);
    draw_robot_on_map(document.getElementById("map-overlay"), x, y, phi);
  });

  window.addEventListener("mousemove", e => {
    if (!dragging) return;

    const map = document.getElementById("map");
    const rect = map.getBoundingClientRect();

    const x = e.clientY - rect.top;
    const y = e.clientX - rect.left;

    el.setAttribute("cx", y);
    el.setAttribute("cy", x);

    updateActionParamsFromDrag(
      actionIndex,
      paramIndexX,
      paramIndexY,
      y,
      x
    );
    let [x1, y1, phi] = calculate_x_y_phi_after_action(el, actionIndex);
    draw_robot_on_map(document.getElementById("map-overlay"), x1, y1, phi);
  });

  window.addEventListener("mouseup", () => {
    if (!dragging) return;

    dragging = false;          // ← drag is over
    renderTasks();
    savePamiStrategy(selected_strategy);
  });
}

///////////////////////////////////////////////////////////////////////////

document.getElementById("add-action-btn").addEventListener("click", () => {
  const index = actionSelect.value;
  if (index == "" || !selected_strategy) return;
  const opt = actionSelect.options[index];
  const command = opt.textContent;
  let args_table = [];
  document.getElementById("command_label").textContent = "Command: "+command;
  // Decide which argument table to use
  if (command.includes("go_to")) {
    args_table = go_to_args;
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
    if (arg === "speed") {
      input.value = "400"; // default speed
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
  if (contextActionIndex == null){
    const index = actionSelect.value - 1;

    action = [index];
    if (index == 0){
      document.querySelectorAll("#args-container input").forEach(input => {
        const value = parseFloat(input.value) || 1000;
        action.push(value != 0 ? value : 1000);
      });
    } else{
      document.querySelectorAll("#args-container input").forEach(input => {
        const value = parseFloat(input.value) || 0;
        action.push(value != 0 ? value : 0);
      });
    }

    if (!action) return;

    selected_strategy.sequence.push(action);
  }else{
    action = selected_strategy.sequence[contextActionIndex];
    if (action[0] == 0){
      document.querySelectorAll("#args-container input").forEach((input, index) => {
        const value = parseFloat(input.value) || 1000;
        action[index + 1] = (value != 0 ? value : 1200);
      });
    } else{
      document.querySelectorAll("#args-container input").forEach((input, index) => {
        const value = parseFloat(input.value) || 0;
        action[index + 1] = (value != 0 ? value : 0);
      });
    }

    if (contextActionIndex != null) {
      // MODIFY
      selected_strategy.sequence[contextActionIndex] = action;
      contextActionIndex = null;
    } else {
      // ADD
      selected_strategy.sequence.push(action);
    }
  }
  modal.classList.add("hidden");
  renderTasks();
  renderMap();
  savePamiStrategy(selected_strategy);
});
await get_selected_strategy();
populateAddList();
renderMap();