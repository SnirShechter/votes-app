import { useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { useTranslation } from 'react-i18next';
import toast from 'react-hot-toast';
import { usePolls } from '../hooks/usePolls';
import { api } from '../api';
import { PollStatusBadge } from '../components/PollStatusBadge';
import { LoadingSpinner } from '../components/LoadingSpinner';

export function Dashboard() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { polls, loading } = usePolls();
  const [joinCode, setJoinCode] = useState('');
  const [joining, setJoining] = useState(false);

  const handleJoin = async () => {
    if (!joinCode.trim()) return;
    setJoining(true);
    try {
      const res = await api.post<{ pollId: string }>('/join/code', { code: joinCode });
      navigate(`/polls/${res.pollId}/vote`);
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setJoining(false);
    }
  };

  if (loading) return <LoadingSpinner />;

  const getPollLink = (poll: any) => {
    if (poll.myRole === 'admin') return `/polls/${poll.id}/manage`;
    if (poll.status === 'active') return `/polls/${poll.id}/vote`;
    if (poll.status === 'finished') return `/polls/${poll.id}/results`;
    return `/polls/${poll.id}/vote`;
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">{t('my_polls')}</h1>
        <Link
          to="/polls/new"
          className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 font-medium"
        >
          {t('new_poll')}
        </Link>
      </div>

      <div className="bg-white rounded-lg border border-gray-200 p-4">
        <label className="block text-sm font-medium mb-2">{t('join_with_code')}</label>
        <div className="flex gap-2">
          <input
            type="text"
            value={joinCode}
            onChange={(e) => setJoinCode(e.target.value.toUpperCase())}
            placeholder="ABC123"
            maxLength={6}
            className="flex-1 px-3 py-2 border border-gray-300 rounded-lg text-center text-lg tracking-widest uppercase"
            onKeyDown={(e) => e.key === 'Enter' && handleJoin()}
          />
          <button
            onClick={handleJoin}
            disabled={joining || joinCode.length < 6}
            className="px-6 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:opacity-50"
          >
            {t('join')}
          </button>
        </div>
      </div>

      <div className="space-y-3">
        {polls.map((poll) => (
          <Link
            key={poll.id}
            to={getPollLink(poll)}
            className="block bg-white rounded-lg border border-gray-200 p-4 hover:border-blue-300 transition-colors"
          >
            <div className="flex items-start justify-between">
              <div className="flex-1">
                <div className="flex items-center gap-2 mb-1">
                  <h3 className="font-semibold text-lg">{poll.title}</h3>
                  <PollStatusBadge status={poll.status} />
                </div>
                <p className="text-sm text-gray-500">
                  {t('participants')}: {poll.memberCount}
                </p>
              </div>
              <span className="text-blue-600 font-medium text-sm">{t('enter')} →</span>
            </div>
          </Link>
        ))}

        {polls.length === 0 && (
          <p className="text-center text-gray-500 py-8">{t('my_polls')} — empty</p>
        )}
      </div>
    </div>
  );
}
