import QRCode from 'qrcode';
import {
  AnswerKey,
  Contest,
  MCQChoice,
  Student,
  StudentPaper,
  TFChoice,
  TFQuestionAnswer,
} from '../types';
import { computeItemAnalysis } from '../omr/grading';
import { parseXlsxFirstSheet } from './xlsxParser';

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

export interface ParsedKeyImportResult {
  keys: Omit<AnswerKey, 'id' | 'createdAt'>[];
  contestPatch?: Partial<Contest>;
}

function parseTfToken(raw: string): TFQuestionAnswer | null {
  const norm = raw
    .normalize('NFC')
    .trim()
    .toUpperCase()
    .replace(/[\s,|/-]+/g, '');
  if (norm.length !== 4) return null;
  const mapChar = (ch: string): TFChoice | null => {
    if (ch === 'Đ' || ch === 'D' || ch === 'T') return 'T';
    if (ch === 'S' || ch === 'F') return 'F';
    return null;
  };
  const a = mapChar(norm[0]);
  const b = mapChar(norm[1]);
  const c = mapChar(norm[2]);
  const d = mapChar(norm[3]);
  if (!a || !b || !c || !d) return null;
  return { a, b, c, d };
}

function isShortNumericToken(raw: string): boolean {
  const s = raw.trim();
  if (!s || /^[A-E]$/i.test(s) || parseTfToken(s)) return false;
  return /^-?[0-9]+([.,][0-9]+)?$/.test(s);
}

