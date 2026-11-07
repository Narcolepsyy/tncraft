import {
  AnswerKey,
  BubbleCoord,
  ChoiceCount,
  Contest,
  MCQChoice,
  Point2D,
  SheetFormId,
  TFQuestionAnswer,
} from '../types';

export const CANONICAL_W = 1000;
export const CANONICAL_H = 1414;

export const FIDUCIAL_CENTERS: Record<'tl' | 'tr' | 'br' | 'bl', Point2D> = {
  tl: { x: 50, y: 50 },
  tr: { x: 950, y: 50 },
  br: { x: 950, y: 1364 },
  bl: { x: 50, y: 1364 },
};

export const FIDUCIAL_SIZE = 36; // 36x36 solid black squares at each corner

export interface SheetGeometry {
  formId: SheetFormId;
  choiceCount: ChoiceCount;
  sbdDigits: 6 | 8;
  examCodeDigits: 3 | 4;
  bubbles: BubbleCoord[];
}

export function buildSheetGeometry(contest: Pick<
  Contest,
  | 'formId'
  | 'choiceCount'
  | 'sbdDigits'
  | 'examCodeDigits'
  | 'totalQuestions'
  | 'part1Questions'
  | 'part2Questions'
  | 'part3Questions'
  | 'enablePart1'
  | 'enablePart2'
  | 'enablePart3'
>): SheetGeometry {
  const bubbles: BubbleCoord[] = [];
  const sbdDigits = contest.sbdDigits || 6;
  const codeDigits = contest.examCodeDigits || 3;

  // 1. Header SBD & Exam Code bubbles (top-right region x: 560..910, y: 122..311)
  const colStep = 26;
  const totalHeaderCols = sbdDigits + codeDigits;
  const gapBetween = 22;
  const rightEdge = 906;
  const totalWidth = totalHeaderCols * colStep + gapBetween;
  const sbdStartX = rightEdge - totalWidth + colStep / 2;

  for (let c = 0; c < sbdDigits; c++) {
    const cx = sbdStartX + c * colStep;
    for (let d = 0; d <= 9; d++) {
      const cy = 126 + d * 21;
      bubbles.push({
        id: `sbd_${c}_${d}`,
        section: 'sbd',
        index: c,
        value: String(d),
        cx,
        cy,
        r: 8.0,
      });
    }
  }

  const codeStartX = sbdStartX + sbdDigits * colStep + gapBetween;
  for (let c = 0; c < codeDigits; c++) {
    const cx = codeStartX + c * colStep;
    for (let d = 0; d <= 9; d++) {
      const cy = 126 + d * 21;
      bubbles.push({
        id: `code_${c}_${d}`,
        section: 'examCode',
        index: c,
        value: String(d),
        cx,
        cy,
        r: 8.0,
      });
    }
  }

  // 2. BGD-2025 3-Part Sheet
  if (contest.formId === 'bgd_2025') {
    const p1Count = contest.enablePart1 ? Math.min(40, Math.max(0, contest.part1Questions)) : 0;
    for (let q = 0; q < 40; q++) {
      if (q >= p1Count) break;
      const block = Math.floor(q / 10);
      const row = q % 10;
      const blockX = 86 + block * 209;
      const cy = 414 + row * 25;
      const choices = ['A', 'B', 'C', 'D'];
      for (let oi = 0; oi < 4; oi++) {
        bubbles.push({
          id: `mcq_${q}_${choices[oi]}`,
          section: 'mcq',
          index: q,
          value: choices[oi],
          cx: blockX + 56 + oi * 36,
          cy,
          r: 8.8,
        });
      }
    }

    const p2Count = contest.enablePart2 ? Math.min(8, Math.max(0, contest.part2Questions)) : 0;
    for (let q = 0; q < 8; q++) {
      if (q >= p2Count) break;
      const block = Math.floor(q / 2);
      const subBlock = q % 2;
      const subX = 86 + block * 209 + subBlock * 101;
      for (let sIdx = 0; sIdx < 4; sIdx++) {
        const cy = 744 + sIdx * 28;
        bubbles.push({
          id: `tf_${q}_${sIdx}_T`,
          section: 'tf',
          index: q,
          subIndex: sIdx,
          value: 'T',
          cx: subX + 44,
          cy,
          r: 8.4,
        });
        bubbles.push({
          id: `tf_${q}_${sIdx}_F`,
          section: 'tf',
          index: q,
          subIndex: sIdx,
          value: 'F',
          cx: subX + 78,
          cy,
          r: 8.4,
        });
      }
    }

    const p3Count = contest.enablePart3 ? Math.min(6, Math.max(0, contest.part3Questions)) : 0;
    for (let q = 0; q < 6; q++) {
      if (q >= p3Count) break;
      const qX = 86 + q * 138;
      // Column 0 minus sign at row 0 (cy = 978)
      bubbles.push({
        id: `short_${q}_0_-`,
        section: 'short',
        index: q,
        subIndex: 0,
        value: '-',
        cx: qX + 27,
        cy: 978,
        r: 7.8,
      });
      // Columns 1 & 2 decimal comma at row 1 (cy = 1003)
      for (const commaCol of [1, 2]) {
        bubbles.push({
          id: `short_${q}_${commaCol}_,`,
          section: 'short',
          index: q,
          subIndex: commaCol,
          value: ',',
          cx: qX + 27 + commaCol * 28,
          cy: 1003,
          r: 7.8,
        });
      }
      // Digits 0..9 across all 4 columns
      for (let col = 0; col < 4; col++) {
        const cx = qX + 27 + col * 28;
        for (let d = 0; d <= 9; d++) {
          bubbles.push({
            id: `short_${q}_${col}_${d}`,
            section: 'short',
            index: q,
            subIndex: col,
            value: String(d),
            cx,
            cy: 1030 + d * 26,
            r: 7.8,
          });
        }
      }
    }

    return {
      formId: contest.formId,
      choiceCount: 4,
      sbdDigits,
      examCodeDigits: codeDigits,
      bubbles,
    };
  }

  // 3. Standard ABCD / ABCDE Sheets (20, 40, 50, 60, 100, 120)
  const formCap = getFormCapacity(contest.formId);
  const activeQuestions = Math.min(formCap, Math.max(1, contest.totalQuestions));
  const cols = formCap === 20 ? 2 : 4;
  const rowsPerCol = Math.ceil(formCap / cols);
  const choiceCount = contest.choiceCount || 4;
  const opts = choiceCount === 5 ? ['A', 'B', 'C', 'D', 'E'] : ['A', 'B', 'C', 'D'];

  const gridTop = 408;
  const gridBottom = 1280;
  const rowStep = Math.min(40, (gridBottom - gridTop) / Math.max(1, rowsPerCol - 1));
  const bubbleR = rowsPerCol >= 28 ? 8.4 : rowsPerCol >= 20 ? 8.8 : 9.8;

  const colAreaWidth = cols === 2 ? 360 : 208;
  const startGridX = cols === 2 ? 130 : 86;
  const optSpacing = choiceCount === 5 ? 29 : 35;
  const optOffset = choiceCount === 5 ? 52 : 56;

  for (let q = 0; q < activeQuestions; q++) {
    const col = Math.floor(q / rowsPerCol);
    const row = q % rowsPerCol;
    const blockX = startGridX + col * colAreaWidth;
    const cy = gridTop + row * rowStep;
    for (let oi = 0; oi < opts.length; oi++) {
      bubbles.push({
        id: `mcq_${q}_${opts[oi]}`,
        section: 'mcq',
        index: q,
        value: opts[oi],
        cx: blockX + optOffset + oi * optSpacing,
        cy,
        r: bubbleR,
      });
    }
  }

  return {
    formId: contest.formId,
    choiceCount,
    sbdDigits,
    examCodeDigits: codeDigits,
    bubbles,
  };
}

