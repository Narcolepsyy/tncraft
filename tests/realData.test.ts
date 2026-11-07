import { describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { execFileSync } from 'node:child_process';
import { parseAnswerKeyBuffer } from '../src/utils/exportUtils';
import { scanSheetFromImageData } from '../src/omr/omrEngine';
import { AnswerKey, Contest } from '../src/types';

const REAL_DATA_DIR = path.resolve(__dirname, '../../real_data');
const xlsxFiles = fs.existsSync(REAL_DATA_DIR)
  ? fs.readdirSync(REAL_DATA_DIR).filter((f) => f.toLowerCase().endsWith('.xlsx')).sort()
  : [];
const jpgFiles = fs.existsSync(REAL_DATA_DIR)
  ? fs.readdirSync(REAL_DATA_DIR).filter((f) => /\.(jpe?g|png)$/i.test(f)).sort()
  : [];
const hasRealData = xlsxFiles.length >= 2 && jpgFiles.length >= 1;

function decodeJpegViaPython(jpgPath: string, maxDim?: number): ImageData {
  const pyScript = `
import sys, struct
from PIL import Image
im = Image.open(sys.argv[1]).convert('RGBA')
if len(sys.argv) > 2 and int(sys.argv[2]) > 0:
    md = int(sys.argv[2])
    r = min(1.0, md / max(im.size))
    im = im.resize((round(im.size[0]*r), round(im.size[1]*r)), Image.Resampling.BILINEAR)
w, h = im.size
sys.stdout.buffer.write(struct.pack('<II', w, h))
sys.stdout.buffer.write(im.tobytes())
`;
  const out = execFileSync(
    'python3',
    ['-c', pyScript, jpgPath, String(maxDim || 0)],
    { maxBuffer: 64 * 1024 * 1024 }
  );
  const width = out.readUInt32LE(0);
  const height = out.readUInt32LE(4);
  const rgba = new Uint8ClampedArray(out.buffer, out.byteOffset + 8, width * height * 4);
  return { width, height, data: rgba, colorSpace: 'srgb' } as ImageData;
}

describe.runIf(hasRealData)('Real-World Vietnamese Exam Data Integration (real_data/)', () => {
  it('imports both .xlsx key workbooks (12 exam codes) and scans + grades the handheld student sheet photo at full & mobile resolutions', async () => {
    let contest: Contest = {
      id: 'real_gk1',
      name: 'Midterm Math 11',
      createdAt: '2026-11-06',
      classId: null,
      formId: 'bgd_2025',
      choiceCount: 4,
      sbdDigits: 6, // intentionally 6 before auto-detect to verify 8-digit Ministry sheet still decodes all 8 digits!
      examCodeDigits: 3, // intentionally 3 to verify .xlsx auto-upgrades to 4!
      totalQuestions: 40,
      maxScore: 10,
      subjectSplits: [],
      enablePart1: true,
      part1Questions: 40,
      part1TotalScore: 3.0,
      enablePart2: true,
      part2Questions: 8,
      part2Score1: 0.1,
      part2Score2: 0.25,
      part2Score3: 0.5,
      part2Score4: 1.0,
      enablePart3: true,
      part3Questions: 6,
      part3TotalScore: 2.0,
      enablePart4Essay: true,
      part4MaxScore: 3.0,
    };

    const xlsx1 = fs.readFileSync(path.join(REAL_DATA_DIR, xlsxFiles[0]));
    const xlsx2 = fs.readFileSync(path.join(REAL_DATA_DIR, xlsxFiles[1]));

    const ab1 = xlsx1.buffer.slice(xlsx1.byteOffset, xlsx1.byteOffset + xlsx1.byteLength);
    const ab2 = xlsx2.buffer.slice(xlsx2.byteOffset, xlsx2.byteOffset + xlsx2.byteLength);

    const parsed1 = await parseAnswerKeyBuffer(ab1, xlsxFiles[0], contest);
    contest = { ...contest, ...parsed1.contestPatch };
    const parsed2 = await parseAnswerKeyBuffer(ab2, xlsxFiles[1], contest);
    contest = { ...contest, ...parsed2.contestPatch };

    const allKeys: AnswerKey[] = [...parsed1.keys, ...parsed2.keys].map((k, idx) => ({
      ...k,
      id: `k_${idx}`,
      createdAt: '2026-11-06',
    }));

    // 1. Verify all 12 Exam Codes (1001..1012) and auto-inferred contest structure
    expect(allKeys.map((k) => k.examCode).sort()).toEqual([
      '1001',
      '1002',
      '1003',
      '1004',
      '1005',
      '1006',
      '1007',
      '1008',
      '1009',
      '1010',
      '1011',
      '1012',
    ]);
    expect(contest.examCodeDigits).toBe(4);
    expect(contest.part1Questions).toBe(12);
    expect(contest.part2Questions).toBe(2);
    expect(contest.part3Questions).toBe(4);

    // 2. Test scanning at BOTH native photo size (1184x2560) and ScannerPanel upload size (maxDim=2000 -> 925x2000)
    const photoPath = path.join(REAL_DATA_DIR, jpgFiles[0]);

    for (const maxDim of [undefined, 2000]) {
      const imgData = decodeJpegViaPython(photoPath, maxDim);
      const res = scanSheetFromImageData(imgData, contest, allKeys, { eraseMode: 'normal' });

      expect(res.cornersDetected).toBe(true);
      expect(res.sbd).toBe('11000001');
      expect(res.examCode).toBe('1003');
      expect(res.mcqAnswers).toEqual([
        'B',
        'A',
        'A',
        'B',
        'B',
        'C',
        'D',
        'B',
        'D',
        'A',
        'D',
        'A',
      ]);
      expect(res.tfAnswers).toEqual([
        { a: 'T', b: 'F', c: 'T', d: 'T' },
        { a: 'T', b: 'T', c: 'F', d: 'F' },
      ]);
      expect(res.shortAnswers).toEqual(['-0,6', '5400', '3', '3,5']);

      // Verify grading against Code 1003:
      // Part I: 8/12 correct -> 2.00 / 3.00
      // Part II: Q1 4/4 (1.00) + Q2 4/4 (1.00) -> 2.00 / 2.00
      // Part III: 3/4 correct (-0,6, 5400, 3,5; Q3 answered "3" vs key "12") -> 1.50 / 2.00
      // Objective total (with 0 essay): 5.50 / 10.00 (7.00 objective + 3.00 essay max)
      expect(res.grade.scorePart1).toBe(2);
      expect(res.grade.scorePart2).toBe(2);
      expect(res.grade.scorePart3).toBe(1.5);
      expect(res.grade.totalScore).toBe(5.5);
      expect(res.grade.warnings).toEqual([]);
    }
  });
});
