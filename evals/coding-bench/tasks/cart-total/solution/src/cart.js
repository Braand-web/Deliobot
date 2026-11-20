export function total(items, discountPercent = 0) {
  let sum = 0;
  for (const item of items) sum += item.price * item.quantity;
  return Math.round(sum * (1 - discountPercent / 100) * 100) / 100;
}
