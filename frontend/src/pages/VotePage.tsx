import { useState, useEffect, useCallback } from 'react';
import { useParams } from 'react-router';
import { useTranslation } from 'react-i18next';
import toast from 'react-hot-toast';
import { api } from '../api';
import { usePoll } from '../hooks/usePolls';
import { usePollState } from '../hooks/usePollState';
import { PollStatusBadge } from '../components/PollStatusBadge';
import { BarChart } from '../components/BarChart';
import { LoadingSpinner } from '../components/LoadingSpinner';
import type { MyVote } from '../types';

export function VotePage() {
  const { t } = useTranslation();
  const { id } = useParams();
  const { poll, loading } = usePoll(id);
  const { pollState, voteCounts } = usePollState(id);
  const [myVotes, setMyVotes] = useState<MyVote[]>([]);
  const [selectedOptions, setSelectedOptions] = useState<string[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [hasVotedCurrent, setHasVotedCurrent] = useState(false);

  const fetchMyVotes = useCallback(async () => {
    if (!id) return;
    try { const data = await api.get<{ votes: MyVote[] }>(`/polls/${id}/my-votes`); setMyVotes(data.votes); } catch {}
  }, [id]);

  useEffect(() => { fetchMyVotes(); }, [fetchMyVotes]);

  const effectiveStatus = pollState?.status || poll?.status || 'draft';
  const currentIndex = pollState?.currentQuestionIndex ?? 0;
  const questionMode = pollState?.questionMode;
  const questions = poll?.questions || [];
  const currentQuestion = questions[currentIndex];

  useEffect(() => {
    if (currentQuestion) {
      const existing = myVotes.find(v => v.questionId === currentQuestion.id);
      if (existing) { setSelectedOptions(existing.optionIds); setHasVotedCurrent(true); }
      else { setSelectedOptions([]); setHasVotedCurrent(false); }
    }
  }, [currentQuestion?.id, myVotes]);

  const handleOptionToggle = (optionId: string) => {
    if (!currentQuestion) return;
    if (currentQuestion.type === 'single') { setSelectedOptions([optionId]); }
    else { setSelectedOptions(prev => prev.includes(optionId) ? prev.filter(x => x !== optionId) : [...prev, optionId]); }
  };

  const handleSubmit = async () => {
    if (!currentQuestion || selectedOptions.length === 0) return;
    setSubmitting(true);
    try {
      await api.post(`/polls/${id}/vote`, { questionId: currentQuestion.id, optionIds: selectedOptions });
      setHasVotedCurrent(true);
      setMyVotes(prev => {
        const filtered = prev.filter(v => v.questionId !== currentQuestion.id);
        return [...filtered, { questionId: currentQuestion.id, optionIds: selectedOptions }];
      });
      toast.success(t('vote_recorded'));
    } catch (err: any) { toast.error(err.message); }
    finally { setSubmitting(false); }
  };

  if (loading) return <LoadingSpinner />;
  if (!poll) return <div className="text-center py-12 text-red-500">{t('error')}</div>;

  if (effectiveStatus === 'draft') {
    return (<div className="text-center py-16"><PollStatusBadge status="draft" /><h2 className="text-xl font-bold mt-4">{poll.title}</h2><p className="text-gray-500 mt-4">{t('waiting_for_start')}</p></div>);
  }
  if (effectiveStatus === 'finished') {
    return (<div className="text-center py-16"><PollStatusBadge status="finished" /><h2 className="text-xl font-bold mt-4">{poll.title}</h2><p className="text-gray-500 mt-4">{t('poll_ended')}</p></div>);
  }

  const counts = currentQuestion ? voteCounts[currentQuestion.id] || {} : {};
  const totalVotes = Object.values(counts).reduce((a, b) => a + Math.max(0, b), 0);

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold">{poll.title}</h1>
          <p className="text-sm text-gray-500">{t('question_x_of_y', { x: currentIndex + 1, y: questions.length })}</p>
        </div>
        <PollStatusBadge status="active" />
      </div>
      {questionMode === 'preview' && (
        <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4 text-center">
          {currentQuestion && <h3 className="font-medium mb-2">{currentQuestion.text}</h3>}
          <p className="text-sm text-yellow-800">{t('waiting_for_unlock')}</p>
        </div>
      )}
      {questionMode === 'open' && currentQuestion && (
        <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6 space-y-4">
          <h3 className="text-lg font-medium">{currentQuestion.text}</h3>
          {!hasVotedCurrent ? (
            <>
              <div className="space-y-2">
                {currentQuestion.options.map((opt) => (
                  <label key={opt.id} className={`flex items-center gap-3 p-3 rounded-lg border cursor-pointer transition-colors ${selectedOptions.includes(opt.id) ? 'border-blue-500 bg-blue-50' : 'border-gray-200 hover:border-gray-300'}`}>
                    <input type={currentQuestion.type === 'single' ? 'radio' : 'checkbox'} name="vote"
                      checked={selectedOptions.includes(opt.id)} onChange={() => handleOptionToggle(opt.id)} className="accent-blue-600" />
                    <span>{opt.text}</span>
                  </label>
                ))}
              </div>
              <button onClick={handleSubmit} disabled={submitting || selectedOptions.length === 0}
                className="w-full py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 font-medium">
                {t('submit_vote')}
              </button>
            </>
          ) : (
            <div className="space-y-4">
              <div className="bg-green-50 border border-green-200 rounded-lg p-3 text-center text-green-800 text-sm">{t('vote_recorded')}</div>
              <button onClick={() => setHasVotedCurrent(false)} className="text-blue-600 text-sm hover:underline">{t('change_vote')}</button>
            </div>
          )}
          {poll.allowStatsView && totalVotes > 0 && (
            <div className="pt-4 border-t border-gray-100">
              <BarChart options={currentQuestion.options.map((o) => ({
                label: o.text, count: Math.max(0, counts[o.id] || 0),
                percentage: totalVotes > 0 ? Math.round((Math.max(0, counts[o.id] || 0) / totalVotes) * 100) : 0,
                highlighted: selectedOptions.includes(o.id),
              }))} />
            </div>
          )}
        </div>
      )}
    </div>
  );
}
