import React, { useEffect, useMemo, useState } from 'react';
import {
  Copy,
  FileCheck2,
  FileText,
  GraduationCap,
  Plus,
  Search,
  Settings,
  Smartphone,
  Trash2,
} from 'lucide-react';
import { AnswerKey, Classroom, Contest, Student, StudentPaper } from './types';
import { SHEET_FORM_LABELS, t } from './i18n';
import { computePaperGrade, syncContestMaxScore } from './omr/grading';
import {
  AppDatabaseState,
  loadDatabaseState,
  saveDatabaseState,
  uid,
} from './storage/db';
import { CreateContestModal } from './components/CreateContestModal';
import { ContestDetailView } from './components/ContestDetailView';
import { ClassesTab } from './components/ClassesTab';
import { SheetsTab } from './components/SheetsTab';
import { SettingsTab } from './components/SettingsTab';

type RootTab = 'tests' | 'classes' | 'sheets' | 'settings';

export const App: React.FC = () => {
  const [state, setState] = useState<AppDatabaseState>(() => loadDatabaseState());
  const [activeTab, setActiveTab] = useState<RootTab>('tests');
  const [openContestId, setOpenContestId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [creatingContest, setCreatingContest] = useState(false);
  const [editingContest, setEditingContest] = useState<Contest | null>(null);
  const [showIosBanner, setShowIosBanner] = useState<boolean>(() => {
    const isStandalone =
      window.matchMedia?.('(display-mode: standalone)').matches ||
      (window.navigator as any).standalone === true;
    const dismissed = localStorage.getItem('tncraft_ios_banner_dismissed') === '1';
    return !isStandalone && !dismissed;
  });

  useEffect(() => {
    saveDatabaseState(state);
  }, [state]);

  const lang = state.settings.language;
  const tr = t(lang);

  const activeContest = useMemo(
    () => state.contests.find((c) => c.id === openContestId) || null,
    [state.contests, openContestId]
  );

  const filteredContests = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return state.contests;
    return state.contests.filter((c) => {
      const clsName = state.classes.find((cl) => cl.id === c.classId)?.name || '';
      return c.name.toLowerCase().includes(q) || clsName.toLowerCase().includes(q);
    });
  }, [state.contests, state.classes, searchQuery]);

  const upsertContest = (rawContest: Contest) => {
    const contest = syncContestMaxScore(rawContest);
    setState((prev) => {
      const exists = prev.contests.some((c) => c.id === contest.id);
      const nextContests = exists
        ? prev.contests.map((c) => (c.id === contest.id ? contest : c))
        : [contest, ...prev.contests];

      // Re-grade existing papers of this contest whenever scoring weights or question counts change
      const contestKeys = prev.keys.filter((k) => k.contestId === contest.id);
      const contestPapers = prev.papers.filter((p) => p.contestId === contest.id);
      const nextPapers =
        exists && contestPapers.length > 0
          ? prev.papers.map((p) => {
              if (p.contestId !== contest.id) return p;
              const g = computePaperGrade(
                contest,
                contestKeys,
                p.sbd,
                p.examCode,
                p.mcqAnswers,
                p.tfAnswers,
                p.shortAnswers,
                p.part4EssayScore,
                contestPapers,
                p.id
              );
              return { ...p, ...g };
            })
          : prev.papers;

      return {
        ...prev,
        contests: nextContests,
        papers: nextPapers,
      };
    });
  };

  const duplicateContest = (c: Contest) => {
    const newId = uid('cnt');
    const copy: Contest = {
      ...c,
      id: newId,
      name: `${c.name} (Copy)`,
      createdAt: new Date().toISOString().slice(0, 10),
    };
    const copiedKeys: AnswerKey[] = state.keys
      .filter((k) => k.contestId === c.id)
      .map((k) => ({
        ...k,
        id: uid('key'),
        contestId: newId,
      }));
    setState((prev) => ({
      ...prev,
      contests: [copy, ...prev.contests],
      keys: [...copiedKeys, ...prev.keys],
    }));
  };

  const deleteContest = (contestId: string) => {
    setState((prev) => ({
      ...prev,
      contests: prev.contests.filter((c) => c.id !== contestId),
      keys: prev.keys.filter((k) => k.contestId !== contestId),
      papers: prev.papers.filter((p) => p.contestId !== contestId),
    }));
    if (openContestId === contestId) setOpenContestId(null);
  };

  const upsertKey = (key: AnswerKey) => {
    setState((prev) => {
      const idx = prev.keys.findIndex(
        (k) =>
          k.id === key.id ||
          (k.contestId === key.contestId && k.examCode.trim() === key.examCode.trim())
      );
      let nextKeys: AnswerKey[];
      if (idx >= 0) {
        nextKeys = [...prev.keys];
        nextKeys[idx] = { ...key, id: prev.keys[idx].id };
      } else {
        nextKeys = [...prev.keys, key];
      }

      const targetContest = prev.contests.find((c) => c.id === key.contestId);
      if (!targetContest) return { ...prev, keys: nextKeys };

      const cKeys = nextKeys.filter((k) => k.contestId === key.contestId);
      const cPapers = prev.papers.filter((p) => p.contestId === key.contestId);
      if (cPapers.length === 0) return { ...prev, keys: nextKeys };

      const nextPapers = prev.papers.map((p) => {
        if (p.contestId !== key.contestId) return p;
        const g = computePaperGrade(
          targetContest,
          cKeys,
          p.sbd,
          p.examCode,
          p.mcqAnswers,
          p.tfAnswers,
          p.shortAnswers,
          p.part4EssayScore,
          cPapers,
          p.id
        );
        return { ...p, ...g };
      });
      return { ...prev, keys: nextKeys, papers: nextPapers };
    });
  };

  const importKeysBatch = (
    contestId: string,
    importedKeys: AnswerKey[],
    contestPatch?: Partial<Contest>
  ) => {
    setState((prev) => {
      const curContest = prev.contests.find((c) => c.id === contestId);
      if (!curContest) return prev;

      const updatedContest =
        contestPatch && Object.keys(contestPatch).length > 0
          ? syncContestMaxScore({ ...curContest, ...contestPatch })
          : curContest;

      const nextContests = prev.contests.map((c) => (c.id === contestId ? updatedContest : c));
      const nextKeys = [...prev.keys];

      for (const item of importedKeys) {
        const idx = nextKeys.findIndex(
          (k) =>
            k.id === item.id ||
            (k.contestId === contestId && k.examCode.trim() === item.examCode.trim())
        );
        if (idx >= 0) {
          nextKeys[idx] = {
            ...item,
            id: nextKeys[idx].id,
            createdAt: nextKeys[idx].createdAt,
          };
        } else {
          nextKeys.push(item);
        }
      }

      const cKeys = nextKeys.filter((k) => k.contestId === contestId);
      const cPapers = prev.papers.filter((p) => p.contestId === contestId);
      const nextPapers =
        cPapers.length > 0
          ? prev.papers.map((p) => {
              if (p.contestId !== contestId) return p;
              const g = computePaperGrade(
                updatedContest,
                cKeys,
                p.sbd,
                p.examCode,
                p.mcqAnswers,
                p.tfAnswers,
                p.shortAnswers,
                p.part4EssayScore,
                cPapers,
                p.id
              );
              return { ...p, ...g };
            })
          : prev.papers;

      return {
        ...prev,
        contests: nextContests,
        keys: nextKeys,
        papers: nextPapers,
      };
    });
  };

  const upsertPaper = (paper: StudentPaper) => {
    setState((prev) => {
      const exists = prev.papers.some((p) => p.id === paper.id);
      return {
        ...prev,
        papers: exists
          ? prev.papers.map((p) => (p.id === paper.id ? paper : p))
          : [paper, ...prev.papers],
      };
    });
  };

  return (
    <div className="app-shell">
      {/* Top App Header */}
      {!activeContest && (
        <header className="top-navbar">
          <div className="brand-row">
            <div className="brand-logo">TN</div>
            <div>
              <h1>{tr.appTitle}</h1>
              <span>{tr.appSubtitle}</span>
            </div>
          </div>
          <button
            type="button"
            className="lang-pill"
            onClick={() =>
              setState((prev) => ({
                ...prev,
                settings: {
                  ...prev.settings,
                  language: prev.settings.language === 'vi' ? 'en' : 'vi',
                },
              }))
            }
          >
            {lang === 'vi' ? '🇻🇳 VI' : '🇬🇧 EN'}
          </button>
        </header>
      )}

      {/* Main Content */}
      <main className="main-content">
        {activeContest ? (
          <ContestDetailView
            contest={activeContest}
            classes={state.classes}
            keys={state.keys.filter((k) => k.contestId === activeContest.id)}
            papers={state.papers.filter((p) => p.contestId === activeContest.id)}
            students={state.students}
            settings={state.settings}
            onBack={() => setOpenContestId(null)}
            onEditContest={() => setEditingContest(activeContest)}
            onUpdateContest={(patch) => upsertContest({ ...activeContest, ...patch })}
            onUpsertKey={upsertKey}
            onImportKeysBatch={(imported, patch) =>
              importKeysBatch(activeContest.id, imported, patch)
            }
            onDeleteKey={(kid) =>
              setState((prev) => {
                const nextKeys = prev.keys.filter((k) => k.id !== kid);
                const cKeys = nextKeys.filter((k) => k.contestId === activeContest.id);
                const cPapers = prev.papers.filter((p) => p.contestId === activeContest.id);
                const nextPapers = prev.papers.map((p) => {
                  if (p.contestId !== activeContest.id) return p;
                  const g = computePaperGrade(
                    activeContest,
                    cKeys,
                    p.sbd,
                    p.examCode,
                    p.mcqAnswers,
                    p.tfAnswers,
                    p.shortAnswers,
                    p.part4EssayScore,
                    cPapers,
                    p.id
                  );
                  return { ...p, ...g };
                });
                return { ...prev, keys: nextKeys, papers: nextPapers };
              })
            }
            onClearKeys={() =>
              setState((prev) => {
                const nextKeys = prev.keys.filter((k) => k.contestId !== activeContest.id);
                const cPapers = prev.papers.filter((p) => p.contestId === activeContest.id);
                const nextPapers = prev.papers.map((p) => {
                  if (p.contestId !== activeContest.id) return p;
                  const g = computePaperGrade(
                    activeContest,
                    [],
                    p.sbd,
                    p.examCode,
                    p.mcqAnswers,
                    p.tfAnswers,
                    p.shortAnswers,
                    p.part4EssayScore,
                    cPapers,
                    p.id
                  );
                  return { ...p, ...g };
                });
                return { ...prev, keys: nextKeys, papers: nextPapers };
              })
            }
            onUpsertPaper={upsertPaper}
            onDeletePaper={(pid) =>
              setState((prev) => ({ ...prev, papers: prev.papers.filter((p) => p.id !== pid) }))
            }
          />
        ) : (
          <>
            {showIosBanner && (
              <div className="ios-banner">
                <Smartphone size={20} style={{ flexShrink: 0, marginTop: 2 }} />
                <div style={{ flex: 1 }}>
                  <strong>{tr.iosInstall.title}</strong>
                  <p>{tr.iosInstall.desc}</p>
                </div>
                <button
                  type="button"
                  className="banner-close-btn"
                  onClick={() => {
                    localStorage.setItem('tncraft_ios_banner_dismissed', '1');
                    setShowIosBanner(false);
                  }}
                >
                  {tr.iosInstall.dismiss}
                </button>
              </div>
            )}

            {activeTab === 'tests' && (
              <div className="page-container">
                <div className="page-header">
                  <h2>{tr.tests.title}</h2>
                  <button
                    type="button"
                    className="primary-btn"
                    onClick={() => setCreatingContest(true)}
                  >
                    <Plus size={17} /> {tr.tests.create}
                  </button>
                </div>

                <div className="search-box">
                  <Search size={17} />
                  <input
                    type="text"
                    placeholder={tr.tests.search}
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                  />
                </div>

                {filteredContests.length === 0 ? (
                  <div className="empty-card">{tr.tests.empty}</div>
                ) : (
                  <div className="card-list">
                    {filteredContests.map((c) => {
                      const pCount = state.papers.filter((p) => p.contestId === c.id).length;
                      const kCount = state.keys.filter((k) => k.contestId === c.id).length;
                      const cls = state.classes.find((cl) => cl.id === c.classId);
                      return (
                        <div
                          key={c.id}
                          className="contest-card"
                          onClick={() => setOpenContestId(c.id)}
                        >
                          <div className="contest-card-body">
                            <div className="contest-tag-row">
                              <span className="form-badge">
                                {SHEET_FORM_LABELS[c.formId][lang]}
                              </span>
                              {cls && <span className="class-badge">{cls.name}</span>}
                            </div>
                            <h3>{c.name}</h3>
                            <div className="contest-meta">
                              <span>
                                <strong>{pCount}</strong> {tr.tests.papersCount}
                              </span>
                              <span>•</span>
                              <span>
                                <strong>{kCount}</strong> {tr.tests.keysCount}
                              </span>
                              <span>•</span>
                              <span>
                                {tr.tests.maxScore}: <strong>{c.maxScore}</strong>
                              </span>
                            </div>
                          </div>

                          <div
                            className="item-card-actions"
                            onClick={(e) => e.stopPropagation()}
                          >
                            <button
                              type="button"
                              className="icon-btn"
                              title={tr.tests.duplicate}
                              onClick={() => duplicateContest(c)}
                            >
                              <Copy size={17} />
                            </button>
                            <button
                              type="button"
                              className="icon-btn danger"
                              title={tr.tests.delete}
                              onClick={() => deleteContest(c.id)}
                            >
                              <Trash2 size={17} />
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            )}

            {activeTab === 'classes' && (
              <ClassesTab
                lang={lang}
                classes={state.classes}
                students={state.students}
                onAddClass={(cls: Classroom) =>
                  setState((prev) => ({ ...prev, classes: [...prev.classes, cls] }))
                }
                onDeleteClass={(cid: string) =>
                  setState((prev) => ({
                    ...prev,
                    classes: prev.classes.filter((c) => c.id !== cid),
                    students: prev.students.filter((s) => s.classId !== cid),
                  }))
                }
                onAddStudents={(items: Student[]) =>
                  setState((prev) => ({ ...prev, students: [...prev.students, ...items] }))
                }
                onDeleteStudent={(sid: string) =>
                  setState((prev) => ({
                    ...prev,
                    students: prev.students.filter((s) => s.id !== sid),
                  }))
                }
              />
            )}

            {activeTab === 'sheets' && (
              <SheetsTab lang={lang} contests={state.contests} />
            )}

            {activeTab === 'settings' && (
              <SettingsTab
                settings={state.settings}
                fullState={state}
                onUpdateSettings={(patch) =>
                  setState((prev) => ({
                    ...prev,
                    settings: { ...prev.settings, ...patch },
                  }))
                }
                onImportState={(next) => setState(next)}
                onResetDemo={() => {
                  localStorage.removeItem('tncraft_state_v1');
                  setState(loadDatabaseState());
                }}
              />
            )}
          </>
        )}
      </main>

      {/* iOS Bottom Tab Bar */}
      {!activeContest && (
        <nav className="bottom-tabbar">
          <button
            type="button"
            className={`tab-item ${activeTab === 'tests' ? 'active' : ''}`}
            onClick={() => setActiveTab('tests')}
          >
            <FileCheck2 size={21} />
            <span>{tr.tabs.tests}</span>
          </button>
          <button
            type="button"
            className={`tab-item ${activeTab === 'classes' ? 'active' : ''}`}
            onClick={() => setActiveTab('classes')}
          >
            <GraduationCap size={21} />
            <span>{tr.tabs.classes}</span>
          </button>
          <button
            type="button"
            className={`tab-item ${activeTab === 'sheets' ? 'active' : ''}`}
            onClick={() => setActiveTab('sheets')}
          >
            <FileText size={21} />
            <span>{tr.tabs.sheets}</span>
          </button>
          <button
            type="button"
            className={`tab-item ${activeTab === 'settings' ? 'active' : ''}`}
            onClick={() => setActiveTab('settings')}
          >
            <Settings size={21} />
            <span>{tr.tabs.settings}</span>
          </button>
        </nav>
      )}

      {(creatingContest || editingContest) && (
        <CreateContestModal
          lang={lang}
          classes={state.classes}
          defaultFormId={state.settings.defaultFormId}
          defaultQuestions={state.settings.defaultQuestions}
          defaultMaxScore={state.settings.defaultMaxScore}
          initial={editingContest}
          onClose={() => {
            setCreatingContest(false);
            setEditingContest(null);
          }}
          onSave={(saved) => {
            upsertContest(saved);
            setCreatingContest(false);
            setEditingContest(null);
            setOpenContestId(saved.id);
          }}
        />
      )}
    </div>
  );
};
