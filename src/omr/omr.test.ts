import { describe, expect, it } from 'vitest';
import {
  buildSheetGeometry,
  CANONICAL_H,
  CANONICAL_W,
  FIDUCIAL_CENTERS,
  FIDUCIAL_SIZE,
} from '../sheets/sheetLayouts';
import { computePaperGrade, normalizeNumericAnswer } from './grading';
import { scanSheetFromImageData } from './omrEngine';
import { AnswerKey, Contest, SheetFormId } from '../types';

function makeContest(formId: SheetFormId): Contest {
  return {
    id: 'c1',
    name: 'Test Exam',
    createdAt: '2026-11-07',
    classId: null,
    formId,
    choiceCount: 4,
    sbdDigits: 6,
    examCodeDigits: formId === 'bgd_2025' ? 4 : 3,
    totalQuestions: formId === 'bgd_2025' ? 40 : Number(formId.replace('standard_', '')),
    maxScore: 10,
    subjectSplits: [],
    enablePart1: true,
    part1Questions: 12,
    part1TotalScore: 3.0,
    enablePart2: true,
    part2Questions: 4,
    part2Score1: 0.1,
    part2Score2: 0.25,
    part2Score3: 0.5,
    part2Score4: 1.0,
    enablePart3: true,
    part3Questions: 6,
    part3TotalScore: 3.0,
    enablePart4Essay: false,
    part4MaxScore: 0,
  };
}

