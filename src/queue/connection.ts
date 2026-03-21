// ---------------------------------------------------------------------------
// BullMQ connection options factory (Phase 5.1)
//
// BullMQ v5 bundles its own IORedis and accepts raw connection options.
// Passing a plain options object avoids version-mismatch type conflicts that
// arise when a separate "ioredis" package is also installed.
//
// maxRetriesPerRequest: null is required by BullMQ so IORedis does not throw
// on blocking commands (BRPOP etc.). enableReadyCheck: false is recommended
// for BullMQ worker connections.
// ---------------------------------------------------------------------------

import { config } from "../config";

export interface BullMQConnectionOptions {
  host: string;
  port: number;
  password?: string;
  username?: string;
  maxRetriesPerRequest: null;
  enableReadyCheck: boolean;
}

export function getConnectionOptions(): BullMQConnectionOptions {
  const url = new URL(config.VALKEY_URL);
  return {
    host: url.hostname,
    port: Number(url.port) || 6379,
    ...(url.password ? { password: decodeURIComponent(url.password) } : {}),
    ...(url.username ? { username: decodeURIComponent(url.username) } : {}),
    maxRetriesPerRequest: null,
    enableReadyCheck: false,
  };
}
