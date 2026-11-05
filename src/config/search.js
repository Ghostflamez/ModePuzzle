/* Tuning for the optimizer. None of these change scores or the optimality proof;
 * they only steer how quickly good layouts are discovered. */
export const SEARCH = Object.freeze({
  /** Default time limit when the caller passes none (ms). */
  defaultLimitMs: 15000,
  /** Share of the time budget spent in the randomized heuristic before exact search. */
  heuristicShare: 0.18,
  heuristicMinMs: 30,
  heuristicMaxMs: 1800,
  /** Minimum interval between progress messages (ms). */
  progressIntervalMs: 250,
  /** Check the clock every (mask + 1) DFS nodes. */
  clockCheckMask: 255,
  /** Every Nth heuristic iteration restarts from scratch instead of repairing the best layout. */
  restartEvery: 3,
  /** Probability that a piece of the seed layout is removed during repair. */
  repairDropRate: 0.35,
  /** Probability of skipping an optional piece that lowers the heuristic fitness. */
  skipWorseRate: 0.8,
  /** Random jitter added to candidate fitness. */
  placementJitter: 0.5,
  /** Weight of the static rank when ordering pieces in a heuristic pass. */
  rankWeight: 0.3,
  /** Fitness weights: range violations dominate, secondary only breaks near-ties. */
  violationWeight: 1000,
  secondaryWeight: 0.001,
});
