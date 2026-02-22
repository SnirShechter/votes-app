import { Hono } from 'hono';
import { requireAuth } from '../middleware/auth.js';
import { query, queryOne, pool } from '../db.js';
import { redis, publishEvent } from '../redis.js';
import { getPollState, getQuestionByIndex } from '../services/pollState.js';
import type { AppEnv } from '../types.js';

const votingRoutes = new Hono<AppEnv>();

// Simple rate limiter
const voteRateLimiter = new Map<string, number[]>();

function checkRateLimit(userId: string): boolean {
  const now = Date.now();
  const windowMs = 1000;
  const maxVotes = 10;

  let timestamps = voteRateLimiter.get(userId) || [];
  timestamps = timestamps.filter(t => t > now - windowMs);
  if (timestamps.length >= maxVotes) return false;
  timestamps.push(now);
  voteRateLimiter.set(userId, timestamps);
  return true;
}

// POST /api/polls/:id/vote
votingRoutes.post('/:id/vote', requireAuth, async (c: any) => {
  const pollId = c.req.param('id');
  const userId = c.get('userId');

  if (!checkRateLimit(userId)) {
    return c.json({ error: 'Rate limit exceeded' }, 429);
  }

  const member = await queryOne(
    'SELECT role FROM poll_members WHERE poll_id = $1 AND user_sub = $2',
    [pollId, userId]
  );
  if (!member) return c.json({ error: 'Not a member of this poll' }, 403);

  const state = await getPollState(pollId);
  if (!state || state.status !== 'active' || state.question_mode !== 'open') {
    return c.json({ error: 'Voting is not open' }, 400);
  }

  const body = await c.req.json();
  const { questionId, optionIds } = body;

  if (!questionId || !optionIds || !Array.isArray(optionIds) || optionIds.length === 0) {
    return c.json({ error: 'questionId and optionIds required' }, 400);
  }

  // Verify question matches current question
  const currentIndex = parseInt(state.current_question);
  const currentQuestion = await getQuestionByIndex(pollId, currentIndex);
  if (!currentQuestion || currentQuestion.id !== questionId) {
    return c.json({ error: 'Wrong question' }, 400);
  }

  // Get question details
  const question = await queryOne(
    'SELECT * FROM questions WHERE id = $1 AND poll_id = $2',
    [questionId, pollId]
  );
  if (!question) return c.json({ error: 'Question not found' }, 404);

  // Validate optionIds belong to this question
  const validOptions = await query(
    'SELECT id FROM options WHERE question_id = $1',
    [questionId]
  );
  const validOptionIds = new Set(validOptions.map((o: any) => o.id));
  for (const oid of optionIds) {
    if (!validOptionIds.has(oid)) {
      return c.json({ error: 'Invalid option' }, 400);
    }
  }

  if ((question as any).type === 'single' && optionIds.length !== 1) {
    return c.json({ error: 'Single choice question requires exactly one option' }, 400);
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Delete existing votes
    const deleted = await client.query(
      'DELETE FROM votes WHERE question_id = $1 AND user_sub = $2 RETURNING option_id',
      [questionId, userId]
    );

    // Decrement Redis counts for deleted
    for (const row of deleted.rows) {
      await redis.hincrby(`poll:${pollId}:counts:${questionId}`, row.option_id, -1);
    }

    // Insert new votes
    for (const optionId of optionIds) {
      await client.query(
        `INSERT INTO votes (poll_id, question_id, option_id, user_sub)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (question_id, user_sub, option_id) DO NOTHING`,
        [pollId, questionId, optionId, userId]
      );
      await redis.hincrby(`poll:${pollId}:counts:${questionId}`, optionId, 1);
    }

    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Vote error:', err);
    return c.json({ error: 'Failed to record vote' }, 500);
  } finally {
    client.release();
  }

  // Read updated counts and publish
  const counts = await redis.hgetall(`poll:${pollId}:counts:${questionId}`);
  const numericCounts: Record<string, number> = {};
  for (const [k, v] of Object.entries(counts)) {
    numericCounts[k] = Math.max(0, parseInt(v));
  }

  await publishEvent(pollId, 'vote_update', {
    questionId,
    counts: numericCounts,
  });

  return c.json({ success: true });
});

// GET /api/polls/:id/my-votes
votingRoutes.get('/:id/my-votes', requireAuth, async (c: any) => {
  const pollId = c.req.param('id');
  const userId = c.get('userId');

  const member = await queryOne(
    'SELECT role FROM poll_members WHERE poll_id = $1 AND user_sub = $2',
    [pollId, userId]
  );
  if (!member) return c.json({ error: 'Not a member' }, 403);

  const rows = await query(
    `SELECT question_id, array_agg(option_id::text) as option_ids
     FROM votes
     WHERE poll_id = $1 AND user_sub = $2
     GROUP BY question_id`,
    [pollId, userId]
  );

  return c.json({
    votes: rows.map((r: any) => ({
      questionId: r.question_id,
      optionIds: r.option_ids,
    })),
  });
});

export default votingRoutes;
