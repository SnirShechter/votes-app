import { Hono } from 'hono';
import { requireAuth } from '../middleware/auth.js';
import { query, queryOne, pool } from '../db.js';
import { cleanupRedisKeys } from '../services/pollState.js';
import type { AppEnv } from '../types.js';

const pollRoutes = new Hono<AppEnv>();

function generateJoinCode(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 6; i++) {
    code += chars[Math.floor(Math.random() * chars.length)];
  }
  return code;
}

// POST /api/polls — Create poll
pollRoutes.post('/', requireAuth, async (c: any) => {
  const userId = c.get('userId');
  const body = await c.req.json();
  const { title, description, allowStatsView, isAnonymous, questions } = body;

  if (!title || !questions || questions.length === 0) {
    return c.json({ error: 'Title and at least one question required' }, 400);
  }

  for (const q of questions) {
    if (!q.text || !q.options || q.options.length < 2 || q.options.length > 5) {
      return c.json({ error: 'Each question needs 2-5 options' }, 400);
    }
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Generate unique join code
    let joinCode: string;
    let attempts = 0;
    do {
      joinCode = generateJoinCode();
      const existing = await client.query('SELECT id FROM polls WHERE join_code = $1', [joinCode]);
      if (existing.rows.length === 0) break;
      attempts++;
    } while (attempts < 10);

    const pollResult = await client.query(
      `INSERT INTO polls (title, description, created_by, join_code, allow_stats_view, is_anonymous)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
      [title, description || null, userId, joinCode, allowStatsView ?? true, isAnonymous ?? true]
    );
    const poll = pollResult.rows[0];

    const questionResponses = [];
    for (let qi = 0; qi < questions.length; qi++) {
      const q = questions[qi];
      const qResult = await client.query(
        `INSERT INTO questions (poll_id, order_index, text, type)
         VALUES ($1, $2, $3, $4) RETURNING *`,
        [poll.id, qi, q.text, q.type || 'single']
      );
      const question = qResult.rows[0];

      const optionResponses = [];
      for (let oi = 0; oi < q.options.length; oi++) {
        const oResult = await client.query(
          `INSERT INTO options (question_id, order_index, text)
           VALUES ($1, $2, $3) RETURNING *`,
          [question.id, oi, q.options[oi].text]
        );
        optionResponses.push({
          id: oResult.rows[0].id,
          orderIndex: oi,
          text: q.options[oi].text,
        });
      }

      questionResponses.push({
        id: question.id,
        orderIndex: qi,
        text: q.text,
        type: q.type || 'single',
        options: optionResponses,
      });
    }

    // Add creator as admin
    await client.query(
      `INSERT INTO poll_members (poll_id, user_sub, role, invited_via)
       VALUES ($1, $2, 'admin', 'direct')`,
      [poll.id, userId]
    );

    await client.query('COMMIT');

    return c.json({
      id: poll.id,
      title: poll.title,
      description: poll.description,
      createdBy: poll.created_by,
      joinCode: poll.join_code,
      allowStatsView: poll.allow_stats_view,
      isAnonymous: poll.is_anonymous,
      status: poll.status,
      createdAt: poll.created_at,
      updatedAt: poll.updated_at,
      myRole: 'admin',
      memberCount: 1,
      questions: questionResponses,
    }, 201);
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Create poll error:', err);
    return c.json({ error: 'Failed to create poll' }, 500);
  } finally {
    client.release();
  }
});

// GET /api/polls — List my polls
pollRoutes.get('/', requireAuth, async (c: any) => {
  const userId = c.get('userId');
  const polls = await query(
    `SELECT p.*, pm.role as my_role,
       (SELECT COUNT(*) FROM poll_members WHERE poll_id = p.id) as member_count
     FROM polls p
     INNER JOIN poll_members pm ON pm.poll_id = p.id AND pm.user_sub = $1
     ORDER BY p.updated_at DESC`,
    [userId]
  );

  return c.json({
    polls: polls.map((p: any) => ({
      id: p.id,
      title: p.title,
      description: p.description,
      createdBy: p.created_by,
      joinCode: p.join_code,
      allowStatsView: p.allow_stats_view,
      isAnonymous: p.is_anonymous,
      status: p.status,
      createdAt: p.created_at,
      updatedAt: p.updated_at,
      myRole: p.my_role,
      memberCount: parseInt(p.member_count),
    })),
  });
});

// GET /api/polls/:id — Get poll details
pollRoutes.get('/:id', requireAuth, async (c: any) => {
  const pollId = c.req.param('id');
  const userId = c.get('userId');

  const poll = await queryOne('SELECT * FROM polls WHERE id = $1', [pollId]);
  if (!poll) return c.json({ error: 'Poll not found' }, 404);

  const member = await queryOne(
    'SELECT role FROM poll_members WHERE poll_id = $1 AND user_sub = $2',
    [pollId, userId]
  );
  if (!member) return c.json({ error: 'Not a member of this poll' }, 403);

  const questions = await query(
    'SELECT * FROM questions WHERE poll_id = $1 ORDER BY order_index',
    [pollId]
  );

  const questionIds = questions.map((q: any) => q.id);
  let options: any[] = [];
  if (questionIds.length > 0) {
    options = await query(
      'SELECT * FROM options WHERE question_id = ANY($1) ORDER BY order_index',
      [questionIds]
    );
  }

  const memberCount = await queryOne(
    'SELECT COUNT(*) as count FROM poll_members WHERE poll_id = $1',
    [pollId]
  );

  const questionResponses = questions.map((q: any) => ({
    id: q.id,
    orderIndex: q.order_index,
    text: q.text,
    type: q.type,
    options: options
      .filter((o: any) => o.question_id === q.id)
      .map((o: any) => ({
        id: o.id,
        orderIndex: o.order_index,
        text: o.text,
      })),
  }));

  return c.json({
    id: (poll as any).id,
    title: (poll as any).title,
    description: (poll as any).description,
    createdBy: (poll as any).created_by,
    joinCode: (poll as any).join_code,
    allowStatsView: (poll as any).allow_stats_view,
    isAnonymous: (poll as any).is_anonymous,
    status: (poll as any).status,
    createdAt: (poll as any).created_at,
    updatedAt: (poll as any).updated_at,
    myRole: (member as any).role,
    memberCount: parseInt((memberCount as any).count),
    questions: questionResponses,
  });
});

// PUT /api/polls/:id — Update poll (draft only)
pollRoutes.put('/:id', requireAuth, async (c: any) => {
  const pollId = c.req.param('id');
  const userId = c.get('userId');
  const body = await c.req.json();

  const member = await queryOne(
    'SELECT role FROM poll_members WHERE poll_id = $1 AND user_sub = $2',
    [pollId, userId]
  );
  if (!member || (member as any).role !== 'admin') {
    return c.json({ error: 'Admin access required' }, 403);
  }

  const poll = await queryOne('SELECT status FROM polls WHERE id = $1', [pollId]);
  if (!poll) return c.json({ error: 'Poll not found' }, 404);
  if ((poll as any).status !== 'draft') {
    return c.json({ error: 'Can only edit draft polls' }, 400);
  }

  const { title, description, allowStatsView, isAnonymous, questions } = body;

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    await client.query(
      `UPDATE polls SET title=$1, description=$2, allow_stats_view=$3, is_anonymous=$4, updated_at=now()
       WHERE id=$5`,
      [title, description || null, allowStatsView ?? true, isAnonymous ?? true, pollId]
    );

    // Delete old questions (cascades to options)
    await client.query('DELETE FROM questions WHERE poll_id = $1', [pollId]);

    // Re-insert
    for (let qi = 0; qi < questions.length; qi++) {
      const q = questions[qi];
      const qResult = await client.query(
        `INSERT INTO questions (poll_id, order_index, text, type)
         VALUES ($1, $2, $3, $4) RETURNING id`,
        [pollId, qi, q.text, q.type || 'single']
      );
      for (let oi = 0; oi < q.options.length; oi++) {
        await client.query(
          `INSERT INTO options (question_id, order_index, text)
           VALUES ($1, $2, $3)`,
          [qResult.rows[0].id, oi, q.options[oi].text]
        );
      }
    }

    await client.query('COMMIT');

    // Return updated poll
    const updated = await queryOne('SELECT * FROM polls WHERE id = $1', [pollId]);
    const updatedQuestions = await query(
      'SELECT * FROM questions WHERE poll_id = $1 ORDER BY order_index',
      [pollId]
    );
    const qIds = updatedQuestions.map((q: any) => q.id);
    let updatedOptions: any[] = [];
    if (qIds.length > 0) {
      updatedOptions = await query(
        'SELECT * FROM options WHERE question_id = ANY($1) ORDER BY order_index',
        [qIds]
      );
    }
    const mc = await queryOne(
      'SELECT COUNT(*) as count FROM poll_members WHERE poll_id = $1',
      [pollId]
    );

    return c.json({
      id: (updated as any).id,
      title: (updated as any).title,
      description: (updated as any).description,
      createdBy: (updated as any).created_by,
      joinCode: (updated as any).join_code,
      allowStatsView: (updated as any).allow_stats_view,
      isAnonymous: (updated as any).is_anonymous,
      status: (updated as any).status,
      createdAt: (updated as any).created_at,
      updatedAt: (updated as any).updated_at,
      myRole: 'admin',
      memberCount: parseInt((mc as any).count),
      questions: updatedQuestions.map((q: any) => ({
        id: q.id,
        orderIndex: q.order_index,
        text: q.text,
        type: q.type,
        options: updatedOptions
          .filter((o: any) => o.question_id === q.id)
          .map((o: any) => ({ id: o.id, orderIndex: o.order_index, text: o.text })),
      })),
    });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Update poll error:', err);
    return c.json({ error: 'Failed to update poll' }, 500);
  } finally {
    client.release();
  }
});

// DELETE /api/polls/:id
pollRoutes.delete('/:id', requireAuth, async (c: any) => {
  const pollId = c.req.param('id');
  const userId = c.get('userId');

  const member = await queryOne(
    'SELECT role FROM poll_members WHERE poll_id = $1 AND user_sub = $2',
    [pollId, userId]
  );
  if (!member || (member as any).role !== 'admin') {
    return c.json({ error: 'Admin access required' }, 403);
  }

  const poll = await queryOne('SELECT id FROM polls WHERE id = $1', [pollId]);
  if (!poll) return c.json({ error: 'Poll not found' }, 404);

  await cleanupRedisKeys(pollId);
  await query('DELETE FROM polls WHERE id = $1', [pollId]);

  return c.body(null, 204);
});

export default pollRoutes;