export function parseAnswerKeyTable(
  rows: string[][],
  contest: Contest
): ParsedKeyImportResult {
  const cleanRows = rows
    .map((r) => r.map((c) => String(c ?? '').trim()))
    .filter((r) => r.some((c) => c !== ''));
  if (cleanRows.length === 0) return { keys: [] };

  // Format 1: Column-per-ExamCode (standard Vietnamese teacher Excel format:
  // Row 0: ["Câu\\Mã đề", "1001", "1003", ...]
  // Row 1..N: ["1", "B", "B", ...], ["13", "ĐSĐĐ", ...], ["15", "5400", "-0,6", ...])
  const header = cleanRows[0];
  const codeCols: Array<{ col: number; code: string }> = [];
  for (let c = 1; c < header.length; c++) {
    if (/^[0-9]{2,6}$/.test(header[c])) {
      codeCols.push({ col: c, code: header[c] });
    }
  }

  if (codeCols.length > 0 && cleanRows.length >= 2) {
    const parsedPerCode = codeCols.map(({ code }) => ({
      examCode: code,
      mcq: [] as MCQChoice[],
      tf: [] as TFQuestionAnswer[],
      short: [] as string[],
    }));

    for (let rIdx = 1; rIdx < cleanRows.length; rIdx++) {
      const row = cleanRows[rIdx];
      // Classify row using non-empty values across code columns
      const sampleVals = codeCols.map(({ col }) => row[col] || '').filter(Boolean);
      if (sampleVals.length === 0) continue;

      const isMcqRow = sampleVals.every((v) => /^[A-E]$/i.test(v));
      const isTfRow = sampleVals.every((v) => parseTfToken(v) !== null);
      const isShortRow = sampleVals.every((v) => isShortNumericToken(v));

      if (isMcqRow) {
        codeCols.forEach(({ col }, idx) => {
          const v = (row[col] || '').toUpperCase();
          parsedPerCode[idx].mcq.push(
            ['A', 'B', 'C', 'D', 'E'].includes(v) ? (v as MCQChoice) : ''
          );
        });
      } else if (isTfRow) {
        codeCols.forEach(({ col }, idx) => {
          parsedPerCode[idx].tf.push(
            parseTfToken(row[col] || '') || { a: '', b: '', c: '', d: '' }
          );
        });
      } else if (isShortRow) {
        codeCols.forEach(({ col }, idx) => {
          parsedPerCode[idx].short.push((row[col] || '').replace('.', ','));
        });
      }
    }

    const maxCodeLen = Math.max(...codeCols.map((c) => c.code.length));
    const p1Len = parsedPerCode[0]?.mcq.length || 0;
    const p2Len = parsedPerCode[0]?.tf.length || 0;
    const p3Len = parsedPerCode[0]?.short.length || 0;

    const contestPatch: Partial<Contest> = {};
    if (maxCodeLen >= 4 && contest.examCodeDigits !== 4) {
      contestPatch.examCodeDigits = 4;
    }
    if (contest.formId === 'bgd_2025') {
      if (p1Len > 0) {
        contestPatch.enablePart1 = true;
        contestPatch.part1Questions = p1Len;
      }
      if (p2Len > 0) {
        contestPatch.enablePart2 = true;
        contestPatch.part2Questions = p2Len;
      }
      if (p3Len > 0) {
        contestPatch.enablePart3 = true;
        contestPatch.part3Questions = p3Len;
      }
    } else if (p1Len > 0) {
      contestPatch.totalQuestions = p1Len;
    }

    const keys: Omit<AnswerKey, 'id' | 'createdAt'>[] = parsedPerCode.map((item) => ({
      contestId: contest.id,
      examCode: item.examCode,
      mcqAnswers: item.mcq,
      tfAnswers: item.tf,
      shortAnswers: item.short,
    }));

    return { keys, contestPatch };
  }

  // Format 2: Row-per-ExamCode (e.g. "101,A,C,B,D,...")
  const results: Omit<AnswerKey, 'id' | 'createdAt'>[] = [];
  for (const r of cleanRows) {
    if (r.length >= 2 && /^[0-9]{2,6}$/.test(r[0])) {
      const examCode = r[0];
      const mcqAnswers: MCQChoice[] = [];
      const tfAnswers: TFQuestionAnswer[] = [];
      const shortAnswers: string[] = [];

      for (let i = 1; i < r.length; i++) {
        const cell = r[i];
        if (!cell) continue;
        if (/^[A-E]$/i.test(cell)) {
          mcqAnswers.push(cell.toUpperCase() as MCQChoice);
        } else {
          const tf = parseTfToken(cell);
          if (tf) tfAnswers.push(tf);
          else if (isShortNumericToken(cell)) shortAnswers.push(cell.replace('.', ','));
        }
      }

      if (mcqAnswers.length > 0 || tfAnswers.length > 0 || shortAnswers.length > 0) {
        const targetMcqLen =
          mcqAnswers.length ||
          (contest.formId === 'bgd_2025' ? contest.part1Questions : contest.totalQuestions);
        while (mcqAnswers.length < targetMcqLen) mcqAnswers.push('');
        results.push({
          contestId: contest.id,
          examCode,
          mcqAnswers,
          tfAnswers,
          shortAnswers,
        });
      }
    }
  }
  return { keys: results };
}

export function parseAnswerKeyCsv(
  csvText: string,
  contest: Contest
): Omit<AnswerKey, 'id' | 'createdAt'>[] {
  const lines = csvText
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  if (lines.length === 0) return [];
  const rows = lines.map((l) => l.split(/[,;\t]/).map((c) => c.replace(/^"|"$/g, '').trim()));
  return parseAnswerKeyTable(rows, contest).keys;
}

export async function parseAnswerKeyBuffer(
  buffer: ArrayBuffer,
  fileName: string,
  contest: Contest
): Promise<ParsedKeyImportResult> {
  const lower = fileName.toLowerCase();
  if (lower.endsWith('.xlsx')) {
    const rows = await parseXlsxFirstSheet(buffer);
    return parseAnswerKeyTable(rows, contest);
  }
  const text = new TextDecoder('utf-8').decode(buffer);
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  const rows = lines.map((l) => l.split(/[,;\t]/).map((c) => c.replace(/^"|"$/g, '').trim()));
  return parseAnswerKeyTable(rows, contest);
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
