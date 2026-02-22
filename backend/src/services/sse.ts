import Redis from 'ioredis';

const REDIS_URL = process.env.REDIS_URL || 'redis://redis:6379';

const pollSubscribers = new Map<string, {
  refCount: number;
  handlers: Set<(message: string) => void>;
  subscriber: Redis;
}>();

export function subscribeToPoll(
  pollId: string,
  handler: (message: string) => void
): () => void {
  const channel = `poll:${pollId}:events`;
  let entry = pollSubscribers.get(pollId);

  if (!entry) {
    const subscriber = new Redis(REDIS_URL);
    entry = { refCount: 0, handlers: new Set(), subscriber };
    subscriber.subscribe(channel);
    subscriber.on('message', (_ch: string, msg: string) => {
      for (const h of entry!.handlers) h(msg);
    });
    pollSubscribers.set(pollId, entry);
  }

  entry.refCount++;
  entry.handlers.add(handler);

  // Return unsubscribe function
  return () => {
    entry!.refCount--;
    entry!.handlers.delete(handler);
    if (entry!.refCount <= 0) {
      entry!.subscriber.unsubscribe(channel);
      entry!.subscriber.disconnect();
      pollSubscribers.delete(pollId);
    }
  };
}
