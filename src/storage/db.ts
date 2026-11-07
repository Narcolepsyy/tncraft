import {
  AnswerKey,
  AppSettings,
  Classroom,
  Contest,
  Student,
  StudentPaper,
} from '../types';
import { computePaperGrade } from '../omr/grading';

const STORAGE_KEY = 'tncraft_state_v1';
const IDB_NAME = 'tncraft_images_db';
const IDB_STORE = 'paper_images';

export interface AppDatabaseState {
  contests: Contest[];
  keys: AnswerKey[];
  papers: StudentPaper[];
  classes: Classroom[];
  students: Student[];
  settings: AppSettings;
}

export const DEFAULT_SETTINGS: AppSettings = {
  language: 'vi',
  eraseMode: 'normal',
  autoCaptureDelayMs: 1000,
  vibrateOnScan: true,
  overrideDuplicateSbd: false,
  warnUnmatchedKey: true,
  warnBlankOrMulti: true,
  defaultFormId: 'bgd_2025',
  defaultMaxScore: 10,
  defaultQuestions: 40,
};

function createSeedState(): AppDatabaseState {
  const classId = 'cls_12a1';
  const classes: Classroom[] = [
    {
      id: classId,
      name: 'Lớp 12A1 - THPT Chuyên',
      createdAt: '2026-11-01',
    },
  ];

  const students: Student[] = [
    { id: 'stu_1', classId, sbd: '010001', name: 'Nguyễn Minh Anh', roomName: 'P.101' },
    { id: 'stu_2', classId, sbd: '010002', name: 'Trần Hoàng Bảo', roomName: 'P.101' },
    { id: 'stu_3', classId, sbd: '010003', name: 'Lê Ngọc Châu', roomName: 'P.101' },
    { id: 'stu_4', classId, sbd: '010004', name: 'Phạm Quốc Đạt', roomName: 'P.102' },
    { id: 'stu_5', classId, sbd: '010005', name: 'Võ Thảo Vy', roomName: 'P.102' },
  ];

  const bgdContest: Contest = {
    id: 'cnt_bgd_demo',
    name: 'Thi Thử Tốt Nghiệp THPT 2025 - Toán',
    createdAt: '2026-11-07',
    classId,
    formId: 'bgd_2025',
    choiceCount: 4,
    sbdDigits: 6,
    examCodeDigits: 4,
    totalQuestions: 12,
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

  const stdContest: Contest = {
    id: 'cnt_std_40',
    name: 'Kiểm Tra Giữa Kỳ Tiếng Anh (40 câu)',
    createdAt: '2026-11-07',
    classId,
    formId: 'standard_40',
    choiceCount: 4,
    sbdDigits: 6,
    examCodeDigits: 3,
    totalQuestions: 40,
    maxScore: 10,
    subjectSplits: [],
    enablePart1: true,
    part1Questions: 40,
    part1TotalScore: 10,
    enablePart2: false,
    part2Questions: 0,
    part2Score1: 0.1,
    part2Score2: 0.25,
    part2Score3: 0.5,
    part2Score4: 1.0,
    enablePart3: false,
    part3Questions: 0,
    part3TotalScore: 0,
    enablePart4Essay: false,
    part4MaxScore: 0,
  };

  const bgdKey101: AnswerKey = {
    id: 'key_bgd_0101',
    contestId: bgdContest.id,
    examCode: '0101',
    createdAt: '2026-11-07',
    mcqAnswers: ['A', 'C', 'B', 'D', 'A', 'B', 'C', 'D', 'B', 'A', 'D', 'C'],
    tfAnswers: [
      { a: 'T', b: 'F', c: 'T', d: 'T' },
      { a: 'F', b: 'T', c: 'T', d: 'F' },
      { a: 'T', b: 'T', c: 'F', d: 'T' },
      { a: 'F', b: 'F', c: 'T', d: 'T' },
    ],
    shortAnswers: ['12,5', '-4', '2025', '0,75', '42', '-1,5'],
  };

  const stdKey: AnswerKey = {
    id: 'key_std_101',
    contestId: stdContest.id,
    examCode: '101',
    createdAt: '2026-11-07',
    mcqAnswers: Array.from({ length: 40 }, (_, i) => (['A', 'B', 'C', 'D'] as const)[i % 4]),
    tfAnswers: [],
    shortAnswers: [],
  };

  const keys = [bgdKey101, stdKey];

  // Seed 3 realistic graded student papers for instant analytics inspection
  const sampleRaw = [
    {
      id: 'pap_1',
      sbd: '010001',
      name: 'Nguyễn Minh Anh',
      room: 'P.101',
      mcq: ['A', 'C', 'B', 'D', 'A', 'B', 'C', 'D', 'B', 'A', 'D', 'C'] as AnswerKey['mcqAnswers'],
      tf: [
        { a: 'T', b: 'F', c: 'T', d: 'T' },
        { a: 'F', b: 'T', c: 'T', d: 'F' },
        { a: 'T', b: 'T', c: 'F', d: 'F' }, // 3/4 -> 0.5
        { a: 'F', b: 'F', c: 'T', d: 'T' },
      ] as AnswerKey['tfAnswers'],
      short: ['12,5', '-4', '2025', '0,75', '42', '-1,5'],
    },
    {
      id: 'pap_2',
      sbd: '010002',
      name: 'Trần Hoàng Bảo',
      room: 'P.101',
      mcq: ['A', 'C', 'A', 'D', 'A', 'B', 'D', 'D', 'B', 'A', 'D', 'C'] as AnswerKey['mcqAnswers'],
      tf: [
        { a: 'T', b: 'F', c: 'T', d: 'F' }, // 3/4 -> 0.5
        { a: 'F', b: 'T', c: 'F', d: 'F' }, // 3/4 -> 0.5
        { a: 'T', b: 'F', c: 'F', d: 'T' }, // 3/4 -> 0.5
        { a: 'F', b: 'T', c: 'T', d: 'F' }, // 2/4 -> 0.25
      ] as AnswerKey['tfAnswers'],
      short: ['12,5', '-4', '2024', '0,75', '42', '1,5'],
    },
    {
      id: 'pap_3',
      sbd: '010003',
      name: 'Lê Ngọc Châu',
      room: 'P.101',
      mcq: ['B', 'C', 'B', 'A', 'A', 'C', 'C', 'D', 'A', 'A', 'B', 'C'] as AnswerKey['mcqAnswers'],
      tf: [
        { a: 'T', b: 'T', c: 'T', d: 'F' }, // 2/4 -> 0.25
        { a: 'F', b: 'T', c: 'T', d: 'F' }, // 4/4 -> 1.0
        { a: 'F', b: 'F', c: 'T', d: 'F' }, // 1/4 -> 0.1
        { a: 'F', b: 'F', c: 'T', d: 'F' }, // 3/4 -> 0.5
      ] as AnswerKey['tfAnswers'],
      short: ['12,5', '4', '2025', '', '42', '-1,5'],
    },
  ];

  const papers: StudentPaper[] = sampleRaw.map((item, idx) => {
    const g = computePaperGrade(
      bgdContest,
      [bgdKey101],
      item.sbd,
      '0101',
      item.mcq,
      item.tf,
      item.short,
      0
    );
    return {
      id: item.id,
      contestId: bgdContest.id,
      scannedAt: new Date(Date.now() - (3 - idx) * 600_000).toISOString(),
      sbd: item.sbd,
      examCode: '0101',
      studentId: `stu_${idx + 1}`,
      studentName: item.name,
      roomName: item.room,
      mcqAnswers: item.mcq,
      tfAnswers: item.tf,
      shortAnswers: item.short,
      part4EssayScore: 0,
      ...g,
    };
  });

  return {
    contests: [bgdContest, stdContest],
    keys,
    papers,
    classes,
    students,
    settings: DEFAULT_SETTINGS,
  };
}

export function loadDatabaseState(): AppDatabaseState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      const seed = createSeedState();
      saveDatabaseState(seed);
      return seed;
    }
    const parsed = JSON.parse(raw) as Partial<AppDatabaseState>;
    return {
      contests: parsed.contests || [],
      keys: parsed.keys || [],
      papers: parsed.papers || [],
      classes: parsed.classes || [],
      students: parsed.students || [],
      settings: { ...DEFAULT_SETTINGS, ...(parsed.settings || {}) },
    };
  } catch {
    return createSeedState();
  }
}

