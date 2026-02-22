import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import toast from 'react-hot-toast';
import { api } from '../../api';
import { BarChart } from '../../components/BarChart';
import type { Poll, PollState } from '../../types';

interface Props {
  poll: Poll;
  pollState: PollState | null;
  voteCounts: Record<string, Record<string, number>>;
  onRefetch: () => void;
}

export function ControlTab({ poll, pollState, voteCounts, onRefetch }: Props) {
  const { t } = useTranslation();
  const effectiveStatus = pollState?.status || poll.status;
  const questions = poll.questions || [];
  const currentIndex = pollState?.currentQuestionIndex ?? 0;
  const currentQuestion = questions[currentIndex];
  const questionMode = pollState?.questionMode;

  const handleStart = async () => {
    try { await api.post(`/polls/${poll.id}/start`); onRefetch(); } catch (err: any) { toast.error(err.message); }
  };
  const handleUnlock = async () => {
    try { await api.post(`/polls/${poll.id}/unlock`); } catch (err: any) { toast.error(err.message); }
  };
  const handleAdvance = async () => {
    try { await api.post(`/polls/${poll.id}/advance`); } catch (err: any) { toast.error(err.message); }
  };
  const handleFinish = async () => {
    try { await api.post(`/polls/${poll.id}/finish`); onRefetch(); } catch (err: any) { toast.error(err.message); }
  };

  if (effectiveStatus === 'draft') {
    return (
      <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6 text-center space-y-4">
        <p className="text-gray-500">{t('questions')}: {questions.length}</p>
        <div className="flex gap-3 justify-center">
          <Link to={`/polls/${poll.id}/edit`}
            className="px-4 py-2 border border-gray-300 rounded-lg text-sm hover:bg-gray-50">
            {t('edit_poll')}
          </Link>
          <button onClick={handleStart}
            className="px-6 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 text-sm font-medium">
            {t('start_poll')}
          </button>
        </div>
      </div>
    );
  }

  if (effectiveStatus === 'finished') {
    return (
      <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6 text-center space-y-4">
        <p className="text-gray-500">{t('poll_ended')}</p>
        <div className="flex gap-3 justify-center">
          <Link to={`/polls/${poll.id}/results`}
            className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm hover:bg-blue-700">
            {t('show_results')}
          </Link>
          <a href={`/api/polls/${poll.id}/results/export`}
            className="px-4 py-2 border border-gray-300 rounded-lg text-sm hover:bg-gray-50">
            {t('export_csv')}
          </a>
        </div>
      </div>
    );
  }

  const counts = currentQuestion ? voteCounts[currentQuestion.id] || {} : {};
  const barOptions = currentQuestion
    ? currentQuestion.options.map((o) => {
        const total = Object.values(counts).reduce((a, b) => a + Math.max(0, b), 0);
        const count = Math.max(0, counts[o.id] || 0);
        return { label: o.text, count, percentage: total > 0 ? Math.round((count / total) * 100) : 0 };
      })
    : [];

  return (
    <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6 space-y-4">
      {currentQuestion && (
        <>
          <p className="text-sm text-gray-500">
            {t('question_x_of_y', { x: currentIndex + 1, y: questions.length })}
          </p>
          <h3 className="text-lg font-medium">&ldquo;{currentQuestion.text}&rdquo;</h3>
          {questionMode === 'preview' && (
            <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-3 text-sm text-yellow-800">
              {t('question_preview_msg')}
            </div>
          )}
          {barOptions.length > 0 && <BarChart options={barOptions} />}
          <div className="flex flex-wrap gap-3 pt-2">
            {questionMode === 'preview' && (
              <button onClick={handleUnlock}
                className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm hover:bg-blue-700">
                {t('unlock_voting')}
              </button>
            )}
            {currentIndex < questions.length - 1 && (
              <button onClick={handleAdvance}
                className="px-4 py-2 border border-gray-300 rounded-lg text-sm hover:bg-gray-50">
                {t('next_question')}
              </button>
            )}
            <button onClick={handleFinish}
              className="px-4 py-2 bg-red-600 text-white rounded-lg text-sm hover:bg-red-700">
              {t('finish_poll')}
            </button>
          </div>
        </>
      )}
    </div>
  );
}
