import React, { useState } from 'react';
import { Sparkles, X } from 'lucide-react';
import {
  AnswerKey,
  Contest,
  Language,
  MCQChoice,
  TFChoice,
  TFQuestionAnswer,
} from '../types';
import { uid } from '../storage/db';

interface Props {
  lang: Language;
  contest: Contest;
  initial?: AnswerKey | null;
  onClose: () => void;
  onSave: (key: AnswerKey) => void;
}

export const KeyEditorModal: React.FC<Props> = ({
  lang,
  contest,
  initial,
  onClose,
  onSave,
}) => {
  const mcqLen = contest.formId === 'bgd_2025' ? contest.part1Questions : contest.totalQuestions;
  const opts: MCQChoice[] =
    contest.choiceCount === 5 && contest.formId !== 'bgd_2025'
      ? ['A', 'B', 'C', 'D', 'E']
      : ['A', 'B', 'C', 'D'];

  const [examCode, setExamCode] = useState(
    initial?.examCode || (contest.examCodeDigits === 4 ? '0102' : '102')
  );
  const [mcqAnswers, setMcqAnswers] = useState<MCQChoice[]>(() =>
    Array.from({ length: mcqLen }, (_, i) => initial?.mcqAnswers[i] || '')
  );
  const [tfAnswers, setTfAnswers] = useState<TFQuestionAnswer[]>(() =>
    Array.from({ length: contest.formId === 'bgd_2025' ? contest.part2Questions : 0 }, (_, i) =>
      initial?.tfAnswers[i]
        ? { ...initial.tfAnswers[i] }
        : { a: '', b: '', c: '', d: '' }
    )
  );
  const [shortAnswers, setShortAnswers] = useState<string[]>(() =>
    Array.from(
      { length: contest.formId === 'bgd_2025' ? contest.part3Questions : 0 },
      (_, i) => initial?.shortAnswers[i] || ''
    )
  );

  const handleAutoFillSample = () => {
    setMcqAnswers(
      Array.from({ length: mcqLen }, (_, i) => opts[(i * 3 + 1) % opts.length])
    );
    if (contest.formId === 'bgd_2025') {
      setTfAnswers(
        Array.from({ length: contest.part2Questions }, (_, i) => ({
          a: i % 2 === 0 ? 'T' : 'F',
          b: 'T',
          c: i % 2 === 0 ? 'F' : 'T',
          d: 'T',
        }))
      );
      const demoShorts = ['12,5', '-3', '2025', '0,5', '18', '-2,5'];
      setShortAnswers(
        Array.from({ length: contest.part3Questions }, (_, i) => demoShorts[i % demoShorts.length])
      );
    }
  };

  const toggleMcq = (qIdx: number, choice: MCQChoice) => {
    setMcqAnswers((prev) => {
      const next = [...prev];
      next[qIdx] = next[qIdx] === choice ? '' : choice;
      return next;
    });
  };

  const toggleTf = (qIdx: number, sub: keyof TFQuestionAnswer, val: TFChoice) => {
    setTfAnswers((prev) => {
      const next = [...prev];
      const cur = { ...next[qIdx] };
      cur[sub] = cur[sub] === val ? '' : val;
      next[qIdx] = cur;
      return next;
    });
  };

  const handleSave = (e: React.FormEvent) => {
    e.preventDefault();
    const cleanedCode = examCode.trim().padStart(contest.examCodeDigits, '0');
    onSave({
      id: initial?.id || uid('key'),
      contestId: contest.id,
      examCode: cleanedCode,
      createdAt: initial?.createdAt || new Date().toISOString().slice(0, 10),
      mcqAnswers,
      tfAnswers,
      shortAnswers,
    });
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-sheet large" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h3>
            {initial
              ? `${lang === 'vi' ? 'Sửa đáp án Mã đề' : 'Edit Key'} ${initial.examCode}`
              : lang === 'vi'
                ? 'Nhập đáp án mới'
                : 'New Answer Key'}
          </h3>
          <button type="button" className="icon-btn" onClick={onClose}>
            <X size={20} />
          </button>
        </div>

        <form onSubmit={handleSave} className="modal-body">
          <div className="row-between">
            <label className="field-label" style={{ flex: 1, marginBottom: 0 }}>
              <span>
                {lang === 'vi' ? 'Mã đề' : 'Exam Code'} ({contest.examCodeDigits}{' '}
                {lang === 'vi' ? 'chữ số' : 'digits'})
              </span>
              <input
                type="text"
                maxLength={contest.examCodeDigits}
                className="text-input mono-input"
                value={examCode}
                onChange={(e) => setExamCode(e.target.value.replace(/[^0-9]/g, ''))}
                required
              />
            </label>
            <button
              type="button"
              className="secondary-btn"
              style={{ alignSelf: 'flex-end' }}
              onClick={handleAutoFillSample}
            >
              <Sparkles size={15} />
              {lang === 'vi' ? 'Điền nhanh mẫu' : 'Quick Fill'}
            </button>
          </div>

          {(contest.formId !== 'bgd_2025' || contest.enablePart1) && (
            <div className="section-box">
              <h4 className="sub-heading">
                {contest.formId === 'bgd_2025'
                  ? lang === 'vi'
                    ? `Phần I — Trắc nghiệm (${mcqLen} câu)`
                    : `Part I — Multiple Choice (${mcqLen} Qs)`
                  : `${lang === 'vi' ? 'Đáp án câu hỏi' : 'Questions'} (1–${mcqLen})`}
              </h4>
              <div className="bubble-editor-grid">
                {mcqAnswers.map((ans, qi) => (
                  <div key={qi} className="bubble-row">
                    <span className="q-num">{qi + 1}.</span>
                    <div className="bubble-group">
                      {opts.map((opt) => (
                        <button
                          key={opt}
                          type="button"
                          className={`bubble-btn ${ans === opt ? 'selected' : ''}`}
                          onClick={() => toggleMcq(qi, opt)}
                        >
                          {opt}
                        </button>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {contest.formId === 'bgd_2025' && contest.enablePart2 && (
            <div className="section-box">
              <h4 className="sub-heading">
                {lang === 'vi'
                  ? `Phần II — Đúng / Sai (${contest.part2Questions} câu)`
                  : `Part II — True / False (${contest.part2Questions} Qs)`}
              </h4>
              <div className="tf-editor-grid">
                {tfAnswers.map((tf, qi) => (
                  <div key={qi} className="tf-card">
                    <div className="tf-card-title">Câu {qi + 1}</div>
                    {(['a', 'b', 'c', 'd'] as const).map((sub) => (
                      <div key={sub} className="tf-sub-row">
                        <span className="q-num">{sub})</span>
                        <div className="bubble-group">
                          <button
                            type="button"
                            className={`bubble-btn ${tf[sub] === 'T' ? 'selected' : ''}`}
                            onClick={() => toggleTf(qi, sub, 'T')}
                          >
                            Đ
                          </button>
                          <button
                            type="button"
                            className={`bubble-btn ${tf[sub] === 'F' ? 'selected-alt' : ''}`}
                            onClick={() => toggleTf(qi, sub, 'F')}
                          >
                            S
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                ))}
              </div>
            </div>
          )}

          {contest.formId === 'bgd_2025' && contest.enablePart3 && (
            <div className="section-box">
              <h4 className="sub-heading">
                {lang === 'vi'
                  ? `Phần III — Trả lời ngắn (${contest.part3Questions} câu, tối đa 4 ký tự: -, ,, 0–9)`
                  : `Part III — Short Numeric (${contest.part3Questions} Qs, max 4 chars: -, ,, 0–9)`}
              </h4>
              <div className="grid-3">
                {shortAnswers.map((val, qi) => (
                  <label key={qi} className="field-label">
                    <span>Câu {qi + 1}</span>
                    <input
                      type="text"
                      maxLength={4}
                      placeholder="VD: -1,5"
                      className="text-input mono-input"
                      value={val}
                      onChange={(e) => {
                        const cleaned = e.target.value.replace(/[^0-9.,-]/g, '').slice(0, 4);
                        setShortAnswers((prev) => {
                          const next = [...prev];
                          next[qi] = cleaned;
                          return next;
                        });
                      }}
                    />
                  </label>
                ))}
              </div>
            </div>
          )}

          <div className="modal-actions">
            <button type="button" className="secondary-btn" onClick={onClose}>
              {lang === 'vi' ? 'Hủy' : 'Cancel'}
            </button>
            <button type="submit" className="primary-btn">
              {lang === 'vi' ? 'Lưu mã đề' : 'Save Answer Key'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
