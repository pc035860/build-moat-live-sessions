import { Database } from "bun:sqlite";
import { drizzle } from "drizzle-orm/bun-sqlite";
import { DB_PATH } from "../config";
import * as schema from "./schema";

export function createDb(path: string) {
  const sqlite = new Database(path);
  return drizzle(sqlite, { schema });
}

export type DB = ReturnType<typeof createDb>;

export const db = createDb(DB_PATH);
