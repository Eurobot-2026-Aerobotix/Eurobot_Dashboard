import { Task } from "./Task.js";

export class Strategy {
  constructor(name, tasks = [], selected = false, color = "yellow") {
    this.name = name;
    this.selected =selected;
    this.color = color;
    this.tasks = tasks; // array of Task
  }

  static fromObject(o) {
    return new Strategy(
      o.name,
      o.tasks.map(Task.fromObject), 
      o.selected,
      o.color
    );
  }
}
