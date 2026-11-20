export function overlaps(a, b) {
  return (a.start >= b.start && a.start <= b.end) || (a.end >= b.start && a.end <= b.end);
}
