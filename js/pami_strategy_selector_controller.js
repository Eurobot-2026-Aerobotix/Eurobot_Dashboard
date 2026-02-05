import {loadPAMIStrategies , savePamiStrategy} from "./file_handler.js"; // your API functions

// HTML elements
let pamiBtns = document.querySelectorAll(".square");
const menu = document.getElementById("pami-context-menu");
let menuCloseTimeout = null;
let context_strategy_number = null;

const params = new URLSearchParams(window.location.search);

window.addEventListener("pageshow", (e) => {
  if (sessionStorage.getItem("refreshOnce")) {
    sessionStorage.removeItem("refreshOnce");
    location.reload();
  }
});

async function fillPamiMenu(menu, index) {
  const strategies = await loadPAMIStrategies();
  const header = document.createElement("div");
  header.className = "menu-header";
  header.innerText = `clone from :`;
  menu.appendChild(header);
  strategies.forEach((strategy, i) => {
    const item = document.createElement("div");
    item.className = "menu-item";
    item.innerText = `${strategy.strategy_name} PAMI ${strategy.pami_number}`;
    item.addEventListener("click", async () => {
      if (context_strategy_number === null) return;

      try {
        const copied = JSON.parse(JSON.stringify(strategy));
        copied.pami_number = context_strategy_number + 1;
        copied.strategy_name = params.get("name");
        savePamiStrategy(copied);
        hideMenu();
      } catch (err) {
        console.error("Failed to copy strategy:", err);
      }
    });
    menu.appendChild(item);
  });
}

// -------------------------------------------------
// Initial load
// -------------------------------------------------
function showMenu(x, y, index) {
  menu.innerHTML = ""; // will be filled later by your function
  fillPamiMenu(menu, index); // <- YOU will define this later

  menu.style.left = `${x}px`;
  menu.style.top = `${y}px`;
  menu.classList.remove("hidden");
}

function hideMenu() {
  menu.classList.add("hidden");
  context_strategy_number = null;
}

for (let i = 0; i < pamiBtns.length; i++) {
  pamiBtns[i].addEventListener("click", () => {
    window.location.href =`pami_strategy_viewer.html?pami=${i + 1}&name=${params.get("name")}`;
  });

  pamiBtns[i].addEventListener("contextmenu", (e) => {
    e.preventDefault(); // stop browser menu
    context_strategy_number = i;
    showMenu(e.pageX, e.pageY, i);
  });

}
document.getElementById("current-strategy").innerText = "pamiyeet " + (params.get("name") || "-");
document.addEventListener("click", (e) => {
  if (!menu.contains(e.target)) {
    hideMenu();
  }
});
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") hideMenu();
});

function distanceFromMenu(x, y) {
  const rect = menu.getBoundingClientRect();

  const cx = Math.max(rect.left, Math.min(x, rect.right));
  const cy = Math.max(rect.top,  Math.min(y, rect.bottom));

  const dx = x - cx;
  const dy = y - cy;

  return Math.sqrt(dx * dx + dy * dy);
}
document.addEventListener("mousemove", (e) => {
  if (menu.classList.contains("hidden")) return;

  const dist = distanceFromMenu(e.clientX, e.clientY);

  if (dist > 200) {
    if (!menuCloseTimeout) {
      menuCloseTimeout = setTimeout(() => {
        hideMenu();
        menuCloseTimeout = null;
      }, 150);
    }
  } else {
    clearTimeout(menuCloseTimeout);
    menuCloseTimeout = null;
  }
});