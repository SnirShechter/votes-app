import { useState, useEffect, useCallback } from 'react';
import { api } from '../api';
import type { Poll } from '../types';

export function usePolls() {
  const [polls, setPolls] = useState<Poll[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchPolls = useCallback(async () => {
    try {
      setLoading(true);
      const data = await api.get<{ polls: Poll[] }>('/polls');
      setPolls(data.polls);
      setError(null);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchPolls(); }, [fetchPolls]);

  return { polls, loading, error, refetch: fetchPolls };
}

export function usePoll(pollId: string | undefined) {
  const [poll, setPoll] = useState<Poll | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchPoll = useCallback(async () => {
    if (!pollId) return;
    try {
      setLoading(true);
      const data = await api.get<Poll>(`/polls/${pollId}`);
      setPoll(data);
      setError(null);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [pollId]);

  useEffect(() => { fetchPoll(); }, [fetchPoll]);

  return { poll, loading, error, refetch: fetchPoll };
}
