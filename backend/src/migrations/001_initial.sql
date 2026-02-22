-- Enable UUID generation
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ============================================
-- POLLS
-- ============================================
CREATE TABLE polls (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title VARCHAR(255) NOT NULL,
  description TEXT,
  created_by VARCHAR(255) NOT NULL,
  join_code CHAR(6) NOT NULL UNIQUE,
  allow_stats_view BOOLEAN NOT NULL DEFAULT true,
  is_anonymous BOOLEAN NOT NULL DEFAULT true,
  status VARCHAR(20) NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'active', 'finished')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_polls_created_by ON polls(created_by);
CREATE INDEX idx_polls_join_code ON polls(join_code);

-- ============================================
-- QUESTIONS
-- ============================================
CREATE TABLE questions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  poll_id UUID NOT NULL REFERENCES polls(id) ON DELETE CASCADE,
  order_index INTEGER NOT NULL,
  text TEXT NOT NULL,
  type VARCHAR(10) NOT NULL DEFAULT 'single'
    CHECK (type IN ('single', 'multi')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (poll_id, order_index)
);

CREATE INDEX idx_questions_poll_id ON questions(poll_id);

-- ============================================
-- OPTIONS
-- ============================================
CREATE TABLE options (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  question_id UUID NOT NULL REFERENCES questions(id) ON DELETE CASCADE,
  order_index INTEGER NOT NULL,
  text TEXT NOT NULL
);

CREATE INDEX idx_options_question_id ON options(question_id);

-- ============================================
-- POLL MEMBERS
-- ============================================
CREATE TABLE poll_members (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  poll_id UUID NOT NULL REFERENCES polls(id) ON DELETE CASCADE,
  user_sub VARCHAR(255) NOT NULL,
  role VARCHAR(10) NOT NULL DEFAULT 'voter'
    CHECK (role IN ('admin', 'voter')),
  invited_by VARCHAR(255),
  invited_via VARCHAR(10) NOT NULL DEFAULT 'direct'
    CHECK (invited_via IN ('link', 'code', 'email', 'direct')),
  joined_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (poll_id, user_sub)
);

CREATE INDEX idx_poll_members_poll_id ON poll_members(poll_id);
CREATE INDEX idx_poll_members_user_sub ON poll_members(user_sub);

-- ============================================
-- VOTES
-- ============================================
CREATE TABLE votes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  poll_id UUID NOT NULL REFERENCES polls(id) ON DELETE CASCADE,
  question_id UUID NOT NULL REFERENCES questions(id) ON DELETE CASCADE,
  option_id UUID NOT NULL REFERENCES options(id) ON DELETE CASCADE,
  user_sub VARCHAR(255) NOT NULL,
  voted_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (question_id, user_sub, option_id)
);

CREATE INDEX idx_votes_poll_id ON votes(poll_id);
CREATE INDEX idx_votes_question_id ON votes(question_id);
CREATE INDEX idx_votes_user_sub ON votes(user_sub);

-- ============================================
-- POLL INVITES
-- ============================================
CREATE TABLE poll_invites (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  poll_id UUID NOT NULL REFERENCES polls(id) ON DELETE CASCADE,
  type VARCHAR(10) NOT NULL
    CHECK (type IN ('email', 'link', 'code')),
  email VARCHAR(255),
  token VARCHAR(64) NOT NULL UNIQUE,
  role VARCHAR(10) NOT NULL DEFAULT 'voter'
    CHECK (role IN ('admin', 'voter')),
  max_uses INTEGER,
  use_count INTEGER NOT NULL DEFAULT 0,
  expires_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_poll_invites_poll_id ON poll_invites(poll_id);
CREATE INDEX idx_poll_invites_token ON poll_invites(token);
CREATE INDEX idx_poll_invites_email ON poll_invites(email) WHERE email IS NOT NULL;

-- ============================================
-- RESULT SNAPSHOTS (written when poll finishes)
-- ============================================
CREATE TABLE result_snapshots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  poll_id UUID NOT NULL REFERENCES polls(id) ON DELETE CASCADE,
  question_id UUID NOT NULL REFERENCES questions(id) ON DELETE CASCADE,
  option_id UUID NOT NULL REFERENCES options(id) ON DELETE CASCADE,
  vote_count INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_result_snapshots_poll_id ON result_snapshots(poll_id);
