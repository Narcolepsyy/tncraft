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

export interface MinistryBgdConstellation {
  hTL: Point2D;
  hTM: Point2D;
  hTR: Point2D;
  mL: Point2D;
  mM: Point2D;
  mR: Point2D;
  bL: Point2D;
  bR: Point2D;
  outerQuad: CornerQuad;
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

interface FiducialBlob {
  cx: number;
  cy: number;
  area: number;
  w: number;
  h: number;
  fillRatio: number;
  contrast: number;
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
 * Returns binary mask (1 = dark ink, 0 = light paper), grayscale array, and local background mean.
 */
export function adaptiveThresholdImage(
  rgba: Uint8ClampedArray,
  width: number,
  height: number,
  sensitivity = 0.84,
  windowDivisor = 28
): { gray: Uint8Array; binary: Uint8Array; localMean: Uint8Array } {
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
  const localMean = new Uint8Array(width * height);
  const s2 = Math.max(8, Math.round(Math.min(width, height) / windowDivisor));

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

      const idx = y * width + x;
      localMean[idx] = Math.round(sum / count);
      binary[idx] = gray[idx] * count < sum * sensitivity ? 1 : 0;
    }
  }

  return { gray, binary, localMean };
}

/**
 * Extract solid dark square fiducial candidates that sit on bright paper background,
 * rejecting dark keyboard keys, monitor bezels, and hollow text/bubbles.
 */
