export interface Poll {
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
  questions?: Question[];
}

export interface Question {
  id: string;
  orderIndex: number;
  text: string;
  type: 'single' | 'multi';
  options: Option[];
}

export interface Option {
  id: string;
  orderIndex: number;
  text: string;
}

export interface PollState {
  status: 'draft' | 'active' | 'finished';
  currentQuestionIndex: number | null;
  questionMode: 'preview' | 'open' | null;
  onlineCount: number;
  totalMembers: number;
}

export interface VoteCounts {
  [questionId: string]: {
    [optionId: string]: number;
  };
}

export interface MyVotes {
  [questionId: string]: string[];
}

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
  }[];
}

export interface Invite {
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

export interface Member {
  userSub: string;
  email: string;
  name: string;
  role: 'admin' | 'voter';
  joinedAt: string;
}
