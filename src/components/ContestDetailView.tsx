import React, { useMemo, useRef, useState } from 'react';
import {
  ArrowLeft,
  BarChart3,
  Camera,
  Download,
  Edit3,
  FileSpreadsheet,
  FileUp,
  KeyRound,
  ListChecks,
  Plus,
  Printer,
  QrCode,
  Settings2,
  Trash2,
} from 'lucide-react';
import {
  AnswerKey,
  AppSettings,
  Classroom,
  Contest,
  Student,
  StudentPaper,
} from '../types';
import { SHEET_FORM_LABELS, t } from '../i18n';
import { computeItemAnalysis, computePaperGrade } from '../omr/grading';
import {
  decodeKeyQrPayload,
  exportContestCsv,
  exportContestExcel,
  generateKeyQrDataUrl,
  parseAnswerKeyCsv,
} from '../utils/exportUtils';
import { uid } from '../storage/db';
import { KeyEditorModal } from './KeyEditorModal';
import { ScannerPanel } from './ScannerPanel';
import { PaperRepairModal } from './PaperRepairModal';

interface Props {
  contest: Contest;
  classes: Classroom[];
  keys: AnswerKey[];
  papers: StudentPaper[];
  students: Student[];
  settings: AppSettings;
  onBack: () => void;
  onEditContest: () => void;
  onUpsertKey: (key: AnswerKey) => void;
  onDeleteKey: (keyId: string) => void;
  onUpsertPaper: (paper: StudentPaper) => void;
  onDeletePaper: (paperId: string) => void;
}

type SubTab = 'keys' | 'scan' | 'papers' | 'stats';