function extractSquareFiducials(
  binary: Uint8Array,
  gray: Uint8Array | undefined,
  width: number,
  height: number
): FiducialBlob[] {
  const visited = new Uint8Array(width * height);
  const blobs: FiducialBlob[] = [];
  const minDim = Math.min(width, height);
  const minSide = Math.max(6, minDim * 0.012);
  const maxSide = minDim * 0.11;
  const qx = new Int32Array(width * height);

  for (let y = 2; y < height - 2; y += 2) {
    for (let x = 2; x < width - 2; x += 2) {
      const startIdx = y * width + x;
      if (!binary[startIdx] || visited[startIdx]) continue;
      if (gray && gray[startIdx] > 140) continue;

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

        if (px > 0 && binary[idx - 1] && !visited[idx - 1] && (!gray || gray[idx - 1] <= 145)) {
          visited[idx - 1] = 1;
          qx[tail++] = idx - 1;
        }
        if (
          px + 1 < width &&
          binary[idx + 1] &&
          !visited[idx + 1] &&
          (!gray || gray[idx + 1] <= 145)
        ) {
          visited[idx + 1] = 1;
          qx[tail++] = idx + 1;
        }
        if (
          py > 0 &&
          binary[idx - width] &&
          !visited[idx - width] &&
          (!gray || gray[idx - width] <= 145)
        ) {
          visited[idx - width] = 1;
          qx[tail++] = idx - width;
        }
        if (
          py + 1 < height &&
          binary[idx + width] &&
          !visited[idx + width] &&
          (!gray || gray[idx + width] <= 145)
        ) {
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
      if (fillRatio < 0.62) continue;

      let contrast = 100;
      if (gray) {
        const pad = Math.max(5, Math.round(Math.max(bw, bh) * 0.45));
        const sx1 = Math.max(0, minX - pad);
        const sx2 = Math.min(width - 1, maxX + pad);
        const sy1 = Math.max(0, minY - pad);
        const sy2 = Math.min(height - 1, maxY + pad);

        let inSum = 0;
        let inCnt = 0;
        let outSum = 0;
        let outCnt = 0;

        for (let py = sy1; py <= sy2; py += 2) {
          for (let px = sx1; px <= sx2; px += 2) {
            const g = gray[py * width + px];
            if (px >= minX && px <= maxX && py >= minY && py <= maxY) {
              inSum += g;
              inCnt++;
            } else {
              outSum += g;
              outCnt++;
            }
          }
        }
        const innerMean = inCnt > 0 ? inSum / inCnt : 0;
        const surroundMean = outCnt > 0 ? outSum / outCnt : 255;
        contrast = surroundMean - innerMean;
        // Reject dark keys on dark keyboards or low-contrast background shadows
        if (innerMean > 108 || contrast < 58) continue;
      }

      blobs.push({
        cx: sumX / area,
        cy: sumY / area,
        area,
        w: bw,
        h: bh,
        fillRatio,
        contrast,
      });
    }
  }

  return blobs;
}

/**
 * Recognize the Vietnamese Ministry BGD-2025 printed answer sheet's 6/7-fiducial constellation:
 * - Middle collinear horizontal triad (mL, mM at ~0.673, mR)
 * - Bottom pair (bL, bR) at ~1.05 * |mR - mL| below (mL, mR)
 * - Header SBD top-left fiducial hTM at ~0.45 * |mR - mL| above mM (plus optional hTL above mL)
 */
export function detectMinistryBgdConstellation(
  blobs: FiducialBlob[],
  width: number
): MinistryBgdConstellation | null {
  if (blobs.length < 6) return null;

  const sortedByArea = [...blobs].sort((a, b) => b.area - a.area);
  const refArea = sortedByArea[Math.min(5, sortedByArea.length - 1)].area;
  const major = blobs.filter((b) => b.area >= refArea * 0.45 && b.fillRatio >= 0.78);
  if (major.length < 6) return null;

  let best: { score: number; result: MinistryBgdConstellation } | null = null;

  for (let i = 0; i < major.length; i++) {
    const mL = major[i];
    for (let j = 0; j < major.length; j++) {
      if (i === j) continue;
      const mR = major[j];
      const dx = mR.cx - mL.cx;
      const dy = mR.cy - mL.cy;
      const span = Math.hypot(dx, dy);
      if (dx < width * 0.42 || Math.abs(dy) > dx * 0.35) continue;

      const ux = dx / span;
      const uy = dy / span;
      // Downward normal
      const vx = -uy;
      const vy = ux;

      // Find collinear middle-right SBD bottom anchor mM at t in [0.58, 0.76] (canonical 0.673)
      let mM: FiducialBlob | null = null;
      let bestMidErr = Infinity;
      for (const b of major) {
        if (b === mL || b === mR) continue;
        const rx = b.cx - mL.cx;
        const ry = b.cy - mL.cy;
        const t = (rx * ux + ry * uy) / span;
        const perp = Math.abs(rx * vx + ry * vy) / span;
        if (t >= 0.58 && t <= 0.76 && perp <= 0.03) {
          const err = Math.abs(t - 0.673) + perp * 2;
          if (err < bestMidErr) {
            bestMidErr = err;
            mM = b;
          }
        }
      }
      if (!mM) continue;

      const findNearNormal = (
        origin: FiducialBlob,
        minDistRatio: number,
        maxDistRatio: number,
        latTolRatio: number
      ): FiducialBlob | null => {
        let pick: FiducialBlob | null = null;
        let bestScore = -Infinity;
        for (const b of major) {
          if (b === mL || b === mR || b === mM) continue;
          const rx = b.cx - origin.cx;
          const ry = b.cy - origin.cy;
          const vProj = (rx * vx + ry * vy) / span;
          const uProj = Math.abs(rx * ux + ry * uy) / span;
          if (vProj >= minDistRatio && vProj <= maxDistRatio && uProj <= latTolRatio) {
            const sc = b.fillRatio * 50 + b.contrast - uProj * 200;
            if (sc > bestScore) {
              bestScore = sc;
              pick = b;
            }
          }
        }
        return pick;
      };

      const bL = findNearNormal(mL, 0.85, 1.30, 0.09);
      const bR = findNearNormal(mR, 0.85, 1.30, 0.09);
      const hTM = findNearNormal(mM, -0.58, -0.32, 0.08);
      if (!bL || !bR || !hTM) continue;

      const hTLBlob = findNearNormal(mL, -0.58, -0.32, 0.08);
      const upVecX = hTM.cx - mM.cx;
      const upVecY = hTM.cy - mM.cy;

      const hTL: Point2D = hTLBlob
        ? { x: hTLBlob.cx, y: hTLBlob.cy }
        : { x: mL.cx + upVecX, y: mL.cy + upVecY };
      const hTR: Point2D = { x: mR.cx + upVecX, y: mR.cy + upVecY };

      const score =
        span +
        (mL.contrast + mM.contrast + mR.contrast + bL.contrast + bR.contrast + hTM.contrast) * 0.5 -
        bestMidErr * 300;

      if (!best || score > best.score) {
        best = {
          score,
          result: {
            hTL,
            hTM: { x: hTM.cx, y: hTM.cy },
            hTR,
            mL: { x: mL.cx, y: mL.cy },
            mM: { x: mM.cx, y: mM.cy },
            mR: { x: mR.cx, y: mR.cy },
            bL: { x: bL.cx, y: bL.cy },
            bR: { x: bR.cx, y: bR.cy },
            outerQuad: {
              tl: hTL,
              tr: hTR,
              br: { x: bR.cx, y: bR.cy },
              bl: { x: bL.cx, y: bL.cy },
            },
          },
        };
      }
    }
  }

  return best ? best.result : null;
}

/**
 * Automatically locate sheet corners (supporting both Ministry BGD-2025 6/7-fiducial sheets
 * and TNCraft 4-corner fiducial sheets).
 */
export function detectFiducialCorners(
  binary: Uint8Array,
  width: number,
  height: number,
  gray?: Uint8Array
): CornerQuad | null {
  const blobs = extractSquareFiducials(binary, gray, width, height);
  if (blobs.length < 4) return null;

  const ministry = detectMinistryBgdConstellation(blobs, width);
  if (ministry) {
    return ministry.outerQuad;
  }

  const pickBestInQuadrant = (
    qxPred: (b: FiducialBlob) => boolean,
    targetX: number,
    targetY: number
  ): FiducialBlob | null => {
    const candidates = blobs.filter(qxPred);
    if (candidates.length === 0) return null;
    candidates.sort((a, b) => {
      const da = Math.hypot(a.cx - targetX, a.cy - targetY) - a.fillRatio * 24 - a.contrast * 0.25;
      const db = Math.hypot(b.cx - targetX, b.cy - targetY) - b.fillRatio * 24 - b.contrast * 0.25;
      return da - db;
    });
    return candidates[0];
  };

  const tl = pickBestInQuadrant((b) => b.cx < width * 0.45 && b.cy < height * 0.45, 0, 0);
  const tr = pickBestInQuadrant((b) => b.cx > width * 0.55 && b.cy < height * 0.45, width, 0);
  const br = pickBestInQuadrant((b) => b.cx > width * 0.55 && b.cy > height * 0.55, width, height);
  const bl = pickBestInQuadrant((b) => b.cx < width * 0.45 && b.cy > height * 0.55, 0, height);

  if (!tl || !tr || !br || !bl) return null;
  if (tr.cx - tl.cx < width * 0.32 || bl.cy - tl.cy < height * 0.32) return null;

  return {
    tl: { x: tl.cx, y: tl.cy },
    tr: { x: tr.cx, y: tr.cy },
    br: { x: br.cx, y: br.cy },
    bl: { x: bl.cx, y: bl.cy },
  };
}

function warpRgbaRegion(
  srcData: Uint8ClampedArray,
  srcW: number,
  srcH: number,
  dstW: number,
  dstH: number,
  dstPts: Point2D[],
  srcPts: Point2D[]
): Uint8ClampedArray {
  const H = computeHomography(dstPts, srcPts);
  const out = new Uint8ClampedArray(dstW * dstH * 4);
  for (let y = 0; y < dstH; y++) {
    for (let x = 0; x < dstW; x++) {
      const denom = H[6] * x + H[7] * y + H[8];
      const sx = Math.round((H[0] * x + H[1] * y + H[2]) / denom);
      const sy = Math.round((H[3] * x + H[4] * y + H[5]) / denom);
      const dstIdx = (y * dstW + x) * 4;
      if (sx >= 0 && sx < srcW && sy >= 0 && sy < srcH) {
        const srcIdx = (sy * srcW + sx) * 4;
        out[dstIdx] = srcData[srcIdx];
        out[dstIdx + 1] = srcData[srcIdx + 1];
        out[dstIdx + 2] = srcData[srcIdx + 2];
        out[dstIdx + 3] = 255;
      } else {
        out[dstIdx] = 255;
        out[dstIdx + 1] = 255;
        out[dstIdx + 2] = 255;
        out[dstIdx + 3] = 255;
      }
    }
  }
  return out;
}

function measureCircleFill(
  thresh: { gray: Uint8Array; binary: Uint8Array; localMean: Uint8Array },
  imgW: number,
  imgH: number,
  cx: number,
  cy: number,
  innerR: number
): number {
  const r2 = innerR * innerR;
  const minX = Math.max(0, Math.floor(cx - innerR));
  const maxX = Math.min(imgW - 1, Math.ceil(cx + innerR));
  const minY = Math.max(0, Math.floor(cy - innerR));
  const maxY = Math.min(imgH - 1, Math.ceil(cy + innerR));

  let darkPixels = 0;
  let totalPixels = 0;
  let graySum = 0;
  let localSum = 0;

  for (let py = minY; py <= maxY; py++) {
    for (let px = minX; px <= maxX; px++) {
      if ((px - cx) * (px - cx) + (py - cy) * (py - cy) <= r2) {
        totalPixels++;
        const idx = py * imgW + px;
        if (thresh.binary[idx]) darkPixels++;
        graySum += thresh.gray[idx];
        localSum += thresh.localMean[idx];
      }
    }
  }

  if (totalPixels === 0) return 0;
  const binRatio = darkPixels / totalPixels;
  const meanGray = graySum / totalPixels;
  const meanLocal = Math.max(60, localSum / totalPixels);
  const relDark = Math.max(0, Math.min(1, 1 - meanGray / meanLocal));
  return binRatio * 0.65 + Math.min(1, relDark * 1.8) * 0.35;
}

function pickMarkedChoice(
  items: Array<{ value: string; score: number }>,
  eraseMode: 'normal' | 'high',
  minMarkThreshold = 0.35
): { value: string; multi: boolean } {
  const scored = [...items].sort((a, b) => b.score - a.score);
  if (scored.length === 0) return { value: '', multi: false };
  const top = scored[0];
  const second = scored[1] || { value: '', score: 0 };

  if (top.score < minMarkThreshold) {
    return { value: '', multi: false };
  }

  if (second.score >= minMarkThreshold) {
    const dominanceRatio = eraseMode === 'high' ? 1.22 : 1.42;
    if (top.score >= second.score * dominanceRatio) {
      return { value: top.value, multi: false };
    }
    return { value: 'MULTI', multi: true };
  }

  return { value: top.value, multi: false };
}

/**
 * Dedicated sub-pixel dual-region scanner for real printed Vietnamese Ministry BGD-2025 sheets.
 */
function scanMinistryBgdSheet(
  data: Uint8ClampedArray,
  width: number,
  height: number,
  constellation: MinistryBgdConstellation,
  contest: Contest,
  keys: AnswerKey[],
  settings: Pick<AppSettings, 'eraseMode'>
): ScanResult {
  const ID_W = 400;
  const ID_H = 500;
  const BODY_W = 1000;
  const BODY_H = 1050;

  const idRgba = warpRgbaRegion(
    data,
    width,
    height,
    ID_W,
    ID_H,
    [
      { x: 0, y: 0 },
      { x: ID_W, y: 0 },
      { x: ID_W, y: ID_H },
      { x: 0, y: ID_H },
    ],
    [constellation.hTM, constellation.hTR, constellation.mR, constellation.mM]
  );

  const bodyRgba = warpRgbaRegion(
    data,
    width,
    height,
    BODY_W,
    BODY_H,
    [
      { x: 0, y: 0 },
      { x: BODY_W, y: 0 },
      { x: BODY_W, y: BODY_H },
      { x: 0, y: BODY_H },
    ],
    [constellation.mL, constellation.mR, constellation.bR, constellation.bL]
  );

  const idThresh = adaptiveThresholdImage(idRgba, ID_W, ID_H, 0.84, 24);
  const bodyThresh = adaptiveThresholdImage(bodyRgba, BODY_W, BODY_H, 0.84, 24);

  const overlayBubbles: BubbleCoord[] = [];
  // Composite layout: top header 1000x364 + bottom body 1000x1050 = 1000x1414
  const HEADER_H = 364;
  // ID box sits inside header from x=673..1000, y=0..364
  const mapIdToComposite = (ix: number, iy: number): { cx: number; cy: number } => ({
    cx: 673 + (ix / ID_W) * (1000 - 673),
    cy: (iy / ID_H) * HEADER_H,
  });

  // 1. Decode 8-column SBD box (gracefully handles both 6-digit and 8-digit SBD)
  const sbdCols: string[] = [];
  for (let c = 0; c < 8; c++) {
    const cx = 31.5 + c * 27.1;
    const group: Array<{ value: string; score: number }> = [];
    for (let d = 0; d <= 9; d++) {
      const cy = 130.0 + d * 35.6;
      const sc = measureCircleFill(idThresh, ID_W, ID_H, cx, cy, 7.2);
      group.push({ value: String(d), score: sc });
      const comp = mapIdToComposite(cx, cy);
      overlayBubbles.push({
        id: `m_sbd_${c}_${d}`,
        section: 'sbd',
        index: c,
        value: String(d),
        cx: comp.cx,
        cy: comp.cy,
        r: 7.5,
      });
    }
    const res = pickMarkedChoice(group, settings.eraseMode);
    sbdCols.push(res.multi ? '?' : res.value);
  }
  const sbd = sbdCols.join('');

  // 2. Decode 4-column Exam Code box (gracefully handles 3-digit or 4-digit codes)
  const codeCols: string[] = [];
  for (let c = 0; c < 4; c++) {
    const cx = 287.5 + c * 26.5;
    const group: Array<{ value: string; score: number }> = [];
    for (let d = 0; d <= 9; d++) {
      const cy = 130.0 + d * 35.6;
      const sc = measureCircleFill(idThresh, ID_W, ID_H, cx, cy, 7.2);
      group.push({ value: String(d), score: sc });
      const comp = mapIdToComposite(cx, cy);
      overlayBubbles.push({
        id: `m_code_${c}_${d}`,
        section: 'examCode',
        index: c,
        value: String(d),
        cx: comp.cx,
        cy: comp.cy,
        r: 7.5,
      });
    }
    const res = pickMarkedChoice(group, settings.eraseMode);
    codeCols.push(res.multi ? '?' : res.value);
  }
  const examCode = codeCols.join('');

  // 3. Decode Part I (MCQ up to 40)
  const p1Starts = [92.5, 327.5, 559.5, 793.5];
  const choices: MCQChoice[] = ['A', 'B', 'C', 'D'];
  const p1Count = contest.enablePart1 ? Math.min(40, contest.part1Questions) : 0;
  const mcqAnswers: MCQChoice[] = [];

  for (let q = 0; q < p1Count; q++) {
    const block = Math.floor(q / 10);
    const row = q % 10;
    const cy = 113.2 + row * 24.0;
    const group: Array<{ value: string; score: number }> = [];

    for (let oi = 0; oi < 4; oi++) {
      const cx = p1Starts[block] + oi * 47.0;
      const sc = measureCircleFill(bodyThresh, BODY_W, BODY_H, cx, cy, 6.5);
      group.push({ value: choices[oi], score: sc });
      overlayBubbles.push({
        id: `m_mcq_${q}_${choices[oi]}`,
        section: 'mcq',
        index: q,
        value: choices[oi],
        cx,
        cy: HEADER_H + cy,
        r: 8.5,
      });
    }
    const res = pickMarkedChoice(group, settings.eraseMode);
    mcqAnswers.push((res.value as MCQChoice) || '');
  }

  // 4. Decode Part II (True/False up to 8)
  const tfAnswers: TFQuestionAnswer[] = [];
  if (contest.enablePart2) {
    const subKeys: Array<keyof TFQuestionAnswer> = ['a', 'b', 'c', 'd'];
    const p2Count = Math.min(8, contest.part2Questions);
    for (let q = 0; q < p2Count; q++) {
      const block = Math.floor(q / 2);
      const sub = q % 2;
      const tx = p1Starts[block] + sub * 2 * 47.0;
      const fx = tx + 47.0;
      const item: TFQuestionAnswer = { a: '', b: '', c: '', d: '' };

      for (let sIdx = 0; sIdx < 4; sIdx++) {
        const cy = 461.0 + sIdx * 24.2;
        const st = measureCircleFill(bodyThresh, BODY_W, BODY_H, tx, cy, 6.5);
        const sf = measureCircleFill(bodyThresh, BODY_W, BODY_H, fx, cy, 6.5);
        const res = pickMarkedChoice(
          [
            { value: 'T', score: st },
            { value: 'F', score: sf },
          ],
          settings.eraseMode
        );
        item[subKeys[sIdx]] = (res.value as TFChoice) || '';

        overlayBubbles.push(
          {
            id: `m_tf_${q}_${sIdx}_T`,
            section: 'tf',
            index: q,
            subIndex: sIdx,
            value: 'T',
            cx: tx,
            cy: HEADER_H + cy,
            r: 8.5,
          },
          {
            id: `m_tf_${q}_${sIdx}_F`,
            section: 'tf',
            index: q,
            subIndex: sIdx,
            value: 'F',
            cx: fx,
            cy: HEADER_H + cy,
            r: 8.5,
          }
        );
      }
      tfAnswers.push(item);
    }
  }

  // 5. Decode Part III (Short Numeric up to 6)
  const shortAnswers: string[] = [];
  if (contest.enablePart3) {
    const p3Count = Math.min(6, contest.part3Questions);
    for (let q = 0; q < p3Count; q++) {
      const qx = 79.0 + q * 150.8;
      let str = '';
      for (let col = 0; col < 4; col++) {
        const cx = qx + col * 32.6;
        const group: Array<{ value: string; score: number }> = [];

        if (col === 0) {
          const cyMinus = 679.5;
          group.push({
            value: '-',
            score: measureCircleFill(bodyThresh, BODY_W, BODY_H, cx, cyMinus, 6.2),
          });
          overlayBubbles.push({
            id: `m_short_${q}_0_-`,
            section: 'short',
            index: q,
            subIndex: col,
            value: '-',
            cx,
            cy: HEADER_H + cyMinus,
            r: 8.0,
          });
        }

        if (col === 1 || col === 2) {
          const cyComma = 704.5;
          group.push({
            value: ',',
            score: measureCircleFill(bodyThresh, BODY_W, BODY_H, cx, cyComma, 6.2),
          });
          overlayBubbles.push({
            id: `m_short_${q}_${col}_,`,
            section: 'short',
            index: q,
            subIndex: col,
            value: ',',
            cx,
            cy: HEADER_H + cyComma,
            r: 8.0,
          });
        }

        for (let d = 0; d <= 9; d++) {
          const cyDigit = 730.0 + d * 25.4;
          group.push({
            value: String(d),
            score: measureCircleFill(bodyThresh, BODY_W, BODY_H, cx, cyDigit, 6.2),
          });
          overlayBubbles.push({
            id: `m_short_${q}_${col}_${d}`,
            section: 'short',
            index: q,
            subIndex: col,
            value: String(d),
            cx,
            cy: HEADER_H + cyDigit,
            r: 8.0,
          });
        }

        const res = pickMarkedChoice(group, settings.eraseMode);
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

  // Build composite 1000x1414 RGBA:
  // - Top-left (673x364): Student metadata box [hTL, hTM, mM, mL]
  // - Top-right (327x364): Exact ID box [hTM, hTR, mR, mM] so SBD/Code rings align 1:1
  // - Bottom (1000x1050): Body [mL, mR, bR, bL]
  const compositeRgba = new Uint8ClampedArray(CANONICAL_W * CANONICAL_H * 4);
  const LEFT_W = 673;
  const RIGHT_W = CANONICAL_W - LEFT_W;

  const headerLeftRgba = warpRgbaRegion(
    data,
    width,
    height,
    LEFT_W,
    HEADER_H,
    [
      { x: 0, y: 0 },
      { x: LEFT_W, y: 0 },
      { x: LEFT_W, y: HEADER_H },
      { x: 0, y: HEADER_H },
    ],
    [constellation.hTL, constellation.hTM, constellation.mM, constellation.mL]
  );

  const headerRightRgba = warpRgbaRegion(
    data,
    width,
    height,
    RIGHT_W,
    HEADER_H,
    [
      { x: 0, y: 0 },
      { x: RIGHT_W, y: 0 },
      { x: RIGHT_W, y: HEADER_H },
      { x: 0, y: HEADER_H },
    ],
    [constellation.hTM, constellation.hTR, constellation.mR, constellation.mM]
  );

  for (let y = 0; y < HEADER_H; y++) {
    const rowDst = y * CANONICAL_W * 4;
    compositeRgba.set(
      headerLeftRgba.subarray(y * LEFT_W * 4, (y + 1) * LEFT_W * 4),
      rowDst
    );
    compositeRgba.set(
      headerRightRgba.subarray(y * RIGHT_W * 4, (y + 1) * RIGHT_W * 4),
      rowDst + LEFT_W * 4
    );
  }
  compositeRgba.set(bodyRgba, CANONICAL_W * HEADER_H * 4);

  const annotatedDataUrl = renderAnnotatedOverlay(
    compositeRgba,
    overlayBubbles,
    keys,
    sbd,
    examCode,
    mcqAnswers,
    tfAnswers,
    shortAnswers,
    grade
  );

  return {
    cornersDetected: true,
    corners: constellation.outerQuad,
    sbd,
    examCode,
    mcqAnswers,
    tfAnswers,
    shortAnswers,
    grade,
    annotatedDataUrl,
  };
}

/**
 * Warp source image into canonical sheet space, read every bubble density,
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
  const { binary, gray } = adaptiveThresholdImage(data, width, height, 0.80, 32);

  if (!overrideCorners && contest.formId === 'bgd_2025') {
    const blobs = extractSquareFiducials(binary, gray, width, height);
    const ministry = detectMinistryBgdConstellation(blobs, width);
    if (ministry) {
      return scanMinistryBgdSheet(data, width, height, ministry, contest, keys, settings);
    }
  }

  const detected = overrideCorners || detectFiducialCorners(binary, width, height, gray);
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
  const warpedData = warpRgbaRegion(
    data,
    width,
    height,
    CANONICAL_W,
    CANONICAL_H,
    dstPts,
    srcPts
  );

  const warpedThresh = adaptiveThresholdImage(warpedData, CANONICAL_W, CANONICAL_H, 0.83, 28);
  const geom = buildSheetGeometry(contest);

  const fillScores = new Map<string, number>();
  for (const b of geom.bubbles) {
    fillScores.set(
      b.id,
      measureCircleFill(warpedThresh, CANONICAL_W, CANONICAL_H, b.cx, b.cy, b.r * 0.76)
    );
  }

  const pickFromGroup = (group: BubbleCoord[]) =>
    pickMarkedChoice(
      group.map((b) => ({ value: b.value, score: fillScores.get(b.id) || 0 })),
      settings.eraseMode
    );

  let sbd = '';
  for (let c = 0; c < contest.sbdDigits; c++) {
    const group = geom.bubbles.filter((b) => b.section === 'sbd' && b.index === c);
    const res = pickFromGroup(group);
    sbd += res.multi ? '?' : res.value || '';
  }

  let examCode = '';
  for (let c = 0; c < contest.examCodeDigits; c++) {
    const group = geom.bubbles.filter((b) => b.section === 'examCode' && b.index === c);
    const res = pickFromGroup(group);
    examCode += res.multi ? '?' : res.value || '';
  }

  const mcqCount = contest.formId === 'bgd_2025' ? contest.part1Questions : contest.totalQuestions;
  const mcqAnswers: MCQChoice[] = [];
  for (let q = 0; q < mcqCount; q++) {
    const group = geom.bubbles.filter((b) => b.section === 'mcq' && b.index === q);
    const res = pickFromGroup(group);
    mcqAnswers.push((res.value as MCQChoice) || '');
  }

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

  ctx.fillStyle = 'rgba(15, 118, 110, 0.92)';
  ctx.fillRect(60, 304, 480, 50);
  ctx.fillStyle = '#ffffff';
  ctx.font = 'bold 21px system-ui, sans-serif';
  ctx.fillText(
    `ĐIỂM: ${grade.totalScore} / ${grade.maxPossibleScore}   •   SBD: ${sbd || '---'}   •   MĐ: ${examCode || '---'}`,
    76,
    336
  );

  const out = document.createElement('canvas');
  out.width = 650;
  out.height = 919;
  const octx = out.getContext('2d')!;
  octx.drawImage(canvas, 0, 0, out.width, out.height);
  return out.toDataURL('image/jpeg', 0.82);
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
