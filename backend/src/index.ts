import { Hono } from 'hono';
import { serve } from '@hono/node-server';
import { cors } from 'hono/cors';
import { serveStatic } from '@hono/node-server/serve-static';
import { runMigrations } from './migrate.js';
import authRoutes from './routes/auth.js';
import pollRoutes from './routes/polls.js';
import pollControlRoutes from './routes/pollControl.js';
import votingRoutes from './routes/voting.js';
import resultsRoutes from './routes/results.js';
import membersRoutes from './routes/members.js';
import invitesRoutes, { joinRoutes } from './routes/invites.js';
import eventsRoutes from './routes/events.js';

// Mount all route modules on /api
const api = new Hono();
api.route('/auth', authRoutes);
api.route('/polls', pollRoutes);
api.route('/polls', pollControlRoutes);
api.route('/polls', votingRoutes);
api.route('/polls', resultsRoutes);
api.route('/polls', membersRoutes);
api.route('/polls', invitesRoutes);
api.route('/join', joinRoutes);
api.route('/polls', eventsRoutes);

const app = new Hono();
app.use('/api/*', cors({
  origin: ['http://localhost:5173'],
  credentials: true,
  allowHeaders: ['Content-Type', 'Authorization'],
}));
app.route('/api', api);

// Production: serve frontend static files
if (process.env.NODE_ENV === 'production') {
  app.use('*', serveStatic({ root: './public' }));
  app.get('*', serveStatic({ root: './public', path: 'index.html' }));
}

// Startup
const PORT = parseInt(process.env.PORT || '3000');
await runMigrations();
serve({ fetch: app.fetch, port: PORT }, (info) => {
  console.log(`Server running on port ${info.port}`);
});
