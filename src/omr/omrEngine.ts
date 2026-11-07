import {
  AnswerKey,
  AppSettings,
  BubbleCoord,
  Contest,
  MCQChoice,
  Point2D,
  TFChoice,
  TFQuestionAnswer,
} from '../types';
import {
  buildSheetGeometry,
  CANONICAL_H,
  CANONICAL_W,
  FIDUCIAL_CENTERS,
} from '../sheets/sheetLayouts';
import { computePaperGrade, GradeComputation, normalizeNumericAnswer } from './grading';

export interface CornerQuad {
  tl: Point2D;
  tr: Point2D;
  br: Point2D;
  bl: Point2D;
}

export interface ScanResult {
  cornersDetected: boolean;
  corners: CornerQuad;
  sbd: string;
  examCode: string;
  mcqAnswers: MCQChoice[];
  tfAnswers: TFQuestionAnswer[];
  shortAnswers: string[];
  grade: GradeComputation;
  annotatedDataUrl: string;
}

/**
 * Compute 3x3 projective homography H mapping canonical destination (x, y) -> source image (u, v)
 */
export function computeHomography(dst: Point2D[], src: Point2D[]): number[] {
  const A: number[][] = [];
  const B: number[] = [];

  for (let i = 0; i < 4; i++) {
    const x = dst[i].x;
    const y = dst[i].y;
    const u = src[i].x;
    const v = src[i].y;
    A.push([x, y, 1, 0, 0, 0, -u * x, -u * y]);
    B.push(u);
    A.push([0, 0, 0, x, y, 1, -v * x, -v * y]);
    B.push(v);
  }

  // Gaussian elimination with partial pivoting (8x8)
  const n = 8;
  for (let col = 0; col < n; col++) {
    let maxRow = col;
    let maxVal = Math.abs(A[col][col]);
    for (let r = col + 1; r < n; r++) {
      const v = Math.abs(A[r][col]);
      if (v > maxVal) {
        maxVal = v;
        maxRow = r;
      }
    }
    [A[col], A[maxRow]] = [A[maxRow], A[col]];
    [B[col], B[maxRow]] = [B[maxRow], B[col]];

    const pivot = A[col][col] || 1e-12;
    for (let c = col; c < n; c++) A[col][c] /= pivot;
    B[col] /= pivot;

    for (let r = 0; r < n; r++) {
      if (r === col) continue;
      const factor = A[r][col];
      if (factor === 0) continue;
      for (let c = col; c < n; c++) A[r][c] -= factor * A[col][c];
      B[r] -= factor * B[col];
    }
  }

  return [B[0], B[1], B[2], B[3], B[4], B[5], B[6], B[7], 1];
}

/**
 * Bradley-Roth fast O(W*H) integral-image local adaptive threshold.
 * Returns binary mask (1 = dark ink, 0 = light paper) and grayscale array.
 */
export function adaptiveThresholdImage(
  rgba: Uint8ClampedArray,
  width: number,
  height: number,
  sensitivity = 0.84
): { gray: Uint8Array; binary: Uint8Array } {
  const gray = new Uint8Array(width * height);
  for (let i = 0, p = 0; i < gray.length; i++, p += 4) {
    gray[i] = (rgba[p] * 77 + rgba[p + 1] * 150 + rgba[p + 2] * 29) >> 8;
  }

  const integral = new Float64Array((width + 1) * (height + 1));
  const stride = width + 1;
  for (let y = 1; y <= height; y++) {
    let rowSum = 0;
    const srcOff = (y - 1) * width;
    const dstOff = y * stride;
    const prevOff = (y - 1) * stride;
    for (let x = 1; x <= width; x++) {
      rowSum += gray[srcOff + x - 1];
      integral[dstOff + x] = integral[prevOff + x] + rowSum;
    }
  }

  const binary = new Uint8Array(width * height);
  const s2 = Math.max(8, Math.round(Math.min(width, height) / 32));

  for (let y = 0; y < height; y++) {
    const y1 = Math.max(0, y - s2);
    const y2 = Math.min(height - 1, y + s2);
    for (let x = 0; x < width; x++) {
      const x1 = Math.max(0, x - s2);
      const x2 = Math.min(width - 1, x + s2);
      const count = (x2 - x1 + 1) * (y2 - y1 + 1);
      const sum =
        integral[(y2 + 1) * stride + (x2 + 1)] -
        integral[y1 * stride + (x2 + 1)] -
        integral[(y2 + 1) * stride + x1] +
        integral[y1 * stride + x1];

      binary[y * width + x] = gray[y * width + x] * count < sum * sensitivity ? 1 : 0;
    }
  }

  return { gray, binary };
}

