export class Action {
  constructor(device, command, params = [], wait = false) {
    this.device = device;
    this.command = command;
    this.params = params;
    this.wait = wait;
  }

  static fromObject(o) {
    return new Action(o.device, o.command, o.params, o.wait);
  }
}
