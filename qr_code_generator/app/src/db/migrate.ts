import { Database } from "bun:sqlite";
import { drizzle } from "drizzle-orm/bun-sqlite";
import { migrate } from "drizzle-orm/bun-sqlite/migrator";
import { DB_PATH } from "../config";

const sqlite = new Database(DB_PATH);
const db = drizzle(sqlite);
migrate(db, { migrationsFolder: "src/db/migrations" });
console.log(`Migrations applied to ${DB_PATH}`);
