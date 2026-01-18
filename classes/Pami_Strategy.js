export class Pami_Strategy {
  constructor(strategy_name, pami_number, sequence = []) {
    this.strategy_name = strategy_name;
    this.pami_number = pami_number;
    this.sequence = sequence;
  }

  static fromObject(o) {
    return new Pami_Strategy(
      o.strategy_name,
      o.pami_number,
      o.sequence
    );
  }
}
// 0 means go_to
// 1 means orientate
// 2 means set_position