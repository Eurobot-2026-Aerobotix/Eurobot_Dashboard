import { Task } from "./Task.js";

export class Strategy {
  constructor(name, tasks = [], selected = false, color = "yellow", order = 0) {
    this.name = name;
    this.selected =selected;
    this.color = color;
    this.tasks = tasks; // array of Task
    this.order = order; // maintain order of tasks
  }

  static fromObject(o) {
    return new Strategy(
      o.name,
      o.tasks.map(Task.fromObject), 
      o.selected,
      o.color,
      o.order
    );
  }
}
