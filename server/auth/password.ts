import { createHash, randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
const derive = promisify(scrypt);
export const hash = (value: string) => createHash('sha256').update(value).digest('hex');
export async function passwordHash(value: string): Promise<string> {
  const salt = randomBytes(16).toString('hex');
  return `${salt}:${((await derive(value, salt, 64)) as Buffer).toString('hex')}`;
}
export async function verifyPassword(value: string, stored: unknown): Promise<boolean> {
  if (typeof stored !== 'string' || !/^[a-f0-9]{32}:[a-f0-9]{128}$/.test(stored)) return false;
  const [salt, digest] = stored.split(':');
  return timingSafeEqual(Buffer.from(digest!, 'hex'), (await derive(value, salt!, 64)) as Buffer);
}
