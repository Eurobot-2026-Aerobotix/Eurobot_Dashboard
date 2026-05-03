import { Task } from "./Task.js";

export class Strategy {
  constructor(name, tasks = [], selected = false, color = "yellow", order = 0, folders = []) {
    this.name = name;
    this.selected =selected;
    this.color = color;
    this.tasks = tasks; // array of Task
    this.order = order; // maintain order of tasks
    this.folders = Array.isArray(folders) ? folders : ["default"]; // array of folder names
  }

  static fromObject(o) {
    let folders = o.folders;
    if (!folders) {
      // Backwards compatibility: if old "folder" field exists, convert to array
      folders = o.folder ? [o.folder] : ["default"];
    }
    return new Strategy(
      o.name,
      o.tasks.map(Task.fromObject), 
      o.selected,
      o.color,
      o.order,
      folders
    );
  }
}
