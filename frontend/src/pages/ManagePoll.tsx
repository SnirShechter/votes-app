import { useState } from 'react';
import { useParams, Link } from 'react-router';
import { useTranslation } from 'react-i18next';
import { usePoll } from '../hooks/usePolls';
import { usePollState } from '../hooks/usePollState';
import { PollStatusBadge } from '../components/PollStatusBadge';
import { LoadingSpinner } from '../components/LoadingSpinner';
import { ControlTab } from './ManageTabs/ControlTab';
import { ParticipantsTab } from './ManageTabs/ParticipantsTab';
import { InvitesTab } from './ManageTabs/InvitesTab';

export function ManagePoll() {
  const { t } = useTranslation();
  const { id } = useParams();
  const { poll, loading, refetch } = usePoll(id);
  const { pollState, voteCounts, connected } = usePollState(id);
  const [activeTab, setActiveTab] = useState<'control' | 'participants' | 'invites'>('control');
  const [copied, setCopied] = useState(false);

  if (loading) return <LoadingSpinner />;
  if (!poll) return <div className="text-center py-12 text-red-500">{t('error')}</div>;

  const effectiveStatus = pollState?.status || poll.status;

  const copyCode = () => {
    navigator.clipboard.writeText(poll.joinCode);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const copyLink = () => {
    navigator.clipboard.writeText(`${window.location.origin}/join/${poll.joinCode}`);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const tabs = [
    { key: 'control' as const, label: t('tab_control') },
    { key: 'participants' as const, label: t('tab_participants') },
    { key: 'invites' as const, label: t('tab_invites') },
  ];

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <h1 className="text-2xl font-bold">{poll.title}</h1>
            <PollStatusBadge status={effectiveStatus as any} />
          </div>
          {connected && pollState && (
            <p className="text-sm text-gray-500">
              {pollState.onlineCount} {t('connected_now')}
            </p>
          )}
        </div>
        <Link to={`/polls/${id}/results`} className="text-blue-600 text-sm hover:underline">
          {t('show_results')}
        </Link>
      </div>

      <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-4">
        <div className="flex flex-wrap gap-4 text-sm">
          <div>
            <span className="text-gray-500">{t('join_code')}: </span>
            <span className="font-mono font-bold">{poll.joinCode}</span>
            <button onClick={copyCode} className="ms-2 text-blue-600 hover:underline text-xs">
              {copied ? t('copied') : t('copy')}
            </button>
          </div>
          <div>
            <span className="text-gray-500">{t('join_link')}: </span>
            <button onClick={copyLink} className="text-blue-600 hover:underline text-xs">
              {t('copy')}
            </button>
          </div>
        </div>
      </div>

      <div className="flex gap-1 border-b border-gray-200">
        {tabs.map((tab) => (
          <button key={tab.key} onClick={() => setActiveTab(tab.key)}
            className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px ${
              activeTab === tab.key ? 'border-blue-600 text-blue-600' : 'border-transparent text-gray-500 hover:text-gray-700'
            }`}>
            {tab.label}
          </button>
        ))}
      </div>

      {activeTab === 'control' && (
        <ControlTab poll={poll} pollState={pollState} voteCounts={voteCounts} onRefetch={refetch} />
      )}
      {activeTab === 'participants' && <ParticipantsTab pollId={poll.id} />}
      {activeTab === 'invites' && <InvitesTab pollId={poll.id} />}
    </div>
  );
}
