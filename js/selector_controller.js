import {
  loadAllStrategies,
  deleteStrategy,
  saveStrategy,
  updateStrategy,
  loadPAMIStrategies,
  savePamiStrategy,
  deletePamiStrategyGroup
} from "./file_handler.js";
import { Strategy } from "../classes/Strategy.js";

// HTML elements
const listDivYellow = document.getElementById("strategy-list-yellow");
const listDivBlue = document.getElementById("strategy-list-blue");
const createBtn = document.getElementById("create-btn");
const pamiBtn = document.getElementById("pami-btn");
const deleteBtn = document.getElementById("delete-btn");
const branchBtn = document.getElementById("branch-btn");

const pamiListDivYellow = document.getElementById("pami-strategy-list-yellow");
const pamiListDivBlue = document.getElementById("pami-strategy-list-blue");
const pamiCreateBtn = document.getElementById("pami-create-btn");
const pamiDeleteBtn = document.getElementById("pami-delete-btn");
const pamiBranchBtn = document.getElementById("pami-branch-btn");

let strategies = [];
let clickedIndex = null;
let busy = false;
let pamiStrategyGroups = [];
let clickedPamiName = null;

// -------------------------------------------------
// Helpers
// -------------------------------------------------

function sortStrategies() {
  // First, sort by color and then order
  strategies.sort((a, b) => {
    if (a.color !== b.color) return a.color === "yellow" ? -1 : 1;
    return a.order - b.order;
  });

  // Then, ensure unique order within each color
  const lastOrder = {}; // { color: lastAssignedOrder }

  strategies.forEach((s) => {
    if (lastOrder[s.color] === undefined) {
      lastOrder[s.color] = s.order;
    } else if (s.order <= lastOrder[s.color]) {
      // conflict, push it back
      s.order = lastOrder[s.color] + 1;
      lastOrder[s.color] = s.order;
    } else {
      lastOrder[s.color] = s.order;
    }
  });
}

function renderList() {
  sortStrategies();

  listDivYellow.innerHTML = "";
  listDivBlue.innerHTML = "";
  
  // Use document fragments for better performance
  const yellowFragment = document.createDocumentFragment();
  const blueFragment = document.createDocumentFragment();
  const strategiesLength = strategies.length;

  for (let i = 0; i < strategiesLength; i++) {
    const s = strategies[i];
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
        const strats = strategies; // cache reference
        const stratsLength = strats.length;
        for (let j = 0; j < stratsLength; j++) {
          strats[j].selected = (j === i);
        }
        await Promise.all(strats.map(st => updateStrategy(st)));
        renderList();
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

    if (s.color === "yellow") {
      yellowFragment.appendChild(div);
    } else {
      blueFragment.appendChild(div);
    }
  }
  
  // Append fragments to DOM in one operation (better performance)
  listDivYellow.appendChild(yellowFragment);
  listDivBlue.appendChild(blueFragment);
}

function updateButtons() {
  const enabled = clickedIndex !== null;
  pamiBtn.disabled = !enabled;
  deleteBtn.disabled = !enabled;
  branchBtn.disabled = !enabled;
}

function inferPamiColorFromName(name) {
  const low = String(name || "").toLowerCase();
  if (low.includes("yellow") || low.includes("jaune") || low.includes("asfer") || low.endsWith("_y")) {
    return "yellow";
  }
  if (low.includes("blue") || low.includes("azreg") || low.endsWith("_b")) {
    return "blue";
  }
  return "blue";
}

function updatePamiButtons() {
  const enabled = clickedPamiName !== null;
  if (pamiDeleteBtn) pamiDeleteBtn.disabled = !enabled;
  if (pamiBranchBtn) pamiBranchBtn.disabled = !enabled;
}

