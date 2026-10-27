import "server-only";
import bcrypt from "bcryptjs";
import { env } from "../env";

export const PASSWORD_MIN_LENGTH = 10;

const cost = () => env().PASSWORD_HASH_COST;

export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, cost());
}

export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  return bcrypt.compare(password, hash);
}

/** True when a stored hash uses a different work factor than configured, so it should be re-hashed at sign-in. */
export function needsRehash(hash: string): boolean {
  try {
    return bcrypt.getRounds(hash) !== cost();
  } catch {
    return false;
  }
}

// A fixed hash used to keep login timing the same whether or not the email exists.
let dummyHash: Promise<string> | null = null;

export async function burnPasswordCheck(password: string): Promise<void> {
  dummyHash ??= bcrypt.hash("not-a-real-password", cost());
  await bcrypt.compare(password, await dummyHash);
}
