export function paginate(items, page, size) {
  const start = (page - 1) * size;
  return { items: items.slice(start, start + size), pages: Math.ceil(items.length / size) };
}
