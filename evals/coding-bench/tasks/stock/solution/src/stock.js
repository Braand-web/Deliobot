export function createStock(initial) {
  const stock = new Map(Object.entries(initial));
  return {
    left: (sku) => stock.get(sku) ?? 0,
    reserve(sku, quantity) {
      const left = stock.get(sku) ?? 0;
      if (!Number.isInteger(quantity) || quantity <= 0 || quantity > left) return false;
      stock.set(sku, left - quantity);
      return true;
    },
  };
}
