import { useState, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import toast from 'react-hot-toast';
import { api } from '../../api';
import type { Invite } from '../../types';

interface Props { pollId: string; }

export function InvitesTab({ pollId }: Props) {
  const { t } = useTranslation();
  const [invites, setInvites] = useState<Invite[]>([]);
  const [loading, setLoading] = useState(true);
  const [inviteType, setInviteType] = useState<'link' | 'email'>('link');
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<'voter' | 'admin'>('voter');
  const [expiresIn, setExpiresIn] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  const fetchInvites = useCallback(async () => {
    try { const data = await api.get<Invite[]>(`/polls/${pollId}/invites`); setInvites(data); }
    catch (err: any) { toast.error(err.message); }
    finally { setLoading(false); }
  }, [pollId]);

  useEffect(() => { fetchInvites(); }, [fetchInvites]);

  const createInvite = async () => {
    setCreating(true);
    try {
      await api.post(`/polls/${pollId}/invites`, {
        type: inviteType, email: inviteType === 'email' ? email : undefined, role, expiresIn,
      });
      setEmail('');
      fetchInvites();
      toast.success('Invite created!');
    } catch (err: any) { toast.error(err.message); }
    finally { setCreating(false); }
  };

  const deleteInvite = async (inviteId: string) => {
    try { await api.del(`/polls/${pollId}/invites/${inviteId}`); fetchInvites(); }
    catch (err: any) { toast.error(err.message); }
  };

  const copyUrl = (url: string) => { navigator.clipboard.writeText(url); toast.success(t('copied')); };

  return (
    <div className="space-y-4">
      <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-4 space-y-3">
        <div className="flex gap-4">
          <label className="flex items-center gap-1 text-sm">
            <input type="radio" checked={inviteType === 'link'} onChange={() => setInviteType('link')} />
            {t('create_link')}
          </label>
          <label className="flex items-center gap-1 text-sm">
            <input type="radio" checked={inviteType === 'email'} onChange={() => setInviteType('email')} />
            {t('invite_by_email')}
          </label>
        </div>
        {inviteType === 'email' && (
          <input type="email" value={email} onChange={(e) => setEmail(e.target.value)}
            placeholder={t('email')} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" />
        )}
        <div className="flex gap-4">
          <select value={role} onChange={(e) => setRole(e.target.value as any)}
            className="px-3 py-1.5 border border-gray-300 rounded-lg text-sm">
            <option value="voter">{t('voter')}</option>
            <option value="admin">{t('admin')}</option>
          </select>
          <select value={expiresIn || ''} onChange={(e) => setExpiresIn(e.target.value || null)}
            className="px-3 py-1.5 border border-gray-300 rounded-lg text-sm">
            <option value="">{t('no_expiry')}</option>
            <option value="hour">{t('hour')}</option>
            <option value="day">{t('day')}</option>
            <option value="week">{t('week')}</option>
          </select>
        </div>
        <button onClick={createInvite} disabled={creating}
          className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm hover:bg-blue-700 disabled:opacity-50">
          {inviteType === 'link' ? t('create_link') : t('invite_by_email')}
        </button>
      </div>
      {loading ? (
        <div className="text-center py-4 text-gray-500">{t('loading')}</div>
      ) : (
        <div className="bg-white rounded-lg shadow-sm border border-gray-200">
          {invites.length === 0 ? (
            <div className="p-4 text-center text-gray-500 text-sm">No invites yet</div>
          ) : invites.map((inv) => (
            <div key={inv.id} className="flex items-center justify-between p-3 border-b border-gray-100 last:border-0">
              <div className="text-sm">
                <span className="font-medium">{inv.type}</span>
                {inv.email && <span className="text-gray-500 ms-2">{inv.email}</span>}
                <span className="text-gray-400 ms-2">({inv.role})</span>
                <span className="text-gray-400 ms-2">{inv.useCount}{inv.maxUses ? `/${inv.maxUses}` : ''} used</span>
              </div>
              <div className="flex gap-2">
                <button onClick={() => copyUrl(inv.url)} className="text-xs text-blue-600 hover:underline">{t('copy')}</button>
                <button onClick={() => deleteInvite(inv.id)} className="text-xs text-red-600 hover:underline">x</button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
