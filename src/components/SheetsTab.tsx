import React, { useEffect, useState } from 'react';
import { Download, Printer } from 'lucide-react';
import { Contest, Language, SheetFormId } from '../types';
import { SHEET_FORM_LABELS } from '../i18n';
import { getFormCapacity, renderSheetToCanvas } from '../sheets/sheetLayouts';
import { slugify } from '../utils/exportUtils';

interface Props {
  lang: Language;
  contests: Contest[];
}

export const SheetsTab: React.FC<Props> = ({ lang, contests }) => {
  const [mode, setMode] = useState<'contest' | 'template'>(
    contests.length > 0 ? 'contest' : 'template'
  );
  const [selectedContestId, setSelectedContestId] = useState<string>(contests[0]?.id || '');
  const [templateForm, setTemplateForm] = useState<SheetFormId>('bgd_2025');
  const [previewUrl, setPreviewUrl] = useState<string>('');

  const activeContest: Contest =
    mode === 'contest' && contests.find((c) => c.id === selectedContestId)
      ? contests.find((c) => c.id === selectedContestId)!
      : {
          id: 'tpl',
          name: SHEET_FORM_LABELS[templateForm][lang],
          createdAt: '',
          classId: null,
          formId: templateForm,
          choiceCount: 4,
          sbdDigits: 6,
          examCodeDigits: templateForm === 'bgd_2025' ? 4 : 3,
          totalQuestions: getFormCapacity(templateForm),
          maxScore: 10,
          subjectSplits: [],
          enablePart1: true,
          part1Questions: 40,
          part1TotalScore: 4,
          enablePart2: true,
          part2Questions: 8,
          part2Score1: 0.1,
          part2Score2: 0.25,
          part2Score3: 0.5,
          part2Score4: 1.0,
          enablePart3: true,
          part3Questions: 6,
          part3TotalScore: 3,
          enablePart4Essay: false,
          part4MaxScore: 0,
        };

  useEffect(() => {
    const canvas = renderSheetToCanvas(activeContest, 1.8);
    setPreviewUrl(canvas.toDataURL('image/png'));
  }, [
    mode,
    selectedContestId,
    templateForm,
    lang,
    activeContest.id,
    activeContest.formId,
    activeContest.totalQuestions,
    activeContest.part1Questions,
    activeContest.part2Questions,
    activeContest.part3Questions,
  ]);

  const handleDownloadPng = () => {
    const hiRes = renderSheetToCanvas(activeContest, 2.4);
    const a = document.createElement('a');
    a.href = hiRes.toDataURL('image/png');
    a.download = `Phieu_${slugify(activeContest.name)}.png`;
    a.click();
  };

  const handlePrintA4 = () => {
    const hiRes = renderSheetToCanvas(activeContest, 2.4).toDataURL('image/png');
    const win = window.open('', '_blank');
    if (!win) {
      window.print();
      return;
    }
    win.document.write(`<!doctype html>
<html>
<head>
  <title>In Phiếu Trắc Nghiệm - ${activeContest.name}</title>
  <style>
    @page { size: A4 portrait; margin: 6mm; }
    body { margin: 0; display: flex; justify-content: center; align-items: center; background: #fff; }
    img { width: 100%; max-width: 198mm; height: auto; display: block; }
  </style>
</head>
<body>
  <img src="${hiRes}" onload="setTimeout(() => { window.print(); }, 250);" />
</body>
</html>`);
    win.document.close();
  };

  return (
    <div className="page-container">
      <div className="page-header">
        <h2>{lang === 'vi' ? 'Tạo & In Phiếu Chuẩn A4 (Offline)' : 'Printable Calibrated A4 Sheets'}</h2>
      </div>

      <div className="section-box">
        <div className="seg-row" style={{ marginBottom: 12 }}>
          <button
            type="button"
            className={`subtab-btn ${mode === 'contest' ? 'active' : ''}`}
            onClick={() => setMode('contest')}
          >
            {lang === 'vi' ? 'Theo Bài thi đã tạo' : 'From My Tests'}
          </button>
          <button
            type="button"
            className={`subtab-btn ${mode === 'template' ? 'active' : ''}`}
            onClick={() => setMode('template')}
          >
            {lang === 'vi' ? 'Mẫu chuẩn (20–120 & BGD)' : 'Standard Templates'}
          </button>
        </div>

        {mode === 'contest' && contests.length > 0 ? (
          <label className="field-label">
            <span>{lang === 'vi' ? 'Chọn bài thi để xuất phiếu khớp số câu' : 'Select Test'}</span>
            <select
              className="text-input"
              value={selectedContestId}
              onChange={(e) => setSelectedContestId(e.target.value)}
            >
              {contests.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name} ({SHEET_FORM_LABELS[c.formId][lang]})
                </option>
              ))}
            </select>
          </label>
        ) : (
          <label className="field-label">
            <span>{lang === 'vi' ? 'Chọn mẫu phiếu chuẩn' : 'Select Sheet Form'}</span>
            <select
              className="text-input"
              value={templateForm}
              onChange={(e) => setTemplateForm(e.target.value as SheetFormId)}
            >
              {(Object.keys(SHEET_FORM_LABELS) as SheetFormId[]).map((fid) => (
                <option key={fid} value={fid}>
                  {SHEET_FORM_LABELS[fid][lang]}
                </option>
              ))}
            </select>
          </label>
        )}

        <div className="action-strip">
          <button type="button" className="primary-btn" onClick={handlePrintA4}>
            <Printer size={16} /> {lang === 'vi' ? 'In A4 / Lưu PDF (AirPrint)' : 'Print A4 / Save PDF'}
          </button>
          <button type="button" className="secondary-btn" onClick={handleDownloadPng}>
            <Download size={16} /> {lang === 'vi' ? 'Tải ảnh PNG nét cao' : 'Download High-DPI PNG'}
          </button>
        </div>

        {previewUrl && (
          <div className="sheet-preview-frame">
            <img src={previewUrl} alt="A4 Answer Sheet Preview" />
          </div>
        )}
      </div>
    </div>
  );
};
