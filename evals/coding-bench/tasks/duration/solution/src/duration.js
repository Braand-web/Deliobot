export function parseDuration(text) {
  const compact = String(text).replace(/\s+/g, '');
  if (!/^(\d+h)?(\d+m)?(\d+s)?$/.test(compact) || compact === '') throw new Error(`not a duration: ${text}`);
  const part = (unit) => Number(new RegExp(`(\\d+)${unit}`).exec(compact)?.[1] ?? 0);
  return part('h') * 3600 + part('m') * 60 + part('s');
}
