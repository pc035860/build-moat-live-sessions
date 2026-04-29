import { sql } from "drizzle-orm";
import { index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const urlMappings = sqliteTable("url_mappings", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  token: text("token").notNull().unique(),
  originalUrl: text("original_url").notNull(),
  createdAt: integer("created_at", { mode: "timestamp_ms" })
    .notNull()
    .default(sql`(unixepoch() * 1000)`),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" })
    .notNull()
    .default(sql`(unixepoch() * 1000)`)
    .$onUpdate(() => new Date()),
  expiresAt: integer("expires_at", { mode: "timestamp_ms" }),
  isDeleted: integer("is_deleted", { mode: "boolean" }).notNull().default(false),
});

export const scanEvents = sqliteTable(
  "scan_events",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    token: text("token").notNull(),
    scannedAt: integer("scanned_at", { mode: "timestamp_ms" })
      .notNull()
      .default(sql`(unixepoch() * 1000)`),
    userAgent: text("user_agent"),
    ipAddress: text("ip_address"),
  },
  (table) => ({
    tokenScannedAtIdx: index("scan_events_token_scanned_at_idx").on(table.token, table.scannedAt),
  }),
);

export type UrlMapping = typeof urlMappings.$inferSelect;
export type NewUrlMapping = typeof urlMappings.$inferInsert;
export type ScanEvent = typeof scanEvents.$inferSelect;
export type NewScanEvent = typeof scanEvents.$inferInsert;