/**
 * Automatically locate the 4 solid black fiducial squares in the 4 quadrants of an image.
 */
export function detectFiducialCorners(
  binary: Uint8Array,
  width: number,
  height: number
): CornerQuad | null {
  const visited = new Uint8Array(width * height);
  interface BlobCandidate {
    cx: number;
    cy: number;
    area: number;
    w: number;
    h: number;
    fillRatio: number;
  }

  const blobs: BlobCandidate[] = [];
  const minSide = Math.max(6, Math.min(width, height) * 0.012);
  const maxSide = Math.min(width, height) * 0.12;
  const qx = new Int32Array(width * height);

  for (let y = 2; y < height - 2; y += 2) {
    for (let x = 2; x < width - 2; x += 2) {
      const startIdx = y * width + x;
      if (!binary[startIdx] || visited[startIdx]) continue;

      let head = 0;
      let tail = 0;
      qx[tail++] = startIdx;
      visited[startIdx] = 1;

      let minX = x;
      let maxX = x;
      let minY = y;
      let maxY = y;
      let sumX = 0;
      let sumY = 0;
      let area = 0;

      while (head < tail) {
        const idx = qx[head++];
        const py = Math.floor(idx / width);
        const px = idx - py * width;
        area++;
        sumX += px;
        sumY += py;
        if (px < minX) minX = px;
        if (px > maxX) maxX = px;
        if (py < minY) minY = py;
        if (py > maxY) maxY = py;

        // 4-connected neighbors
        if (px > 0 && binary[idx - 1] && !visited[idx - 1]) {
          visited[idx - 1] = 1;
          qx[tail++] = idx - 1;
        }
        if (px + 1 < width && binary[idx + 1] && !visited[idx + 1]) {
          visited[idx + 1] = 1;
          qx[tail++] = idx + 1;
        }
        if (py > 0 && binary[idx - width] && !visited[idx - width]) {
          visited[idx - width] = 1;
          qx[tail++] = idx - width;
        }
        if (py + 1 < height && binary[idx + width] && !visited[idx + width]) {
          visited[idx + width] = 1;
          qx[tail++] = idx + width;
        }
      }

      const bw = maxX - minX + 1;
      const bh = maxY - minY + 1;
      if (bw < minSide || bh < minSide || bw > maxSide || bh > maxSide) continue;
      const aspect = bw / bh;
      if (aspect < 0.62 || aspect > 1.6) continue;
      const fillRatio = area / (bw * bh);
      // Solid square fiducials have high fill ratio (> 0.58), unlike hollow text or rings
      if (fillRatio < 0.58) continue;

      blobs.push({
        cx: sumX / area,
        cy: sumY / area,
        area,
        w: bw,
        h: bh,
        fillRatio,
      });
    }
  }

  if (blobs.length < 4) return null;

  const pickBestInQuadrant = (
    qxPred: (b: BlobCandidate) => boolean,
    targetX: number,
    targetY: number
  ): BlobCandidate | null => {
    const candidates = blobs.filter(qxPred);
    if (candidates.length === 0) return null;
    // Outermost square-like dense fiducial closest to the corner
    candidates.sort((a, b) => {
      const da = Math.hypot(a.cx - targetX, a.cy - targetY) - a.fillRatio * 18;
      const db = Math.hypot(b.cx - targetX, b.cy - targetY) - b.fillRatio * 18;
      return da - db;
    });
    return candidates[0];
  };

  const tl = pickBestInQuadrant((b) => b.cx < width * 0.45 && b.cy < height * 0.45, 0, 0);
  const tr = pickBestInQuadrant((b) => b.cx > width * 0.55 && b.cy < height * 0.45, width, 0);
  const br = pickBestInQuadrant((b) => b.cx > width * 0.55 && b.cy > height * 0.55, width, height);
  const bl = pickBestInQuadrant((b) => b.cx < width * 0.45 && b.cy > height * 0.55, 0, height);

  if (!tl || !tr || !br || !bl) return null;

  // Sanity check quad span (>35% of frame width & height)
  if (tr.cx - tl.cx < width * 0.32 || bl.cy - tl.cy < height * 0.32) return null;

  return {
    tl: { x: tl.cx, y: tl.cy },
    tr: { x: tr.cx, y: tr.cy },
    br: { x: br.cx, y: br.cy },
    bl: { x: bl.cx, y: bl.cy },
  };
}

