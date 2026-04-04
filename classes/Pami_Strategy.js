export class Pami_Strategy {
  constructor(strategy_name, pami_number, sequence = [], color = null, order = 0) {
    this.strategy_name = strategy_name;
    this.pami_number = pami_number;
    this.sequence = sequence;
    this.color = color || Pami_Strategy.inferColorFromName(strategy_name);
    this.order = Number.isFinite(Number(order)) ? Number(order) : 0;
  }

  static inferColorFromName(strategyName) {
    const low = String(strategyName || "").toLowerCase();
    if (low.includes("yellow") || low.includes("jaune") || low.includes("asfer")) {
      return "yellow";
    }
    if (low.includes("blue") || low.includes("azreg")) {
      return "blue";
    }
    return "blue";
  }

  static fromObject(o) {
    return new Pami_Strategy(
      o.strategy_name,
      o.pami_number,
      o.sequence,
      o.color,
      o.order
    );
  }
}
// 0 means go_to
// 1 means orientate
// 2 means set_position