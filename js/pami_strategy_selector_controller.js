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
  strategies.sort((a, b) => a.strategy_name.localeCompare(b.strategy_name));
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

// Cache array length for performance
const pamiBtnsLength = pamiBtns.length;
for (let i = 0; i < pamiBtnsLength; i++) {
  // Check if this is the ALL square
  if (pamiBtns[i].classList.contains('all-square')) {
    pamiBtns[i].addEventListener("click", () => {
      // Open with all PAMIs visible
      window.location.href = `pami_strategy_viewer.html?pami=1&name=${params.get("name")}&viewAll=true`;
    });
    
    // No context menu for ALL square
    pamiBtns[i].addEventListener("contextmenu", (e) => {
      e.preventDefault();
    });
    continue;
  }
  
  // Check if this is the TEST square
  if (pamiBtns[i].classList.contains('test-square')) {
    pamiBtns[i].addEventListener("click", () => {
      // Save the current strategy path for testing
      const strategyName = params.get("name");
      const testPath = `strategies/${strategyName}.yaml`;
      
      // Save to localStorage
      localStorage.setItem('pami_test_strategy_path', testPath);
      localStorage.setItem('pami_test_strategy_name', strategyName);
      
      // Visual feedback
      pamiBtns[i].style.transform = 'scale(0.95)';
      pamiBtns[i].style.opacity = '0.7';
      setTimeout(() => {
        pamiBtns[i].style.transform = '';
        pamiBtns[i].style.opacity = '';
      }, 200);
      
      alert(`Test strategy set to: ${strategyName}`);
    });
    
    // No context menu for TEST square
    pamiBtns[i].addEventListener("contextmenu", (e) => {
      e.preventDefault();
    });
    continue;
  }
  
  // Regular PAMI squares - also open with multi-PAMI view
  const pamiNumber = i - 1; // Adjusted because of ALL and TEST squares
  pamiBtns[i].addEventListener("click", () => {
    // Open with PAMI selector visible, this PAMI selected by default
    window.location.href =`pami_strategy_viewer.html?pami=${pamiNumber}&name=${params.get("name")}`;
  });

  pamiBtns[i].addEventListener("contextmenu", (e) => {
    e.preventDefault(); // stop browser menu
    context_strategy_number = pamiNumber - 1;
    showMenu(e.pageX, e.pageY, pamiNumber - 1);
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

// Throttle mousemove for performance
let lastMouseMoveCheck = 0;
const mouseMoveThrottle = 100; // Check every 100ms

document.addEventListener("mousemove", (e) => {
  if (menu.classList.contains("hidden")) return;
  
  // Throttle to reduce CPU usage
  const now = Date.now();
  if (now - lastMouseMoveCheck < mouseMoveThrottle) return;
  lastMouseMoveCheck = now;

  const dist = distanceFromMenu(e.clientX, e.clientY);

  if (dist > 200) {
    if (!menuCloseTimeout) {
      menuCloseTimeout = setTimeout(() => {
        hideMenu();
        menuCloseTimeout = null;
      }, 150);
    }
  } else {
    if (menuCloseTimeout) {
      clearTimeout(menuCloseTimeout);
      menuCloseTimeout = null;
    }
  }
});