import { Hono } from 'hono';
import { requireAuth } from '../middleware/auth.js';
import { query, queryOne } from '../db.js';
import type { AppEnv } from '../types.js';

const membersRoutes = new Hono<AppEnv>();

// GET /api/polls/:id/members
membersRoutes.get('/:id/members', requireAuth, async (c: any) => {
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

  const members = await query(
    'SELECT user_sub, role, joined_at FROM poll_members WHERE poll_id = $1 ORDER BY joined_at',
    [pollId]
  );

  // Return members with sub as fallback for name/email
  const result = members.map((m: any) => ({
    userSub: m.user_sub,
    email: '',
    name: m.user_sub,
    role: m.role,
    joinedAt: m.joined_at,
  }));

  return c.json(result);
});

// PUT /api/polls/:id/members/:sub/role
membersRoutes.put('/:id/members/:sub/role', requireAuth, async (c: any) => {
  const pollId = c.req.param('id');
  const targetSub = c.req.param('sub');
  const userId = c.get('userId');

  // Verify admin
  const member = await queryOne(
    'SELECT role FROM poll_members WHERE poll_id = $1 AND user_sub = $2',
    [pollId, userId]
  );
  if (!member || member.role !== 'admin') {
    return c.json({ error: 'Admin access required' }, 403);
  }

  // Cannot change own role
  if (targetSub === userId) {
    return c.json({ error: 'Cannot change your own role' }, 400);
  }

  // Cannot change creator's role
  const poll = await queryOne('SELECT created_by FROM polls WHERE id = $1', [pollId]);
  if (poll && targetSub === poll.created_by) {
    return c.json({ error: 'Cannot change the creator\'s role' }, 400);
  }

  const body = await c.req.json();
  const { role } = body;

  if (!['admin', 'voter'].includes(role)) {
    return c.json({ error: 'Invalid role' }, 400);
  }

  const updated = await queryOne(
    'UPDATE poll_members SET role = $1 WHERE poll_id = $2 AND user_sub = $3 RETURNING id',
    [role, pollId, targetSub]
  );

  if (!updated) {
    return c.json({ error: 'Member not found' }, 404);
  }

  return c.json({ success: true });
});

// DELETE /api/polls/:id/members/:sub
membersRoutes.delete('/:id/members/:sub', requireAuth, async (c: any) => {
  const pollId = c.req.param('id');
  const targetSub = c.req.param('sub');
  const userId = c.get('userId');

  // Verify admin
  const member = await queryOne(
    'SELECT role FROM poll_members WHERE poll_id = $1 AND user_sub = $2',
    [pollId, userId]
  );
  if (!member || member.role !== 'admin') {
    return c.json({ error: 'Admin access required' }, 403);
  }

  // Cannot remove yourself
  if (targetSub === userId) {
    return c.json({ error: 'Cannot remove yourself' }, 400);
  }

  // Cannot remove creator
  const poll = await queryOne('SELECT created_by FROM polls WHERE id = $1', [pollId]);
  if (poll && targetSub === poll.created_by) {
    return c.json({ error: 'Cannot remove the creator' }, 400);
  }

  await query(
    'DELETE FROM poll_members WHERE poll_id = $1 AND user_sub = $2',
    [pollId, targetSub]
  );

  return c.body(null, 204);
});

export default membersRoutes;
