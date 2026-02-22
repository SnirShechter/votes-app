import { useState, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import toast from 'react-hot-toast';
import { api } from '../../api';
import type { Member } from '../../types';

interface Props { pollId: string; }

export function ParticipantsTab({ pollId }: Props) {
  const { t } = useTranslation();
  const [members, setMembers] = useState<Member[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchMembers = useCallback(async () => {
    try {
      const data = await api.get<Member[]>(`/polls/${pollId}/members`);
      setMembers(data);
    } catch (err: any) { toast.error(err.message); }
    finally { setLoading(false); }
  }, [pollId]);

  useEffect(() => { fetchMembers(); }, [fetchMembers]);

  const changeRole = async (sub: string, newRole: 'admin' | 'voter') => {
    try { await api.put(`/polls/${pollId}/members/${encodeURIComponent(sub)}/role`, { role: newRole }); fetchMembers(); }
    catch (err: any) { toast.error(err.message); }
  };

  const removeMember = async (sub: string) => {
    try { await api.del(`/polls/${pollId}/members/${encodeURIComponent(sub)}`); fetchMembers(); }
    catch (err: any) { toast.error(err.message); }
  };

  if (loading) return <div className="py-4 text-center text-gray-500">{t('loading')}</div>;

  return (
    <div className="bg-white rounded-lg shadow-sm border border-gray-200">
      {members.map((m) => (
        <div key={m.userSub} className="flex items-center justify-between p-4 border-b border-gray-100 last:border-0">
          <div>
            <p className="font-medium text-sm">{m.name || m.userSub}</p>
            <p className="text-xs text-gray-500">{m.role === 'admin' ? t('admin') : t('voter')}</p>
          </div>
          <div className="flex gap-2">
            {m.role === 'voter' ? (
              <button onClick={() => changeRole(m.userSub, 'admin')} className="text-xs text-blue-600 hover:underline">{t('make_admin')}</button>
            ) : (
              <button onClick={() => changeRole(m.userSub, 'voter')} className="text-xs text-orange-600 hover:underline">{t('remove_admin')}</button>
            )}
            <button onClick={() => removeMember(m.userSub)} className="text-xs text-red-600 hover:underline">{t('remove_member')}</button>
          </div>
        </div>
      ))}
    </div>
  );
}