export function saveDatabaseState(state: AppDatabaseState): void {
  try {
    // Strip large image blobs from localStorage copy (stored in IndexedDB)
    const slimPapers = state.papers.map(({ annotatedImageDataUrl, ...rest }) => rest);
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        ...state,
        papers: slimPapers,
      })
    );
  } catch (err) {
    console.warn('Failed to persist state to localStorage', err);
  }
}

function openImageDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('IndexedDB unavailable'));
      return;
    }
    const req = indexedDB.open(IDB_NAME, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(IDB_STORE)) {
        db.createObjectStore(IDB_STORE);
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function savePaperImage(paperId: string, dataUrl: string): Promise<void> {
  if (!dataUrl) return;
  try {
    const db = await openImageDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(IDB_STORE, 'readwrite');
      tx.objectStore(IDB_STORE).put(dataUrl, paperId);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch {
    // Non-fatal fallback
  }
}

export async function loadPaperImage(paperId: string): Promise<string | null> {
  try {
    const db = await openImageDb();
    return await new Promise<string | null>((resolve, reject) => {
      const tx = db.transaction(IDB_STORE, 'readonly');
      const req = tx.objectStore(IDB_STORE).get(paperId);
      req.onsuccess = () => resolve((req.result as string) || null);
      req.onerror = () => reject(req.error);
    });
  } catch {
    return null;
  }
}

export function uid(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
}
