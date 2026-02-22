import type { Env } from 'hono';

export interface AppEnv extends Env {
  Variables: {
    userId: string;
    userEmail?: string;
    userName?: string;
  };
}

// ---------- Request/Response Types ----------

// Auth
export interface MeResponse {
  sub: string;
  email: string;
  name: string;
}

// Polls
export interface CreatePollRequest {
  title: string;
  description?: string;
  allowStatsView: boolean;
  isAnonymous: boolean;
  questions: {
    text: string;
    type: 'single' | 'multi';
    options: { text: string }[];
  }[];
}

export interface PollResponse {
  id: string;
  title: string;
  description: string | null;
  createdBy: string;
  joinCode: string;
  allowStatsView: boolean;
  isAnonymous: boolean;
  status: 'draft' | 'active' | 'finished';
  createdAt: string;
  updatedAt: string;
  myRole: 'admin' | 'voter' | null;
  memberCount: number;
  questions?: QuestionResponse[];
}

export interface QuestionResponse {
  id: string;
  orderIndex: number;
  text: string;
  type: 'single' | 'multi';
  options: OptionResponse[];
}

export interface OptionResponse {
  id: string;
  orderIndex: number;
  text: string;
}

export interface PollListResponse {
  polls: PollResponse[];
}

// Voting
export interface VoteRequest {
  questionId: string;
  optionIds: string[];
}

export interface MyVotesResponse {
  votes: {
    questionId: string;
    optionIds: string[];
  }[];
}

// Results
export interface QuestionResult {
  questionId: string;
  questionText: string;
  questionType: 'single' | 'multi';
  orderIndex: number;
  totalVoters: number;
  options: {
    optionId: string;
    text: string;
    count: number;
    percentage: number;
    voters?: string[];
  }[];
}

export interface ResultsResponse {
  pollId: string;
  title: string;
  status: 'active' | 'finished';
  isAnonymous: boolean;
  allowStatsView: boolean;
  currentQuestionIndex: number | null;
  questionMode: 'preview' | 'open' | null;
  questions: QuestionResult[];
}

// Members
export interface MemberResponse {
  userSub: string;
  email: string;
  name: string;
  role: 'admin' | 'voter';
  joinedAt: string;
}

// Invites
export interface CreateInviteRequest {
  type: 'email' | 'link';
  email?: string;
  role: 'admin' | 'voter';
  maxUses?: number;
  expiresIn?: 'hour' | 'day' | 'week' | null;
}

export interface InviteResponse {
  id: string;
  type: 'email' | 'link' | 'code';
  email: string | null;
  token: string;
  role: 'admin' | 'voter';
  maxUses: number | null;
  useCount: number;
  expiresAt: string | null;
  createdAt: string;
  url: string;
}

// SSE state (sent on initial connect)
export interface PollStateResponse {
  status: 'draft' | 'active' | 'finished';
  currentQuestionIndex: number | null;
  questionMode: 'preview' | 'open' | null;
  onlineCount: number;
  totalMembers: number;
}

// Join
export interface JoinByCodeRequest {
  code: string;
}
