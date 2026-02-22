import RedisModule from 'ioredis';
const Redis = RedisModule.default ?? RedisModule;

const REDIS_URL = process.env.REDIS_URL || 'redis://redis:6379';

// Regular client for commands
export const redis = new Redis(REDIS_URL);

// Separate client for pub/sub subscriber (required by ioredis)
export const redisSub = new Redis(REDIS_URL);

// Publish helper
export async function publishEvent(pollId: string, event: string, data: unknown): Promise<void> {
  const message = JSON.stringify({ event, data });
  await redis.publish(`poll:${pollId}:events`, message);
}
