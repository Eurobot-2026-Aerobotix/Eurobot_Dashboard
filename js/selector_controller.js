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
let activeList = "robot";

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
      activeList = "robot";
      clickedIndex = i;
      clickedPamiName = null;
      updatePamiButtons();
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
  if (pamiBtn) pamiBtn.disabled = !enabled;
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

function sortPamiStrategyGroups() {
  pamiStrategyGroups.sort((a, b) => {
    if (a.color !== b.color) return a.color === "yellow" ? -1 : 1;
    return a.order - b.order;
  });

  const lastOrder = {};
  pamiStrategyGroups.forEach((g) => {
    if (lastOrder[g.color] === undefined) {
      lastOrder[g.color] = g.order;
    } else if (g.order <= lastOrder[g.color]) {
      g.order = lastOrder[g.color] + 1;
      lastOrder[g.color] = g.order;
    } else {
      lastOrder[g.color] = g.order;
    }
  });
}

async function savePamiGroupMeta(strategyName, updater, allPami = null) {
  const source = allPami || await loadPAMIStrategies();
  const linked = source.filter((s) => s.strategy_name === strategyName);
  if (linked.length === 0) return;

  await Promise.all(
    linked.map((s) => {
      const updated = JSON.parse(JSON.stringify(s));
      updater(updated);
      return savePamiStrategy(updated);
    })
  );
}

async function persistPamiOrderSwap(nameA, orderA, nameB, orderB) {
  const allPami = await loadPAMIStrategies();
  await Promise.all([
    savePamiGroupMeta(nameA, (s) => { s.order = orderA; }, allPami),
    savePamiGroupMeta(nameB, (s) => { s.order = orderB; }, allPami)
  ]);
}

async function compactAndPersistPamiOrders(groups, allPami = null) {
  if (!Array.isArray(groups) || groups.length === 0) return groups || [];

  const normalized = groups.map((g) => ({ ...g }));

  // Keep deterministic ranking inside each color and compress to 1..N.
  const colors = ["yellow", "blue"];
  const updates = [];

  colors.forEach((color) => {
    const sameColor = normalized
      .filter((g) => g.color === color)
      .sort((a, b) => {
        if (a.order !== b.order) return a.order - b.order;
        return String(a.name).localeCompare(String(b.name));
      });

    sameColor.forEach((g, idx) => {
      const expectedOrder = idx + 1;
      if (g.order !== expectedOrder) {
        g.order = expectedOrder;
        updates.push({ name: g.name, order: expectedOrder });
      }
    });
  });

  if (updates.length > 0) {
    const source = allPami || await loadPAMIStrategies();
    await Promise.all(
      updates.map((u) => savePamiGroupMeta(u.name, (s) => { s.order = u.order; }, source))
    );
  }

  return normalized;
}

