import QRCode from 'qrcode';
import {
  AnswerKey,
  Contest,
  MCQChoice,
  Student,
  StudentPaper,
  TFQuestionAnswer,
} from '../types';
import { computeItemAnalysis } from '../omr/grading';

function escapeXml(str: string): string {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function exportContestExcel(
  contest: Contest,
  keys: AnswerKey[],
  papers: StudentPaper[]
): void {
  const stats = computeItemAnalysis(contest, keys, papers);

  const summaryRows = papers
    .map(
      (p, idx) => `<Row>
        <Cell><Data ss:Type="Number">${idx + 1}</Data></Cell>
        <Cell><Data ss:Type="String">${escapeXml(p.sbd)}</Data></Cell>
        <Cell><Data ss:Type="String">${escapeXml(p.studentName || '-')}</Data></Cell>
        <Cell><Data ss:Type="String">${escapeXml(p.roomName || '-')}</Data></Cell>
        <Cell><Data ss:Type="String">${escapeXml(p.examCode)}</Data></Cell>
        <Cell><Data ss:Type="Number">${p.scorePart1}</Data></Cell>
        <Cell><Data ss:Type="Number">${p.scorePart2}</Data></Cell>
        <Cell><Data ss:Type="Number">${p.scorePart3}</Data></Cell>
        <Cell><Data ss:Type="Number">${p.part4EssayScore || 0}</Data></Cell>
        <Cell><Data ss:Type="Number">${p.totalScore}</Data></Cell>
        <Cell><Data ss:Type="Number">${p.correctCount}</Data></Cell>
        <Cell><Data ss:Type="Number">${p.blankCount}</Data></Cell>
      </Row>`
    )
    .join('\n');

  const statRows = stats
    .map(
      (st) => `<Row>
        <Cell><Data ss:Type="String">${escapeXml(st.label)}</Data></Cell>
        <Cell><Data ss:Type="String">${escapeXml(st.part)}</Data></Cell>
        <Cell><Data ss:Type="String">${escapeXml(st.correctKey)}</Data></Cell>
        <Cell><Data ss:Type="Number">${st.correctPct}</Data></Cell>
        <Cell><Data ss:Type="Number">${st.totalGraded}</Data></Cell>
      </Row>`
    )
    .join('\n');

  const workbookXml = `<?xml version="1.0" encoding="UTF-8"?>
<?mso-application progid="Excel.Sheet"?>
<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet"
 xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet">
 <Worksheet ss:Name="BangDiem">
  <Table>
   <Row>
    <Cell><Data ss:Type="String">STT</Data></Cell>
    <Cell><Data ss:Type="String">SBD / Student ID</Data></Cell>
    <Cell><Data ss:Type="String">Ho va Ten / Name</Data></Cell>
    <Cell><Data ss:Type="String">Phong / Room</Data></Cell>
    <Cell><Data ss:Type="String">Ma De / Code</Data></Cell>
    <Cell><Data ss:Type="String">Phan I</Data></Cell>
    <Cell><Data ss:Type="String">Phan II</Data></Cell>
    <Cell><Data ss:Type="String">Phan III</Data></Cell>
    <Cell><Data ss:Type="String">Tu Luan (IV)</Data></Cell>
    <Cell><Data ss:Type="String">Tong Diem / Total</Data></Cell>
    <Cell><Data ss:Type="String">So Y Dung</Data></Cell>
    <Cell><Data ss:Type="String">Bo Trong</Data></Cell>
   </Row>
   ${summaryRows}
  </Table>
 </Worksheet>
 <Worksheet ss:Name="ThongKeCauHoi">
  <Table>
   <Row>
    <Cell><Data ss:Type="String">Cau / Item</Data></Cell>
    <Cell><Data ss:Type="String">Phan / Part</Data></Cell>
    <Cell><Data ss:Type="String">Dap An Goc</Data></Cell>
    <Cell><Data ss:Type="String">Ti Le Dung (%)</Data></Cell>
    <Cell><Data ss:Type="String">So Bai</Data></Cell>
   </Row>
   ${statRows}
  </Table>
 </Worksheet>
</Workbook>`;

  triggerDownload(
    new Blob([workbookXml], { type: 'application/vnd.ms-excel;charset=utf-8' }),
    `${slugify(contest.name)}_BangDiem.xls`
  );
}

export function exportContestCsv(contest: Contest, papers: StudentPaper[]): void {
  const header = [
    'STT',
    'SBD',
    'HoVaTen',
    'Phong',
    'MaDe',
    'DiemPhan1',
    'DiemPhan2',
    'DiemPhan3',
    'DiemTuLuan',
    'TongDiem',
    'ChiTietTraLoi',
  ];
  const lines = [header.join(',')];
  papers.forEach((p, idx) => {
    const ansSummary = [
      p.mcqAnswers.join(''),
      p.tfAnswers.map((t) => `${t.a}${t.b}${t.c}${t.d}`).join('|'),
      p.shortAnswers.join('|'),
    ]
      .filter(Boolean)
      .join(' / ');
    lines.push(
      [
        idx + 1,
        csvCell(p.sbd),
        csvCell(p.studentName),
        csvCell(p.roomName),
        csvCell(p.examCode),
        p.scorePart1,
        p.scorePart2,
        p.scorePart3,
        p.part4EssayScore || 0,
        p.totalScore,
        csvCell(ansSummary),
      ].join(',')
    );
  });

  // UTF-8 BOM so Excel/Numbers opens Vietnamese diacritics cleanly
  const content = '\uFEFF' + lines.join('\r\n');
  triggerDownload(
    new Blob([content], { type: 'text/csv;charset=utf-8' }),
    `${slugify(contest.name)}_BangDiem.csv`
  );
}

function csvCell(v: string): string {
  const s = String(v ?? '').replace(/"/g, '""');
  return `"${s}"`;
}

export function parseStudentRosterCsv(csvText: string, classId: string): Student[] {
  const lines = csvText
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  const out: Student[] = [];
  lines.forEach((line, idx) => {
    const parts = line.split(/[,;\t]/).map((s) => s.replace(/^"|"$/g, '').trim());
    if (idx === 0 && /sbd|id|name|họ/i.test(parts.join(' '))) return;
    const [sbd, name, roomName = ''] = parts;
    if (!sbd || !name) return;
    out.push({
      id: `stu_${Date.now()}_${idx}`,
      classId,
      sbd,
      name,
      roomName,
    });
  });
  return out;
}

export function parseAnswerKeyCsv(
  csvText: string,
  contest: Contest
): Omit<AnswerKey, 'id' | 'createdAt'>[] {
  // Format supported:
  // Row-per-question: Question,101,102  OR  Code-per-row: 101,A,B,C,D...
  const lines = csvText
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  if (lines.length === 0) return [];

  const rows = lines.map((l) => l.split(/[,;\t]/).map((c) => c.replace(/^"|"$/g, '').trim()));
  const results: Omit<AnswerKey, 'id' | 'createdAt'>[] = [];

  // Code-per-row: e.g. "101,A,C,B,D,..."
  for (const r of rows) {
    if (r.length >= 3 && /^[0-9]{2,6}$/.test(r[0]) && /^[A-E]$/i.test(r[1])) {
      const examCode = r[0];
      const qLen = contest.formId === 'bgd_2025' ? contest.part1Questions : contest.totalQuestions;
      const mcqAnswers: MCQChoice[] = Array.from({ length: qLen }, (_, i) => {
        const v = (r[i + 1] || '').toUpperCase();
        return ['A', 'B', 'C', 'D', 'E'].includes(v) ? (v as MCQChoice) : '';
      });
      const tfAnswers: TFQuestionAnswer[] = Array.from(
        { length: contest.formId === 'bgd_2025' ? contest.part2Questions : 0 },
        () => ({ a: 'T', b: 'F', c: 'T', d: 'F' })
      );
      const shortAnswers = Array.from(
        { length: contest.formId === 'bgd_2025' ? contest.part3Questions : 0 },
        () => ''
      );
      results.push({
        contestId: contest.id,
        examCode,
        mcqAnswers,
        tfAnswers,
        shortAnswers,
      });
    }
  }
  return results;
}

export async function generateKeyQrDataUrl(key: AnswerKey): Promise<string> {
  const payload = JSON.stringify({
    v: 1,
    c: key.examCode,
    m: key.mcqAnswers.join(''),
    t: key.tfAnswers.map((x) => `${x.a || '_'}${x.b || '_'}${x.c || '_'}${x.d || '_'}`),
    s: key.shortAnswers,
  });
  return QRCode.toDataURL(payload, { margin: 2, width: 280 });
}

export function decodeKeyQrPayload(
  raw: string,
  contest: Contest
): Omit<AnswerKey, 'id' | 'createdAt'> | null {
  try {
    const obj = JSON.parse(raw);
    if (!obj || typeof obj.c !== 'string') return null;
    const qLen = contest.formId === 'bgd_2025' ? contest.part1Questions : contest.totalQuestions;
    const mcqAnswers: MCQChoice[] = Array.from({ length: qLen }, (_, i) => {
      const ch = obj.m?.[i] || '';
      return ['A', 'B', 'C', 'D', 'E'].includes(ch) ? (ch as MCQChoice) : '';
    });
    const tfAnswers: TFQuestionAnswer[] = Array.from(
      { length: contest.formId === 'bgd_2025' ? contest.part2Questions : 0 },
      (_, i) => {
        const s = obj.t?.[i] || '____';
        const mapCh = (c: string) => (c === 'T' || c === 'F' ? c : '');
        return {
          a: mapCh(s[0]),
          b: mapCh(s[1]),
          c: mapCh(s[2]),
          d: mapCh(s[3]),
        };
      }
    );
    const shortAnswers: string[] = Array.from(
      { length: contest.formId === 'bgd_2025' ? contest.part3Questions : 0 },
      (_, i) => String(obj.s?.[i] ?? '')
    );
    return {
      contestId: contest.id,
      examCode: obj.c,
      mcqAnswers,
      tfAnswers,
      shortAnswers,
    };
  } catch {
    return null;
  }
}

export function triggerDownload(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1500);
}

export function slugify(text: string): string {
  return (
    text
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-zA-Z0-9]+/g, '_')
      .replace(/^_|_$/g, '')
      .slice(0, 40) || 'TNCraft'
  );
}
