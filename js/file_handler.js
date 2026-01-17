import { Pami_Strategy } from "../classes/Pami_Strategy.js";
import { Strategy } from "../classes/Strategy.js";

// Base URL of your Flask server
// Use smart IP configuration
const getStrategiesBaseURL = () => {
    if (!window.ipConfig) {
        console.warn('ipConfig not loaded, using fallback URL');
        return 'http://10.42.0.1:8000/strategies';
    }
    return `${window.ipConfig.getAPIURL()}/strategies`;
};

const STRATEGY_BASE_URL = getStrategiesBaseURL();

const getPamiStrategiesBaseURL = () => {
    if (!window.ipConfig) {
        console.warn('ipConfig not loaded, using fallback URL');
        return 'http://10.42.0.1:8000/pami_strategies';
    }
    return `${window.ipConfig.getAPIURL()}/pami_strategies`;
};

const PAMI_STRATEGY_BASE_URL = getPamiStrategiesBaseURL();

/**
 * Load all strategies as Strategy objects
 */
export async function loadAllStrategies() {
  const res = await fetch(STRATEGY_BASE_URL);
  if (!res.ok) throw new Error("Failed to fetch strategies");
  const files = await res.json();

  const strategies = [];
  for (const file of files) {
    const fileRes = await fetch(`${STRATEGY_BASE_URL}/${file}`);
    if (!fileRes.ok) continue; // skip failed files
    const data = await fileRes.json();
    strategies.push(Strategy.fromObject(data));
  }

  return strategies;
}

export async function loadPAMIStrategies() {
  const res = await fetch(PAMI_STRATEGY_BASE_URL);
  if (!res.ok) throw new Error("Failed to fetch strategies");
  const files = await res.json();

  const strategies = [];
  for (const file of files) {
    const fileRes = await fetch(`${PAMI_STRATEGY_BASE_URL}/${file}`);
    if (!fileRes.ok) continue; // skip failed files
    const data = await fileRes.json();
    strategies.push(Pami_Strategy.fromObject(data));
  }

  return strategies;
}


/**
 * Create or update a strategy
 * @param {string} filename - e.g., "myStrategy.yaml"
 * @param {Strategy} strategy - Strategy object to save
 */
export async function saveStrategy(strategy) {
  const res = await fetch(`${STRATEGY_BASE_URL}/${strategy.name}.yaml`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(strategy),
  });

  if (!res.ok) throw new Error("Failed to save strategy");
  return await res.json();
}

/**
 * Delete a strategy file
 * @param {string} filename - e.g., "myStrategy.yaml"
 */
export async function deleteStrategy(filename) {
  const res = await fetch(`${STRATEGY_BASE_URL}/${filename}`, {
    method: "DELETE",
  });

  if (!res.ok) throw new Error("Failed to delete strategy");
  return await res.json();
}

async function calculate_global_poses(strategy) {
  if (!strategy || !strategy.tasks) return;

  strategy.tasks.forEach(task => {
    let lastX = null;
    let lastY = null;
    let lastTheta = null;
    let lastMoveIndex = -1;

    // Track the last known position for theta calculation
    let prevX = 0;
    let prevY = 0;

    // First, find the last movement command
    for (let i = task.sequence.length - 1; i >= 0; i--) {
      const action = task.sequence[i];

      if (action.command.includes("go_to")) {
        const [x, y] = action.params; // (x, y, speed)
        lastX = x;
        lastY = y;

        // Find previous position by looking backward
        for (let j = i - 1; j >= 0; j--) {
          const prevAction = task.sequence[j];
          if (prevAction.command.includes("go_to")) {
            prevX = prevAction.params[0];
            prevY = prevAction.params[1];
            break;
          } else if (prevAction.command.includes("bezier")) {
            prevX = prevAction.params[4]; // x3
            prevY = prevAction.params[5]; // y3
            break;
          } else if (prevAction.command.includes("set_position")) {
            prevX = prevAction.params[0];
            prevY = prevAction.params[1];
            break;
          }
        }

        lastTheta = Math.atan2(y - prevY, x - prevX)*180/3.1415926535897932384626;
        lastMoveIndex = i;
        break;

      } else if (action.command.includes("bezier")) {
        const [x1, y1, x2, y2, x3, y3] = action.params;
        lastX = x3;
        lastY = y3;

        // Previous point for theta = x2, y2
        lastTheta = Math.atan2(y3 - y2, x3 - x2)*180/3.1415926535897932384626;
        lastMoveIndex = i;
        break;

      } else if (action.command.includes("set_position")) {
        // Could be used for prevX / prevY for next go_to
        prevX = action.params[0];
        prevY = action.params[1];
      }
    }

    // Check for orientate after last movement
    for (let i = lastMoveIndex + 1; i < task.sequence.length; i++) {
      const action = task.sequence[i];
      if (action.command.includes("orientate")) {
        const [theta] = action.params;
        lastTheta = theta;
        break;
      }
    }

    task.global_goal = {
      x: lastX,
      y: lastY,
      theta: lastTheta
    };
  });
  strategy.tasks.forEach((task, i) => {
  if (task.global_goal && task.global_goal.x == null && i > 0) {
      // Copy global_goal from previous task
      const prevGoal = strategy.tasks[i - 1].global_goal;
      task.global_goal = {
        x: prevGoal.x,
        y: prevGoal.y,
        theta: prevGoal.theta
      };
    }
  });
}

export async function updateStrategy(strategy) {
  await calculate_global_poses(strategy);
  console.log("Updated strategy:", strategy);
  // saveStrategy works for both create and update
  return await saveStrategy(strategy);
}
