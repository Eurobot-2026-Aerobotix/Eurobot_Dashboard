import { loadAllStrategies, deleteStrategy, saveStrategy, updateStrategy } from "./file_handler.js"; // your API functions
import { Strategy } from "./classes/Strategy.js";
import { Task } from "./classes/Task.js";
import { Action } from "./classes/Action.js";


let strategies = [];
let selected_strategy = null;
let actionsContainer = document.getElementById("side-panel");
const actionSelect = document.getElementById("action-select");

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
      actionDiv.textContent = `${action.device} - ${action.command} [${action.params.join(",")}] wait:${action.wait}`;
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
}

// ------------------------------
// Populate Add Action dropdown
// ------------------------------
function populateAddList() {
  const options = [
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
  actionSelect.innerHTML = '<option value="-1">Task</option>';
  options.forEach((a, i) => {
    const opt = document.createElement("option");
    opt.value = i;
    opt.textContent = `${a.device} - ${a.command}`;
    actionSelect.appendChild(opt);
  });
}

document.getElementById("add-action-btn").addEventListener("click", () => {
  const index = actionSelect.value;
  if (!selected_strategy) return;
  if (index === ""){
    selected_strategy.tasks.push(new Task(`Task ${selected_strategy.tasks.length + 1 }`, []));
  }
  const opt = actionSelect.options[index];
  const [device, command] = opt.textContent.split(" - ");
  // Add to first task by default
  if (selected_strategy.tasks.length === 0) {
    selected_strategy.tasks.push(new Task("Task 1", []));
  }
  selected_strategy.tasks[selected_strategy.tasks.length - 1].sequence.push(new Action(device, command));
  renderTasks();
  updateStrategy(selected_strategy);
});

document.getElementById("back-btn").addEventListener("click", () => {
  window.history.back();
});

populateAddList();