function renderPamiList() {
  if (!pamiListDivYellow || !pamiListDivBlue) return;

  pamiListDivYellow.innerHTML = "";
  pamiListDivBlue.innerHTML = "";

  const yellowNames = [];
  const blueNames = [];

  pamiStrategyGroups.forEach((group) => {
    if (group.color === "yellow") {
      yellowNames.push(group.name);
    } else {
      blueNames.push(group.name);
    }
  });

  const renderName = (name, container) => {
    const div = document.createElement("div");
    div.className = "strategy-item";
    if (clickedPamiName === name) div.classList.add("selected");
    div.textContent = name;

    div.onclick = () => {
      clickedPamiName = name;
      renderPamiList();
      updatePamiButtons();
    };

    div.ondblclick = () => {
      window.location.href = `pami_strategy_selector.html?name=${encodeURIComponent(name)}`;
    };

    container.appendChild(div);
  };

  yellowNames.sort((a, b) => a.localeCompare(b)).forEach((name) => renderName(name, pamiListDivYellow));
  blueNames.sort((a, b) => a.localeCompare(b)).forEach((name) => renderName(name, pamiListDivBlue));
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

async function loadPamiStrategyNames() {
  const allPami = await loadPAMIStrategies();
  const grouped = new Map();

  allPami.forEach((s) => {
    if (!s || !s.strategy_name) return;
    if (!grouped.has(s.strategy_name)) {
      grouped.set(s.strategy_name, {
        name: s.strategy_name,
        color: s.color || inferPamiColorFromName(s.strategy_name)
      });
    }
  });

  pamiStrategyGroups = Array.from(grouped.values());
  clickedPamiName = null;
  renderPamiList();
  updatePamiButtons();
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

function mirror_pami_strategy(pami_strategy) {
  const mirrored = JSON.parse(JSON.stringify(pami_strategy)); // deep copy

  mirrored.sequence.forEach(action => {
    const type = action[0];

    if (type === 1) {
      // [1, x, y]
      action[2] = 3000 - action[2];
    }

    else if (type === 2) {
      // [2, angle, ?, y1, ?, y2]  (based on your description)
      action[1] = -action[1]; // angle
    }

    else if (type === 3) {
      // [3, y, angle]
      action[2] = 3000 - action[2]; // y
      action[3] = -action[3];       // angle
    }

    else if (type === 4) {
      // Bezier: [4, x1, y1, x2, y2, x3, y3]
      // y's are indices 2,4,6
      if (action.length > 2) action[2] = 3000 - action[2];
      if (action.length > 4) action[4] = 3000 - action[4];
      if (action.length > 6) action[6] = 3000 - action[6];
    }
  });

  return mirrored;
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
  
  const symmetric = confirm("Symmetric?");
  if (symmetric) {
    cloned = mirror_strategy(cloned);
  }

  await saveStrategy(cloned);

  // Clone all PAMI strategies linked to the original strategy name.
  try {
    const pamiStrategies = await loadPAMIStrategies();
    const linkedPamiStrategies = pamiStrategies.filter(
      (pamiStrategy) => pamiStrategy.strategy_name === original.name
    );

    await Promise.all(
      linkedPamiStrategies.map((pamiStrategy) => {
        let copiedPamiStrategy = JSON.parse(JSON.stringify(pamiStrategy));
        copiedPamiStrategy.strategy_name = name;
        if (symmetric) {
          copiedPamiStrategy = mirror_pami_strategy(copiedPamiStrategy);
        }
        return savePamiStrategy(copiedPamiStrategy);
      })
    );
  } catch (error) {
    console.error("Strategy was branched, but cloning PAMI strategies failed:", error);
    alert("Strategy branched, but cloning PAMI strategies failed.");
  }

  strategies.push(cloned);
  renderList();
});

// PAMI CREATE
if (pamiCreateBtn) {
  pamiCreateBtn.addEventListener("click", async () => {
    let name = prompt("Enter new PAMI strategy name:");
    if (!name || !name.trim()) return;
    name = name.trim().replace(/\s+/g, "_");

    let color = prompt("azreg walla asfer (b/y)");
    color = color === "y" ? "yellow" : "blue";
    if (!name.toLowerCase().includes("blue") && !name.toLowerCase().includes("yellow")) {
      name = `${name}_${color}`;
    }

    if (pamiStrategyGroups.some((g) => g.name === name)) {
      alert("deja mawjouda");
      return;
    }

    for (let i = 1; i <= 7; i++) {
      await savePamiStrategy({
        strategy_name: name,
        pami_number: i,
        sequence: [],
        color
      });
    }

    await loadPamiStrategyNames();
  });
}

// PAMI DELETE
if (pamiDeleteBtn) {
  pamiDeleteBtn.addEventListener("click", async () => {
    if (!clickedPamiName) return;
    if (!confirm(`Delete PAMI strategy "${clickedPamiName}"?`)) return;

    await deletePamiStrategyGroup(clickedPamiName);
    await loadPamiStrategyNames();
  });
}

// PAMI BRANCH
if (pamiBranchBtn) {
  pamiBranchBtn.addEventListener("click", async () => {
    if (!clickedPamiName) return;

    let name = prompt("Enter name for the branched PAMI strategy:");
    if (!name || !name.trim()) return;
    name = name.trim().replace(/\s+/g, "_");

    if (pamiStrategyGroups.some((g) => g.name === name)) {
      alert("deja mawjouda");
      return;
    }

    const sourceGroup = pamiStrategyGroups.find((g) => g.name === clickedPamiName);
    const targetColor = sourceGroup?.color || inferPamiColorFromName(name);

    const symmetric = confirm("Symmetric?");
    const allPami = await loadPAMIStrategies();
    const linkedPamiStrategies = allPami.filter(
      (pamiStrategy) => pamiStrategy.strategy_name === clickedPamiName
    );

    if (linkedPamiStrategies.length === 0) {
      alert("No PAMI strategies found for this name");
      return;
    }

    await Promise.all(
      linkedPamiStrategies.map((pamiStrategy) => {
        let copied = JSON.parse(JSON.stringify(pamiStrategy));
        copied.strategy_name = name;
        copied.color = targetColor;
        if (symmetric) {
          copied = mirror_pami_strategy(copied);
          copied.color = targetColor;
        }
        return savePamiStrategy(copied);
      })
    );

    await loadPamiStrategyNames();
  });
}

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
loadPamiStrategyNames();
