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

// Fetch with timeout to prevent hanging when multiple windows open
async function fetchWithTimeout(url, timeout = 10000) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeout);
  
  try {
    const response = await fetch(url, { signal: controller.signal });
    clearTimeout(timeoutId);
    return response;
  } catch (error) {
    clearTimeout(timeoutId);
    if (error.name === 'AbortError') {
      throw new Error('Request timeout - server may be busy with other windows');
    }
    throw error;
  }
}

/**
 * Load all strategies as Strategy objects
 * Uses parallel fetching for better performance with multiple windows
 */
export async function loadAllStrategies() {
  const res = await fetchWithTimeout(STRATEGY_BASE_URL);
  if (!res.ok) throw new Error("Failed to fetch strategies");
  const files = await res.json();

  // Fetch all files in parallel instead of sequentially
  const fetchPromises = files.map(async (file) => {
    try {
      const fileRes = await fetchWithTimeout(`${STRATEGY_BASE_URL}/${file}`);
      if (!fileRes.ok) return null; // skip failed files
      const data = await fileRes.json();
      return Strategy.fromObject(data);
    } catch (error) {
      console.warn(`Failed to load strategy ${file}:`, error.message);
      return null; // skip failed files
    }
  });

  const results = await Promise.all(fetchPromises);
  return results.filter(s => s !== null); // remove failed loads
}

export async function loadPAMIStrategies() {
  const res = await fetchWithTimeout(PAMI_STRATEGY_BASE_URL);
  if (!res.ok) throw new Error("Failed to fetch strategies");
  const files = await res.json();

  // Fetch all files in parallel instead of sequentially
  const fetchPromises = files.map(async (file) => {
    try {
      const fileRes = await fetchWithTimeout(`${PAMI_STRATEGY_BASE_URL}/${file}`);
      if (!fileRes.ok) return null; // skip failed files
      const data = await fileRes.json();
      return Pami_Strategy.fromObject(data);
    } catch (error) {
      console.warn(`Failed to load PAMI strategy ${file}:`, error.message);
      return null; // skip failed files
    }
  });

  const results = await Promise.all(fetchPromises);
  return results.filter(s => s !== null); // remove failed loads
}


/**
 * Create or update a strategy
 * @param {string} filename - e.g., "myStrategy.yaml"
 * @param {Strategy} strategy - Strategy object to save
 */
export async function saveStrategy(strategy) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 10000);
  
  try {
    const res = await fetch(`${STRATEGY_BASE_URL}/${strategy.name}.yaml`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(strategy),
      signal: controller.signal
    });
    clearTimeout(timeoutId);

    if (!res.ok) throw new Error("Failed to save strategy");
    return await res.json();
  } catch (error) {
    clearTimeout(timeoutId);
    if (error.name === 'AbortError') {
      throw new Error('Save timeout - server may be busy');
    }
    throw error;
  }
}

/**
 * Create or update a pami strategy
 * @param {string} filename - e.g., "myStrategy.yaml"
 * @param {Strategy} strategy - Strategy object to save
 */
