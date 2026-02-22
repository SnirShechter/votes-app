import { Hono } from 'hono';
import { randomBytes } from 'crypto';
import { requireAuth } from '../middleware/auth.js';
import { query, queryOne } from '../db.js';
import { publishEvent } from '../redis.js';
import type { AppEnv } from '../types.js';

const invitesRoutes = new Hono<AppEnv>();

const APP_URL = process.env.APP_URL || 'https://votes.snir.sh';

// POST /api/polls/:id/invites
invitesRoutes.post('/:id/invites', requireAuth, async (c: any) => {
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

  const body = await c.req.json();
  const { type, email, role, maxUses, expiresIn } = body;

  if (!['email', 'link'].includes(type)) {
    return c.json({ error: 'Invalid invite type' }, 400);
  }
  if (type === 'email' && !email) {
    return c.json({ error: 'Email required for email invites' }, 400);
  }
  if (!['admin', 'voter'].includes(role)) {
    return c.json({ error: 'Invalid role' }, 400);
  }

  const token = randomBytes(32).toString('hex');

  let expiresAt: Date | null = null;
  if (expiresIn === 'hour') {
    expiresAt = new Date(Date.now() + 60 * 60 * 1000);
  } else if (expiresIn === 'day') {
    expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);
  } else if (expiresIn === 'week') {
    expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
  }

  const finalMaxUses = type === 'email' ? 1 : (maxUses || null);

  const invite = await queryOne(
    `INSERT INTO poll_invites (poll_id, type, email, token, role, max_uses, expires_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     RETURNING *`,
    [pollId, type, email || null, token, role, finalMaxUses, expiresAt]
  );

  return c.json({
    id: invite.id,
    type: invite.type,
    email: invite.email,
    token: invite.token,
    role: invite.role,
    maxUses: invite.max_uses,
    useCount: invite.use_count,
    expiresAt: invite.expires_at,
    createdAt: invite.created_at,
    url: `${APP_URL}/join/${invite.token}`,
  }, 201);
});

// GET /api/polls/:id/invites
invitesRoutes.get('/:id/invites', requireAuth, async (c: any) => {
  const pollId = c.req.param('id');
  const userId = c.get('userId');

  const member = await queryOne(
    'SELECT role FROM poll_members WHERE poll_id = $1 AND user_sub = $2',
    [pollId, userId]
  );
  if (!member || member.role !== 'admin') {
    return c.json({ error: 'Admin access required' }, 403);
  }

  const invites = await query(
    'SELECT * FROM poll_invites WHERE poll_id = $1 ORDER BY created_at DESC',
    [pollId]
  );

  return c.json(invites.map((inv: any) => ({
    id: inv.id,
    type: inv.type,
    email: inv.email,
    token: inv.token,
    role: inv.role,
    maxUses: inv.max_uses,
    useCount: inv.use_count,
    expiresAt: inv.expires_at,
    createdAt: inv.created_at,
    url: `${APP_URL}/join/${inv.token}`,
  })));
});

// DELETE /api/polls/:id/invites/:inviteId
invitesRoutes.delete('/:id/invites/:inviteId', requireAuth, async (c: any) => {
  const pollId = c.req.param('id');
  const inviteId = c.req.param('inviteId');
  const userId = c.get('userId');

  const member = await queryOne(
    'SELECT role FROM poll_members WHERE poll_id = $1 AND user_sub = $2',
    [pollId, userId]
  );
  if (!member || member.role !== 'admin') {
    return c.json({ error: 'Admin access required' }, 403);
  }

  const deleted = await queryOne(
    'DELETE FROM poll_invites WHERE id = $1 AND poll_id = $2 RETURNING id',
    [inviteId, pollId]
  );

  if (!deleted) {
    return c.json({ error: 'Invite not found' }, 404);
  }

  return c.body(null, 204);
});

export default invitesRoutes;

// --- Join routes (mounted separately on /api/join) ---
const joinRoutes = new Hono<AppEnv>();

// POST /api/join/:token
joinRoutes.post('/:token', requireAuth, async (c: any) => {
  const token = c.req.param('token');
  const userId = c.get('userId');

  const invite = await queryOne(
    'SELECT * FROM poll_invites WHERE token = $1',
    [token]
  );

  if (!invite) {
    return c.json({ error: 'Invite not found' }, 404);
  }

  // Check expiry
  if (invite.expires_at && new Date(invite.expires_at) < new Date()) {
    return c.json({ error: 'Invite has expired' }, 400);
  }

  // Check max uses
  if (invite.max_uses !== null && invite.use_count >= invite.max_uses) {
    return c.json({ error: 'Invite has reached maximum uses' }, 400);
  }

  // Check if already a member
  const existing = await queryOne(
    'SELECT role FROM poll_members WHERE poll_id = $1 AND user_sub = $2',
    [invite.poll_id, userId]
  );
  if (existing) {
    return c.json({ pollId: invite.poll_id, role: existing.role });
  }

  // Join
  await query(
    `INSERT INTO poll_members (poll_id, user_sub, role, invited_via)
     VALUES ($1, $2, $3, 'link')
     ON CONFLICT (poll_id, user_sub) DO NOTHING`,
    [invite.poll_id, userId, invite.role]
  );

  // Increment use count
  await query(
    'UPDATE poll_invites SET use_count = use_count + 1 WHERE id = $1',
    [invite.id]
  );

  // Publish SSE
  const memberCount = await query(
    'SELECT COUNT(*) as count FROM poll_members WHERE poll_id = $1',
    [invite.poll_id]
  );
  await publishEvent(invite.poll_id, 'member_joined', {
    memberCount: parseInt(memberCount[0].count),
  });

  return c.json({ pollId: invite.poll_id, role: invite.role });
});

// POST /api/join/code
joinRoutes.post('/code', requireAuth, async (c: any) => {
  const userId = c.get('userId');
  const body = await c.req.json();
  const code = (body.code || '').toUpperCase().trim();

  if (!code) {
    return c.json({ error: 'Code is required' }, 400);
  }

  const poll = await queryOne(
    'SELECT * FROM polls WHERE join_code = $1',
    [code]
  );

  if (!poll) {
    return c.json({ error: 'Poll not found' }, 404);
  }

  // Check if already a member
  const existing = await queryOne(
    'SELECT role FROM poll_members WHERE poll_id = $1 AND user_sub = $2',
    [poll.id, userId]
  );
  if (existing) {
    return c.json({ pollId: poll.id });
  }

  // Join
  await query(
    `INSERT INTO poll_members (poll_id, user_sub, role, invited_via)
     VALUES ($1, $2, 'voter', 'code')
     ON CONFLICT (poll_id, user_sub) DO NOTHING`,
    [poll.id, userId]
  );

  // Publish SSE
  const memberCount = await query(
    'SELECT COUNT(*) as count FROM poll_members WHERE poll_id = $1',
    [poll.id]
  );
  await publishEvent(poll.id, 'member_joined', {
    memberCount: parseInt(memberCount[0].count),
  });

  return c.json({ pollId: poll.id });
});

export { joinRoutes };
