import { loadAllStrategies, deleteStrategy, saveStrategy, updateStrategy } from "./file_handler.js"; 
import { Strategy } from "../classes/Strategy.js";

// HTML elements
const listDivYellow = document.getElementById("strategy-list-yellow");
const listDivBlue = document.getElementById("strategy-list-blue");
const createBtn = document.getElementById("create-btn");
const pamiBtn = document.getElementById("pami-btn");
const deleteBtn = document.getElementById("delete-btn");
const branchBtn = document.getElementById("branch-btn");

let strategies = [];
let clickedIndex = null;
let busy = false;

// -------------------------------------------------
// Helpers
// -------------------------------------------------

function sortStrategies() {
  strategies.sort((a, b) => {
    // first: by color (yellow < blue)
    if (a.color !== b.color) {
      return a.color === "yellow" ? -1 : 1;
    }
    // second: by order
    return a.order - b.order;
  });
}

function renderList() {
  sortStrategies();

  listDivYellow.innerHTML = "";
  listDivBlue.innerHTML = "";

  strategies.forEach((s, i) => {
    const div = document.createElement("div");
    div.className = "strategy-item";
    if (i === clickedIndex) div.classList.add("selected");

    div.textContent = s.name;

    // selected icon
    if (s.selected) {
      const img = document.createElement("img");
      img.src = "../resources/harissa.png";
      img.className = "selected-icon";
      img.style.height = "30px";
      img.style.marginLeft = "8px";
      div.appendChild(img);
    }

    // single click (UI selection only)
    div.onclick = () => {
      clickedIndex = i;
      renderList();
      updateButtons();
    };

    // double click (open)
    div.ondblclick = () => {
      window.location.href = `strategy_viewer.html?name=${s.name}`;
    };

    // long press = mark as active strategy
    const HOLD_MS = 300;
    let holdTimer;
    const startHold = (e) => {
      e.preventDefault();
      holdTimer = setTimeout(async () => {
        strategies.forEach((st, j) => st.selected = (j === i));
        await Promise.all(strategies.map(st => updateStrategy(st)));
        renderList();
      }, HOLD_MS);
    };
    const cancelHold = () => clearTimeout(holdTimer);

    div.addEventListener("mousedown", startHold);
    div.addEventListener("touchstart", startHold, { passive: false });
    div.addEventListener("mouseup", cancelHold);
    div.addEventListener("mouseleave", cancelHold);
    div.addEventListener("touchend", cancelHold);
    div.addEventListener("touchcancel", cancelHold);

    if (s.color === "yellow") {
      listDivYellow.appendChild(div);
    } else {
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

function mirror_strategy(strategy) {
  if (!strategy.tasks) return strategy;
  strategy.color = strategy.color === "yellow" ? "blue" : "yellow";

  strategy.tasks.forEach(task => {
    if (!task.sequence) return;

    task.sequence.forEach(action => {
      if (!action.command || !Array.isArray(action.params)) return;

      const mirrorValue = (value) => {
        const num = Number(value);
        if (isNaN(num)) return value;
        const mirrored = 3000 - num;
        return typeof value === "string" ? String(mirrored) : mirrored;
      };

      if (action.command.includes("set_position") || action.command.includes("go_to")) {
        if (action.params.length >= 2) action.params[1] = mirrorValue(action.params[1]);
      }

      if (action.command.includes("bezier")) {
        if (action.params.length >= 6) {
          action.params[1] = mirrorValue(action.params[1]);
          action.params[3] = mirrorValue(action.params[3]);
          action.params[5] = mirrorValue(action.params[5]);
        }
      }
    });
  });

  return strategy;
}

// CREATE
createBtn.addEventListener("click", async () => {
  let name = prompt("Enter new strategy name:");
  if (!name) return;

  name = name.replace(/\s+/g, "_");

  if (strategies.some(s => s.name === name)) {
    alert("deja mawjouda");
    return;
  }

  let color = prompt("azreg walla asfer (b/y)");
  color = color === "b" ? "blue" : "yellow";

  const maxOrder = strategies.length ? Math.max(...strategies.map(s => s.order)) : 0;
  const newStrategy = new Strategy(name, [], false, color, maxOrder + 1);

  await saveStrategy(newStrategy);

  strategies.push(newStrategy);
  renderList();
});

// DELETE
deleteBtn.addEventListener("click", async () => {
  if (clickedIndex === null) return;

  const strategy = strategies[clickedIndex];
  if (!confirm(`Delete strategy "${strategy.name}"?`)) return;

  await deleteStrategy(strategy.name + ".yaml");

  strategies.splice(clickedIndex, 1);
  clickedIndex = null;
  renderList();
  updateButtons();
});

// PAMI
pamiBtn.addEventListener("click", () => {
  if (clickedIndex === null) return;
  window.location.href = `pami_strategy_selector.html?name=${strategies[clickedIndex].name}`;
});

// BRANCH
branchBtn.addEventListener("click", async () => {
  if (clickedIndex === null) return;

  const original = strategies[clickedIndex];
  let name = prompt("Enter name for the branched strategy:");
  if (!name || !name.trim()) return;
  name = name.trim();

  if (strategies.some(s => s.name === name)) {
    alert("deja mawjouda");
    return;
  }

  let cloned = JSON.parse(JSON.stringify(original));
  cloned.name = name;
  cloned.selected = false;
  cloned.order = strategies.length ? Math.max(...strategies.map(s => s.order)) + 1 : 1;

  if (confirm("symetric ?")) {
    cloned = mirror_strategy(cloned);
  }

  await saveStrategy(cloned);
  strategies.push(cloned);
  renderList();
});

// -------------------------------------------------
// Arrow key handling
// -------------------------------------------------
window.addEventListener("keydown", async (e) => {
  if (clickedIndex === null) return;
  const current = strategies[clickedIndex];

  if (e.key === "ArrowLeft" && clickedIndex > 0) {
    const prev = strategies[clickedIndex - 1];
    clickedIndex--;
    [current.order, prev.order] = [prev.order, current.order];
    renderList();
    await updateStrategy(current);
    await updateStrategy(prev);
  }

  if (e.key === "ArrowRight" && clickedIndex < strategies.length - 1) {
    const next = strategies[clickedIndex + 1];
    clickedIndex++;
    [current.order, next.order] = [next.order, current.order];
    renderList();
    await updateStrategy(current);
    await updateStrategy(next);
  }
});

// -------------------------------------------------
// Initial load
// -------------------------------------------------
loadStrategies();
