import { Hono } from 'hono';
import { requireAuth } from '../middleware/auth.js';
import { query, queryOne } from '../db.js';
import { redis } from '../redis.js';
import { subscribeToPoll } from '../services/sse.js';
import { randomUUID } from 'crypto';
import type { AppEnv } from '../types.js';

const eventsRoutes = new Hono<AppEnv>();

eventsRoutes.get('/:id/events', async (c: any, next: any) => {
  const token = c.req.query('token');
  if (token && !c.req.header('Authorization')) {
    c.req.raw.headers.set('Authorization', `Bearer ${token}`);
  }
  return next();
}, requireAuth, async (c: any) => {
  const pollId = c.req.param('id');
  const userId = c.get('userId');

  const member = await queryOne(
    'SELECT role FROM poll_members WHERE poll_id = $1 AND user_sub = $2',
    [pollId, userId]
  );
  if (!member) {
    return c.json({ error: 'Not a member of this poll' }, 403);
  }

  const connectionId = randomUUID();
  await redis.sadd(`poll:${pollId}:connections`, connectionId);

  const onlineCount = await redis.scard(`poll:${pollId}:connections`);
  const totalMembers = await query(
    'SELECT COUNT(*) as count FROM poll_members WHERE poll_id = $1',
    [pollId]
  );

  const channel = `poll:${pollId}:events`;
  await redis.publish(channel, JSON.stringify({
    event: 'member_count',
    data: { online: onlineCount, total: parseInt(totalMembers[0].count) },
  }));

  const stream = new ReadableStream({
    start(controller) {
      const encoder = new TextEncoder();

      (async () => {
        const state = await redis.hgetall(`poll:${pollId}:state`);
        const poll = await queryOne('SELECT status FROM polls WHERE id = $1', [pollId]);

        const initData = {
          status: state?.status || poll?.status || 'draft',
          currentQuestionIndex: state?.current_question != null
            ? parseInt(state.current_question) : null,
          questionMode: state?.question_mode || null,
          onlineCount,
          totalMembers: parseInt(totalMembers[0].count),
        };

        controller.enqueue(
          encoder.encode(`event: init\ndata: ${JSON.stringify(initData)}\n\n`)
        );
      })();

      const unsubscribe = subscribeToPoll(pollId, (message: string) => {
        try {
          const parsed = JSON.parse(message);
          const ssePayload = `event: ${parsed.event}\ndata: ${JSON.stringify(parsed.data)}\n\n`;
          controller.enqueue(encoder.encode(ssePayload));
        } catch (e) {
          console.error('SSE message parse error:', e);
        }
      });

      const heartbeat = setInterval(() => {
        try {
          controller.enqueue(encoder.encode(': heartbeat\n\n'));
        } catch {
          clearInterval(heartbeat);
        }
      }, 30000);

      c.req.raw.signal.addEventListener('abort', async () => {
        clearInterval(heartbeat);
        unsubscribe();
        await redis.srem(`poll:${pollId}:connections`, connectionId);

        const newOnlineCount = await redis.scard(`poll:${pollId}:connections`);
        const totalMembersNow = await query(
          'SELECT COUNT(*) as count FROM poll_members WHERE poll_id = $1',
          [pollId]
        );
        await redis.publish(channel, JSON.stringify({
          event: 'member_count',
          data: {
            online: newOnlineCount,
            total: parseInt(totalMembersNow[0].count),
          },
        }));

        controller.close();
      });
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  });
});

export default eventsRoutes;
