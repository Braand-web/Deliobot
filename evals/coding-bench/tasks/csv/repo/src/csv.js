export function parseCsv(text) {
  return text.trim().split('\n').map((line) => line.split(','));
}
