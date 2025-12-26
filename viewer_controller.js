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

populateAddList();