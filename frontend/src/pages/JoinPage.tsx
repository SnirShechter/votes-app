import { useEffect, useRef, useState } from 'react';
import { useParams, useNavigate } from 'react-router';
import { useTranslation } from 'react-i18next';
import toast from 'react-hot-toast';
import { api } from '../api';
import { LoadingSpinner } from '../components/LoadingSpinner';

export function JoinPage() {
  const { t } = useTranslation();
  const { token } = useParams();
  const navigate = useNavigate();
  const [error, setError] = useState<string | null>(null);
  const processed = useRef(false);

  useEffect(() => {
    if (!token || processed.current) return;
    processed.current = true;
    api.post<{ pollId: string; role?: string }>(`/join/${token}`)
      .then((result) => { toast.success(t('joining')); navigate(`/polls/${result.pollId}/vote`, { replace: true }); })
      .catch((err) => { setError(err.message); toast.error(t('invalid_invite')); });
  }, [token]);

  if (error) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <p className="text-red-500 mb-4">{t('invalid_invite')}</p>
          <button onClick={() => navigate('/')} className="text-blue-600 hover:underline">{t('app_title')}</button>
        </div>
      </div>
    );
  }
  return <LoadingSpinner />;
}
