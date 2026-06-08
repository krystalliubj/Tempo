import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ChevronDown } from 'lucide-react';
import { HexColorInput, HexColorPicker } from 'react-colorful';
import OverviewPanel from './components/OverviewPanel';
import ProjectCard from './components/ProjectCard';
import ReminderBanner from './components/ReminderBanner';
import SessionsPanel from './components/SessionsPanel';
import SevenDayChart from './components/SevenDayChart';
import {
  exportDailySummaryCsv,
  exportJsonBackup,
  exportSessionsCsv,
  loadTempoState,
  saveTempoState,
} from './services/tempoStorage';
import { ProjectCategory, TempoState } from './types';
import './app.css';
import {
  CATEGORY_OPTIONS,
  COLOR_OPTIONS,
  clampMinutes,
  createId,
  createSessionFromActive,
  formatClock,
  formatDateKey,
  formatDurationCompact,
  getActiveElapsedSec,
  getCategoryDuration,
  getCompletedSessionsForProject,
  getInterruptedCountByDate,
  getInterruptedCountForProject,
  getLastNDays,
  getProjectById,
  getProjectDurationByDate,
  getProjectDurationByDates,
  getTotalDurationByDate,
  normalizeColor,
} from './utils/tempo';

const App: React.FC = () => {
  const [state, setState] = useState<TempoState>(() => loadTempoState());
  const [now, setNow] = useState(() => Date.now());
  const [toast, setToast] = useState<string | null>(null);
  const [draft, setDraft] = useState({
    name: '',
    category: '专注' as ProjectCategory,
    color: '#6366f1',
    targetMinutes: 25,
  });
  const [editingProjectId, setEditingProjectId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState({
    name: '',
    category: '专注' as ProjectCategory,
    color: '#6366f1',
    targetMinutes: 25,
  });
  const [activeSelect, setActiveSelect] = useState<'create-category' | 'edit-category' | null>(null);
  const [showCustomDraftColor, setShowCustomDraftColor] = useState(false);
  const [showCustomEditColor, setShowCustomEditColor] = useState(false);

  const toastTimerRef = useRef<number | null>(null);
  const miniWindowRef = useRef<Window | null>(null);

  const todayKey = formatDateKey(now);
  const last7Days = getLastNDays(7);
  const activeProject = state.activeSession
    ? getProjectById(state.projects, state.activeSession.projectId)
    : null;
  const activeElapsedSec = getActiveElapsedSec(state.activeSession, now);

  useEffect(() => {
    saveTempoState(state);
  }, [state]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      setNow(Date.now());
    }, 1000);

    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    if (!state.activeSession) {
      return;
    }

    const targetSec = state.activeSession.targetMinutes * 60;
    if (
      targetSec > 0 &&
      activeElapsedSec >= targetSec &&
      !state.activeSession.alertedAt
    ) {
      triggerReminder();
    }
  }, [activeElapsedSec, state.activeSession]);

  useEffect(() => {
    syncMiniWindow();
  }, [activeElapsedSec, activeProject, state.activeSession]);

  useEffect(() => {
    return () => {
      closeMiniWindow();
    };
  }, []);

  const overviewStats = useMemo(() => {
    const todayDuration = getTotalDurationByDate(state, now, todayKey);
    const todayInterruptions = getInterruptedCountByDate(state, todayKey);
    const weekFocus = getCategoryDuration(state, now, last7Days, '专注');
    const weekExercise = getCategoryDuration(state, now, last7Days, '运动');

    return [
      {
        label: '状态',
        value: state.activeSession ? '专注中' : '空闲',
        note: activeProject ? activeProject.name : '当前没有运行中的项目',
      },
      {
        label: '实时计时',
        value: state.activeSession ? formatClock(activeElapsedSec) : '--:--:--',
        note: activeProject ? `目标 ${activeProject.targetMinutes} 分钟` : '可以从任意项目开始',
      },
      {
        label: '今日累计',
        value: formatDurationCompact(todayDuration),
        note: '真实累计，不是提醒次数',
      },
      {
        label: '今日打断',
        value: String(todayInterruptions),
        note: todayInterruptions ? '未达到目标即结束的次数' : '今天还没有打断',
      },
      {
        label: '本周专注',
        value: formatDurationCompact(weekFocus),
        note: '最近 7 天',
      },
      {
        label: '本周运动',
        value: formatDurationCompact(weekExercise),
        note: '最近 7 天',
      },
    ];
  }, [activeElapsedSec, activeProject, last7Days, now, state, todayKey]);

  const sortedProjects = useMemo(() => {
    return [...state.projects].sort((a, b) => {
      if (state.activeSession?.projectId === a.id) {
        return -1;
      }

      if (state.activeSession?.projectId === b.id) {
        return 1;
      }

      return b.createdAt - a.createdAt;
    });
  }, [state.activeSession, state.projects]);

  const editingProject = editingProjectId
    ? getProjectById(state.projects, editingProjectId)
    : null;

  function triggerReminder() {
    setState((current) => {
      if (!current.activeSession || current.activeSession.alertedAt) {
        return current;
      }

      return {
        ...current,
        activeSession: {
          ...current.activeSession,
          alertedAt: Date.now(),
          reminderAcknowledgedAt: null,
        },
      };
    });

    const name = activeProject?.name || '当前项目';
    showToast(`${name} 已到设定时间，请手动停止或切换到下一个项目。`);
    playReminder();

    if ('Notification' in window) {
      if (Notification.permission === 'granted') {
        void new Notification('Tempo 计时到点', {
          body: `${name} 已达到 ${activeProject?.targetMinutes || 0} 分钟。`,
        });
      } else if (Notification.permission === 'default') {
        void Notification.requestPermission();
      }
    }
  }

  function playReminder() {
    try {
      const AudioContextClass = window.AudioContext || (window as typeof window & {
        webkitAudioContext?: typeof AudioContext;
      }).webkitAudioContext;

      if (!AudioContextClass) {
        return;
      }

      const context = new AudioContextClass();
      const oscillator = context.createOscillator();
      const gainNode = context.createGain();
      oscillator.connect(gainNode);
      gainNode.connect(context.destination);
      oscillator.type = 'triangle';
      oscillator.frequency.value = 880;
      gainNode.gain.value = 0.0001;
      oscillator.start();
      gainNode.gain.exponentialRampToValueAtTime(0.16, context.currentTime + 0.03);
      gainNode.gain.exponentialRampToValueAtTime(0.0001, context.currentTime + 0.7);
      oscillator.stop(context.currentTime + 0.75);
    } catch (error) {
      console.warn('Reminder audio not available:', error);
    }
  }

  function showToast(message: string) {
    setToast(message);
    if (toastTimerRef.current) {
      window.clearTimeout(toastTimerRef.current);
    }
    toastTimerRef.current = window.setTimeout(() => setToast(null), 2600);
  }

  function handleDraftChange<K extends keyof typeof draft>(key: K, value: (typeof draft)[K]) {
    setDraft((current) => ({ ...current, [key]: value }));
  }

  function handleEditDraftChange<K extends keyof typeof editDraft>(
    key: K,
    value: (typeof editDraft)[K],
  ) {
    setEditDraft((current) => ({ ...current, [key]: value }));
  }

  function handleCreateProject(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const name = draft.name.trim();
    if (!name) {
      showToast('请输入项目名称。');
      return;
    }

    setState((current) => ({
      ...current,
      projects: [
        {
          id: createId(),
          name,
          category: draft.category,
          color: normalizeColor(draft.color),
          targetMinutes: clampMinutes(draft.targetMinutes),
          createdAt: Date.now(),
        },
        ...current.projects,
      ],
    }));

    setDraft({
      name: '',
      category: '专注',
      color: '#6366f1',
      targetMinutes: 25,
    });
    setShowCustomDraftColor(false);
    showToast('项目已添加，可以立即开始计时。');
  }

  function startProject(projectId: string) {
    const project = getProjectById(state.projects, projectId);
    if (!project) {
      showToast('未找到对应项目。');
      return;
    }

    if (state.activeSession?.projectId === projectId) {
      showToast('这个项目已经在计时中了。');
      return;
    }

    setState((current) => {
      const sessions = current.activeSession
        ? [
            createSessionFromActive(
              current.activeSession,
              getProjectById(current.projects, current.activeSession.projectId),
              Date.now(),
              'switch',
            ),
            ...current.sessions,
          ]
        : current.sessions;

      return {
        ...current,
        sessions,
        activeSession: {
          id: createId(),
          projectId,
          startAt: Date.now(),
          targetMinutes: project.targetMinutes,
          alertedAt: null,
          reminderAcknowledgedAt: null,
        },
      };
    });
  }

  function stopActiveSession(reason: 'manual' | 'switch' = 'manual') {
    setState((current) => {
      if (!current.activeSession) {
        return current;
      }

      return {
        ...current,
        sessions: [
          createSessionFromActive(
            current.activeSession,
            getProjectById(current.projects, current.activeSession.projectId),
            Date.now(),
            reason,
          ),
          ...current.sessions,
        ],
        activeSession: null,
      };
    });
  }

  function deleteProject(projectId: string) {
    if (state.activeSession?.projectId === projectId) {
      showToast('当前项目正在计时，请先停止再删除。');
      return;
    }

    setState((current) => ({
      ...current,
      projects: current.projects.filter((project) => project.id !== projectId),
    }));
  }

  function deleteSession(sessionId: string) {
    setState((current) => ({
      ...current,
      sessions: current.sessions.filter((session) => session.id !== sessionId),
    }));
    showToast('该条会话记录已删除。');
  }

  function openEditProject(projectId: string) {
    const project = getProjectById(state.projects, projectId);
    if (!project) {
      return;
    }

    setEditingProjectId(projectId);
    setEditDraft({
      name: project.name,
      category: project.category,
      color: project.color,
      targetMinutes: project.targetMinutes,
    });
    setShowCustomEditColor(false);
  }

  function saveProjectEdit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!editingProjectId) {
      return;
    }

    const name = editDraft.name.trim();
    if (!name) {
      showToast('请输入项目名称。');
      return;
    }

    setState((current) => ({
      ...current,
      projects: current.projects.map((project) =>
        project.id === editingProjectId
          ? {
              ...project,
              name,
              category: editDraft.category,
              color: normalizeColor(editDraft.color),
              targetMinutes: clampMinutes(editDraft.targetMinutes),
            }
          : project,
      ),
      activeSession:
        current.activeSession && current.activeSession.projectId === editingProjectId
          ? {
              ...current.activeSession,
              targetMinutes: clampMinutes(editDraft.targetMinutes),
            }
          : current.activeSession,
    }));

    setEditingProjectId(null);
    showToast('项目已更新。');
  }

  function acknowledgeReminder() {
    setState((current) => {
      if (!current.activeSession) {
        return current;
      }

      return {
        ...current,
        activeSession: {
          ...current.activeSession,
          reminderAcknowledgedAt: Date.now(),
        },
      };
    });
  }

  function openMiniWindow() {
    const existingPopup = miniWindowRef.current;
    if (existingPopup && !existingPopup.closed) {
      try {
        existingPopup.focus();
        syncMiniWindow();
        showToast('迷你计时窗已打开；若未显示，请检查是否被其他窗口遮挡或最小化隐藏。');
        return;
      } catch (error) {
        console.warn('Existing mini window is no longer available:', error);
        miniWindowRef.current = null;
      }
    }

    const popup = window.open(
      'about:blank',
      'tempo-mini',
      'popup=yes,width=360,height=220,resizable=yes,scrollbars=no',
    );
    if (!popup) {
      showToast('迷你计时窗被浏览器拦截了，请允许弹出窗口。');
      return;
    }

    miniWindowRef.current = popup;
    popup.document.body.innerHTML = '<div></div>';
    popup.focus();
    syncMiniWindow();
    showToast('迷你计时窗已打开。');
  }

  function closeMiniWindow() {
    const popup = miniWindowRef.current;
    if (popup && !popup.closed) {
      popup.close();
    }
    miniWindowRef.current = null;
  }

  function escapeMiniHtml(value: string) {
    return value
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function syncMiniWindow() {
    const popup = miniWindowRef.current;
    if (!popup || popup.closed) {
      miniWindowRef.current = null;
      return;
    }

    const timerText = state.activeSession ? formatClock(activeElapsedSec) : '--:--:--';
    const projectName = activeProject?.name || '当前空闲';
    const statusText = state.activeSession ? activeProject?.category || '专注' : '等待开始';
    const projectNameHtml = escapeMiniHtml(projectName);
    const statusTextHtml = escapeMiniHtml(statusText);
    const timerTextHtml = escapeMiniHtml(timerText);

    popup.document.title = 'Tempo Mini';
    popup.document.body.innerHTML = `
      <style>
        body {
          margin: 0;
          min-height: 100vh;
          display: flex;
          align-items: center;
          justify-content: center;
          font-family: Inter, "PingFang SC", "Microsoft YaHei", sans-serif;
          background: linear-gradient(135deg, #eef2ff, #f8fafc);
          color: #0f172a;
        }
        .mini-shell {
          width: calc(100vw - 24px);
          padding: 20px;
          border-radius: 24px;
          background: rgba(255, 255, 255, 0.92);
          box-shadow: 0 20px 40px rgba(79, 70, 229, 0.14);
          border: 1px solid rgba(255, 255, 255, 0.8);
          box-sizing: border-box;
        }
        .mini-topbar {
          display: flex;
          align-items: center;
          justify-content: flex-start;
          margin-bottom: 12px;
        }
        .mini-label {
          display: inline-block;
          font-size: 11px;
          letter-spacing: 0.18em;
          text-transform: uppercase;
          color: #818cf8;
          font-weight: 800;
        }
        .mini-name {
          margin: 0;
          font-size: 24px;
          font-weight: 900;
        }
        .mini-status {
          margin: 8px 0 0;
          color: #64748b;
          font-size: 13px;
        }
        .mini-time {
          margin-top: 18px;
          font-size: 40px;
          font-weight: 900;
          letter-spacing: -0.05em;
          font-variant-numeric: tabular-nums;
        }
      </style>
      <div class="mini-shell">
        <div class="mini-topbar">
          <span class="mini-label">Tempo Mini</span>
        </div>
        <h1 class="mini-name">${projectNameHtml}</h1>
        <p class="mini-status">${statusTextHtml}</p>
        <div class="mini-time">${timerTextHtml}</div>
      </div>
    `;

    popup.onbeforeunload = () => {
      if (miniWindowRef.current === popup) {
        miniWindowRef.current = null;
      }
    };
  }

  return (
    <div className="page">
      <header className="header">
        <div className="brand">
          <div className="brand-icon">T</div>
          <div>
            <h1>Tempo</h1>
            <p className="subtle">
              多项目单活跃计时器，离线记录每日真实累计时长、打断次数与近 7 天趋势。
            </p>
          </div>
        </div>

        <div className="toolbar">
          <button className="btn btn-secondary" onClick={() => exportSessionsCsv(state.sessions)}>
            导出计时明细
          </button>
          <button className="btn btn-secondary" onClick={() => exportDailySummaryCsv(state)}>
            导出日汇总
          </button>
          <button className="btn btn-secondary" onClick={() => exportJsonBackup(state)}>
            导出完整备份
          </button>
          <button className="btn btn-primary toolbar-main-action" onClick={openMiniWindow}>
            打开迷你计时窗
          </button>
        </div>
      </header>

      <div className="layout">
        <aside className="stack">
          <section className="panel glass">
            <span className="eyebrow">Create Project</span>
            <div className="section-title">
              <h2>新增计时项目</h2>
            </div>

            <form className="field-grid" onSubmit={handleCreateProject}>
              <div className="field">
                <label htmlFor="project-name">项目名称</label>
                <input
                  id="project-name"
                  type="text"
                  maxLength={30}
                  value={draft.name}
                  placeholder="例如：深度工作 / 快走 / 读书"
                  onChange={(event) => handleDraftChange('name', event.target.value)}
                />
              </div>

              <div className="field-inline">
                <div className="field">
                  <label htmlFor="project-category">项目类型</label>
                  <CustomSelect
                    id="project-category"
                    value={draft.category}
                    options={CATEGORY_OPTIONS}
                    isOpen={activeSelect === 'create-category'}
                    onToggle={() =>
                      setActiveSelect((current) =>
                        current === 'create-category' ? null : 'create-category',
                      )
                    }
                    onChange={(value) => {
                      handleDraftChange('category', value);
                      setActiveSelect(null);
                    }}
                    onClose={() => setActiveSelect(null)}
                  />
                </div>

                <div className="field">
                  <label htmlFor="project-color">颜色</label>
                  <ColorPickerField
                    value={draft.color}
                    presets={COLOR_OPTIONS as unknown as string[]}
                    isOpen={showCustomDraftColor}
                    onChange={(color) => handleDraftChange('color', color)}
                    onToggle={() => setShowCustomDraftColor((current) => !current)}
                    onClose={() => setShowCustomDraftColor(false)}
                  />
                </div>
              </div>

              <div className="field">
                <label htmlFor="project-target">单次计时目标（分钟）</label>
                <input
                  id="project-target"
                  type="number"
                  min={1}
                  max={480}
                  value={draft.targetMinutes}
                  onChange={(event) =>
                    handleDraftChange('targetMinutes', Number(event.target.value))
                  }
                />
              </div>

              <button className="btn btn-primary" type="submit">
                添加项目
              </button>
            </form>

            <p className="hint">所有项目会同时显示在右侧；任意时刻最多只有一个项目处于计时中。</p>
            <div className="mini-window-note">
              迷你计时窗适合作为桌面小看板的前端原型，它只显示当前项目与实时计时。
            </div>
          </section>

          <OverviewPanel stats={overviewStats} />

          <section className="panel glass">
            <span className="eyebrow">Data Export</span>
            <div className="section-title">
              <h3>导出说明</h3>
            </div>
            <ul className="helper-list">
              <li>
                <strong>计时明细 CSV</strong>：一行一条完整计时记录，适合 Excel、飞书表格、AI 工具分析。
              </li>
              <li>
                <strong>日汇总 CSV</strong>：按日期和项目聚合后的时长，更适合做看板和二次透视。
              </li>
              <li>
                <strong>完整备份 JSON</strong>：导出全部项目、历史记录和当前运行状态，适合本地留档。
              </li>
            </ul>
          </section>
        </aside>

        <main className="stack">
          {state.activeSession?.alertedAt && !state.activeSession.reminderAcknowledgedAt && (
            <ReminderBanner
              projectName={activeProject?.name || '当前项目'}
              elapsed={formatClock(activeElapsedSec)}
              onStop={() => stopActiveSession('manual')}
              onContinue={acknowledgeReminder}
            />
          )}

          <section className="panel glass">
            <span className="eyebrow">Project Timers</span>
            <div className="section-title">
              <h2>全部项目</h2>
              <span className="subtle">最多 1 个项目同时计时，也允许全部空闲</span>
            </div>

            {sortedProjects.length === 0 ? (
              <p className="empty">还没有项目，先在左侧添加一个项目。</p>
            ) : (
              <div className="project-grid">
                {sortedProjects.map((project) => {
                  const isActive = state.activeSession?.projectId === project.id;
                  const todayDuration = getProjectDurationByDate(project.id, state, now, todayKey);
                  const weekDuration = getProjectDurationByDates(project.id, state, now, last7Days);
                  const interruptedCount = getInterruptedCountForProject(project.id, state, last7Days);
                  const completedCount = getCompletedSessionsForProject(project.id, state, last7Days);

                  return (
                    <ProjectCard
                      key={project.id}
                      project={project}
                      isActive={Boolean(isActive)}
                      timerText={formatClock(isActive ? activeElapsedSec : todayDuration)}
                      todayDuration={formatDurationCompact(todayDuration)}
                      weekDuration={formatDurationCompact(weekDuration)}
                      interruptionCount={interruptedCount}
                      completedCount={completedCount}
                      hasRunningSession={Boolean(state.activeSession)}
                      onEdit={openEditProject}
                      onStart={startProject}
                      onStop={() => stopActiveSession('manual')}
                      onDelete={deleteProject}
                    />
                  );
                })}
              </div>
            )}
          </section>

          <SevenDayChart state={state} now={now} />
          <SessionsPanel
            sessions={state.sessions.slice(0, 12)}
            onDeleteSession={deleteSession}
          />
        </main>
      </div>

      {toast && <div className="toast">{toast}</div>}

      {editingProject && (
        <div className="modal-backdrop" onClick={() => setEditingProjectId(null)}>
          <div className="modal-card glass" onClick={(event) => event.stopPropagation()}>
            <div className="section-title">
              <h2>编辑项目</h2>
              <button className="btn btn-secondary" onClick={() => setEditingProjectId(null)}>
                关闭
              </button>
            </div>

            <form className="field-grid" onSubmit={saveProjectEdit}>
              <div className="field">
                <label htmlFor="edit-project-name">项目名称</label>
                <input
                  id="edit-project-name"
                  type="text"
                  maxLength={30}
                  value={editDraft.name}
                  onChange={(event) => handleEditDraftChange('name', event.target.value)}
                />
              </div>

              <div className="field-inline">
                <div className="field">
                  <label htmlFor="edit-project-category">项目类型</label>
                  <CustomSelect
                    id="edit-project-category"
                    value={editDraft.category}
                    options={CATEGORY_OPTIONS}
                    isOpen={activeSelect === 'edit-category'}
                    onToggle={() =>
                      setActiveSelect((current) =>
                        current === 'edit-category' ? null : 'edit-category',
                      )
                    }
                    onChange={(value) => {
                      handleEditDraftChange('category', value);
                      setActiveSelect(null);
                    }}
                    onClose={() => setActiveSelect(null)}
                  />
                </div>

                <div className="field">
                  <label htmlFor="edit-project-target">单次计时目标（分钟）</label>
                  <input
                    id="edit-project-target"
                    type="number"
                    min={1}
                    max={480}
                    value={editDraft.targetMinutes}
                    onChange={(event) =>
                      handleEditDraftChange('targetMinutes', Number(event.target.value))
                    }
                  />
                </div>
              </div>

              <div className="field">
                <label htmlFor="edit-project-color">颜色</label>
                <ColorPickerField
                  value={editDraft.color}
                  presets={COLOR_OPTIONS as unknown as string[]}
                  isOpen={showCustomEditColor}
                  onChange={(color) => handleEditDraftChange('color', color)}
                  onToggle={() => setShowCustomEditColor((current) => !current)}
                  onClose={() => setShowCustomEditColor(false)}
                />
              </div>

              <button className="btn btn-primary" type="submit">
                保存项目
              </button>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};

export default App;

interface CustomSelectProps {
  id: string;
  value: ProjectCategory;
  options: ProjectCategory[];
  isOpen: boolean;
  onToggle: () => void;
  onClose: () => void;
  onChange: (value: ProjectCategory) => void;
}

const CustomSelect: React.FC<CustomSelectProps> = ({
  id,
  value,
  options,
  isOpen,
  onToggle,
  onClose,
  onChange,
}) => {
  const wrapperRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (!wrapperRef.current?.contains(event.target as Node)) {
        onClose();
      }
    }

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [onClose]);

  return (
    <div ref={wrapperRef} className={`custom-select${isOpen ? ' open' : ''}`}>
      <button
        id={id}
        type="button"
        className="custom-select-trigger"
        aria-haspopup="listbox"
        aria-expanded={isOpen}
        onClick={onToggle}
      >
        <span>{value}</span>
        <ChevronDown className={`custom-select-chevron${isOpen ? ' open' : ''}`} size={16} />
      </button>
      {isOpen && (
        <div className="custom-select-menu" role="listbox" aria-labelledby={id}>
          {options.map((option) => (
            <button
              key={option}
              type="button"
              className={`custom-select-option${option === value ? ' active' : ''}`}
              onClick={() => onChange(option)}
            >
              {option}
            </button>
          ))}
        </div>
      )}
    </div>
  );
};

interface ColorPickerFieldProps {
  value: string;
  presets: string[];
  isOpen: boolean;
  onChange: (value: string) => void;
  onToggle: () => void;
  onClose: () => void;
}

const ColorPickerField: React.FC<ColorPickerFieldProps> = ({
  value,
  presets,
  isOpen,
  onChange,
  onToggle,
  onClose,
}) => {
  const wrapperRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (!wrapperRef.current?.contains(event.target as Node)) {
        onClose();
      }
    }

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [onClose]);

  return (
    <div ref={wrapperRef} className="color-picker-group">
      <div className="color-presets">
        {presets.map((color) => (
          <button
            key={color}
            type="button"
            className={`color-chip${value.toLowerCase() === color.toLowerCase() ? ' active' : ''}`}
            style={{ background: color }}
            aria-label={`选择颜色 ${color}`}
            onClick={() => onChange(color)}
          />
        ))}
        <button
          type="button"
          className={`color-custom-toggle${isOpen ? ' active' : ''}`}
          onClick={onToggle}
        >
          自定义
        </button>
      </div>

      <div className="color-custom-row compact">
        <span className="color-custom-preview" style={{ background: value }} />
        <span className="color-value">{value.toUpperCase()}</span>
      </div>

      {isOpen && (
        <div className="color-picker-popover">
          <HexColorPicker color={value} onChange={onChange} />
          <div className="color-picker-footer">
            <span className="color-custom-preview large" style={{ background: value }} />
            <HexColorInput
              color={value}
              onChange={onChange}
              prefixed
              className="color-hex-input"
            />
          </div>
        </div>
      )}
    </div>
  );
};
