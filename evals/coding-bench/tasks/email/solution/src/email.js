export function isEmail(text) {
  return /^[^\s@]+@[^\s@.]+(\.[^\s@.]+)+$/.test(text);
}
