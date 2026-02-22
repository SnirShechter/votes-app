import { useState } from 'react';
import { useNavigate } from 'react-router';
import { useTranslation } from 'react-i18next';
import toast from 'react-hot-toast';
import { api } from '../api';
import type { Poll } from '../types';

interface QuestionForm {
  text: string;
  type: 'single' | 'multi';
  options: { text: string }[];
}

export function CreatePoll() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [allowStatsView, setAllowStatsView] = useState(true);
  const [isAnonymous, setIsAnonymous] = useState(true);
  const [questions, setQuestions] = useState<QuestionForm[]>([
    { text: '', type: 'single', options: [{ text: '' }, { text: '' }] },
  ]);
  const [saving, setSaving] = useState(false);

  const addQuestion = () => {
    setQuestions([...questions, { text: '', type: 'single', options: [{ text: '' }, { text: '' }] }]);
  };

  const removeQuestion = (qi: number) => {
    if (questions.length <= 1) return;
    setQuestions(questions.filter((_, i) => i !== qi));
  };

  const updateQuestion = (qi: number, field: string, value: any) => {
    const updated = [...questions];
    (updated[qi] as any)[field] = value;
    setQuestions(updated);
  };

  const addOption = (qi: number) => {
    if (questions[qi].options.length >= 5) return;
    const updated = [...questions];
    updated[qi].options.push({ text: '' });
    setQuestions(updated);
  };

  const removeOption = (qi: number, oi: number) => {
    if (questions[qi].options.length <= 2) return;
    const updated = [...questions];
    updated[qi].options = updated[qi].options.filter((_, i) => i !== oi);
    setQuestions(updated);
  };

  const updateOption = (qi: number, oi: number, text: string) => {
    const updated = [...questions];
    updated[qi].options[oi].text = text;
    setQuestions(updated);
  };

  const handleSubmit = async () => {
    if (!title.trim()) {
      toast.error('Title required');
      return;
    }
    for (const q of questions) {
      if (!q.text.trim()) {
        toast.error('All questions need text');
        return;
      }
      for (const o of q.options) {
        if (!o.text.trim()) {
          toast.error('All options need text');
          return;
        }
      }
    }

    setSaving(true);
    try {
      const poll = await api.post<Poll>('/polls', {
        title,
        description: description || undefined,
        allowStatsView,
        isAnonymous,
        questions,
      });
      toast.success('Poll created!');
      navigate(`/polls/${poll.id}/manage`);
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">{t('create_poll_title')}</h1>

      <div className="bg-white rounded-lg border border-gray-200 p-6 space-y-4">
        <div>
          <label className="block text-sm font-medium mb-1">{t('poll_name')}</label>
          <input
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg"
          />
        </div>

        <div>
          <label className="block text-sm font-medium mb-1">{t('poll_description')}</label>
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg"
            rows={2}
          />
        </div>

        <div className="flex flex-col gap-2">
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={allowStatsView}
              onChange={(e) => setAllowStatsView(e.target.checked)}
              className="rounded"
            />
            <span className="text-sm">{t('allow_stats')}</span>
          </label>
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={isAnonymous}
              onChange={(e) => setIsAnonymous(e.target.checked)}
              className="rounded"
            />
            <span className="text-sm">{t('anonymous_voting')}</span>
          </label>
        </div>
      </div>

      <div className="space-y-4">
        <h2 className="text-lg font-semibold">{t('questions')}</h2>

        {questions.map((q, qi) => (
          <div key={qi} className="bg-white rounded-lg border border-gray-200 p-4 space-y-3">
            <div className="flex items-center justify-between">
              <span className="font-medium text-sm text-gray-500">#{qi + 1}</span>
              {questions.length > 1 && (
                <button
                  onClick={() => removeQuestion(qi)}
                  className="text-red-500 text-sm hover:underline"
                >
                  ✕
                </button>
              )}
            </div>

            <input
              type="text"
              value={q.text}
              onChange={(e) => updateQuestion(qi, 'text', e.target.value)}
              placeholder={t('question_text')}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg"
            />

            <div className="flex gap-4">
              <label className="flex items-center gap-1 text-sm">
                <input
                  type="radio"
                  checked={q.type === 'single'}
                  onChange={() => updateQuestion(qi, 'type', 'single')}
                />
                {t('single_choice')}
              </label>
              <label className="flex items-center gap-1 text-sm">
                <input
                  type="radio"
                  checked={q.type === 'multi'}
                  onChange={() => updateQuestion(qi, 'type', 'multi')}
                />
                {t('multi_choice')}
              </label>
            </div>

            <div className="space-y-2">
              {q.options.map((o, oi) => (
                <div key={oi} className="flex items-center gap-2">
                  <input
                    type="text"
                    value={o.text}
                    onChange={(e) => updateOption(qi, oi, e.target.value)}
                    placeholder={`${t('option')} ${oi + 1}`}
                    className="flex-1 px-3 py-2 border border-gray-300 rounded-lg"
                  />
                  {q.options.length > 2 && (
                    <button
                      onClick={() => removeOption(qi, oi)}
                      className="text-red-400 hover:text-red-600"
                    >
                      ✕
                    </button>
                  )}
                </div>
              ))}
              {q.options.length < 5 && (
                <button
                  onClick={() => addOption(qi)}
                  className="text-sm text-blue-600 hover:underline"
                >
                  {t('add_option')}
                </button>
              )}
            </div>
          </div>
        ))}

        <button
          onClick={addQuestion}
          className="w-full py-2 border-2 border-dashed border-gray-300 rounded-lg text-gray-500 hover:border-blue-400 hover:text-blue-600"
        >
          {t('add_question')}
        </button>
      </div>

      <button
        onClick={handleSubmit}
        disabled={saving}
        className="w-full py-3 bg-blue-600 text-white rounded-lg font-semibold hover:bg-blue-700 disabled:opacity-50"
      >
        {t('save_draft')}
      </button>
    </div>
  );
}
