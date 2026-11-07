import {
  AnswerKey,
  Contest,
  MCQChoice,
  PaperWarning,
  Student,
  StudentPaper,
  TFChoice,
  TFQuestionAnswer,
} from '../types';

export function normalizeNumericAnswer(raw: string): string {
  const cleaned = raw.trim().replace(/\s+/g, '').replace(/\./g, ',');
  if (!cleaned) return '';
  // Allow leading minus and digits/comma
  const dotForm = cleaned.replace(',', '.');
  const num = Number(dotForm);
  if (!Number.isNaN(num) && /^[-]?[0-9]+([.,][0-9]+)?$/.test(cleaned)) {
    // Normalize mathematical equivalence: "-1,50" -> "-1.5", "05" -> "5"
    return String(num);
  }
  return cleaned;
}

export function matchAnswerKey(
  keys: AnswerKey[],
  examCode: string
): { matchedKey?: AnswerKey; exact: boolean } {
  const code = (examCode || '').trim();
  if (code) {
    const exactHit = keys.find((k) => k.examCode.trim() === code);
    if (exactHit) return { matchedKey: exactHit, exact: true };

    const stripped = code.replace(/^0+/, '');
    if (stripped) {
      const numericHits = keys.filter((k) => k.examCode.trim().replace(/^0+/, '') === stripped);
      if (numericHits.length === 1) {
        return { matchedKey: numericHits[0], exact: true };
      }
    }
  }

  // Only fall back to single key when the contest genuinely has just 1 Mã đề
  if (keys.length === 1) {
    return { matchedKey: keys[0], exact: false };
  }

  return { matchedKey: undefined, exact: false };
}

export interface GradeComputation {
  scorePart1: number;
  scorePart2: number;
  scorePart3: number;
  totalScore: number;
  maxPossibleScore: number;
  correctCount: number;
  blankCount: number;
  wrongCount: number;
  multiCount: number;
  warnings: PaperWarning[];
}

