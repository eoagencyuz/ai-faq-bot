import fs from 'node:fs';
import path from 'node:path';

export class InstanceLockError extends Error {}

function defaultIsAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return (err as NodeJS.ErrnoException).code === 'EPERM';
  }
}

/**
 * Polling rejimida bir vaqtda faqat bitta instance ishlashini ta'minlaydi.
 * Qaytaradigan funksiya qulfni bo'shatadi.
 */
export function acquireInstanceLock(
  lockFile: string,
  pid: number = process.pid,
  isAlive: (pid: number) => boolean = defaultIsAlive,
): () => void {
  fs.mkdirSync(path.dirname(lockFile), { recursive: true });

  const create = () => {
    const fd = fs.openSync(lockFile, 'wx');
    fs.writeSync(fd, String(pid));
    fs.closeSync(fd);
  };

  try {
    create();
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'EEXIST') throw err;
    const other = Number(fs.readFileSync(lockFile, 'utf8').trim());
    if (Number.isInteger(other) && other > 0 && other !== pid && isAlive(other)) {
      throw new InstanceLockError(`Bot allaqachon ishlayapti (PID ${other}). Ikkinchi nusxa ishga tushmaydi.`);
    }
    // Eski (o'chib qolgan jarayon) qulfi
    fs.rmSync(lockFile, { force: true });
    create();
  }

  let released = false;
  return () => {
    if (released) return;
    released = true;
    try {
      if (Number(fs.readFileSync(lockFile, 'utf8').trim()) === pid) fs.rmSync(lockFile, { force: true });
    } catch {
      // qulf fayli allaqachon yo'q
    }
  };
}