/**
 * Warp source image into canonical 1000x1414 sheet space, read every bubble density,
 * grade against keys, and produce an annotated visual confirmation image.
 */
export function scanSheetFromImageData(
  imageData: ImageData,
  contest: Contest,
  keys: AnswerKey[],
  settings: Pick<AppSettings, 'eraseMode'>,
  overrideCorners?: CornerQuad
): ScanResult {
  const { width, height, data } = imageData;
  const { binary } = adaptiveThresholdImage(data, width, height, 0.84);

  const detected = overrideCorners || detectFiducialCorners(binary, width, height);
  const corners: CornerQuad = detected || {
    tl: { x: width * 0.05, y: height * 0.035 },
    tr: { x: width * 0.95, y: height * 0.035 },
    br: { x: width * 0.95, y: height * 0.965 },
    bl: { x: width * 0.05, y: height * 0.965 },
  };

  const dstPts = [
    FIDUCIAL_CENTERS.tl,
    FIDUCIAL_CENTERS.tr,
    FIDUCIAL_CENTERS.br,
    FIDUCIAL_CENTERS.bl,
  ];
  const srcPts = [corners.tl, corners.tr, corners.br, corners.bl];
  const H = computeHomography(dstPts, srcPts);

  // Warp source image into canonical 1000x1414 canvas
  const warpedData = new Uint8ClampedArray(CANONICAL_W * CANONICAL_H * 4);
  for (let y = 0; y < CANONICAL_H; y++) {
    for (let x = 0; x < CANONICAL_W; x++) {
      const denom = H[6] * x + H[7] * y + H[8];
      const sx = Math.round((H[0] * x + H[1] * y + H[2]) / denom);
      const sy = Math.round((H[3] * x + H[4] * y + H[5]) / denom);
      const dstIdx = (y * CANONICAL_W + x) * 4;
      if (sx >= 0 && sx < width && sy >= 0 && sy < height) {
        const srcIdx = (sy * width + sx) * 4;
        warpedData[dstIdx] = data[srcIdx];
        warpedData[dstIdx + 1] = data[srcIdx + 1];
        warpedData[dstIdx + 2] = data[srcIdx + 2];
        warpedData[dstIdx + 3] = 255;
      } else {
        warpedData[dstIdx] = 255;
        warpedData[dstIdx + 1] = 255;
        warpedData[dstIdx + 2] = 255;
        warpedData[dstIdx + 3] = 255;
      }
    }
  }

  const warpedThresh = adaptiveThresholdImage(warpedData, CANONICAL_W, CANONICAL_H, 0.83);
  const geom = buildSheetGeometry(contest);

  // Measure fill score inside inner 78% of each bubble radius (ignoring printed outer ring!)
  const fillScores = new Map<string, number>();
  for (const b of geom.bubbles) {
    const innerR = b.r * 0.76;
    const r2 = innerR * innerR;
    const minX = Math.max(0, Math.floor(b.cx - innerR));
    const maxX = Math.min(CANONICAL_W - 1, Math.ceil(b.cx + innerR));
    const minY = Math.max(0, Math.floor(b.cy - innerR));
    const maxY = Math.min(CANONICAL_H - 1, Math.ceil(b.cy + innerR));

    let darkPixels = 0;
    let totalPixels = 0;
    let graySum = 0;

    for (let py = minY; py <= maxY; py++) {
      for (let px = minX; px <= maxX; px++) {
        if ((px - b.cx) * (px - b.cx) + (py - b.cy) * (py - b.cy) <= r2) {
          totalPixels++;
          const idx = py * CANONICAL_W + px;
          if (warpedThresh.binary[idx]) darkPixels++;
          graySum += warpedThresh.gray[idx];
        }
      }
    }

    const binRatio = totalPixels > 0 ? darkPixels / totalPixels : 0;
    const darkness = totalPixels > 0 ? 1 - graySum / (totalPixels * 255) : 0;
    // Combined fill confidence (printed character inside empty bubble is ~0.12-0.22; filled mark is ~0.58-0.98)
    fillScores.set(b.id, binRatio * 0.7 + darkness * 0.3);
  }

  const pickFromGroup = (group: BubbleCoord[]): { value: string; multi: boolean } => {
    const scored = group
      .map((b) => ({ value: b.value, score: fillScores.get(b.id) || 0 }))
      .sort((a, b) => b.score - a.score);

    if (scored.length === 0) return { value: '', multi: false };
    const top = scored[0];
    const second = scored[1] || { value: '', score: 0 };

    const minMarkThreshold = 0.36;
    if (top.score < minMarkThreshold) {
      return { value: '', multi: false };
    }

    // Erase mode handling: if 2 bubbles exceed threshold, check if top is clearly darker than erased smudge
    if (second.score >= minMarkThreshold) {
      const dominanceRatio = settings.eraseMode === 'high' ? 1.22 : 1.42;
      if (top.score >= second.score * dominanceRatio) {
        return { value: top.value, multi: false };
      }
      return { value: 'MULTI', multi: true };
    }

    return { value: top.value, multi: false };
  };

  // Decode SBD
  let sbd = '';
  for (let c = 0; c < contest.sbdDigits; c++) {
    const group = geom.bubbles.filter((b) => b.section === 'sbd' && b.index === c);
    const res = pickFromGroup(group);
    sbd += res.multi ? '?' : res.value || '';
  }

  // Decode Exam Code
  let examCode = '';
  for (let c = 0; c < contest.examCodeDigits; c++) {
    const group = geom.bubbles.filter((b) => b.section === 'examCode' && b.index === c);
    const res = pickFromGroup(group);
    examCode += res.multi ? '?' : res.value || '';
  }

  // Decode MCQ (Standard or BGD Part I)
  const mcqCount = contest.formId === 'bgd_2025' ? contest.part1Questions : contest.totalQuestions;
  const mcqAnswers: MCQChoice[] = [];
  for (let q = 0; q < mcqCount; q++) {
    const group = geom.bubbles.filter((b) => b.section === 'mcq' && b.index === q);
    const res = pickFromGroup(group);
    mcqAnswers.push((res.value as MCQChoice) || '');
  }

  // Decode BGD Part II (True/False)
  const tfAnswers: TFQuestionAnswer[] = [];
  if (contest.formId === 'bgd_2025' && contest.enablePart2) {
    const subKeys: Array<keyof TFQuestionAnswer> = ['a', 'b', 'c', 'd'];
    for (let q = 0; q < contest.part2Questions; q++) {
      const item: TFQuestionAnswer = { a: '', b: '', c: '', d: '' };
      for (let sIdx = 0; sIdx < 4; sIdx++) {
        const group = geom.bubbles.filter(
          (b) => b.section === 'tf' && b.index === q && b.subIndex === sIdx
        );
        const res = pickFromGroup(group);
        item[subKeys[sIdx]] = (res.value as TFChoice) || '';
      }
      tfAnswers.push(item);
    }
  }

  // Decode BGD Part III (Short Answer Numeric)
  const shortAnswers: string[] = [];
  if (contest.formId === 'bgd_2025' && contest.enablePart3) {
    for (let q = 0; q < contest.part3Questions; q++) {
      let str = '';
      for (let col = 0; col < 4; col++) {
        const group = geom.bubbles.filter(
          (b) => b.section === 'short' && b.index === q && b.subIndex === col
        );
        const res = pickFromGroup(group);
        if (res.multi) str += '?';
        else if (res.value) str += res.value;
      }
      shortAnswers.push(str);
    }
  }

  const grade = computePaperGrade(
    contest,
    keys,
    sbd,
    examCode,
    mcqAnswers,
    tfAnswers,
    shortAnswers,
    0
  );

  const annotatedDataUrl = renderAnnotatedOverlay(
    warpedData,
    geom.bubbles,
    contest,
    keys,
    sbd,
    examCode,
    mcqAnswers,
    tfAnswers,
    shortAnswers,
    grade
  );

  return {
    cornersDetected: Boolean(detected),
    corners,
    sbd,
    examCode,
    mcqAnswers,
    tfAnswers,
    shortAnswers,
    grade,
    annotatedDataUrl,
  };
}

