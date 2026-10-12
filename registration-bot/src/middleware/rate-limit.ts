/** Foydalanuvchi har `windowMs` ichida ko'pi bilan `limit` ta yangilanish yuborishi mumkin. */
export function createRateLimiter(
  limit: number,
  windowMs: number,
  now: () => number = () => Date.now(),
): (userId: number) => boolean {
  const hits = new Map<number, number[]>();
  return (userId: number): boolean => {
    const t = now();
    const recent = (hits.get(userId) ?? []).filter((x) => t - x < windowMs);
    if (recent.length >= limit) {
      hits.set(userId, recent);
      return false;
    }
    recent.push(t);
    hits.set(userId, recent);
    if (hits.size > 10_000) {
      for (const [id, times] of hits) {
        if (times.every((x) => t - x >= windowMs)) hits.delete(id);
      }
    }
    return true;
  };
}