export function computePaperGrade(
  contest: Contest,
  keys: AnswerKey[],
  sbd: string,
  examCode: string,
  mcqAnswers: MCQChoice[],
  tfAnswers: TFQuestionAnswer[],
  shortAnswers: string[],
  part4EssayScore = 0,
  existingPapers: StudentPaper[] = [],
  currentPaperId?: string
): GradeComputation {
  const warnings: PaperWarning[] = [];

  if (!sbd || sbd.includes('?')) {
    warnings.push({
      kind: 'incomplete_id',
      message: `Student ID (${sbd || 'blank'}) has missing or double-marked digits`,
    });
  }

  if (
    sbd &&
    existingPapers.some((p) => p.sbd === sbd && p.id !== currentPaperId)
  ) {
    warnings.push({
      kind: 'duplicate_sbd',
      message: `Duplicate Student ID ${sbd}`,
    });
  }

  const { matchedKey, exact } = matchAnswerKey(keys, examCode);

  if (!exact) {
    warnings.push({
      kind: 'unmatched_key',
      message: matchedKey
        ? `Exam code "${examCode || 'blank'}" not matched — using single key "${matchedKey.examCode}"`
        : keys.length === 0
          ? 'No Answer Keys added to this contest yet'
          : `Exam code "${examCode || 'blank'}" not found among ${keys.length} Answer Keys (${keys
              .slice(0, 5)
              .map((k) => k.examCode)
              .join(', ')}${keys.length > 5 ? ', …' : ''})`,
    });
  }

  let scorePart1 = 0;
  let scorePart2 = 0;
  let scorePart3 = 0;
  let correctCount = 0;
  let blankCount = 0;
  let wrongCount = 0;
  let multiCount = 0;

  if (contest.formId !== 'bgd_2025') {
    const qCount = contest.totalQuestions;
    const hasSplits =
      contest.subjectSplits &&
      contest.subjectSplits.length > 0 &&
      contest.subjectSplits.reduce((acc, s) => acc + s.questionCount, 0) === qCount;

    let qCursor = 0;
    const perQuestionWeights: number[] = [];
    if (hasSplits) {
      for (const split of contest.subjectSplits) {
        const w = split.questionCount > 0 ? split.maxScore / split.questionCount : 0;
        for (let i = 0; i < split.questionCount; i++) perQuestionWeights.push(w);
      }
    } else {
      const w = qCount > 0 ? contest.maxScore / qCount : 0;
      for (let i = 0; i < qCount; i++) perQuestionWeights.push(w);
    }

    for (qCursor = 0; qCursor < qCount; qCursor++) {
      const studentAns = mcqAnswers[qCursor] || '';
      const keyAns = matchedKey?.mcqAnswers[qCursor] || '';
      if (studentAns === '') {
        blankCount++;
      } else if (studentAns === 'MULTI') {
        multiCount++;
        wrongCount++;
      } else if (matchedKey && keyAns && studentAns === keyAns) {
        correctCount++;
        scorePart1 += perQuestionWeights[qCursor];
      } else if (matchedKey && keyAns) {
        wrongCount++;
      }
    }

    const maxPossibleScore = hasSplits
      ? contest.subjectSplits.reduce((a, s) => a + s.maxScore, 0)
      : contest.maxScore;

    if (blankCount > 0) {
      warnings.push({
        kind: 'blank_answers',
        message: `${blankCount} blank answer(s)`,
      });
    }
    if (multiCount > 0) {
      warnings.push({
        kind: 'multi_marks',
        message: `${multiCount} double-marked question(s)`,
      });
    }

    return {
      scorePart1: roundScore(scorePart1),
      scorePart2: 0,
      scorePart3: 0,
      totalScore: roundScore(scorePart1),
      maxPossibleScore: roundScore(maxPossibleScore),
      correctCount,
      blankCount,
      wrongCount,
      multiCount,
      warnings,
    };
  }

  // BGD-2025 3-Part + Optional Part IV Essay Scoring
  let maxPossible = 0;

  if (contest.enablePart1 && contest.part1Questions > 0) {
    maxPossible += contest.part1TotalScore;
    const weight1 = contest.part1TotalScore / contest.part1Questions;
    for (let i = 0; i < contest.part1Questions; i++) {
      const sAns = mcqAnswers[i] || '';
      const kAns = matchedKey?.mcqAnswers[i] || '';
      if (sAns === '') blankCount++;
      else if (sAns === 'MULTI') {
        multiCount++;
        wrongCount++;
      } else if (matchedKey && kAns && sAns === kAns) {
        correctCount++;
        scorePart1 += weight1;
      } else if (matchedKey && kAns) {
        wrongCount++;
      }
    }
  }

  if (contest.enablePart2 && contest.part2Questions > 0) {
    maxPossible += contest.part2Questions * contest.part2Score4;
    const subKeys: Array<keyof TFQuestionAnswer> = ['a', 'b', 'c', 'd'];
    for (let i = 0; i < contest.part2Questions; i++) {
      const sTf = tfAnswers[i] || { a: '', b: '', c: '', d: '' };
      const kTf = matchedKey?.tfAnswers[i] || { a: 'T', b: 'F', c: 'T', d: 'F' };
      let subMatched = 0;
      for (const sk of subKeys) {
        const sv: TFChoice = sTf[sk] || '';
        const kv: TFChoice = kTf[sk] || '';
        if (sv === '') blankCount++;
        else if (sv === 'MULTI') {
          multiCount++;
          wrongCount++;
        } else if (matchedKey && kv && sv === kv) {
          subMatched++;
          correctCount++;
        } else if (matchedKey && kv) {
          wrongCount++;
        }
      }
      if (matchedKey) {
        if (subMatched === 1) scorePart2 += contest.part2Score1;
        else if (subMatched === 2) scorePart2 += contest.part2Score2;
        else if (subMatched === 3) scorePart2 += contest.part2Score3;
        else if (subMatched === 4) scorePart2 += contest.part2Score4;
      }
    }
  }

  if (contest.enablePart3 && contest.part3Questions > 0) {
    maxPossible += contest.part3TotalScore;
    const weight3 = contest.part3TotalScore / contest.part3Questions;
    for (let i = 0; i < contest.part3Questions; i++) {
      const sRaw = shortAnswers[i] || '';
      const kRaw = matchedKey?.shortAnswers[i] || '';
      if (!sRaw.trim()) {
        blankCount++;
      } else if (sRaw.includes('?')) {
        multiCount++;
        wrongCount++;
      } else if (
        matchedKey &&
        kRaw.trim() &&
        normalizeNumericAnswer(sRaw) === normalizeNumericAnswer(kRaw)
      ) {
        correctCount++;
        scorePart3 += weight3;
      } else if (matchedKey && kRaw.trim()) {
        wrongCount++;
      }
    }
  }

  const essay = contest.enablePart4Essay ? Math.max(0, Math.min(contest.part4MaxScore, part4EssayScore || 0)) : 0;
  if (contest.enablePart4Essay) {
    maxPossible += contest.part4MaxScore;
  }

  if (blankCount > 0) {
    warnings.push({
      kind: 'blank_answers',
      message: `${blankCount} blank bubble/field(s)`,
    });
  }
  if (multiCount > 0) {
    warnings.push({
      kind: 'multi_marks',
      message: `${multiCount} double-marked field(s)`,
    });
  }

  const totalScore = scorePart1 + scorePart2 + scorePart3 + essay;

  return {
    scorePart1: roundScore(scorePart1),
    scorePart2: roundScore(scorePart2),
    scorePart3: roundScore(scorePart3),
    totalScore: roundScore(totalScore),
    maxPossibleScore: roundScore(maxPossible),
    correctCount,
    blankCount,
    wrongCount,
    multiCount,
    warnings,
  };
}

