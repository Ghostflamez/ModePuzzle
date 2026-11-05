// Deterministic search budget for tests: a counting clock instead of wall time, so
// results (and "proven") do not depend on machine load. Timeout tests use their own clocks.
export function steady() {
  let tick = 0;
  return {limitMs: 1e12, now: () => tick++};
}
