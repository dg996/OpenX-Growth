import { index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const posts = sqliteTable("posts", {
  id: text("id").primaryKey(),
  text: text("text").notNull(),
  threadJson: text("thread_json"),
  status: text("status", { enum:["draft","scheduled","publishing","published","failed"] }).notNull().default("draft"),
  scheduledAt: integer("scheduled_at"),
  publishedAt: integer("published_at"),
  xPostId: text("x_post_id"),
  publishedIdsJson: text("published_ids_json"),
  topic: text("topic"),
  format: text("format").notNull().default("post"),
  hook: text("hook"),
  generated: integer("generated",{mode:"boolean"}).notNull().default(false),
  evergreen: integer("evergreen",{mode:"boolean"}).notNull().default(false),
  evergreenIntervalDays: integer("evergreen_interval_days").notNull().default(30),
  attempts: integer("attempts").notNull().default(0),
  lastError: text("last_error"),
  createdAt: integer("created_at").notNull(),
  updatedAt: integer("updated_at").notNull(),
}, (table) => [index("posts_status_scheduled_idx").on(table.status,table.scheduledAt)]);

export const analyticsSnapshots = sqliteTable("analytics_snapshots", {
  id: integer("id").primaryKey({autoIncrement:true}),
  postId: text("post_id").notNull(),
  recordedAt: integer("recorded_at").notNull(),
  impressions: integer("impressions").notNull().default(0),
  likes: integer("likes").notNull().default(0),
  replies: integer("replies").notNull().default(0),
  reposts: integer("reposts").notNull().default(0),
  bookmarks: integer("bookmarks").notNull().default(0),
}, (table) => [index("analytics_post_recorded_idx").on(table.postId,table.recordedAt)]);

export const feedback = sqliteTable("feedback", {
  id: text("id").primaryKey(),
  targetType: text("target_type",{enum:["idea","reply"]}).notNull(),
  targetId: text("target_id").notNull(),
  vote: integer("vote").notNull(),
  contextJson: text("context_json"),
  createdAt: integer("created_at").notNull(),
}, (table) => [index("feedback_target_idx").on(table.targetType,table.targetId)]);

export const syncCache = sqliteTable("sync_cache", {
  key: text("key").primaryKey(),
  payload: text("payload").notNull(),
  expiresAt: integer("expires_at").notNull(),
  updatedAt: integer("updated_at").notNull(),
});

export const apiUsage = sqliteTable("api_usage", {
  day: text("day").primaryKey(),
  reads: integer("reads").notNull().default(0),
  writes: integer("writes").notNull().default(0),
  updatedAt: integer("updated_at").notNull(),
});

export const secureStore = sqliteTable("secure_store", {
  key: text("key").primaryKey(),
  sealedValue: text("sealed_value").notNull(),
  updatedAt: integer("updated_at").notNull(),
});
