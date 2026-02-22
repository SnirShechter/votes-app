import { Hono } from 'hono';
import { requireAuth } from '../middleware/auth.js';
import { query, queryOne } from '../db.js';
import { redis, publishEvent } from '../redis.js';
import { getPollState, setPollState, initVoteCounts, getQuestionByIndex, getQuestionCount } from '../services/pollState.js';
import type { AppEnv } from '../types.js';

const pollControlRoutes = new Hono<AppEnv>();

// POST /api/polls/:id/start
pollControlRoutes.post('/:id/start', requireAuth, async (c: any) => {
  const pollId = c.req.param('id');
  const userId = c.get('userId');

  const member = await queryOne(
    'SELECT role FROM poll_members WHERE poll_id = $1 AND user_sub = $2',
    [pollId, userId]
  );
  if (!member || (member as any).role !== 'admin') {
    return c.json({ error: 'Admin access required' }, 403);
  }

  const poll = await queryOne('SELECT status FROM polls WHERE id = $1', [pollId]);
  if (!poll || (poll as any).status !== 'draft') {
    return c.json({ error: 'Can only start draft polls' }, 400);
  }

  const firstQuestion = await getQuestionByIndex(pollId, 0);
  if (!firstQuestion) {
    return c.json({ error: 'Poll has no questions' }, 400);
  }

  await query('UPDATE polls SET status = $1, updated_at = now() WHERE id = $2', ['active', pollId]);

  const now = new Date().toISOString();
  await setPollState(pollId, {
    status: 'active',
    current_question: '0',
    question_mode: 'preview',
    started_at: now,
    finished_at: '',
    advanced_at: now,
  });

  await initVoteCounts(pollId);

  await publishEvent(pollId, 'poll_started', {
    questionIndex: 0,
    questionId: firstQuestion.id,
  });

  return c.json({ status: 'active', currentQuestion: 0 });
});

// POST /api/polls/:id/unlock
pollControlRoutes.post('/:id/unlock', requireAuth, async (c: any) => {
  const pollId = c.req.param('id');
  const userId = c.get('userId');

  const member = await queryOne(
    'SELECT role FROM poll_members WHERE poll_id = $1 AND user_sub = $2',
    [pollId, userId]
  );
  if (!member || (member as any).role !== 'admin') {
    return c.json({ error: 'Admin access required' }, 403);
  }

  const state = await getPollState(pollId);
  if (!state || state.status !== 'active' || state.question_mode !== 'preview') {
    return c.json({ error: 'Poll must be active and in preview mode' }, 400);
  }

  await setPollState(pollId, { question_mode: 'open' });

  const currentIndex = parseInt(state.current_question);
  const question = await getQuestionByIndex(pollId, currentIndex);

  await publishEvent(pollId, 'question_unlocked', {
    questionIndex: currentIndex,
    questionId: question?.id,
  });

  return c.json({ success: true });
});

// POST /api/polls/:id/advance
pollControlRoutes.post('/:id/advance', requireAuth, async (c: any) => {
  const pollId = c.req.param('id');
  const userId = c.get('userId');

  const member = await queryOne(
    'SELECT role FROM poll_members WHERE poll_id = $1 AND user_sub = $2',
    [pollId, userId]
  );
  if (!member || (member as any).role !== 'admin') {
    return c.json({ error: 'Admin access required' }, 403);
  }

  const state = await getPollState(pollId);
  if (!state || state.status !== 'active') {
    return c.json({ error: 'Poll must be active' }, 400);
  }

  const totalQuestions = await getQuestionCount(pollId);
  const currentIndex = parseInt(state.current_question);
  const nextIndex = currentIndex + 1;

  if (nextIndex >= totalQuestions) {
    return c.json({ error: 'No more questions, use /finish' }, 400);
  }

  const now = new Date().toISOString();
  await setPollState(pollId, {
    current_question: nextIndex.toString(),
    question_mode: 'preview',
    advanced_at: now,
  });

  const nextQuestion = await getQuestionByIndex(pollId, nextIndex);

  await publishEvent(pollId, 'question_changed', {
    questionIndex: nextIndex,
    questionId: nextQuestion?.id,
  });

  return c.json({ success: true });
});

// POST /api/polls/:id/finish
pollControlRoutes.post('/:id/finish', requireAuth, async (c: any) => {
  const pollId = c.req.param('id');
  const userId = c.get('userId');

  const member = await queryOne(
    'SELECT role FROM poll_members WHERE poll_id = $1 AND user_sub = $2',
    [pollId, userId]
  );
  if (!member || (member as any).role !== 'admin') {
    return c.json({ error: 'Admin access required' }, 403);
  }

  const state = await getPollState(pollId);
  if (!state || state.status !== 'active') {
    return c.json({ error: 'Poll must be active' }, 400);
  }

  await query('UPDATE polls SET status = $1, updated_at = now() WHERE id = $2', ['finished', pollId]);

  const now = new Date().toISOString();
  await setPollState(pollId, { status: 'finished', finished_at: now });

  // Snapshot counts to PG
  const questions = await query('SELECT id FROM questions WHERE poll_id = $1', [pollId]);
  for (const q of questions) {
    const counts = await redis.hgetall(`poll:${pollId}:counts:${q.id}`);
    for (const [optionId, count] of Object.entries(counts)) {
      await query(
        `INSERT INTO result_snapshots (poll_id, question_id, option_id, vote_count)
         VALUES ($1, $2, $3, $4)`,
        [pollId, q.id, optionId, parseInt(count)]
      );
    }
  }

  await publishEvent(pollId, 'poll_finished', {});

  return c.json({ success: true });
});

export default pollControlRoutes;
