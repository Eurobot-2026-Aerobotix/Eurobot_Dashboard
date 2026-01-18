import { loadAllStrategies, deleteStrategy, saveStrategy, updateStrategy } from "./file_handler.js"; // your API functions
import { Strategy } from "../classes/Strategy.js";
import { Task } from "../classes/Task.js";
import { Action } from "../classes/Action.js";

// HTML elements
let pamiBtns = document.querySelectorAll(".square");


window.addEventListener("pageshow", (e) => {
  if (sessionStorage.getItem("refreshOnce")) {
    sessionStorage.removeItem("refreshOnce");
    location.reload();
  }
});

// -------------------------------------------------
// Initial load
// -------------------------------------------------
const params = new URLSearchParams(window.location.search);
for (let i = 0; i < pamiBtns.length; i++) {
  pamiBtns[i].addEventListener("click", () => {
    window.location.href =`pami_strategy_viewer.html?pami=${i + 1}&name=${params.get("name")}`;
  });
}
document.getElementById("current-strategy").innerText = "pamiyeet " + (params.get("name") || "-");