export function roundScore(val: number): number {
  return Math.round((val + Number.EPSILON) * 100) / 100;
}

export function syncContestMaxScore(contest: Contest): Contest {
  if (contest.formId !== 'bgd_2025') return contest;
  const computed =
    (contest.enablePart1 && contest.part1Questions > 0 ? contest.part1TotalScore : 0) +
    (contest.enablePart2 && contest.part2Questions > 0
      ? contest.part2Questions * contest.part2Score4
      : 0) +
    (contest.enablePart3 && contest.part3Questions > 0 ? contest.part3TotalScore : 0) +
    (contest.enablePart4Essay ? contest.part4MaxScore : 0);
  return {
    ...contest,
    maxScore: roundScore(computed),
  };
}

export function resolveStudentFromRoster(
  sbd: string,
  students: Student[],
  classId: string | null
): { studentId: string | null; studentName: string; roomName: string } {
  if (!sbd) return { studentId: null, studentName: '', roomName: '' };
  const normalized = sbd.trim();
  const pool = classId ? students.filter((s) => s.classId === classId) : students;
  const exact =
    pool.find((s) => s.sbd.trim() === normalized) ||
    pool.find((s) => s.sbd.replace(/^0+/, '') === normalized.replace(/^0+/, '') && normalized.replace(/^0+/, '') !== '');
  if (!exact) return { studentId: null, studentName: '', roomName: '' };
  return {
    studentId: exact.id,
    studentName: exact.name,
    roomName: exact.roomName,
  };
}

export interface QuestionStatItem {
  label: string;
  part: 'I' | 'II' | 'III';
  correctKey: string;
  totalGraded: number;
  correctPct: number;
  counts: Record<string, number>;
}