export async function savePamiStrategy(strategy) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 10000);
  
  try {
    const res = await fetch(`${PAMI_STRATEGY_BASE_URL}/${strategy.strategy_name}/${strategy.pami_number}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(strategy),
      signal: controller.signal
    });
    clearTimeout(timeoutId);

    if (!res.ok) throw new Error("Failed to save strategy");
    return await res.json();
  } catch (error) {
    clearTimeout(timeoutId);
    if (error.name === 'AbortError') {
      throw new Error('Save timeout - server may be busy');
    }
    throw error;
  }
}

/**
 * Delete a strategy file
 * @param {string} filename - e.g., "myStrategy.yaml"
 */
export async function deleteStrategy(filename) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 10000);
  
  try {
    const res = await fetch(`${STRATEGY_BASE_URL}/${filename}`, {
      method: "DELETE",
      signal: controller.signal
    });
    clearTimeout(timeoutId);

    if (!res.ok) throw new Error("Failed to delete strategy");
    return await res.json();
  } catch (error) {
    clearTimeout(timeoutId);
    if (error.name === 'AbortError') {
      throw new Error('Delete timeout - server may be busy');
    }
    throw error;
  }
}

async function calculate_global_poses(strategy) {
  if (!strategy || !strategy.tasks) return;

  // Track position across tasks
  let globalLastX = 0;
  let globalLastY = 0;

  // First pass: calculate theta and position from movement commands
  strategy.tasks.forEach(task => {
    let lastX = null;
    let lastY = null;
    let lastTheta = null;
    let lastMoveIndex = -1;

    // Use global position tracker as starting point for this task
    let prevX = globalLastX;
    let prevY = globalLastY;

    // First, find the last movement command
    for (let i = task.sequence.length - 1; i >= 0; i--) {
      const action = task.sequence[i];

      if (action.command.includes("go_to")) {
        const [x, y] = action.params; // (x, y, speed)
        lastX = x;
        lastY = y;

        // Find previous position by looking backward in CURRENT task
        let foundPrevInTask = false;
        for (let j = i - 1; j >= 0; j--) {
          const prevAction = task.sequence[j];
          if (prevAction.command.includes("go_to")) {
            prevX = prevAction.params[0];
            prevY = prevAction.params[1];
            foundPrevInTask = true;
            break;
          } else if (prevAction.command.includes("bezier")) {
            prevX = prevAction.params[4]; // x3
            prevY = prevAction.params[5]; // y3
            foundPrevInTask = true;
            break;
          } else if (prevAction.command.includes("set_position")) {
            prevX = prevAction.params[0];
            prevY = prevAction.params[1];
            foundPrevInTask = true;
            break;
          }
        }
        // If not found in current task, prevX/prevY already has globalLastX/Y

        // Calculate travel direction
        let travelTheta = Math.atan2(y - prevY, x - prevX)*180/3.1415926535897932384626;
        
        // For backward movement, robot faces opposite direction
        if (action.command === "go_to_backwards") {
          lastTheta = travelTheta + 180;
          // Normalize to [-180, 180]
          if (lastTheta > 180) lastTheta -= 360;
          if (lastTheta < -180) lastTheta += 360;
        } else {
          lastTheta = travelTheta;
        }
        
        lastMoveIndex = i;
        break;

      } else if (action.command.includes("bezier")) {
        const [x1, y1, x2, y2, x3, y3] = action.params;
        lastX = x3;
        lastY = y3;

        // Previous point for theta = x2, y2
        let travelTheta = Math.atan2(y3 - y2, x3 - x2)*180/3.1415926535897932384626;
        
        // For backward movement, robot faces opposite direction
        if (action.command === "bezier_backwards") {
          lastTheta = travelTheta + 180;
          // Normalize to [-180, 180]
          if (lastTheta > 180) lastTheta -= 360;
          if (lastTheta < -180) lastTheta += 360;
        } else {
          lastTheta = travelTheta;
        }
        
        lastMoveIndex = i;
        break;

      } else if (action.command.includes("set_position")) {
        // Update position for this task
        prevX = action.params[0];
        prevY = action.params[1];
      }
    }

    // Check for orientate command ANYWHERE in the sequence after last movement
    // This handles tasks with NO movement but WITH orientate
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

    // Update global position tracker for next task
    if (lastX != null) {
      globalLastX = lastX;
      globalLastY = lastY;
    }
  });
  
  // Second pass: inherit from previous task if needed
  strategy.tasks.forEach((task, i) => {
    if (i > 0) {
      const prevGoal = strategy.tasks[i - 1].global_goal;
      
      // Inherit position if current task has null position
      if (task.global_goal.x == null && prevGoal.x != null) {
        task.global_goal.x = prevGoal.x;
        task.global_goal.y = prevGoal.y;
      }
      
      // Inherit theta if current task has null theta
      if (task.global_goal.theta == null && prevGoal.theta != null) {
        task.global_goal.theta = prevGoal.theta;
      }
    }
  });
}

export async function updateStrategy(strategy) {
  await calculate_global_poses(strategy);
  console.log("Updated strategy:", strategy);
  // saveStrategy works for both create and update
  return await saveStrategy(strategy);
}
