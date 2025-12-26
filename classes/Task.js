import { Action } from "./Action.js";

export class Task {
  constructor(description, global_goal = [0, 0, 0], sequence = []) {
    this.description = description;
    this.global_goal = global_goal;
    this.sequence = sequence; // array of Action
  }

  static fromObject(o) {
    return new Task(
      o.description,
      o.global_goal,
      o.sequence.map(Action.fromObject)
    );
  }
}
