-- Anonymous usage counts (see src/usage.ts). Only aggregates: no requests, IPs or IDs are stored.
-- Apply: npx wrangler d1 execute drip-usage --remote --file usage.sql
CREATE TABLE IF NOT EXISTS usage (
  hour TEXT NOT NULL,          -- IST hour, "2026-10-24T14"
  event TEXT NOT NULL,
  dim TEXT NOT NULL DEFAULT '',
  n INTEGER NOT NULL DEFAULT 0,
  total INTEGER NOT NULL DEFAULT 0, -- sum of values (session seconds)
  PRIMARY KEY (hour, event, dim)
);
CREATE TABLE IF NOT EXISTS live (
  minute INTEGER PRIMARY KEY,  -- epoch minute
  n INTEGER NOT NULL DEFAULT 0
);
