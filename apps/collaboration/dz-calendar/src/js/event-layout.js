/**
 * Column layout for overlapping timed events (week / day views).
 *
 * Events are grouped into "clusters" of transitively-overlapping items; within
 * a cluster each event is greedily assigned the first free column, and every
 * event in the cluster is given the cluster's total column count so the view
 * can render them side by side with equal widths and no overlap.
 *
 * Input events need numeric `start` and `end` (epoch ms). Output preserves the
 * original event object and adds `colIndex` (0-based) and `colCount`.
 */
export function layoutColumns(events) {
  const items = events
    .map((event) => ({
      event,
      start: event.start,
      // Guarantee positive duration so zero-length events still take a column.
      end: Math.max(event.end, event.start + 1),
      colIndex: 0,
      colCount: 1,
    }))
    .sort((a, b) => a.start - b.start || b.end - a.end);

  let cluster = [];
  let columnEnds = []; // last end time per active column
  let clusterEnd = -Infinity;

  const flush = () => {
    const colCount = Math.max(columnEnds.length, 1);
    for (const it of cluster) it.colCount = colCount;
    cluster = [];
    columnEnds = [];
    clusterEnd = -Infinity;
  };

  for (const it of items) {
    // A new event that starts at/after everything so far begins a new cluster.
    if (cluster.length && it.start >= clusterEnd) flush();

    let placed = false;
    for (let c = 0; c < columnEnds.length; c++) {
      if (columnEnds[c] <= it.start) {
        columnEnds[c] = it.end;
        it.colIndex = c;
        placed = true;
        break;
      }
    }
    if (!placed) {
      it.colIndex = columnEnds.length;
      columnEnds.push(it.end);
    }

    cluster.push(it);
    clusterEnd = Math.max(clusterEnd, it.end);
  }
  flush();

  return items.map(({ event, colIndex, colCount }) => ({
    event,
    colIndex,
    colCount,
  }));
}

/**
 * Split events into "all-day / multi-day" vs "timed" for a given day, and clip
 * timed spans to that day's [dayStart, dayEnd] window.
 */
export function splitDayEvents(events, dayStart, dayEnd) {
  const allDay = [];
  const timed = [];
  for (const ev of events) {
    // ">= 24h of real time" alone misroutes on the DST fall-back day: that day
    // is 25 wall-clock hours, so a timed event covering most of it (e.g.
    // 00:00–23:45, 24¾ real hours) is still a SAME-day event and belongs on
    // the hour grid. Only a span that also escapes this day's window reads as
    // "a day or more".
    const withinDay = ev.start >= dayStart && ev.end <= dayEnd;
    if (ev.allDay || (ev.end - ev.start >= 24 * 3600_000 && !withinDay)) {
      allDay.push(ev);
    } else {
      timed.push({
        ...ev,
        start: Math.max(ev.start, dayStart),
        end: Math.min(ev.end, dayEnd),
      });
    }
  }
  return { allDay, timed };
}
