import { Strategy } from "../classes/Strategy.js";

// Base URL of your Flask server
const BASE_URL = "http://localhost:8000/strategies";

/**
 * Load all strategies as Strategy objects
 */
export async function loadAllStrategies() {
  const res = await fetch(BASE_URL);
  if (!res.ok) throw new Error("Failed to fetch strategies");
  const files = await res.json();

  const strategies = [];
  for (const file of files) {
    const fileRes = await fetch(`${BASE_URL}/${file}`);
    if (!fileRes.ok) continue; // skip failed files
    const data = await fileRes.json();
    strategies.push(Strategy.fromObject(data));
  }

  return strategies;
}

/**
 * Create or update a strategy
 * @param {string} filename - e.g., "myStrategy.yaml"
 * @param {Strategy} strategy - Strategy object to save
 */
export async function saveStrategy(strategy) {
  const res = await fetch(`${BASE_URL}/${strategy.name}.yaml`, {
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
  const res = await fetch(`${BASE_URL}/${filename}`, {
    method: "DELETE",
  });

  if (!res.ok) throw new Error("Failed to delete strategy");
  return await res.json();
}

/**
 * Update a strategy (overwrite)
 * @param {string} filename - e.g., "myStrategy.yaml"
 * @param {Strategy} strategy - Strategy object to update
 */
export async function updateStrategy(strategy) {
  // saveStrategy works for both create and update
  return await saveStrategy(strategy);
}
