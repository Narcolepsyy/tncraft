import React, { useEffect, useState } from 'react';
import { AlertTriangle, CheckCircle2, X } from 'lucide-react';
import {
  AnswerKey,
  Contest,
  Language,
  MCQChoice,
  Student,
  StudentPaper,
  TFChoice,
  TFQuestionAnswer,
} from '../types';
import {
  computePaperGrade,
  matchAnswerKey,
  normalizeNumericAnswer,
  resolveStudentFromRoster,
} from '../omr/grading';
import { loadPaperImage } from '../storage/db';

interface Props {
  lang: Language;
  contest: Contest;
  keys: AnswerKey[];
  students: Student[];
  existingPapers: StudentPaper[];
  paper: StudentPaper;
  onClose: () => void;
  onSave: (updated: StudentPaper) => void;
}

export const PaperRepairModal: React.FC<Props> = ({
  lang,
  contest,
  keys,
  students,
  existingPapers,
  paper,
  onClose,
  onSave,
}) => {
  const mcqLen =
    contest.formId === 'bgd_2025'
      ? contest.enablePart1
        ? contest.part1Questions
        : 0
      : contest.totalQuestions;
  const tfLen =
    contest.formId === 'bgd_2025' && contest.enablePart2 ? contest.part2Questions : 0;
  const shortLen =
    contest.formId === 'bgd_2025' && contest.enablePart3 ? contest.part3Questions : 0;

  const [sbd, setSbd] = useState(paper.sbd);
  const [examCode, setExamCode] = useState(paper.examCode);
  const [studentName, setStudentName] = useState(paper.studentName);
  const [roomName, setRoomName] = useState(paper.roomName);
  const [essayScore, setEssayScore] = useState<number>(paper.part4EssayScore || 0);
  const [mcqAnswers, setMcqAnswers] = useState<MCQChoice[]>(() =>
    Array.from({ length: mcqLen }, (_, i) => paper.mcqAnswers[i] || '')
  );
  const [tfAnswers, setTfAnswers] = useState<TFQuestionAnswer[]>(() =>
    Array.from({ length: tfLen }, (_, i) =>
      paper.tfAnswers[i] ? { ...paper.tfAnswers[i] } : { a: '', b: '', c: '', d: '' }
    )
  );
  const [shortAnswers, setShortAnswers] = useState<string[]>(() =>
    Array.from({ length: shortLen }, (_, i) => paper.shortAnswers[i] || '')
  );
  const [scanImage, setScanImage] = useState<string | null>(paper.annotatedImageDataUrl || null);

  useEffect(() => {
    if (!scanImage) {
      loadPaperImage(paper.id).then((img) => {
        if (img) setScanImage(img);
      });
    }
  }, [paper.id, scanImage]);

  const handleSbdChange = (val: string) => {
    setSbd(val);
    const matched = resolveStudentFromRoster(val, students, contest.classId);
    if (matched.studentName) {
      setStudentName(matched.studentName);
      setRoomName(matched.roomName);
    }
  };

  const liveGrade = computePaperGrade(
    contest,
    keys,
    sbd,
    examCode,
    mcqAnswers,
    tfAnswers,
    shortAnswers,
    essayScore,
    existingPapers,
    paper.id
  );

  const matchedKey = matchAnswerKey(keys, examCode).matchedKey;

  const opts: MCQChoice[] =
    contest.choiceCount === 5 && contest.formId !== 'bgd_2025'
      ? ['A', 'B', 'C', 'D', 'E']
      : ['A', 'B', 'C', 'D'];

  const handleSave = (e: React.FormEvent) => {
    e.preventDefault();
    onSave({
      ...paper,
      sbd,
      examCode,
      studentName,
      roomName,
      mcqAnswers: [...mcqAnswers, ...paper.mcqAnswers.slice(mcqAnswers.length)],
      tfAnswers: [...tfAnswers, ...paper.tfAnswers.slice(tfAnswers.length)],
      shortAnswers: [...shortAnswers, ...paper.shortAnswers.slice(shortAnswers.length)],
      part4EssayScore: essayScore,
      ...liveGrade,
    });
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-sheet large" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <div>
            <h3>
              {lang === 'vi' ? 'Chi tiết & Sửa bài chấm' : 'Review & Repair Graded Paper'}
            </h3>
            <small className="muted-text">
              {liveGrade.totalScore} / {liveGrade.maxPossibleScore}{' '}
              {lang === 'vi' ? 'điểm' : 'pts'}
            </small>
          </div>
          <button type="button" className="icon-btn" onClick={onClose}>
            <X size={20} />
          </button>
        </div>

        <form onSubmit={handleSave} className="modal-body">
          <div className="score-banner">
            <div>
              <div className="score-big">
                {liveGrade.totalScore} <span className="score-denom">/ {liveGrade.maxPossibleScore}</span>
              </div>
              {contest.formId === 'bgd_2025' && (
                <div className="score-parts">
                  P.I: {liveGrade.scorePart1} • P.II: {liveGrade.scorePart2} • P.III:{' '}
                  {liveGrade.scorePart3}
                  {contest.enablePart4Essay ? ` • TL: ${essayScore}` : ''}
                </div>
              )}
            </div>
            <div className="score-counts">
              <span className="badge-ok">✓ {liveGrade.correctCount}</span>
              <span className="badge-err">✗ {liveGrade.wrongCount}</span>
              <span className="badge-warn">∅ {liveGrade.blankCount}</span>
            </div>
          </div>

          {liveGrade.warnings.length > 0 && (
            <div className="warning-stack">
              {liveGrade.warnings.map((w, idx) => (
                <div key={idx} className="warning-item">
                  <AlertTriangle size={15} />
                  <span>{w.message}</span>
                </div>
              ))}
            </div>
          )}

          {scanImage && (
            <details className="scan-preview-details" open>
              <summary>
                {lang === 'vi' ? 'Ảnh phiếu đã chấm (vòng xanh = đúng, đỏ = sai)' : 'Annotated Scan Image'}
              </summary>
              <img src={scanImage} alt="Annotated scan" className="annotated-scan-img" />
            </details>
          )}

          <div className="grid-2">
            <label className="field-label">
              <span>{lang === 'vi' ? 'Số báo danh (SBD)' : 'Student ID'}</span>
              <input
                type="text"
                className="text-input mono-input"
                value={sbd}
                onChange={(e) => handleSbdChange(e.target.value)}
              />
            </label>
            <label className="field-label">
              <span>{lang === 'vi' ? 'Mã đề' : 'Exam Code'}</span>
              {keys.length > 0 ? (
                <div className="seg-row">
                  <input
                    type="text"
                    className="text-input mono-input"
                    style={{ minWidth: 74 }}
                    value={examCode}
                    onChange={(e) => setExamCode(e.target.value)}
                  />
                  <select
                    className="text-input"
                    value={
                      keys.some((k) => k.examCode === examCode.trim()) ? examCode.trim() : ''
                    }
                    onChange={(e) => {
                      if (e.target.value) setExamCode(e.target.value);
                    }}
                  >
                    <option value="">{lang === 'vi' ? 'Chọn mã...' : 'Pick...'}</option>
                    {keys.map((k) => (
                      <option key={k.id} value={k.examCode}>
                        {k.examCode}
                      </option>
                    ))}
                  </select>
                </div>
              ) : (
                <input
                  type="text"
                  className="text-input mono-input"
                  value={examCode}
                  onChange={(e) => setExamCode(e.target.value)}
                />
              )}
            </label>
          </div>

          <div className="grid-2">
            <label className="field-label">
              <span>{lang === 'vi' ? 'Họ và tên học sinh' : 'Student Name'}</span>
              <input
                type="text"
                className="text-input"
                value={studentName}
                placeholder={lang === 'vi' ? 'Tự động khớp theo SBD...' : 'Auto-matched from roster...'}
                onChange={(e) => setStudentName(e.target.value)}
              />
            </label>
            {contest.formId === 'bgd_2025' && contest.enablePart4Essay ? (
              <label className="field-label">
                <span>
                  {lang === 'vi' ? 'Điểm Tự luận (Phần IV)' : 'Essay Score (Part IV)'} (≤
                  {contest.part4MaxScore})
                </span>
                <input
                  type="number"
                  step="0.05"
                  min={0}
                  max={contest.part4MaxScore}
                  className="text-input"
                  value={essayScore}
                  onChange={(e) => setEssayScore(Number(e.target.value))}
                />
              </label>
            ) : (
              <label className="field-label">
                <span>{lang === 'vi' ? 'Phòng thi' : 'Room'}</span>
                <input
                  type="text"
                  className="text-input"
                  value={roomName}
                  onChange={(e) => setRoomName(e.target.value)}
                />
              </label>
            )}
          </div>

          {(contest.formId !== 'bgd_2025' || contest.enablePart1) && (
            <div className="section-box">
              <h4 className="sub-heading">
                {lang === 'vi' ? 'Chỉnh sửa câu trả lời Phần I' : 'Part I Answers (Tap to Repair)'}
              </h4>
              <div className="bubble-editor-grid">
                {mcqAnswers.map((ans, qi) => {
                  const keyAns = matchedKey?.mcqAnswers[qi] || '';
                  return (
                    <div key={qi} className="bubble-row">
                      <span className="q-num">{qi + 1}.</span>
                      <div className="bubble-group">
                        {opts.map((opt) => {
                          const isStudent = ans === opt;
                          const isKey = keyAns === opt;
                          let cls = 'bubble-btn';
                          if (isStudent && isKey) cls += ' correct';
                          else if (isStudent && !isKey) cls += ' wrong';
                          else if (!isStudent && isKey) cls += ' key-hint';
                          return (
                            <button
                              key={opt}
                              type="button"
                              className={cls}
                              onClick={() =>
                                setMcqAnswers((prev) => {
                                  const next = [...prev];
                                  next[qi] = next[qi] === opt ? '' : opt;
                                  return next;
                                })
                              }
                            >
                              {opt}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {contest.formId === 'bgd_2025' && contest.enablePart2 && (
            <div className="section-box">
              <h4 className="sub-heading">
                {lang === 'vi' ? 'Phần II — Đúng / Sai' : 'Part II — True / False'}
              </h4>
              <div className="tf-editor-grid">
                {tfAnswers.map((tf, qi) => (
                  <div key={qi} className="tf-card">
                    <div className="tf-card-title">Câu {qi + 1}</div>
                    {(['a', 'b', 'c', 'd'] as const).map((sub) => {
                      const sVal = tf[sub];
                      const kVal = matchedKey?.tfAnswers[qi]?.[sub] || '';
                      const makeClass = (target: TFChoice) => {
                        let c = 'bubble-btn';
                        if (sVal === target && kVal === target) c += ' correct';
                        else if (sVal === target && kVal !== target) c += ' wrong';
                        else if (sVal !== target && kVal === target) c += ' key-hint';
                        return c;
                      };
                      return (
                        <div key={sub} className="tf-sub-row">
                          <span className="q-num">{sub})</span>
                          <div className="bubble-group">
                            <button
                              type="button"
                              className={makeClass('T')}
                              onClick={() =>
                                setTfAnswers((prev) => {
                                  const next = [...prev];
                                  next[qi] = { ...next[qi], [sub]: sVal === 'T' ? '' : 'T' };
                                  return next;
                                })
                              }
                            >
                              Đ
                            </button>
                            <button
                              type="button"
                              className={makeClass('F')}
                              onClick={() =>
                                setTfAnswers((prev) => {
                                  const next = [...prev];
                                  next[qi] = { ...next[qi], [sub]: sVal === 'F' ? '' : 'F' };
                                  return next;
                                })
                              }
                            >
                              S
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                ))}
              </div>
            </div>
          )}

          {contest.formId === 'bgd_2025' && contest.enablePart3 && (
            <div className="section-box">
              <h4 className="sub-heading">
                {lang === 'vi' ? 'Phần III — Trả lời ngắn' : 'Part III — Short Numeric'}
              </h4>
              <div className="grid-3">
                {shortAnswers.map((val, qi) => {
                  const kVal = matchedKey?.shortAnswers[qi] || '';
                  const ok =
                    val.trim() &&
                    kVal.trim() &&
                    normalizeNumericAnswer(val) === normalizeNumericAnswer(kVal);
                  return (
                    <label key={qi} className="field-label">
                      <span>
                        Câu {qi + 1} <small className="muted-text">(ĐA: {kVal || '-'})</small>
                      </span>
                      <div style={{ position: 'relative' }}>
                        <input
                          type="text"
                          maxLength={4}
                          className={`text-input mono-input ${ok ? 'input-ok' : val ? 'input-err' : ''}`}
                          value={val}
                          onChange={(e) => {
                            const nextVal = e.target.value.replace(/[^0-9.,-]/g, '').slice(0, 4);
                            setShortAnswers((prev) => {
                              const next = [...prev];
                              next[qi] = nextVal;
                              return next;
                            });
                          }}
                        />
                        {ok && (
                          <CheckCircle2
                            size={15}
                            color="#16a34a"
                            style={{ position: 'absolute', right: 10, top: 11 }}
                          />
                        )}
                      </div>
                    </label>
                  );
                })}
              </div>
            </div>
          )}

          <div className="modal-actions">
            <button type="button" className="secondary-btn" onClick={onClose}>
              {lang === 'vi' ? 'Đóng' : 'Close'}
            </button>
            <button type="submit" className="primary-btn">
              {lang === 'vi' ? 'Lưu kết quả chấm lại' : 'Save Repaired Score'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
