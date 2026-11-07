import React, { useState } from 'react';
import { X } from 'lucide-react';
import { Classroom, ChoiceCount, Contest, Language, SheetFormId } from '../types';
import { SHEET_FORM_LABELS } from '../i18n';
import { getFormCapacity } from '../sheets/sheetLayouts';
import { uid } from '../storage/db';

interface Props {
  lang: Language;
  classes: Classroom[];
  defaultFormId: SheetFormId;
  defaultQuestions: number;
  defaultMaxScore: number;
  initial?: Contest | null;
  onClose: () => void;
  onSave: (contest: Contest) => void;
}

export const CreateContestModal: React.FC<Props> = ({
  lang,
  classes,
  defaultFormId,
  defaultQuestions,
  defaultMaxScore,
  initial,
  onClose,
  onSave,
}) => {
  const [name, setName] = useState(initial?.name || '');
  const [formId, setFormId] = useState<SheetFormId>(initial?.formId || defaultFormId);
  const [classId, setClassId] = useState<string>(initial?.classId || '');
  const [choiceCount, setChoiceCount] = useState<ChoiceCount>(initial?.choiceCount || 4);
  const [sbdDigits, setSbdDigits] = useState<6 | 8>(initial?.sbdDigits || 6);
  const [examCodeDigits, setExamCodeDigits] = useState<3 | 4>(
    initial?.examCodeDigits || (formId === 'bgd_2025' ? 4 : 3)
  );

  // Standard
  const [totalQuestions, setTotalQuestions] = useState<number>(
    initial?.totalQuestions || defaultQuestions
  );
  const [maxScore, setMaxScore] = useState<number>(initial?.maxScore || defaultMaxScore);

  // BGD-2025
  const [enablePart1, setEnablePart1] = useState<boolean>(initial?.enablePart1 ?? true);
  const [part1Questions, setPart1Questions] = useState<number>(initial?.part1Questions ?? 12);
  const [part1TotalScore, setPart1TotalScore] = useState<number>(initial?.part1TotalScore ?? 3.0);

  const [enablePart2, setEnablePart2] = useState<boolean>(initial?.enablePart2 ?? true);
  const [part2Questions, setPart2Questions] = useState<number>(initial?.part2Questions ?? 4);
  const [part2Score1, setPart2Score1] = useState<number>(initial?.part2Score1 ?? 0.1);
  const [part2Score2, setPart2Score2] = useState<number>(initial?.part2Score2 ?? 0.25);
  const [part2Score3, setPart2Score3] = useState<number>(initial?.part2Score3 ?? 0.5);
  const [part2Score4, setPart2Score4] = useState<number>(initial?.part2Score4 ?? 1.0);

  const [enablePart3, setEnablePart3] = useState<boolean>(initial?.enablePart3 ?? true);
  const [part3Questions, setPart3Questions] = useState<number>(initial?.part3Questions ?? 6);
  const [part3TotalScore, setPart3TotalScore] = useState<number>(initial?.part3TotalScore ?? 3.0);

  const [enablePart4Essay, setEnablePart4Essay] = useState<boolean>(
    initial?.enablePart4Essay ?? false
  );
  const [part4MaxScore, setPart4MaxScore] = useState<number>(initial?.part4MaxScore ?? 2.0);

  const handleFormChange = (next: SheetFormId) => {
    setFormId(next);
    if (next !== 'bgd_2025') {
      const cap = getFormCapacity(next);
      if (totalQuestions > cap) setTotalQuestions(cap);
      else setTotalQuestions(cap);
    } else {
      setExamCodeDigits(4);
    }
  };

  const computedBgdTotal =
    (enablePart1 ? part1TotalScore : 0) +
    (enablePart2 ? part2Questions * part2Score4 : 0) +
    (enablePart3 ? part3TotalScore : 0) +
    (enablePart4Essay ? part4MaxScore : 0);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed =
      name.trim() ||
      (lang === 'vi' ? 'Bài kiểm tra mới' : 'New Multiple Choice Test');

    const cap = getFormCapacity(formId);
    const saved: Contest = {
      id: initial?.id || uid('cnt'),
      name: trimmed,
      createdAt: initial?.createdAt || new Date().toISOString().slice(0, 10),
      classId: classId || null,
      formId,
      choiceCount: formId === 'bgd_2025' ? 4 : choiceCount,
      sbdDigits,
      examCodeDigits,
      totalQuestions: Math.min(cap, Math.max(1, totalQuestions)),
      maxScore: formId === 'bgd_2025' ? Number(computedBgdTotal.toFixed(2)) : maxScore,
      subjectSplits: initial?.subjectSplits || [],
      enablePart1,
      part1Questions: Math.min(40, Math.max(1, part1Questions)),
      part1TotalScore,
      enablePart2,
      part2Questions: Math.min(8, Math.max(1, part2Questions)),
      part2Score1,
      part2Score2,
      part2Score3,
      part2Score4,
      enablePart3,
      part3Questions: Math.min(6, Math.max(1, part3Questions)),
      part3TotalScore,
      enablePart4Essay,
      part4MaxScore,
    };
    onSave(saved);
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-sheet" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h3>
            {initial
              ? lang === 'vi'
                ? 'Chỉnh sửa bài thi'
                : 'Edit Test'
              : lang === 'vi'
                ? 'Tạo bài thi mới'
                : 'Create New Test'}
          </h3>
          <button type="button" className="icon-btn" onClick={onClose} aria-label="Close">
            <X size={20} />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="modal-body">
          <label className="field-label">
            <span>{lang === 'vi' ? 'Tên bài thi' : 'Test Name'}</span>
            <input
              type="text"
              className="text-input"
              placeholder={lang === 'vi' ? 'VD: Kiểm tra Giữa kỳ Toán 12' : 'e.g. Midterm Math Grade 12'}
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
            />
          </label>

          <label className="field-label">
            <span>{lang === 'vi' ? 'Mẫu phiếu trả lời' : 'Answer Sheet Form'}</span>
            <select
              className="text-input"
              value={formId}
              onChange={(e) => handleFormChange(e.target.value as SheetFormId)}
            >
              {(Object.keys(SHEET_FORM_LABELS) as SheetFormId[]).map((fid) => (
                <option key={fid} value={fid}>
                  {SHEET_FORM_LABELS[fid][lang]}
                </option>
              ))}
            </select>
            <small className="field-hint">
              {SHEET_FORM_LABELS[formId][lang === 'vi' ? 'descVi' : 'descEn']}
            </small>
          </label>

          <div className="grid-2">
            <label className="field-label">
              <span>{lang === 'vi' ? 'Lớp học liên kết' : 'Linked Class'}</span>
              <select
                className="text-input"
                value={classId}
                onChange={(e) => setClassId(e.target.value)}
              >
                <option value="">{lang === 'vi' ? '— Không chọn lớp —' : '— No Class —'}</option>
                {classes.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </label>

            <label className="field-label">
              <span>{lang === 'vi' ? 'Cấu hình SBD & Mã đề' : 'ID & Code Digits'}</span>
              <div className="seg-row">
                <select
                  className="text-input"
                  value={sbdDigits}
                  onChange={(e) => setSbdDigits(Number(e.target.value) as 6 | 8)}
                >
                  <option value={6}>6 SBD</option>
                  <option value={8}>8 SBD</option>
                </select>
                <select
                  className="text-input"
                  value={examCodeDigits}
                  onChange={(e) => setExamCodeDigits(Number(e.target.value) as 3 | 4)}
                >
                  <option value={3}>3 MĐ</option>
                  <option value={4}>4 MĐ</option>
                </select>
              </div>
            </label>
          </div>

          {formId !== 'bgd_2025' ? (
            <div className="section-box">
              <div className="grid-3">
                <label className="field-label">
                  <span>{lang === 'vi' ? 'Số câu hỏi' : 'Questions'}</span>
                  <input
                    type="number"
                    min={1}
                    max={getFormCapacity(formId)}
                    className="text-input"
                    value={totalQuestions}
                    onChange={(e) => setTotalQuestions(Number(e.target.value))}
                  />
                </label>
                <label className="field-label">
                  <span>{lang === 'vi' ? 'Thang điểm' : 'Max Score'}</span>
                  <input
                    type="number"
                    step="0.5"
                    min={1}
                    max={1000}
                    className="text-input"
                    value={maxScore}
                    onChange={(e) => setMaxScore(Number(e.target.value))}
                  />
                </label>
                <label className="field-label">
                  <span>{lang === 'vi' ? 'Số lựa chọn' : 'Options'}</span>
                  <select
                    className="text-input"
                    value={choiceCount}
                    onChange={(e) => setChoiceCount(Number(e.target.value) as ChoiceCount)}
                  >
                    <option value={4}>4 (A–D)</option>
                    <option value={5}>5 (A–E)</option>
                  </select>
                </label>
              </div>
            </div>
          ) : (
            <div className="section-box">
              <div className="part-header-row">
                <label className="check-row">
                  <input
                    type="checkbox"
                    checked={enablePart1}
                    onChange={(e) => setEnablePart1(e.target.checked)}
                  />
                  <strong>{lang === 'vi' ? 'Phần I: Nhiều lựa chọn (A–D)' : 'Part I: Multiple Choice (A–D)'}</strong>
                </label>
              </div>
              {enablePart1 && (
                <div className="grid-2">
                  <label className="field-label">
                    <span>{lang === 'vi' ? 'Số câu (1–40)' : 'Questions (1–40)'}</span>
                    <input
                      type="number"
                      min={1}
                      max={40}
                      className="text-input"
                      value={part1Questions}
                      onChange={(e) => setPart1Questions(Number(e.target.value))}
                    />
                  </label>
                  <label className="field-label">
                    <span>{lang === 'vi' ? 'Tổng điểm Phần I' : 'Part I Total Points'}</span>
                    <input
                      type="number"
                      step="0.25"
                      min={0.25}
                      className="text-input"
                      value={part1TotalScore}
                      onChange={(e) => setPart1TotalScore(Number(e.target.value))}
                    />
                  </label>
                </div>
              )}

              <hr className="divider" />

              <div className="part-header-row">
                <label className="check-row">
                  <input
                    type="checkbox"
                    checked={enablePart2}
                    onChange={(e) => setEnablePart2(e.target.checked)}
                  />
                  <strong>{lang === 'vi' ? 'Phần II: Đúng / Sai (4 ý a,b,c,d)' : 'Part II: True / False (a,b,c,d)'}</strong>
                </label>
              </div>
              {enablePart2 && (
                <>
                  <label className="field-label">
                    <span>{lang === 'vi' ? 'Số câu (1–8)' : 'Questions (1–8)'}</span>
                    <input
                      type="number"
                      min={1}
                      max={8}
                      className="text-input"
                      value={part2Questions}
                      onChange={(e) => setPart2Questions(Number(e.target.value))}
                    />
                  </label>
                  <div className="grid-4">
                    <label className="field-label">
                      <span>1 ý đúng</span>
                      <input
                        type="number"
                        step="0.05"
                        className="text-input"
                        value={part2Score1}
                        onChange={(e) => setPart2Score1(Number(e.target.value))}
                      />
                    </label>
                    <label className="field-label">
                      <span>2 ý đúng</span>
                      <input
                        type="number"
                        step="0.05"
                        className="text-input"
                        value={part2Score2}
                        onChange={(e) => setPart2Score2(Number(e.target.value))}
                      />
                    </label>
                    <label className="field-label">
                      <span>3 ý đúng</span>
                      <input
                        type="number"
                        step="0.05"
                        className="text-input"
                        value={part2Score3}
                        onChange={(e) => setPart2Score3(Number(e.target.value))}
                      />
                    </label>
                    <label className="field-label">
                      <span>4 ý đúng</span>
                      <input
                        type="number"
                        step="0.05"
                        className="text-input"
                        value={part2Score4}
                        onChange={(e) => setPart2Score4(Number(e.target.value))}
                      />
                    </label>
                  </div>
                </>
              )}

              <hr className="divider" />

              <div className="part-header-row">
                <label className="check-row">
                  <input
                    type="checkbox"
                    checked={enablePart3}
                    onChange={(e) => setEnablePart3(e.target.checked)}
                  />
                  <strong>{lang === 'vi' ? 'Phần III: Trả lời ngắn (Số)' : 'Part III: Short Numeric'}</strong>
                </label>
              </div>
              {enablePart3 && (
                <div className="grid-2">
                  <label className="field-label">
                    <span>{lang === 'vi' ? 'Số câu (1–6)' : 'Questions (1–6)'}</span>
                    <input
                      type="number"
                      min={1}
                      max={6}
                      className="text-input"
                      value={part3Questions}
                      onChange={(e) => setPart3Questions(Number(e.target.value))}
                    />
                  </label>
                  <label className="field-label">
                    <span>{lang === 'vi' ? 'Tổng điểm Phần III' : 'Part III Total Points'}</span>
                    <input
                      type="number"
                      step="0.25"
                      min={0.25}
                      className="text-input"
                      value={part3TotalScore}
                      onChange={(e) => setPart3TotalScore(Number(e.target.value))}
                    />
                  </label>
                </div>
              )}

              <hr className="divider" />

              <div className="part-header-row">
                <label className="check-row">
                  <input
                    type="checkbox"
                    checked={enablePart4Essay}
                    onChange={(e) => setEnablePart4Essay(e.target.checked)}
                  />
                  <strong>{lang === 'vi' ? 'Phần IV: Điểm Tự luận (nhập thêm)' : 'Part IV: Optional Essay Score'}</strong>
                </label>
              </div>
              {enablePart4Essay && (
                <label className="field-label">
                  <span>{lang === 'vi' ? 'Điểm tối đa Tự luận' : 'Max Essay Score'}</span>
                  <input
                    type="number"
                    step="0.25"
                    min={0.25}
                    className="text-input"
                    value={part4MaxScore}
                    onChange={(e) => setPart4MaxScore(Number(e.target.value))}
                  />
                </label>
              )}

              <div className="total-pill">
                {lang === 'vi' ? 'Tổng điểm toàn bài:' : 'Total Exam Score:'}{' '}
                <strong>{computedBgdTotal.toFixed(2)}</strong>
              </div>
            </div>
          )}

          <div className="modal-actions">
            <button type="button" className="secondary-btn" onClick={onClose}>
              {lang === 'vi' ? 'Hủy' : 'Cancel'}
            </button>
            <button type="submit" className="primary-btn">
              {initial
                ? lang === 'vi'
                  ? 'Lưu thay đổi'
                  : 'Save Changes'
                : lang === 'vi'
                  ? 'Tạo bài thi'
                  : 'Create Test'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