export const ContestDetailView: React.FC<Props> = ({
  contest,
  classes,
  keys,
  papers,
  students,
  settings,
  onBack,
  onEditContest,
  onUpsertKey,
  onDeleteKey,
  onUpsertPaper,
  onDeletePaper,
}) => {
  const lang = settings.language;
  const tr = t(lang);
  const [subTab, setSubTab] = useState<SubTab>('scan');
  const [editingKey, setEditingKey] = useState<AnswerKey | null | undefined>(undefined);
  const [repairingPaper, setRepairingPaper] = useState<StudentPaper | null>(null);
  const [qrModal, setQrModal] = useState<{ code: string; url: string; rawPayload: string } | null>(
    null
  );
  const [qrImportText, setQrImportText] = useState('');
  const [showQrImport, setShowQrImport] = useState(false);
  const [sortBy, setSortBy] = useState<'time' | 'score_desc' | 'score_asc' | 'sbd' | 'warn'>(
    'time'
  );
  const [statFilterCode, setStatFilterCode] = useState<string>('ALL');
  const csvKeyInputRef = useRef<HTMLInputElement | null>(null);

  const linkedClass = classes.find((c) => c.id === contest.classId);

  // Re-evaluate existing papers whenever an AnswerKey is added/edited
  const handleSaveKeyAndRegrade = (savedKey: AnswerKey) => {
    onUpsertKey(savedKey);
    const updatedKeys = keys.some((k) => k.id === savedKey.id)
      ? keys.map((k) => (k.id === savedKey.id ? savedKey : k))
      : [...keys, savedKey];

    papers.forEach((p) => {
      if (p.examCode === savedKey.examCode || updatedKeys.length === 1) {
        const g = computePaperGrade(
          contest,
          updatedKeys,
          p.sbd,
          p.examCode,
          p.mcqAnswers,
          p.tfAnswers,
          p.shortAnswers,
          p.part4EssayScore,
          papers,
          p.id
        );
        onUpsertPaper({ ...p, ...g });
      }
    });
    setEditingKey(undefined);
  };

  const handleCsvKeyUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const parsed = parseAnswerKeyCsv(String(reader.result || ''), contest);
      parsed.forEach((item) => {
        onUpsertKey({
          ...item,
          id: uid('key'),
          createdAt: new Date().toISOString().slice(0, 10),
        });
      });
    };
    reader.readAsText(file);
    e.target.value = '';
  };

  const handleOpenKeyQr = async (k: AnswerKey) => {
    const url = await generateKeyQrDataUrl(k);
    const rawPayload = JSON.stringify({
      v: 1,
      c: k.examCode,
      m: k.mcqAnswers.join(''),
      t: k.tfAnswers.map((x) => `${x.a || '_'}${x.b || '_'}${x.c || '_'}${x.d || '_'}`),
      s: k.shortAnswers,
    });
    setQrModal({ code: k.examCode, url, rawPayload });
  };

  const sortedPapers = useMemo(() => {
    const list = [...papers];
    switch (sortBy) {
      case 'score_desc':
        return list.sort((a, b) => b.totalScore - a.totalScore);
      case 'score_asc':
        return list.sort((a, b) => a.totalScore - b.totalScore);
      case 'sbd':
        return list.sort((a, b) => a.sbd.localeCompare(b.sbd));
      case 'warn':
        return list.sort((a, b) => b.warnings.length - a.warnings.length);
      default:
        return list.sort((a, b) => b.scannedAt.localeCompare(a.scannedAt));
    }
  }, [papers, sortBy]);

  const statsSummary = useMemo(() => {
    if (papers.length === 0) {
      return {
        avg: 0,
        max: 0,
        min: 0,
        veryGood: 0,
        good: 0,
        average: 0,
        weak: 0,
        bins: [0, 0, 0, 0, 0],
      };
    }
    const scores = papers.map((p) => p.totalScore);
    const maxPoss = papers[0]?.maxPossibleScore || contest.maxScore || 10;
    const sum = scores.reduce((a, b) => a + b, 0);
    let veryGood = 0;
    let good = 0;
    let average = 0;
    let weak = 0;
    const bins = [0, 0, 0, 0, 0]; // 0-20%, 20-40%, 40-60%, 60-80%, 80-100%

    for (const s of scores) {
      const ratio = maxPoss > 0 ? s / maxPoss : 0;
      if (ratio >= 0.8) veryGood++;
      else if (ratio >= 0.65) good++;
      else if (ratio >= 0.5) average++;
      else weak++;

      const bi = Math.min(4, Math.max(0, Math.floor(ratio * 5)));
      bins[bi]++;
    }

    return {
      avg: Number((sum / scores.length).toFixed(2)),
      max: Math.max(...scores),
      min: Math.min(...scores),
      veryGood,
      good,
      average,
      weak,
      bins,
    };
  }, [papers, contest.maxScore]);

  const itemStats = useMemo(
    () => computeItemAnalysis(contest, keys, papers, statFilterCode),
    [contest, keys, papers, statFilterCode]
  );

  return (
    <div className="detail-view">
      {/* Top bar */}
      <div className="detail-header">
        <button type="button" className="icon-btn" onClick={onBack} aria-label="Back">
          <ArrowLeft size={20} />
        </button>
        <div className="detail-title-wrap">
          <h2>{contest.name}</h2>
          <p>
            {SHEET_FORM_LABELS[contest.formId][lang]}
            {linkedClass ? ` • ${linkedClass.name}` : ''}
          </p>
        </div>
        <button type="button" className="icon-btn" onClick={onEditContest} title="Settings">
          <Settings2 size={19} />
        </button>
      </div>

      {/* Segmented sub-navigation */}
      <div className="subtab-bar">
        <button
          type="button"
          className={`subtab-btn ${subTab === 'keys' ? 'active' : ''}`}
          onClick={() => setSubTab('keys')}
        >
          <KeyRound size={16} />
          <span>
            {tr.detail.keys} ({keys.length})
          </span>
        </button>
        <button
          type="button"
          className={`subtab-btn ${subTab === 'scan' ? 'active' : ''}`}
          onClick={() => setSubTab('scan')}
        >
          <Camera size={16} />
          <span>{tr.detail.scan}</span>
        </button>
        <button
          type="button"
          className={`subtab-btn ${subTab === 'papers' ? 'active' : ''}`}
          onClick={() => setSubTab('papers')}
        >
          <ListChecks size={16} />
          <span>
            {tr.detail.papers} ({papers.length})
          </span>
        </button>
        <button
          type="button"
          className={`subtab-btn ${subTab === 'stats' ? 'active' : ''}`}
          onClick={() => setSubTab('stats')}
        >
          <BarChart3 size={16} />
          <span>{tr.detail.stats}</span>
        </button>
      </div>

      {/* 1. KEYS TAB */}
      {subTab === 'keys' && (
        <div className="tab-pane">
          <div className="action-strip">
            <button
              type="button"
              className="primary-btn"
              onClick={() => setEditingKey(null)}
            >
              <Plus size={16} /> {tr.detail.addKeyHand}
            </button>
            <button
              type="button"
              className="secondary-btn"
              onClick={() => csvKeyInputRef.current?.click()}
            >
              <FileUp size={16} /> {tr.detail.importKeyCsv}
            </button>
            <input
              ref={csvKeyInputRef}
              type="file"
              accept=".csv,.txt"
              style={{ display: 'none' }}
              onChange={handleCsvKeyUpload}
            />
            <button
              type="button"
              className="secondary-btn"
              onClick={() => setShowQrImport((v) => !v)}
            >
              <QrCode size={16} /> {tr.detail.importKeyQr}
            </button>
          </div>

          {showQrImport && (
            <div className="section-box">
              <label className="field-label">
                <span>
                  {lang === 'vi'
                    ? 'Dán chuỗi dữ liệu QR đáp án để nhập nhanh'
                    : 'Paste QR Key JSON payload to import'}
                </span>
                <div className="seg-row">
                  <input
                    type="text"
                    className="text-input mono-input"
                    placeholder='{"v":1,"c":"0102",...}'
                    value={qrImportText}
                    onChange={(e) => setQrImportText(e.target.value)}
                  />
                  <button
                    type="button"
                    className="primary-btn"
                    onClick={() => {
                      const decoded = decodeKeyQrPayload(qrImportText, contest);
                      if (decoded) {
                        handleSaveKeyAndRegrade({
                          ...decoded,
                          id: uid('key'),
                          createdAt: new Date().toISOString().slice(0, 10),
                        });
                        setQrImportText('');
                        setShowQrImport(false);
                      }
                    }}
                  >
                    {lang === 'vi' ? 'Nhập' : 'Import'}
                  </button>
                </div>
              </label>
            </div>
          )}

          {keys.length === 0 ? (
            <div className="empty-card">{tr.detail.noKeys}</div>
          ) : (
            <div className="card-list">
              {keys.map((k) => (
                <div key={k.id} className="item-card">
                  <div className="item-card-main" onClick={() => setEditingKey(k)}>
                    <div className="code-badge">{k.examCode}</div>
                    <div className="item-card-info">
                      <h4>
                        {tr.detail.examCode} {k.examCode}
                      </h4>
                      <p className="mono-preview">
                        {k.mcqAnswers
                          .slice(0, 12)
                          .map((a, i) => `${i + 1}${a || '_'}`)
                          .join(' ')}
                        {k.mcqAnswers.length > 12 ? ' …' : ''}
                      </p>
                    </div>
                  </div>
                  <div className="item-card-actions">
                    <button
                      type="button"
                      className="icon-btn"
                      onClick={() => handleOpenKeyQr(k)}
                      title="QR Code"
                    >
                      <QrCode size={17} />
                    </button>
                    <button
                      type="button"
                      className="icon-btn"
                      onClick={() => setEditingKey(k)}
                      title="Edit"
                    >
                      <Edit3 size={17} />
                    </button>
                    <button
                      type="button"
                      className="icon-btn danger"
                      onClick={() => onDeleteKey(k.id)}
                      title="Delete"
                    >
                      <Trash2 size={17} />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* 2. SCAN TAB */}
      {subTab === 'scan' && (
        <div className="tab-pane">
          <ScannerPanel
            contest={contest}
            keys={keys}
            students={students}
            existingPapers={papers}
            settings={settings}
            onSavePaper={(newPaper) => {
              if (settings.overrideDuplicateSbd) {
                const dup = papers.find((p) => p.sbd === newPaper.sbd);
                if (dup) {
                  onUpsertPaper({ ...newPaper, id: dup.id });
                  return;
                }
              }
              onUpsertPaper(newPaper);
            }}
          />
        </div>
      )}

      {/* 3. GRADED PAPERS TAB */}
      {subTab === 'papers' && (
        <div className="tab-pane">
          <div className="row-between" style={{ marginBottom: 12 }}>
            <select
              className="text-input"
              style={{ maxWidth: 220 }}
              value={sortBy}
              onChange={(e) => setSortBy(e.target.value as any)}
            >
              <option value="time">{lang === 'vi' ? 'Mới chấm gần nhất' : 'Newest Scanned'}</option>
              <option value="score_desc">{lang === 'vi' ? 'Điểm cao → thấp' : 'Score High → Low'}</option>
              <option value="score_asc">{lang === 'vi' ? 'Điểm thấp → cao' : 'Score Low → High'}</option>
              <option value="sbd">{lang === 'vi' ? 'Theo Số báo danh' : 'By Student ID'}</option>
              <option value="warn">{lang === 'vi' ? 'Bài có cảnh báo lỗi' : 'Warnings First'}</option>
            </select>

            {papers.length > 0 && (
              <button
                type="button"
                className="secondary-btn"
                onClick={() => exportContestExcel(contest, keys, sortedPapers)}
              >
                <FileSpreadsheet size={16} /> Excel
              </button>
            )}
          </div>

          {sortedPapers.length === 0 ? (
            <div className="empty-card">{tr.detail.noPapers}</div>
          ) : (
            <div className="card-list">
              {sortedPapers.map((p) => (
                <div key={p.id} className="item-card" onClick={() => setRepairingPaper(p)}>
                  <div className="item-card-main">
                    <div className="score-pill-circle">
                      {p.totalScore}
                    </div>
                    <div className="item-card-info">
                      <h4>
                        {p.studentName || `SBD: ${p.sbd}`}
                        {p.studentName ? <span className="muted-inline"> • {p.sbd}</span> : null}
                      </h4>
                      <p>
                        {tr.detail.examCode}: <strong>{p.examCode || '-'}</strong> • ✓{p.correctCount}{' '}
                        ✗{p.wrongCount} ∅{p.blankCount}
                        {p.warnings.length > 0 && (
                          <span className="warn-dot"> • ⚠ {p.warnings.length}</span>
                        )}
                      </p>
                    </div>
                  </div>
                  <div
                    className="item-card-actions"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <button
                      type="button"
                      className="icon-btn danger"
                      onClick={() => onDeletePaper(p.id)}
                      aria-label="Delete paper"
                    >
                      <Trash2 size={17} />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* 4. ANALYTICS & EXPORT TAB */}
      {subTab === 'stats' && (
        <div className="tab-pane">
          <div className="action-strip">
            <button
              type="button"
              className="primary-btn"
              disabled={papers.length === 0}
              onClick={() => exportContestExcel(contest, keys, papers)}
            >
              <FileSpreadsheet size={16} /> {tr.detail.exportExcel}
            </button>
            <button
              type="button"
              className="secondary-btn"
              disabled={papers.length === 0}
              onClick={() => exportContestCsv(contest, papers)}
            >
              <Download size={16} /> {tr.detail.exportCsv}
            </button>
            <button
              type="button"
              className="secondary-btn"
              onClick={() => window.print()}
            >
              <Printer size={16} /> {tr.detail.printReport}
            </button>
          </div>

          <div className="kpi-grid">
            <div className="kpi-card">
              <span>{tr.stats.totalPapers}</span>
              <strong>{papers.length}</strong>
            </div>
            <div className="kpi-card">
              <span>{tr.stats.avg}</span>
              <strong>{statsSummary.avg}</strong>
            </div>
            <div className="kpi-card">
              <span>{tr.stats.highest}</span>
              <strong>{statsSummary.max}</strong>
            </div>
            <div className="kpi-card">
              <span>{tr.stats.lowest}</span>
              <strong>{statsSummary.min}</strong>
            </div>
          </div>

          <div className="section-box">
            <h4 className="sub-heading">{tr.stats.distribution}</h4>
            <div className="hist-bars">
              {['0–20%', '20–40%', '40–60%', '60–80%', '80–100%'].map((lbl, idx) => {
                const count = statsSummary.bins[idx];
                const maxBin = Math.max(1, ...statsSummary.bins);
                const pct = Math.round((count / maxBin) * 100);
                return (
                  <div key={lbl} className="hist-col">
                    <span className="hist-val">{count}</span>
                    <div className="hist-track">
                      <div className="hist-fill" style={{ height: `${Math.max(6, pct)}%` }} />
                    </div>
                    <span className="hist-lbl">{lbl}</span>
                  </div>
                );
              })}
            </div>

            <div className="tier-grid">
              <div className="tier-pill ok">
                {tr.stats.veryGood}: <strong>{statsSummary.veryGood}</strong>
              </div>
              <div className="tier-pill info">
                {tr.stats.good}: <strong>{statsSummary.good}</strong>
              </div>
              <div className="tier-pill warn">
                {tr.stats.average}: <strong>{statsSummary.average}</strong>
              </div>
              <div className="tier-pill err">
                {tr.stats.weak}: <strong>{statsSummary.weak}</strong>
              </div>
            </div>
          </div>

          <div className="section-box">
            <div className="row-between" style={{ marginBottom: 10 }}>
              <h4 className="sub-heading" style={{ margin: 0 }}>
                {tr.stats.itemAnalysis}
              </h4>
              <select
                className="text-input"
                style={{ width: 'auto' }}
                value={statFilterCode}
                onChange={(e) => setStatFilterCode(e.target.value)}
              >
                <option value="ALL">{lang === 'vi' ? 'Tất cả mã đề' : 'All Codes'}</option>
                {keys.map((k) => (
                  <option key={k.id} value={k.examCode}>
                    {tr.detail.examCode} {k.examCode}
                  </option>
                ))}
              </select>
            </div>

            <div className="item-stat-table-wrap">
              <table className="item-stat-table">
                <thead>
                  <tr>
                    <th>{lang === 'vi' ? 'Câu' : 'Item'}</th>
                    <th>{lang === 'vi' ? 'Đáp án' : 'Key'}</th>
                    <th>{lang === 'vi' ? 'Tỉ lệ đúng' : '% Correct'}</th>
                  </tr>
                </thead>
                <tbody>
                  {itemStats.map((st) => (
                    <tr key={st.label}>
                      <td className="mono-cell">{st.label}</td>
                      <td className="mono-cell">
                        <strong>{st.correctKey}</strong>
                      </td>
                      <td>
                        <div className="pct-bar-row">
                          <div className="pct-bar-bg">
                            <div
                              className="pct-bar-fill"
                              style={{
                                width: `${st.correctPct}%`,
                                background:
                                  st.correctPct >= 70
                                    ? '#10b981'
                                    : st.correctPct >= 40
                                      ? '#f59e0b'
                                      : '#ef4444',
                              }}
                            />
                          </div>
                          <span className="pct-num">{st.correctPct}%</span>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {editingKey !== undefined && (
        <KeyEditorModal
          lang={lang}
          contest={contest}
          initial={editingKey}
          onClose={() => setEditingKey(undefined)}
          onSave={handleSaveKeyAndRegrade}
        />
      )}

      {repairingPaper && (
        <PaperRepairModal
          lang={lang}
          contest={contest}
          keys={keys}
          students={students}
          existingPapers={papers}
          paper={repairingPaper}
          onClose={() => setRepairingPaper(null)}
          onSave={(updated) => {
            onUpsertPaper(updated);
            setRepairingPaper(null);
          }}
        />
      )}

      {qrModal && (
        <div className="modal-backdrop" onClick={() => setQrModal(null)}>
          <div className="modal-sheet" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h3>
                QR {tr.detail.examCode} {qrModal.code}
              </h3>
              <button type="button" className="icon-btn" onClick={() => setQrModal(null)}>
                ✕
              </button>
            </div>
            <div className="modal-body" style={{ textAlign: 'center' }}>
              <img
                src={qrModal.url}
                alt="Answer Key QR"
                style={{ width: 220, height: 220, margin: '0 auto', borderRadius: 12 }}
              />
              <textarea
                readOnly
                className="text-input mono-input"
                rows={3}
                value={qrModal.rawPayload}
                style={{ marginTop: 12, fontSize: 12 }}
              />
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
