export function paginate(items, page, size) {
  const start = page * size;
  return { items: items.slice(start, start + size), pages: Math.floor(items.length / size) };
}
