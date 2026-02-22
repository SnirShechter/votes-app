import { Hono } from 'hono';
import { requireAuth } from '../middleware/auth.js';
import { query, queryOne } from '../db.js';
import { redis } from '../redis.js';
import type { AppEnv, QuestionResult, ResultsResponse } from '../types.js';

const resultsRoutes = new Hono<AppEnv>();

// GET /api/polls/:id/results
resultsRoutes.get('/:id/results', requireAuth, async (c: any) => {
  const pollId = c.req.param('id');
  const userId = c.get('userId');

  // Verify membership and get role
  const member = await queryOne(
    'SELECT role FROM poll_members WHERE poll_id = $1 AND user_sub = $2',
    [pollId, userId]
  );
  if (!member) {
    return c.json({ error: 'Not a member of this poll' }, 403);
  }

  // Get poll
  const poll = await queryOne(
    'SELECT * FROM polls WHERE id = $1',
    [pollId]
  );
  if (!poll) {
    return c.json({ error: 'Poll not found' }, 404);
  }

  // Check access
  if (!poll.allow_stats_view && member.role === 'voter') {
    return c.json({ error: 'Stats viewing not allowed' }, 403);
  }

  // Get questions and options
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

  // Get Redis state
  const state = await redis.hgetall(`poll:${pollId}:state`);

  // Build results per question
  const questionResults: QuestionResult[] = [];

  for (const q of questions) {
    const qOptions = options.filter((o: any) => o.question_id === q.id);
    let counts: Record<string, number> = {};

    if (poll.status === 'active') {
      // Live counts from Redis
      const redisCounts = await redis.hgetall(`poll:${pollId}:counts:${q.id}`);
      counts = {};
      for (const opt of qOptions) {
        const raw = parseInt(redisCounts[opt.id] || '0');
        counts[opt.id] = Math.max(0, raw); // Clamp negative to 0
      }
    } else if (poll.status === 'finished') {
      // From snapshots
      const snapshots = await query(
        'SELECT option_id, vote_count FROM result_snapshots WHERE poll_id = $1 AND question_id = $2',
        [pollId, q.id]
      );
      for (const s of snapshots) {
        counts[s.option_id] = s.vote_count;
      }
    }

    const totalVotes = Object.values(counts).reduce((a, b) => a + b, 0);
    const totalVoters = totalVotes; // Simplified for MVP

    const optionResults = qOptions.map((opt: any) => {
      const count = counts[opt.id] || 0;
      const percentage = totalVotes > 0 ? Math.round((count / totalVotes) * 100) : 0;
      return {
        optionId: opt.id,
        text: opt.text,
        count,
        percentage,
      };
    });

    // If not anonymous and admin, include voter names
    if (!poll.is_anonymous && member.role === 'admin') {
      for (const optResult of optionResults) {
        const voters = await query(
          'SELECT user_sub FROM votes WHERE question_id = $1 AND option_id = $2',
          [q.id, optResult.optionId]
        );
        (optResult as any).voters = voters.map((v: any) => v.user_sub);
      }
    }

    questionResults.push({
      questionId: q.id,
      questionText: q.text,
      questionType: q.type,
      orderIndex: q.order_index,
      totalVoters,
      options: optionResults,
    });
  }

  const response: ResultsResponse = {
    pollId: poll.id,
    title: poll.title,
    status: poll.status,
    isAnonymous: poll.is_anonymous,
    allowStatsView: poll.allow_stats_view,
    currentQuestionIndex: state?.current_question != null ? parseInt(state.current_question) : null,
    questionMode: (state?.question_mode as 'preview' | 'open') || null,
    questions: questionResults,
  };

  return c.json(response);
});

// GET /api/polls/:id/results/export — CSV export
resultsRoutes.get('/:id/results/export', requireAuth, async (c: any) => {
  const pollId = c.req.param('id');
  const userId = c.get('userId');

  // Verify admin
  const member = await queryOne(
    'SELECT role FROM poll_members WHERE poll_id = $1 AND user_sub = $2',
    [pollId, userId]
  );
  if (!member || member.role !== 'admin') {
    return c.json({ error: 'Admin access required' }, 403);
  }

  const poll = await queryOne('SELECT * FROM polls WHERE id = $1', [pollId]);
  if (!poll) {
    return c.json({ error: 'Poll not found' }, 404);
  }

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

  // Build CSV
  const headers = poll.is_anonymous
    ? ['Question', 'Option', 'Votes', 'Percentage']
    : ['Question', 'Option', 'Votes', 'Percentage', 'Voters'];

  let csv = headers.join(',') + '\n';

  for (const q of questions) {
    const qOptions = options.filter((o: any) => o.question_id === q.id);
    let counts: Record<string, number> = {};

    if (poll.status === 'finished') {
      const snapshots = await query(
        'SELECT option_id, vote_count FROM result_snapshots WHERE poll_id = $1 AND question_id = $2',
        [pollId, q.id]
      );
      for (const s of snapshots) {
        counts[s.option_id] = s.vote_count;
      }
    } else {
      const redisCounts = await redis.hgetall(`poll:${pollId}:counts:${q.id}`);
      for (const opt of qOptions) {
        counts[opt.id] = Math.max(0, parseInt(redisCounts[opt.id] || '0'));
      }
    }

    const totalVotes = Object.values(counts).reduce((a, b) => a + b, 0);

    for (const opt of qOptions) {
      const count = counts[opt.id] || 0;
      const pct = totalVotes > 0 ? Math.round((count / totalVotes) * 100) : 0;
      const escapedQuestion = q.text.replace(/"/g, '""');
      const escapedOption = opt.text.replace(/"/g, '""');

      let row = `"${escapedQuestion}","${escapedOption}",${count},${pct}%`;

      if (!poll.is_anonymous) {
        const voters = await query(
          'SELECT user_sub FROM votes WHERE question_id = $1 AND option_id = $2',
          [q.id, opt.id]
        );
        const voterList = voters.map((v: any) => v.user_sub).join('; ');
        row += `,"${voterList}"`;
      }

      csv += row + '\n';
    }
  }

  return new Response(csv, {
    headers: {
      'Content-Type': 'text/csv',
      'Content-Disposition': `attachment; filename="poll-results-${pollId}.csv"`,
    },
  });
});

export default resultsRoutes;
