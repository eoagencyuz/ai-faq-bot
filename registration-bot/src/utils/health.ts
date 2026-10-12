import http from 'node:http';
import type { Logger } from './logger.js';

/** Render kabi hostinglar servis HTTP portni tinglashini talab qiladi; bot o'zi polling bilan ishlaydi. */
export function startHealthServer(port: number, logger: Logger): http.Server {
  const server = http.createServer((_req, res) => {
    res.writeHead(200, { 'content-type': 'text/plain; charset=utf-8' });
    res.end('ok');
  });
  server.listen(port, '0.0.0.0', () => logger.info({ port }, 'Health-server ishga tushdi'));
  return server;
}

/** Bepul hostinglar so'rovsiz qolgan servisni uxlatadi — o'z manzilimizga vaqti-vaqti bilan murojaat qilamiz. */
export function startKeepAlive(url: string, intervalMs: number, logger: Logger): NodeJS.Timeout {
  return setInterval(() => {
    fetch(url, { signal: AbortSignal.timeout(20_000) }).catch((err: unknown) => {
      logger.warn({ err: err instanceof Error ? err.name : 'error' }, 'Keep-alive so\'rovi muvaffaqiyatsiz');
    });
  }, intervalMs);
}
