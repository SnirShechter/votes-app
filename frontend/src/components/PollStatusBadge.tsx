import { useTranslation } from 'react-i18next';

interface Props {
  status: 'draft' | 'active' | 'finished';
}

export function PollStatusBadge({ status }: Props) {
  const { t } = useTranslation();
  const colors = {
    draft: 'bg-gray-200 text-gray-700',
    active: 'bg-green-100 text-green-800',
    finished: 'bg-blue-100 text-blue-800',
  };

  return (
    <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${colors[status]}`}>
      {t(`status_${status}`)}
    </span>
  );
}
