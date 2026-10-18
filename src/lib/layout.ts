export interface Span {
  start: number;
  end: number;
}

export interface Lane {
  lane: number;
  lanes: number;
}

/**
 * Puts overlapping items side by side. Items in the same overlapping cluster
 * share a lane count so they get equal widths.
 */
export function layoutLanes(spans: Span[]): Lane[] {
  const order = spans.map((_, i) => i).sort((a, b) => spans[a].start - spans[b].start || spans[a].end - spans[b].end);
  const result: Lane[] = spans.map(() => ({ lane: 0, lanes: 1 }));

  let cluster: number[] = [];
  let clusterEnd = -Infinity;
  const laneEnds: number[] = [];

  const closeCluster = () => {
    for (const i of cluster) result[i].lanes = laneEnds.length;
    cluster = [];
    laneEnds.length = 0;
  };

  for (const i of order) {
    if (spans[i].start >= clusterEnd) closeCluster();
    let lane = laneEnds.findIndex((end) => end <= spans[i].start);
    if (lane === -1) lane = laneEnds.length;
    laneEnds[lane] = spans[i].end;
    result[i].lane = lane;
    cluster.push(i);
    clusterEnd = Math.max(clusterEnd, spans[i].end);
  }
  closeCluster();
  return result;
}
