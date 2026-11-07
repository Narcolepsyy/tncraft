export type Language = 'vi' | 'en';

export type SheetFormId =
  | 'standard_20'
  | 'standard_40'
  | 'standard_50'
  | 'standard_60'
  | 'standard_100'
  | 'standard_120'
  | 'bgd_2025';

export type ChoiceCount = 4 | 5; // A-D or A-E for standard sheets

export interface SubjectSplit {
  name: string;
  questionCount: number;
  maxScore: number;
}

export interface Contest {
  id: string;
  name: string;
  createdAt: string;
  classId: string | null;
  formId: SheetFormId;
  choiceCount: ChoiceCount;
  sbdDigits: 6 | 8;
  examCodeDigits: 3 | 4;

  // Standard form settings
  totalQuestions: number; // 1..120
  maxScore: number; // e.g., 10 or 100
  subjectSplits: SubjectSplit[];

  // BGD-2025 (Ministry 3-part + optional Essay Part IV) settings
  enablePart1: boolean;
  part1Questions: number; // 1..40
  part1TotalScore: number; // default 3.0 or 4.0

  enablePart2: boolean;
  part2Questions: number; // 1..8 (each has a, b, c, d True/False)
  part2Score1: number; // default 0.1
  part2Score2: number; // default 0.25
  part2Score3: number; // default 0.5
  part2Score4: number; // default 1.0

  enablePart3: boolean;
  part3Questions: number; // 1..6 (short numeric - , 0..9)
  part3TotalScore: number; // default 1.5 or 3.0

  enablePart4Essay: boolean;
  part4MaxScore: number; // optional manual essay score
}

export type MCQChoice = 'A' | 'B' | 'C' | 'D' | 'E' | '' | 'MULTI';
export type TFChoice = 'T' | 'F' | '' | 'MULTI'; // T = Đúng, F = Sai

export interface TFQuestionAnswer {
  a: TFChoice;
  b: TFChoice;
  c: TFChoice;
  d: TFChoice;
}

export interface AnswerKey {
  id: string;
  contestId: string;
  examCode: string; // Mã đề, e.g. "101" or "0101"
  createdAt: string;
  mcqAnswers: MCQChoice[]; // length = totalQuestions (standard) or part1Questions (bgd_2025)
  tfAnswers: TFQuestionAnswer[]; // length = part2Questions (bgd_2025)
  shortAnswers: string[]; // length = part3Questions (bgd_2025), e.g. "-1,5" or "2025"
}

export interface PaperWarning {
  kind: 'unmatched_key' | 'duplicate_sbd' | 'blank_answers' | 'multi_marks' | 'incomplete_id';
  message: string;
}

export interface StudentPaper {
  id: string;
  contestId: string;
  scannedAt: string;
  sbd: string; // Số báo danh
  examCode: string; // Mã đề
  studentId: string | null;
  studentName: string;
  roomName: string;

  mcqAnswers: MCQChoice[];
  tfAnswers: TFQuestionAnswer[];
  shortAnswers: string[];
  part4EssayScore: number;

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
  annotatedImageDataUrl?: string; // Stored in IndexedDB or compact JPEG data URL
}

export interface Classroom {
  id: string;
  name: string;
  createdAt: string;
}

export interface Student {
  id: string;
  classId: string;
  sbd: string;
  name: string;
  roomName: string;
}

export interface AppSettings {
  language: Language;
  eraseMode: 'normal' | 'high'; // Switch erase sensitivity when 2 bubbles have marks
  autoCaptureDelayMs: 0 | 600 | 1000 | 1500 | 2000;
  vibrateOnScan: boolean;
  overrideDuplicateSbd: boolean;
  warnUnmatchedKey: boolean;
  warnBlankOrMulti: boolean;
  defaultFormId: SheetFormId;
  defaultMaxScore: number;
  defaultQuestions: number;
}

export interface Point2D {
  x: number;
  y: number;
}

export interface BubbleCoord {
  id: string;
  section: 'sbd' | 'examCode' | 'mcq' | 'tf' | 'short';
  index: number; // column index for sbd/examCode, 0-based question index for mcq/tf/short
  subIndex?: number; // 0..3 for tf statements a..d, or 0..3 for short answer columns
  value: string; // '0'..'9', 'A'..'E', 'T'|'F', '-'|','|'0'..'9'
  cx: number; // Canonical sheet X in [0..1000]
  cy: number; // Canonical sheet Y in [0..1414]
  r: number; // Canonical bubble radius
}