export function getFormCapacity(formId: SheetFormId): number {
  switch (formId) {
    case 'standard_20':
      return 20;
    case 'standard_40':
      return 40;
    case 'standard_50':
      return 50;
    case 'standard_60':
      return 60;
    case 'standard_100':
      return 100;
    case 'standard_120':
      return 120;
    case 'bgd_2025':
      return 40;
  }
}

export interface SampleFillData {
  sbd: string;
  examCode: string;
  mcqAnswers?: MCQChoice[];
  tfAnswers?: TFQuestionAnswer[];
  shortAnswers?: string[];
  perspectiveTilt?: boolean; // Simulates realistic mobile camera angle & subtle paper shading
}

export function renderSheetToCanvas(
  contest: Contest,
  scale = 1.6,
  fill?: SampleFillData
): HTMLCanvasElement {
  const geom = buildSheetGeometry(contest);
  const w = Math.round(CANONICAL_W * scale);
  const h = Math.round(CANONICAL_H * scale);
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d')!;

  ctx.save();
  ctx.scale(scale, scale);

  // Clean white paper background
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, CANONICAL_W, CANONICAL_H);

  // 4 outer fiducial alignment squares
  ctx.fillStyle = '#000000';
  for (const pt of Object.values(FIDUCIAL_CENTERS)) {
    ctx.fillRect(
      pt.x - FIDUCIAL_SIZE / 2,
      pt.y - FIDUCIAL_SIZE / 2,
      FIDUCIAL_SIZE,
      FIDUCIAL_SIZE
    );
  }

  // Title & Student Metadata Box (Top-left)
  ctx.strokeStyle = '#1e293b';
  ctx.lineWidth = 1.5;
  ctx.strokeRect(86, 72, 435, 258);

  ctx.fillStyle = '#0f172a';
  ctx.font = 'bold 19px system-ui, -apple-system, sans-serif';
  ctx.fillText('PHIẾU TRẢ LỜI TRẮC NGHIỆM', 104, 104);
  ctx.font = '13px system-ui, -apple-system, sans-serif';
  ctx.fillStyle = '#334155';
  ctx.fillText(`Bài thi / Test: ${contest.name.slice(0, 34)}`, 104, 132);
  ctx.fillText('Họ và tên / Full Name: .....................................................', 104, 166);
  ctx.fillText('Lớp / Class: ...........................   Ngày / Date: ....../....../202...', 104, 198);
  ctx.fillText('Phòng thi / Room: .................   Chữ ký / Sign: ......................', 104, 230);
  ctx.font = 'bold 11px system-ui, -apple-system, sans-serif';
  ctx.fillStyle = '#0f766e';
  ctx.fillText(
    `TNCraft Calibrated Form: ${contest.formId.toUpperCase()} • Tô kín bằng bút chì đen`,
    104,
    310
  );

  // Header SBD & Exam Code Boxes
  const sbdBubbles = geom.bubbles.filter((b) => b.section === 'sbd' && b.value === '0');
  const codeBubbles = geom.bubbles.filter((b) => b.section === 'examCode' && b.value === '0');

  if (sbdBubbles.length > 0) {
    const left = sbdBubbles[0].cx - 13;
    const width = sbdBubbles.length * 26;
    ctx.fillStyle = '#0f172a';
    ctx.font = 'bold 12px system-ui, sans-serif';
    ctx.fillText('SỐ BÁO DANH (ID)', left, 68);
    ctx.strokeStyle = '#1e293b';
    ctx.lineWidth = 1.3;
    ctx.strokeRect(left, 75, width, 260);
    for (let c = 0; c < sbdBubbles.length; c++) {
      const bx = left + c * 26;
      ctx.strokeRect(bx, 75, 26, 32);
      if (fill?.sbd?.[c]) {
        ctx.font = 'bold 15px monospace';
        ctx.fillText(fill.sbd[c], bx + 8, 97);
      }
    }
  }

  if (codeBubbles.length > 0) {
    const left = codeBubbles[0].cx - 13;
    const width = codeBubbles.length * 26;
    ctx.fillStyle = '#0f172a';
    ctx.font = 'bold 12px system-ui, sans-serif';
    ctx.fillText('MÃ ĐỀ', left, 68);
    ctx.strokeStyle = '#1e293b';
    ctx.lineWidth = 1.3;
    ctx.strokeRect(left, 75, width, 260);
    for (let c = 0; c < codeBubbles.length; c++) {
      const bx = left + c * 26;
      ctx.strokeRect(bx, 75, 26, 32);
      if (fill?.examCode?.[c]) {
        ctx.font = 'bold 15px monospace';
        ctx.fillText(fill.examCode[c], bx + 8, 97);
      }
    }
  }

  // Section Headers & Borders
  if (contest.formId === 'bgd_2025') {
    // Part I
    ctx.fillStyle = '#0f172a';
    ctx.font = 'bold 13px system-ui, sans-serif';
    ctx.fillText('PHẦN I. TRẮC NGHIỆM NHIỀU LỰA CHỌN (A, B, C, D)', 86, 366);
    for (let b = 0; b < 4; b++) {
      const bx = 86 + b * 209;
      ctx.strokeStyle = '#334155';
      ctx.lineWidth = 1.2;
      ctx.strokeRect(bx, 376, 196, 280);
      ctx.font = 'bold 11px system-ui, sans-serif';
      ['A', 'B', 'C', 'D'].forEach((lbl, oi) => {
        ctx.fillText(lbl, bx + 52 + oi * 36, 394);
      });
      for (let r = 0; r < 10; r++) {
        const qNum = b * 10 + r + 1;
        if (qNum <= (contest.enablePart1 ? contest.part1Questions : 0)) {
          ctx.font = '11px system-ui, sans-serif';
          ctx.fillText(String(qNum), bx + 12, 418 + r * 25);
        }
      }
    }

    // Part II
    ctx.fillStyle = '#0f172a';
    ctx.font = 'bold 13px system-ui, sans-serif';
    ctx.fillText('PHẦN II. TRẮC NGHIỆM ĐÚNG / SAI (a, b, c, d)', 86, 682);
    const subLabels = ['a)', 'b)', 'c)', 'd)'];
    for (let q = 0; q < 8; q++) {
      const block = Math.floor(q / 2);
      const sub = q % 2;
      const sx = 86 + block * 209 + sub * 101;
      ctx.strokeStyle = '#334155';
      ctx.lineWidth = 1.2;
      ctx.strokeRect(sx, 692, 95, 156);
      if (q < (contest.enablePart2 ? contest.part2Questions : 0)) {
        ctx.font = 'bold 11px system-ui, sans-serif';
        ctx.fillText(`Câu ${q + 1}`, sx + 8, 710);
        ctx.fillText('Đ', sx + 40, 724);
        ctx.fillText('S', sx + 74, 724);
        for (let sIdx = 0; sIdx < 4; sIdx++) {
          ctx.font = '11px system-ui, sans-serif';
          ctx.fillText(subLabels[sIdx], sx + 8, 748 + sIdx * 28);
        }
      }
    }

    // Part III
    ctx.fillStyle = '#0f172a';
    ctx.font = 'bold 13px system-ui, sans-serif';
    ctx.fillText('PHẦN III. TRẢ LỜI NGẮN (Dấu âm "-", dấu phẩy ",", chữ số 0–9)', 86, 876);
    for (let q = 0; q < 6; q++) {
      const qx = 86 + q * 138;
      ctx.strokeStyle = '#334155';
      ctx.lineWidth = 1.2;
      ctx.strokeRect(qx, 888, 128, 400);
      if (q < (contest.enablePart3 ? contest.part3Questions : 0)) {
        ctx.font = 'bold 11px system-ui, sans-serif';
        ctx.fillText(`Câu ${q + 1}`, qx + 10, 908);
        for (let c = 0; c < 4; c++) {
          ctx.strokeRect(qx + 13 + c * 28, 918, 28, 30);
        }
      }
    }
  } else {
    // Standard Sheet Framing
    const cap = getFormCapacity(contest.formId);
    const cols = cap === 20 ? 2 : 4;
    const rowsPerCol = Math.ceil(cap / cols);
    const colAreaWidth = cols === 2 ? 360 : 208;
    const startGridX = cols === 2 ? 130 : 86;
    const opts = contest.choiceCount === 5 ? ['A', 'B', 'C', 'D', 'E'] : ['A', 'B', 'C', 'D'];
    const optSpacing = contest.choiceCount === 5 ? 29 : 35;
    const optOffset = contest.choiceCount === 5 ? 52 : 56;
    const rowStep = Math.min(40, (1280 - 408) / Math.max(1, rowsPerCol - 1));

    ctx.fillStyle = '#0f172a';
    ctx.font = 'bold 14px system-ui, sans-serif';
    ctx.fillText(`PHẦN TRẢ LỜI CÂU HỎI (1 – ${contest.totalQuestions})`, startGridX, 366);

    for (let col = 0; col < cols; col++) {
      const bx = startGridX + col * colAreaWidth;
      const boxW = cols === 2 ? 260 : 196;
      ctx.strokeStyle = '#334155';
      ctx.lineWidth = 1.2;
      ctx.strokeRect(bx, 376, boxW, 932);

      ctx.font = 'bold 11px system-ui, sans-serif';
      opts.forEach((lbl, oi) => {
        ctx.fillText(lbl, bx + optOffset - 4 + oi * optSpacing, 393);
      });

      for (let r = 0; r < rowsPerCol; r++) {
        const qIdx = col * rowsPerCol + r;
        if (qIdx < contest.totalQuestions) {
          ctx.font = '11px system-ui, sans-serif';
          ctx.fillText(String(qIdx + 1), bx + 10, 412 + r * rowStep);
        }
      }
    }
  }

  // Draw all bubbles (and fill any requested demo marks!)
  for (const b of geom.bubbles) {
    const isFilled = shouldFillSampleBubble(b, fill);
    ctx.beginPath();
    ctx.arc(b.cx, b.cy, b.r, 0, Math.PI * 2);
    if (isFilled) {
      ctx.fillStyle = '#18181b';
      ctx.fill();
    } else {
      ctx.strokeStyle = '#64748b';
      ctx.lineWidth = 1.15;
      ctx.stroke();
      ctx.fillStyle = '#64748b';
      ctx.font = '9px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      const label = b.value === 'T' ? 'Đ' : b.value === 'F' ? 'S' : b.value;
      ctx.fillText(label, b.cx, b.cy + 0.5);
    }
  }
  ctx.textAlign = 'start';
  ctx.textBaseline = 'alphabetic';
  ctx.restore();

  if (!fill?.perspectiveTilt) {
    return canvas;
  }

  // Optional: render sheet onto a realistic wooden/desk background with slight camera angle
  const scene = document.createElement('canvas');
  scene.width = w + Math.round(140 * scale);
  scene.height = h + Math.round(140 * scale);
  const sctx = scene.getContext('2d')!;
  sctx.fillStyle = '#cbd5e1';
  sctx.fillRect(0, 0, scene.width, scene.height);

  sctx.save();
  sctx.translate(scene.width / 2, scene.height / 2);
  sctx.rotate(-0.018); // Slight realistic handheld camera rotation
  sctx.drawImage(canvas, -w / 2, -h / 2);
  sctx.restore();
  return scene;
}

function shouldFillSampleBubble(b: BubbleCoord, fill?: SampleFillData): boolean {
  if (!fill) return false;
  if (b.section === 'sbd') {
    return fill.sbd?.[b.index] === b.value;
  }
  if (b.section === 'examCode') {
    return fill.examCode?.[b.index] === b.value;
  }
  if (b.section === 'mcq') {
    return fill.mcqAnswers?.[b.index] === b.value;
  }
  if (b.section === 'tf') {
    const subKeys: Array<keyof TFQuestionAnswer> = ['a', 'b', 'c', 'd'];
    const sk = subKeys[b.subIndex ?? 0];
    return fill.tfAnswers?.[b.index]?.[sk] === b.value;
  }
  if (b.section === 'short') {
    const raw = (fill.shortAnswers?.[b.index] || '').replace(/\./g, ',');
    const ch = raw[b.subIndex ?? 0] || '';
    return ch === b.value;
  }
  return false;
}
