export function createStock(initial) {
  const stock = new Map(Object.entries(initial));
  return {
    left: (sku) => stock.get(sku) ?? 0,
    reserve(sku, quantity) {
      stock.set(sku, (stock.get(sku) ?? 0) - quantity);
      return true;
    },
  };
}
