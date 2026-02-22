import { Hono } from 'hono';
import { requireAuth } from '../middleware/auth.js';
import { query, queryOne } from '../db.js';
import { publishEvent } from '../redis.js';
import type { AppEnv } from '../types.js';

const authRoutes = new Hono<AppEnv>();

authRoutes.get('/me', requireAuth, async (c: any) => {
  const sub = c.get('userId');
  const email = c.get('userEmail');
  const name = c.get('userName');

  // Auto-join any pending email invites for this user's email
  if (email) {
    const pendingInvites = await query(
      `SELECT pi.* FROM poll_invites pi
       WHERE pi.email = $1 AND pi.type = 'email'
       AND (pi.use_count < pi.max_uses OR pi.max_uses IS NULL)
       AND (pi.expires_at IS NULL OR pi.expires_at > now())`,
      [email]
    );

    for (const invite of pendingInvites) {
      const inserted = await queryOne(
        `INSERT INTO poll_members (poll_id, user_sub, role, invited_by, invited_via)
         VALUES ($1, $2, $3, NULL, 'email')
         ON CONFLICT (poll_id, user_sub) DO NOTHING
         RETURNING id`,
        [invite.poll_id, sub, invite.role]
      );
      if (inserted) {
        await query(
          'UPDATE poll_invites SET use_count = use_count + 1 WHERE id = $1',
          [invite.id]
        );
        const memberCount = await query(
          'SELECT COUNT(*) as count FROM poll_members WHERE poll_id = $1',
          [invite.poll_id]
        );
        await publishEvent(invite.poll_id, 'member_joined', {
          memberCount: parseInt(memberCount[0].count),
        });
      }
    }
  }

  return c.json({ sub, email, name });
});

export default authRoutes;
