// ---------- Person code (national id / QR) helpers ----------

/** Random readable person code (used when the person has no real national id), e.g. P-4F7K9Q2M */
export const generatePersonCode = () => {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let s = '';
  for (let i = 0; i < 8; i++) s += chars[Math.floor(Math.random() * chars.length)];
  return `P-${s}`;
};
