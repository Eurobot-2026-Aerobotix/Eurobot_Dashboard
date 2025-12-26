import { loadAllStrategies, deleteStrategy, saveStrategy, updateStrategy } from "./file_handler.js"; // your API functions
import { Strategy } from "./classes/Strategy.js";
import { Task } from "./classes/Task.js";
import { Action } from "./classes/Action.js";

// HTML elements
const listDivYellow = document.getElementById("strategy-list-yellow");
const listDivBlue = document.getElementById("strategy-list-blue");
const createBtn = document.getElementById("create-btn");
const openBtn = document.getElementById("open-btn");
const deleteBtn = document.getElementById("delete-btn");
const selectBtn = document.getElementById("select-btn");

let strategies = [];
let selectedIndex = null;

// -------------------------------------------------
// Helpers
// -------------------------------------------------
function renderList() {
  listDivYellow.innerHTML = "";
  listDivBlue.innerHTML = "";
  strategies.forEach((s, i) => {
    const div = document.createElement("div");
    div.classList.add("strategy-item");
    if (i === selectedIndex) div.classList.add("selected");
    div.textContent = s.name;
    div.addEventListener("click", () => {
      selectedIndex = i;
      renderList();
      updateButtons();
    });
    if (s.color == "yellow"){
        listDivYellow.appendChild(div);
    }else{
        listDivBlue.appendChild(div);
    }
  });
}

function updateButtons() {
  const enabled = selectedIndex !== null;
  openBtn.disabled = !enabled;
  deleteBtn.disabled = !enabled;
  selectBtn.disabled = !enabled;
}

// -------------------------------------------------
// Actions
// -------------------------------------------------
async function loadStrategies() {
  strategies = await loadAllStrategies();
  selectedIndex = null;
  renderList();
  updateButtons();
}

createBtn.addEventListener("click", async () => {
  var name = prompt("Enter new strategy name:");
  if (!name) return;
  name = name.replace(/\s+/g, "_");
  for(let strategy of strategies){
    if (strategy.name == name){
        alert("deja mawjouda");
        return
    }
  }
  var color = prompt("azreg walla asfer (b/y)")
  if (color == "b"){
    color = "blue";
  }else{
    color = "yellow";
  }
  const filename = name + ".yaml";
  const newStrategy = new Strategy(name, [], false, color);
  await saveStrategy(newStrategy);
  await loadStrategies();
});

deleteBtn.addEventListener("click", async () => {
  if (selectedIndex === null) return;
  const strategy = strategies[selectedIndex];
  if (!confirm(`Delete strategy "${strategy.name}"?`)) return;

  const filename = strategy.name.replace(/\s+/g, "_") + ".yaml";
  await deleteStrategy(filename);
  await loadStrategies();
});

openBtn.addEventListener("click", () => {
  if (selectedIndex === null) return;
  const strategy = strategies[selectedIndex];
  window.location.href = `strategy_viewer.html?name=${strategy.name}`;
});

selectBtn.addEventListener("click", () => {
  if (selectedIndex === null) return;
  for(let i = 0; i<strategies.length; i++){
    if (i == selectedIndex){
        strategies[i].selected = true
    }else{
        strategies[i].selected = false;
    }
    updateStrategy(strategies[i])
  }
});

// -------------------------------------------------
// Initial load
// -------------------------------------------------
loadStrategies();