function renderPamiList() {
  if (!pamiListDivYellow || !pamiListDivBlue) return;

  sortPamiStrategyGroups();

  pamiListDivYellow.innerHTML = "";
  pamiListDivBlue.innerHTML = "";

  const yellowGroups = pamiStrategyGroups.filter((g) => g.color === "yellow");
  const blueGroups = pamiStrategyGroups.filter((g) => g.color !== "yellow");

  const renderName = (name, container) => {
    const div = document.createElement("div");
    div.className = "strategy-item";
    if (clickedPamiName === name) div.classList.add("selected");
    div.textContent = name;

    div.onclick = () => {
      activeList = "pami";
      clickedPamiName = name;
      clickedIndex = null;
      updateButtons();
      renderPamiList();
      updatePamiButtons();
    };

    div.ondblclick = () => {
      window.location.href = `pami_strategy_selector.html?name=${encodeURIComponent(name)}`;
    };

    container.appendChild(div);
  };

  yellowGroups.forEach((g) => renderName(g.name, pamiListDivYellow));
  blueGroups.forEach((g) => renderName(g.name, pamiListDivBlue));
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

  const normalizeOrder = (value) => {
    const num = Number(value);
    return Number.isFinite(num) ? num : null;
  };

  // Pick a stable order from multiple files of same strategy:
  // 1) most frequent order value across its PAMI files
  // 2) if tie, choose the smallest value
  const pickStableOrder = (orders) => {
    if (!Array.isArray(orders) || orders.length === 0) return 1;
    const freq = new Map();
    orders.forEach((o) => freq.set(o, (freq.get(o) || 0) + 1));

    let bestOrder = orders[0];
    let bestCount = freq.get(bestOrder) || 0;

    freq.forEach((count, orderVal) => {
      if (count > bestCount || (count === bestCount && orderVal < bestOrder)) {
        bestCount = count;
        bestOrder = orderVal;
      }
    });

    return bestOrder;
  };

  allPami.forEach((s) => {
    if (!s || !s.strategy_name) return;
    const order = normalizeOrder(s.order);

    if (!grouped.has(s.strategy_name)) {
      grouped.set(s.strategy_name, {
        name: s.strategy_name,
        color: s.color || inferPamiColorFromName(s.strategy_name),
        orders: order !== null ? [order] : []
      });
    } else {
      const existing = grouped.get(s.strategy_name);
      const nextOrders = existing.orders || [];
      if (order !== null) nextOrders.push(order);
      grouped.set(s.strategy_name, {
        ...existing,
        orders: nextOrders
      });
    }
  });

  let nextGroups = Array.from(grouped.values()).map((g) => ({
    name: g.name,
    color: g.color,
    order: pickStableOrder(g.orders)
  }));

  // Ensure persisted order stays contiguous and deterministic per color.
  try {
    nextGroups = await compactAndPersistPamiOrders(nextGroups, allPami);
  } catch (error) {
    console.error("Failed to compact PAMI orders:", error);
  }

  pamiStrategyGroups = nextGroups;
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

      if (action.command.includes("set_position") || action.command.includes("prepare_for_start") || action.command.includes("go_to")) {
        if (action.params.length >= 2) action.params[1] = mirrorValue(action.params[1]);
      }
      if (action.command.includes("set_position")) {
        action.params[2] = -action.params[2];
      }

      if (action.command.includes("orientate")) {
        action.params[0] = -action.params[0];
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

  const mirrorY = (value) => {
    const num = Number(value);
    if (Number.isNaN(num)) return value;
    const mirroredValue = 3000 - num;
    return typeof value === "string" ? String(mirroredValue) : mirroredValue;
  };

  const mirrorAngle = (value) => {
    const num = Number(value);
    if (Number.isNaN(num)) return value;
    const mirroredValue = -num;
    return typeof value === "string" ? String(mirroredValue) : mirroredValue;
  };

  mirrored.sequence.forEach((action) => {
    const type = action[0];

    if (type === 1) {
      // go_to: [1, x, y, ...]
      if (action.length > 2) action[2] = mirrorY(action[2]);
    } else if (type === 2) {
      // orientate: [2, angle]
      if (action.length > 1) action[1] = mirrorAngle(action[1]);
    } else if (type === 3) {
      // set_position: [3, x, y, angle]
      if (action.length > 2) action[2] = mirrorY(action[2]);
      if (action.length > 3) action[3] = mirrorAngle(action[3]);
    } else if (type === 4) {
      // bezier: [4, x1, y1, x2, y2, x3, y3, ...]
      if (action.length > 2) action[2] = mirrorY(action[2]);
      if (action.length > 4) action[4] = mirrorY(action[4]);
      if (action.length > 6) action[6] = mirrorY(action[6]);
    } else if (type === 13) {
      // rotate: [13, angle]
      if (action.length > 1) action[1] = mirrorAngle(action[1]);
    }
  });

  return mirrored;
}

// CREATE
createBtn.addEventListener("click", async () => {
  activeList = "robot";
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
if (pamiBtn) {
  pamiBtn.addEventListener("click", () => {
    if (clickedIndex === null) return;
    window.location.href = `pami_strategy_selector.html?name=${strategies[clickedIndex].name}`;
  });
}

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

    const basePamiColor = linkedPamiStrategies[0]?.color || inferPamiColorFromName(original.name);
    const targetPamiColor = symmetric
      ? (basePamiColor === "yellow" ? "blue" : "yellow")
      : basePamiColor;
    const sameColorOrders = pamiStrategies
      .filter((pamiStrategy) => {
        const color = pamiStrategy.color || inferPamiColorFromName(pamiStrategy.strategy_name);
        return color === targetPamiColor;
      })
      .map((pamiStrategy) => Number(pamiStrategy.order))
      .filter((order) => Number.isFinite(order));
    const nextOrder = sameColorOrders.length ? Math.max(...sameColorOrders) + 1 : 1;

    await Promise.all(
      linkedPamiStrategies.map((pamiStrategy) => {
        let copiedPamiStrategy = JSON.parse(JSON.stringify(pamiStrategy));
        copiedPamiStrategy.strategy_name = name;
        copiedPamiStrategy.color = targetPamiColor;
        copiedPamiStrategy.order = nextOrder;
        if (symmetric) {
          copiedPamiStrategy = mirror_pami_strategy(copiedPamiStrategy);
          copiedPamiStrategy.color = targetPamiColor;
          copiedPamiStrategy.order = nextOrder;
        }
        return savePamiStrategy(copiedPamiStrategy);
      })
    );

    await loadPamiStrategyNames();
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
    activeList = "pami";
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

    const sameColorOrders = pamiStrategyGroups
      .filter((g) => g.color === color)
      .map((g) => g.order);
    const nextOrder = sameColorOrders.length ? Math.max(...sameColorOrders) + 1 : 1;

    for (let i = 1; i <= 7; i++) {
      await savePamiStrategy({
        strategy_name: name,
        pami_number: i,
        sequence: [],
        color,
        order: nextOrder
      });
    }

    await loadPamiStrategyNames();
    clickedPamiName = name;
    renderPamiList();
    updatePamiButtons();
  });
}