function renderAnnotatedOverlay(
  warpedRgba: Uint8ClampedArray,
  bubbles: BubbleCoord[],
  contest: Contest,
  keys: AnswerKey[],
  sbd: string,
  examCode: string,
  mcqAnswers: MCQChoice[],
  tfAnswers: TFQuestionAnswer[],
  shortAnswers: string[],
  grade: GradeComputation
): string {
  if (typeof document === 'undefined') return '';
  const canvas = document.createElement('canvas');
  canvas.width = CANONICAL_W;
  canvas.height = CANONICAL_H;
  const ctx = canvas.getContext('2d');
  if (!ctx) return '';

  const imgData = new ImageData(new Uint8ClampedArray(warpedRgba), CANONICAL_W, CANONICAL_H);
  ctx.putImageData(imgData, 0, 0);

  const matchedKey =
    keys.find((k) => k.examCode.trim() === examCode.trim()) ||
    (keys.length === 1 ? keys[0] : undefined);

  // Highlight SBD & ExamCode readouts
  for (const b of bubbles) {
    if (b.section === 'sbd' && sbd[b.index] === b.value) {
      drawRing(ctx, b.cx, b.cy, b.r + 2, '#0284c7', 2.5);
    } else if (b.section === 'examCode' && examCode[b.index] === b.value) {
      drawRing(ctx, b.cx, b.cy, b.r + 2, '#7c3aed', 2.5);
    } else if (b.section === 'mcq') {
      const sAns = mcqAnswers[b.index] || '';
      const kAns = matchedKey?.mcqAnswers[b.index] || '';
      if (sAns === b.value) {
        drawRing(ctx, b.cx, b.cy, b.r + 2.5, sAns === kAns ? '#16a34a' : '#dc2626', 3);
      } else if (kAns === b.value && sAns !== kAns) {
        drawRing(ctx, b.cx, b.cy, b.r + 2.5, '#0ea5e9', 2.5, true);
      }
    } else if (b.section === 'tf') {
      const subKeys: Array<keyof TFQuestionAnswer> = ['a', 'b', 'c', 'd'];
      const sk = subKeys[b.subIndex ?? 0];
      const sAns = tfAnswers[b.index]?.[sk] || '';
      const kAns = matchedKey?.tfAnswers[b.index]?.[sk] || '';
      if (sAns === b.value) {
        drawRing(ctx, b.cx, b.cy, b.r + 2.5, sAns === kAns ? '#16a34a' : '#dc2626', 3);
      } else if (kAns === b.value && sAns !== kAns) {
        drawRing(ctx, b.cx, b.cy, b.r + 2.5, '#0ea5e9', 2.2, true);
      }
    } else if (b.section === 'short') {
      const sRaw = shortAnswers[b.index] || '';
      const kRaw = matchedKey?.shortAnswers[b.index] || '';
      const isCorrect =
        Boolean(sRaw) &&
        Boolean(kRaw) &&
        normalizeNumericAnswer(sRaw) === normalizeNumericAnswer(kRaw);
      if (sRaw[b.subIndex ?? 0] === b.value) {
        drawRing(ctx, b.cx, b.cy, b.r + 2, isCorrect ? '#16a34a' : '#dc2626', 2.6);
      }
    }
  }

  // Score Stamp Banner at top-left
  ctx.fillStyle = 'rgba(15, 118, 110, 0.92)';
  ctx.fillRect(96, 244, 415, 52);
  ctx.fillStyle = '#ffffff';
  ctx.font = 'bold 22px system-ui, sans-serif';
  ctx.fillText(
    `ĐIỂM: ${grade.totalScore} / ${grade.maxPossibleScore}   •   SBD: ${sbd || '---'}   •   MĐ: ${examCode || '---'}`,
    110,
    277
  );

  // Downscale slightly for compact local storage
  const out = document.createElement('canvas');
  out.width = 650;
  out.height = 919;
  const octx = out.getContext('2d')!;
  octx.drawImage(canvas, 0, 0, out.width, out.height);
  return out.toDataURL('image/jpeg', 0.8);
}

function drawRing(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  r: number,
  color: string,
  lineWidth: number,
  dashed = false
) {
  ctx.save();
  ctx.beginPath();
  if (dashed) ctx.setLineDash([4, 3]);
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.strokeStyle = color;
  ctx.lineWidth = lineWidth;
  ctx.stroke();
  ctx.restore();
}