export function computeItemAnalysis(
  contest: Contest,
  keys: AnswerKey[],
  papers: StudentPaper[],
  filterExamCode = 'ALL'
): QuestionStatItem[] {
  const filteredPapers =
    filterExamCode === 'ALL'
      ? papers
      : papers.filter((p) => matchAnswerKey([ { id: '', contestId: '', examCode: filterExamCode, createdAt: '', mcqAnswers: [], tfAnswers: [], shortAnswers: [] } ], p.examCode).exact);

  const items: QuestionStatItem[] = [];
  const findKey = (code: string) => matchAnswerKey(keys, code).matchedKey;
  const resolveDisplayKey = (getter: (k: AnswerKey) => string): string => {
    if (filterExamCode !== 'ALL') {
      const k = findKey(filterExamCode);
      return (k ? getter(k) : '') || '-';
    }
    if (keys.length === 0) return '-';
    const vals = keys.map((k) => getter(k)).filter(Boolean);
    if (vals.length === 0) return '-';
    const unique = new Set(vals);
    return unique.size === 1 ? vals[0] : 'Đa mã';
  };

  if (contest.formId !== 'bgd_2025') {
    const opts = contest.choiceCount === 5 ? ['A', 'B', 'C', 'D', 'E'] : ['A', 'B', 'C', 'D'];
    for (let i = 0; i < contest.totalQuestions; i++) {
      const counts: Record<string, number> = {};
      for (const o of opts) counts[o] = 0;
      counts.BLANK = 0;
      let correct = 0;
      for (const p of filteredPapers) {
        const ans = p.mcqAnswers[i] || '';
        const k = findKey(p.examCode);
        if (!ans || ans === 'MULTI') counts.BLANK++;
        else counts[ans] = (counts[ans] || 0) + 1;
        if (k && k.mcqAnswers[i] && ans === k.mcqAnswers[i]) correct++;
      }
      const singleKey = resolveDisplayKey((k) => k.mcqAnswers[i] || '');
      items.push({
        label: `Q${i + 1}`,
        part: 'I',
        correctKey: singleKey,
        totalGraded: filteredPapers.length,
        correctPct: filteredPapers.length ? Math.round((correct / filteredPapers.length) * 100) : 0,
        counts,
      });
    }
    return items;
  }

  // BGD-2025 Item Analysis
  if (contest.enablePart1) {
    for (let i = 0; i < contest.part1Questions; i++) {
      const counts: Record<string, number> = { A: 0, B: 0, C: 0, D: 0, BLANK: 0 };
      let correct = 0;
      for (const p of filteredPapers) {
        const ans = p.mcqAnswers[i] || '';
        const k = findKey(p.examCode);
        if (!ans || ans === 'MULTI') counts.BLANK++;
        else counts[ans] = (counts[ans] || 0) + 1;
        if (k && k.mcqAnswers[i] && ans === k.mcqAnswers[i]) correct++;
      }
      const singleKey = resolveDisplayKey((k) => k.mcqAnswers[i] || '');
      items.push({
        label: `I.${i + 1}`,
        part: 'I',
        correctKey: singleKey,
        totalGraded: filteredPapers.length,
        correctPct: filteredPapers.length ? Math.round((correct / filteredPapers.length) * 100) : 0,
        counts,
      });
    }
  }

  if (contest.enablePart2) {
    const subs: Array<keyof TFQuestionAnswer> = ['a', 'b', 'c', 'd'];
    for (let i = 0; i < contest.part2Questions; i++) {
      for (const sub of subs) {
        const counts: Record<string, number> = { T: 0, F: 0, BLANK: 0 };
        let correct = 0;
        for (const p of filteredPapers) {
          const ans = p.tfAnswers[i]?.[sub] || '';
          const k = findKey(p.examCode);
          if (!ans || ans === 'MULTI') counts.BLANK++;
          else counts[ans] = (counts[ans] || 0) + 1;
          if (k && k.tfAnswers[i]?.[sub] && ans === k.tfAnswers[i][sub]) correct++;
        }
        const rawKv = resolveDisplayKey((k) => {
          const v = k.tfAnswers[i]?.[sub] || '';
          return v === 'T' ? 'Đ' : v === 'F' ? 'S' : '';
        });
        items.push({
          label: `II.${i + 1}${sub}`,
          part: 'II',
          correctKey: rawKv,
          totalGraded: filteredPapers.length,
          correctPct: filteredPapers.length ? Math.round((correct / filteredPapers.length) * 100) : 0,
          counts,
        });
      }
    }
  }

  if (contest.enablePart3) {
    for (let i = 0; i < contest.part3Questions; i++) {
      const counts: Record<string, number> = { MATCH: 0, WRONG: 0, BLANK: 0 };
      let correct = 0;
      for (const p of filteredPapers) {
        const ans = p.shortAnswers[i] || '';
        const k = findKey(p.examCode);
        if (!ans.trim()) counts.BLANK++;
        else if (
          k &&
          k.shortAnswers[i] &&
          normalizeNumericAnswer(ans) === normalizeNumericAnswer(k.shortAnswers[i])
        ) {
          counts.MATCH++;
          correct++;
        } else {
          counts.WRONG++;
        }
      }
      const kv = resolveDisplayKey((k) => k.shortAnswers[i] || '');
      items.push({
        label: `III.${i + 1}`,
        part: 'III',
        correctKey: kv,
        totalGraded: filteredPapers.length,
        correctPct: filteredPapers.length ? Math.round((correct / filteredPapers.length) * 100) : 0,
        counts,
      });
    }
  }

  return items;
}