// PAMI DELETE
if (pamiDeleteBtn) {
  pamiDeleteBtn.addEventListener("click", async () => {
    activeList = "pami";
    if (!clickedPamiName) return;
    if (!confirm(`Delete PAMI strategy "${clickedPamiName}"?`)) return;

    await deletePamiStrategyGroup(clickedPamiName);
    await loadPamiStrategyNames();
  });
}

// PAMI BRANCH
if (pamiBranchBtn) {
  pamiBranchBtn.addEventListener("click", async () => {
    activeList = "pami";
    if (!clickedPamiName) return;

    let name = prompt("Enter name for the branched PAMI strategy:");
    if (!name || !name.trim()) return;
    name = name.trim().replace(/\s+/g, "_");

    if (pamiStrategyGroups.some((g) => g.name === name)) {
      alert("deja mawjouda");
      return;
    }

    const symmetric = confirm("Symmetric?");
    const sourceGroup = pamiStrategyGroups.find((g) => g.name === clickedPamiName);
    const baseColor = sourceGroup?.color || inferPamiColorFromName(name);
    const targetColor = symmetric
      ? (baseColor === "yellow" ? "blue" : "yellow")
      : baseColor;
    const sameColorOrders = pamiStrategyGroups
      .filter((g) => g.color === targetColor)
      .map((g) => g.order);
    const nextOrder = sameColorOrders.length ? Math.max(...sameColorOrders) + 1 : 1;

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
        copied.order = nextOrder;
        if (symmetric) {
          copied = mirror_pami_strategy(copied);
          copied.color = targetColor;
          copied.order = nextOrder;
        }
        return savePamiStrategy(copied);
      })
    );

    await loadPamiStrategyNames();
    clickedPamiName = name;
    renderPamiList();
    updatePamiButtons();
  });
}

// -------------------------------------------------
// Arrow key handling
// -------------------------------------------------
window.addEventListener("keydown", async (e) => {
  if (busy) return;

  if (activeList === "robot" && clickedIndex !== null) {
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
    return;
  }

  if (activeList === "pami" && clickedPamiName) {
    const current = pamiStrategyGroups.find((g) => g.name === clickedPamiName);
    if (!current) return;

    const sameColor = pamiStrategyGroups
      .filter((g) => g.color === current.color)
      .sort((a, b) => a.order - b.order);
    const idxInColor = sameColor.findIndex((g) => g.name === current.name);
    if (idxInColor === -1) return;

    if (e.key === "ArrowLeft" && idxInColor > 0) {
      const prev = sameColor[idxInColor - 1];
      const currentOrder = current.order;
      const prevOrder = prev.order;

      // Optimistic UI update (same feel as robot strategies)
      current.order = prevOrder;
      prev.order = currentOrder;
      renderPamiList();
      updatePamiButtons();

      busy = true;
      try {
        await persistPamiOrderSwap(current.name, prevOrder, prev.name, currentOrder);
      } catch (error) {
        console.error("Failed to reorder PAMI strategies:", error);
        await loadPamiStrategyNames();
        clickedPamiName = current.name;
        renderPamiList();
        updatePamiButtons();
      }
      busy = false;
    }

    if (e.key === "ArrowRight" && idxInColor < sameColor.length - 1) {
      const next = sameColor[idxInColor + 1];
      const currentOrder = current.order;
      const nextOrder = next.order;

      // Optimistic UI update (same feel as robot strategies)
      current.order = nextOrder;
      next.order = currentOrder;
      renderPamiList();
      updatePamiButtons();

      busy = true;
      try {
        await persistPamiOrderSwap(current.name, nextOrder, next.name, currentOrder);
      } catch (error) {
        console.error("Failed to reorder PAMI strategies:", error);
        await loadPamiStrategyNames();
        clickedPamiName = current.name;
        renderPamiList();
        updatePamiButtons();
      }
      busy = false;
    }
  }
});

// -------------------------------------------------
// Initial load
// -------------------------------------------------
loadStrategies();
loadPamiStrategyNames();
