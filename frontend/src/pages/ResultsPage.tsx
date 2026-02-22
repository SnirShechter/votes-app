import { useState, useEffect, useCallback } from 'react';
import { useParams } from 'react-router';
import { useTranslation } from 'react-i18next';
import { api } from '../api';
import { usePollState } from '../hooks/usePollState';
import { BarChart } from '../components/BarChart';
import { PollStatusBadge } from '../components/PollStatusBadge';
import { LoadingSpinner } from '../components/LoadingSpinner';
import type { ResultsData } from '../types';

export function ResultsPage() {
  const { t } = useTranslation();
  const { id } = useParams();
  const { pollState, voteCounts } = usePollState(id);
  const [results, setResults] = useState<ResultsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState<'current' | 'all'>('current');

  const fetchResults = useCallback(async () => {
    if (!id) return;
    try { const data = await api.get<ResultsData>(`/polls/${id}/results`); setResults(data); } catch {}
    finally { setLoading(false); }
  }, [id]);

  useEffect(() => { fetchResults(); }, [fetchResults]);
  useEffect(() => {
    if (results?.status === 'finished') return;
    const interval = setInterval(fetchResults, 10000);
    return () => clearInterval(interval);
  }, [fetchResults, results?.status]);

  if (loading) return <LoadingSpinner />;
  if (!results) return <div className="text-center py-12 text-red-500">{t('error')}</div>;

  const effectiveStatus = pollState?.status || results.status;
  const currentIndex = pollState?.currentQuestionIndex ?? results.currentQuestionIndex ?? 0;
  const questionsToShow = view === 'all' ? results.questions : results.questions.filter((_, i) => i === currentIndex);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <h1 className="text-2xl font-bold">{results.title}</h1>
          <PollStatusBadge status={effectiveStatus as any} />
        </div>
        <div className="flex gap-2">
          <button onClick={() => setView('current')} className={`px-3 py-1 text-sm rounded ${view === 'current' ? 'bg-blue-600 text-white' : 'bg-gray-200'}`}>{t('current_question')}</button>
          <button onClick={() => setView('all')} className={`px-3 py-1 text-sm rounded ${view === 'all' ? 'bg-blue-600 text-white' : 'bg-gray-200'}`}>{t('all_questions')}</button>
        </div>
      </div>
      {questionsToShow.map((q) => {
        const liveCounts = voteCounts[q.questionId];
        const options = q.options.map((o) => {
          const count = liveCounts ? Math.max(0, liveCounts[o.optionId] || 0) : o.count;
          const total = liveCounts ? Object.values(liveCounts).reduce((a, b) => a + Math.max(0, b), 0) : q.options.reduce((a, b) => a + b.count, 0);
          return { label: o.text, count, percentage: total > 0 ? Math.round((count / total) * 100) : 0 };
        });
        return (
          <div key={q.questionId} className="bg-white rounded-lg shadow-sm border border-gray-200 p-6 space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-medium">{q.questionText}</h3>
              <span className="text-sm text-gray-500">{t('question_x_of_y', { x: q.orderIndex + 1, y: results.questions.length })}</span>
            </div>
            <BarChart options={options} />
            <p className="text-sm text-gray-500">{q.totalVoters} {t('votes_count')}</p>
          </div>
        );
      })}
    </div>
  );
}
