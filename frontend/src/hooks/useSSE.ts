import { useEffect, useRef, useState } from 'react';
import { useAuth } from '../auth/useAuth';

interface SSEEvent {
  event: string;
  data: any;
}

export function useSSE(
  pollId: string | undefined,
  onEvent: (event: SSEEvent) => void
) {
  const { token } = useAuth();
  const [connected, setConnected] = useState(false);
  const eventSourceRef = useRef<EventSource | null>(null);
  const onEventRef = useRef(onEvent);
  onEventRef.current = onEvent;

  useEffect(() => {
    if (!pollId || !token) return;

    const url = `/api/polls/${pollId}/events?token=${encodeURIComponent(token)}`;
    const es = new EventSource(url);
    eventSourceRef.current = es;

    const eventTypes = [
      'init', 'poll_started', 'question_changed', 'question_unlocked',
      'vote_update', 'member_joined', 'member_count', 'poll_finished',
    ];

    for (const type of eventTypes) {
      es.addEventListener(type, (e: MessageEvent) => {
        try {
          const data = JSON.parse(e.data);
          onEventRef.current({ event: type, data });
        } catch (err) {
          console.error('SSE parse error:', err);
        }
      });
    }

    es.onopen = () => setConnected(true);
    es.onerror = () => { setConnected(false); };

    return () => {
      es.close();
      eventSourceRef.current = null;
      setConnected(false);
    };
  }, [pollId, token]);

  return { connected };
}
