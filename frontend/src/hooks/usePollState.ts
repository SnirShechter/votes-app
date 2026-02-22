import { useState, useCallback } from 'react';
import { useSSE } from './useSSE';
import type { PollState } from '../types';

export function usePollState(pollId: string | undefined) {
  const [pollState, setPollState] = useState<PollState | null>(null);
  const [voteCounts, setVoteCounts] = useState<Record<string, Record<string, number>>>({});

  const handleEvent = useCallback((event: { event: string; data: any }) => {
    switch (event.event) {
      case 'init':
        setPollState({
          status: event.data.status,
          currentQuestionIndex: event.data.currentQuestionIndex,
          questionMode: event.data.questionMode,
          onlineCount: event.data.onlineCount,
          totalMembers: event.data.totalMembers,
        });
        break;
      case 'poll_started':
        setPollState(prev => prev ? {
          ...prev, status: 'active',
          currentQuestionIndex: event.data.questionIndex,
          questionMode: 'preview',
        } : prev);
        break;
      case 'question_changed':
        setPollState(prev => prev ? {
          ...prev,
          currentQuestionIndex: event.data.questionIndex,
          questionMode: 'preview',
        } : prev);
        break;
      case 'question_unlocked':
        setPollState(prev => prev ? { ...prev, questionMode: 'open' } : prev);
        break;
      case 'vote_update':
        setVoteCounts(prev => ({
          ...prev,
          [event.data.questionId]: event.data.counts,
        }));
        break;
      case 'member_joined':
      case 'member_count':
        setPollState(prev => prev ? {
          ...prev,
          onlineCount: event.data.online ?? prev.onlineCount,
          totalMembers: event.data.total ?? event.data.memberCount ?? prev.totalMembers,
        } : prev);
        break;
      case 'poll_finished':
        setPollState(prev => prev ? { ...prev, status: 'finished' } : prev);
        break;
    }
  }, []);

  const { connected } = useSSE(pollId, handleEvent);

  return { pollState, voteCounts, connected };
}
