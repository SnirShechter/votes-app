import { redis } from '../redis.js';
import { query } from '../db.js';

export interface PollState {
  status: string;
  current_question: string;
  question_mode: string;
  started_at: string;
  finished_at: string;
  advanced_at: string;
}

export async function getPollState(pollId: string): Promise<PollState | null> {
  const state = await redis.hgetall(`poll:${pollId}:state`);
  if (!state || Object.keys(state).length === 0) return null;
  return state as unknown as PollState;
}

export async function setPollState(pollId: string, fields: Record<string, string>): Promise<void> {
  const key = `poll:${pollId}:state`;
  const args: string[] = [];
  for (const [k, v] of Object.entries(fields)) {
    args.push(k, v);
  }
  await redis.hset(key, ...args);
}

export async function initVoteCounts(pollId: string): Promise<void> {
  const questions = await query(
    'SELECT q.id as question_id FROM questions q WHERE q.poll_id = $1 ORDER BY q.order_index',
    [pollId]
  );
  for (const q of questions) {
    const options = await query(
      'SELECT id FROM options WHERE question_id = $1',
      [q.question_id]
    );
    for (const opt of options) {
      await redis.hset(`poll:${pollId}:counts:${q.question_id}`, opt.id, '0');
    }
  }
}

export async function getQuestionByIndex(pollId: string, index: number): Promise<{ id: string; text: string } | null> {
  const rows = await query(
    'SELECT id, text FROM questions WHERE poll_id = $1 AND order_index = $2',
    [pollId, index]
  );
  return rows[0] || null;
}

export async function getQuestionCount(pollId: string): Promise<number> {
  const rows = await query(
    'SELECT COUNT(*) as count FROM questions WHERE poll_id = $1',
    [pollId]
  );
  return parseInt(rows[0].count);
}

export async function cleanupRedisKeys(pollId: string): Promise<void> {
  const questions = await query(
    'SELECT id FROM questions WHERE poll_id = $1',
    [pollId]
  );
  const keys = [
    `poll:${pollId}:state`,
    `poll:${pollId}:connections`,
    ...questions.map((q: any) => `poll:${pollId}:counts:${q.id}`),
  ];
  if (keys.length > 0) {
    await redis.del(...keys);
  }
}
