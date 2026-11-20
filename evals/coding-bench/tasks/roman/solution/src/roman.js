const TABLE = [[1000, 'M'], [900, 'CM'], [500, 'D'], [400, 'CD'], [100, 'C'], [90, 'XC'], [50, 'L'], [40, 'XL'], [10, 'X'], [9, 'IX'], [5, 'V'], [4, 'IV'], [1, 'I']];
export function toRoman(n) {
  if (!Number.isInteger(n) || n < 1 || n > 3999) throw new RangeError('1 to 3999');
  let out = '';
  for (const [value, symbol] of TABLE) while (n >= value) { out += symbol; n -= value; }
  return out;
}
export function fromRoman(text) {
  let n = 0, rest = String(text);
  for (const [value, symbol] of TABLE) while (rest.startsWith(symbol)) { n += value; rest = rest.slice(symbol.length); }
  if (rest || n < 1 || n > 3999 || toRoman(n) !== text) throw new Error(`invalid numeral: ${text}`);
  return n;
}
