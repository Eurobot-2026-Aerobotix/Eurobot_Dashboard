import { loadAllStrategies, deleteStrategy, saveStrategy, updateStrategy } from "./file_handler.js"; // your API functions
import { Strategy } from "../classes/Strategy.js";
import { Task } from "../classes/Task.js";
import { Action } from "../classes/Action.js";

// HTML elements
const listDivYellow = document.getElementById("strategy-list-yellow");
const listDivBlue = document.getElementById("strategy-list-blue");
const createBtn = document.getElementById("create-btn");
const pamiBtn = document.getElementById("pami-btn");
const deleteBtn = document.getElementById("delete-btn");
const branchBtn = document.getElementById("branch-btn");

let strategies = [];
let clickedIndex = null;

// -------------------------------------------------
// Helpers
// -------------------------------------------------
function renderList() {
  listDivYellow.innerHTML = "";
  listDivBlue.innerHTML = "";
  strategies.forEach((s, i) => {
    const div = document.createElement("div");
    div.classList.add("strategy-item");
    if (i === clickedIndex) div.classList.add("selected");
    div.textContent = s.name;
    div.style.display = "flex";
    div.style.alignItems = "center";
    div.style.justifyContent = "center"; // Center the text and image
    if (s.selected){
      const img = document.createElement("img");
      img.src = "../resources/harissa.png";
      img.classList.add("selected-icon");
      img.style.height = "30px";
      img.style.marginLeft = "8px";
      div.appendChild(img);
    }
    div.addEventListener("click", () => {
      clickedIndex = i;
      renderList();
      updateButtons();
    });
    div.addEventListener("dblclick", () => {
      window.location.href = `strategy_viewer.html?name=${s.name}`;
    });
    // long-press / hold detection to mark this strategy as selected
    const HOLD_MS = 100;
    let holdTimer = null;

    const startHold = (e) => {
      // prevent text selection / native behavior on touch
      if (e && e.preventDefault) e.preventDefault();
      holdTimer = setTimeout(async () => {
        // mark only this strategy as selected and persist
        for (let j = 0; j < strategies.length; j++) {
          strategies[j].selected = (j === i);
          await updateStrategy(strategies[j]);
        }
        await loadStrategies();
      }, HOLD_MS);
    };

    const cancelHold = () => {
      if (holdTimer) {
        clearTimeout(holdTimer);
        holdTimer = null;
      }
    };

    div.addEventListener("mousedown", startHold);
    div.addEventListener("touchstart", startHold, { passive: false });

    div.addEventListener("mouseup", cancelHold);
    div.addEventListener("mouseleave", cancelHold);
    div.addEventListener("touchend", cancelHold);
    div.addEventListener("touchcancel", cancelHold);
    if (s.color == "yellow"){
        listDivYellow.appendChild(div);
    }else{
        listDivBlue.appendChild(div);
    }
  });
}

function updateButtons() {
  const enabled = clickedIndex !== null;
  pamiBtn.disabled = !enabled;
  deleteBtn.disabled = !enabled;
  branchBtn.disabled = !enabled;
}

// -------------------------------------------------
// Actions
// -------------------------------------------------
async function loadStrategies() {
  strategies = await loadAllStrategies();
  clickedIndex = null;
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
  if (clickedIndex === null) return;
  const strategy = strategies[clickedIndex];
  if (!confirm(`Delete strategy "${strategy.name}"?`)) return;

  const filename = strategy.name.replace(/\s+/g, "_") + ".yaml";
  await deleteStrategy(filename);
  await loadStrategies();
});

pamiBtn.addEventListener("click", () => {
  if (clickedIndex === null) return;
  const strategy = strategies[clickedIndex];
  window.location.href = `pami_strategy_selector.html?name=${strategy.name}`;
});

branchBtn.addEventListener("click", () => {
  if (clickedIndex === null) return;

  const original = strategies[clickedIndex];

  const cloned = JSON.parse(JSON.stringify(original));

  const name = prompt("Enter name for the branched strategy:");
  for(let strategy of strategies){
    if (strategy.name == name){
        alert("deja mawjouda");
        return
    }
  }
  if (name !== null && name.trim() !== "") {
    cloned.name = name.trim();
    strategies.push(cloned);
    saveStrategy(cloned);
    loadStrategies();
  }
});

window.addEventListener("pageshow", (e) => {
  if (sessionStorage.getItem("refreshOnce")) {
    sessionStorage.removeItem("refreshOnce");
    location.reload();
  }
});

// -------------------------------------------------
// Initial load
// -------------------------------------------------

loadStrategies();