describe('TNCraft Sheet Geometry & OMR Grading Engine', () => {
  it('keeps all bubbles strictly non-overlapping across every sheet form', () => {
    const forms: SheetFormId[] = [
      'bgd_2025',
      'standard_20',
      'standard_40',
      'standard_50',
      'standard_60',
      'standard_100',
      'standard_120',
    ];

    for (const formId of forms) {
      const c = makeContest(formId);
      const geom = buildSheetGeometry(c);
      expect(geom.bubbles.length).toBeGreaterThan(80);

      for (let i = 0; i < geom.bubbles.length; i++) {
        const a = geom.bubbles[i];
        expect(a.cx).toBeGreaterThan(70);
        expect(a.cx).toBeLessThan(CANONICAL_W - 70);
        expect(a.cy).toBeGreaterThan(100);
        expect(a.cy).toBeLessThan(CANONICAL_H - 90);

        for (let j = i + 1; j < geom.bubbles.length; j++) {
          const b = geom.bubbles[j];
          const dist = Math.hypot(a.cx - b.cx, a.cy - b.cy);
          expect(dist).toBeGreaterThan(a.r + b.r + 1.5);
        }
      }
    }
  });

  it('scores BGD-2025 Part I, non-linear Part II (0.1/0.25/0.5/1.0), and Part III numeric equivalence', () => {
    expect(normalizeNumericAnswer('-1,50')).toBe('-1.5');
    expect(normalizeNumericAnswer('05')).toBe('5');

    const contest = makeContest('bgd_2025');
    contest.part1Questions = 4;
    contest.part1TotalScore = 2.0; // 0.5 each
    contest.part2Questions = 2; // up to 2.0
    contest.part3Questions = 2;
    contest.part3TotalScore = 1.0; // 0.5 each
    contest.enablePart4Essay = true;
    contest.part4MaxScore = 2.0;

    const key: AnswerKey = {
      id: 'k1',
      contestId: contest.id,
      examCode: '0101',
      createdAt: '2026-11-07',
      mcqAnswers: ['A', 'B', 'C', 'D'],
      tfAnswers: [
        { a: 'T', b: 'F', c: 'T', d: 'F' },
        { a: 'T', b: 'T', c: 'F', d: 'F' },
      ],
      shortAnswers: ['-1,5', '42'],
    };

    const g = computePaperGrade(
      contest,
      [key],
      '010009',
      '0101',
      ['A', 'B', 'C', 'A'], // 3/4 -> 1.5
      [
        { a: 'T', b: 'F', c: 'T', d: 'F' }, // 4/4 -> 1.0
        { a: 'T', b: 'T', c: 'F', d: 'T' }, // 3/4 -> 0.5
      ],
      ['-1.50', '99'], // 1/2 -> 0.5
      1.75
    );

    expect(g.scorePart1).toBe(1.5);
    expect(g.scorePart2).toBe(1.5);
    expect(g.scorePart3).toBe(0.5);
    expect(g.totalScore).toBe(5.25);
    expect(g.maxPossibleScore).toBe(7.0);
  });

  it('detects fiducial corners, warps perspective, and decodes SBD, ExamCode, Part I, II, III accurately', () => {
    const contest = makeContest('bgd_2025');
    const geom = buildSheetGeometry(contest);

    // Synthesize a padded 1120 x 1540 RGBA camera frame with offset sheet
    const padX = 60;
    const padY = 60;
    const W = CANONICAL_W + padX * 2;
    const H = CANONICAL_H + padY * 2;
    const rgba = new Uint8ClampedArray(W * H * 4);
    // Light gray desk outer border
    for (let i = 0; i < W * H * 4; i += 4) {
      rgba[i] = 215;
      rgba[i + 1] = 220;
      rgba[i + 2] = 225;
      rgba[i + 3] = 255;
    }
    // White paper interior
    for (let y = padY; y < padY + CANONICAL_H; y++) {
      for (let x = padX; x < padX + CANONICAL_W; x++) {
        const idx = (y * W + x) * 4;
        rgba[idx] = 255;
        rgba[idx + 1] = 255;
        rgba[idx + 2] = 255;
      }
    }

    // Draw 4 solid black fiducial squares
    for (const pt of Object.values(FIDUCIAL_CENTERS)) {
      const x0 = Math.round(padX + pt.x - FIDUCIAL_SIZE / 2);
      const y0 = Math.round(padY + pt.y - FIDUCIAL_SIZE / 2);
      for (let y = y0; y < y0 + FIDUCIAL_SIZE; y++) {
        for (let x = x0; x < x0 + FIDUCIAL_SIZE; x++) {
          const idx = (y * W + x) * 4;
          rgba[idx] = 10;
          rgba[idx + 1] = 10;
          rgba[idx + 2] = 10;
        }
      }
    }

    const fillBubble = (cx: number, cy: number, r: number) => {
      const r2 = r * r;
      for (let y = Math.floor(padY + cy - r); y <= Math.ceil(padY + cy + r); y++) {
        for (let x = Math.floor(padX + cx - r); x <= Math.ceil(padX + cx + r); x++) {
          if ((x - (padX + cx)) ** 2 + (y - (padY + cy)) ** 2 <= r2) {
            const idx = (y * W + x) * 4;
            rgba[idx] = 20;
            rgba[idx + 1] = 20;
            rgba[idx + 2] = 20;
          }
        }
      }
    };

    const targetSbd = '010025';
    const targetCode = '0101';
    const keyMcq = ['A', 'C', 'B', 'D', 'A', 'B', 'C', 'D', 'B', 'A', 'D', 'C'] as const;
    const keyTf = [
      { a: 'T', b: 'F', c: 'T', d: 'T' },
      { a: 'F', b: 'T', c: 'T', d: 'F' },
      { a: 'T', b: 'T', c: 'F', d: 'T' },
      { a: 'F', b: 'F', c: 'T', d: 'T' },
    ] as const;
    const keyShort = ['12,5', '-4', '2025', '0,75', '42', '-1,5'];

    for (const b of geom.bubbles) {
      if (b.section === 'sbd' && targetSbd[b.index] === b.value) fillBubble(b.cx, b.cy, b.r);
      if (b.section === 'examCode' && targetCode[b.index] === b.value) fillBubble(b.cx, b.cy, b.r);
      if (b.section === 'mcq' && keyMcq[b.index] === b.value) fillBubble(b.cx, b.cy, b.r);
      if (b.section === 'tf') {
        const sub = (['a', 'b', 'c', 'd'] as const)[b.subIndex ?? 0];
        if (keyTf[b.index][sub] === b.value) fillBubble(b.cx, b.cy, b.r);
      }
      if (b.section === 'short') {
        const ch = keyShort[b.index][b.subIndex ?? 0] || '';
        if (ch === b.value) fillBubble(b.cx, b.cy, b.r);
      }
    }

    const key: AnswerKey = {
      id: 'k1',
      contestId: contest.id,
      examCode: targetCode,
      createdAt: '2026-11-07',
      mcqAnswers: [...keyMcq],
      tfAnswers: keyTf.map((x) => ({ ...x })),
      shortAnswers: [...keyShort],
    };

    const res = scanSheetFromImageData(
      { data: rgba, width: W, height: H, colorSpace: 'srgb' } as ImageData,
      contest,
      [key],
      { eraseMode: 'normal' }
    );

    expect(res.cornersDetected).toBe(true);
    expect(res.sbd).toBe(targetSbd);
    expect(res.examCode).toBe(targetCode);
    expect(res.mcqAnswers).toEqual([...keyMcq]);
    expect(res.shortAnswers).toEqual(keyShort);
    expect(res.grade.totalScore).toBe(10);
  });
});
