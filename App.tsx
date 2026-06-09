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
  importJsonBackup,
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
  formatAdaptiveClock,
  formatClock,
  formatCountdownClock,
  formatDateKey,
  formatDurationCompact,
  getActiveElapsedSec,
  getCategoryDuration,
  getCompletedSessionsForProject,
  getCountdownMeta,
  getInterruptedCountByDate,
  getInterruptedCountForProject,
  getLastNDays,
  getProjectById,
  getProjectDurationByDate,
  getProjectDurationByDates,
  getTotalDurationByDate,
  normalizeColor,
} from './utils/tempo';

const REMINDER_STAGE_DELAYS_SEC = [0, 60, 180, 300, 600] as const;
const REMINDER_STAGE_LABELS = ['到点', '1 分钟', '3 分钟', '5 分钟', '10 分钟'] as const;

interface MiniWindowPayload {
  sessionId: string | null;
  projectName: string;
  statusText: string;
  startAt: number | null;
  targetMinutes: number;
  reminderStage: number;
}

type TempoWindow = Window &
  typeof globalThis & {
    __tempoMiniHandleReminder?: (stage: number) => void;
  };

type MiniWindowHandle = TempoWindow &
  typeof globalThis & {
    __tempoMiniReady?: boolean;
    __tempoMiniUpdate?: (payload: MiniWindowPayload) => void;
  };

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
  const [draggingProjectId, setDraggingProjectId] = useState<string | null>(null);
  const [dragOverProjectId, setDragOverProjectId] = useState<string | null>(null);

  const toastTimerRef = useRef<number | null>(null);
  const reminderAudioRef = useRef<HTMLAudioElement | null>(null);
  const miniWindowRef = useRef<Window | null>(null);
  const importInputRef = useRef<HTMLInputElement | null>(null);

  const todayKey = formatDateKey(now);
  const last7Days = getLastNDays(7);
  const activeProject = state.activeSession
    ? getProjectById(state.projects, state.activeSession.projectId)
    : null;
  const activeElapsedSec = getActiveElapsedSec(state.activeSession, now);
  const activeCountdown = activeProject
    ? getCountdownMeta(activeProject.targetMinutes, activeElapsedSec)
    : null;
  const activeOvertime = activeProject
    ? formatAdaptiveClock(Math.max(0, activeElapsedSec - activeProject.targetMinutes * 60))
    : '00:00';
  const miniWindowPayload = useMemo<MiniWindowPayload>(
    () => ({
      sessionId: state.activeSession?.id ?? null,
      projectName: activeProject?.name || '当前空闲',
      statusText: state.activeSession ? activeProject?.category || '专注' : '等待开始',
      startAt: state.activeSession?.startAt ?? null,
      targetMinutes: activeProject?.targetMinutes || 0,
      reminderStage: state.activeSession?.reminderStage ?? -1,
    }),
    [
      activeProject?.category,
      activeProject?.name,
      activeProject?.targetMinutes,
      state.activeSession?.id,
      state.activeSession?.reminderStage,
      state.activeSession,
    ],
  );

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
    if (targetSec <= 0) {
      return;
    }

    const overdueSec = activeElapsedSec - targetSec;
    if (overdueSec < 0) {
      return;
    }

    let dueStage = -1;
    REMINDER_STAGE_DELAYS_SEC.forEach((delaySec, index) => {
      if (overdueSec >= delaySec) {
        dueStage = index;
      }
    });

    if (dueStage > state.activeSession.reminderStage) {
      triggerReminder(dueStage);
    }
  }, [activeElapsedSec, activeProject?.name, state.activeSession]);

  useEffect(() => {
    syncMiniWindow();
  }, [miniWindowPayload]);

  useEffect(() => {
    const hostWindow = window as TempoWindow;
    hostWindow.__tempoMiniHandleReminder = (stage: number) => {
      triggerReminder(stage, {
        playSound: false,
        showSystemNotification: false,
      });
    };

    return () => {
      delete hostWindow.__tempoMiniHandleReminder;
    };
  }, [activeProject?.name, state.activeSession?.id, state.activeSession?.reminderStage]);

  useEffect(() => {
    const audio = new Audio('/sounds/universfield-new-notification-036-485897.mp3');
    audio.preload = 'auto';
    reminderAudioRef.current = audio;

    return () => {
      if (toastTimerRef.current) {
        window.clearTimeout(toastTimerRef.current);
      }
      if (reminderAudioRef.current) {
        reminderAudioRef.current.pause();
        reminderAudioRef.current.src = '';
        reminderAudioRef.current = null;
      }
      closeMiniWindow();
    };
  }, []);

  const overviewStats = useMemo(() => {
    const todayDuration = getTotalDurationByDate(state, now, todayKey);
    const todayInterruptions = getInterruptedCountByDate(state, todayKey);
    const weekTotalDuration = last7Days.reduce(
      (total, dateKey) => total + getTotalDurationByDate(state, now, dateKey),
      0,
    );
    const weekDateKeySet = new Set(last7Days);
    const weekCompletedCount = state.sessions.filter(
      (session) => session.reachedTarget && weekDateKeySet.has(formatDateKey(session.endAt)),
    ).length;

    return [
      {
        label: '状态',
        value: state.activeSession ? '专注中' : '空闲',
        note: activeProject ? activeProject.name : '当前没有运行中的项目',
      },
      {
        label: '当前计时',
        value: state.activeSession && activeCountdown ? activeCountdown.timerText : '--:--:--',
        note: state.activeSession && activeCountdown
          ? `目标 ${activeProject?.targetMinutes || 0} 分钟`
          : '可以从任意项目开始',
      },
      {
        label: '今日累计',
        value: formatDurationCompact(todayDuration),
        note: '真实项目时间累计',
      },
      {
        label: '今日中断',
        value: String(todayInterruptions),
        note: todayInterruptions ? '未达目标即结束次数' : '今天还没有中断',
      },
      {
        label: '本周总时长',
        value: formatDurationCompact(weekTotalDuration),
        note: '最近 7 天',
      },
      {
        label: '本周达标次数',
        value: String(weekCompletedCount),
        note: '最近 7 天',
      },
    ];
  }, [activeCountdown, activeElapsedSec, activeProject, last7Days, now, state, todayKey]);

  const sortedProjects = useMemo(() => state.projects, [state.projects]);

  const editingProject = editingProjectId
    ? getProjectById(state.projects, editingProjectId)
    : null;

  function triggerReminder(
    stage: number,
    options: {
      playSound?: boolean;
      showSystemNotification?: boolean;
    } = {},
  ) {
    const { playSound: shouldPlaySound = true, showSystemNotification = true } = options;
    const triggeredAt = Date.now();
    setState((current) => {
      if (!current.activeSession || stage <= current.activeSession.reminderStage) {
        return current;
      }

      return {
        ...current,
        activeSession: {
          ...current.activeSession,
          alertedAt: current.activeSession.alertedAt ?? triggeredAt,
          lastReminderAt: triggeredAt,
          reminderStage: stage,
        },
      };
    });

    const name = activeProject?.name || '当前项目';
    showToast(getReminderToast(name, stage));
    if (shouldPlaySound) {
      playReminder();
    }

    if (showSystemNotification && 'Notification' in window) {
      if (Notification.permission === 'granted') {
        void new Notification('Tempo 计时到点', {
          body: getReminderToast(name, stage),
        });
      } else if (Notification.permission === 'default') {
        void Notification.requestPermission();
      }
    }
  }

  function getReminderToast(projectName: string, stage: number) {
    if (stage === 0) {
      return `${projectName} 已到设定时间，请停止当前计时或继续专注。`;
    }

    const stageLabel = REMINDER_STAGE_LABELS[stage] || `${stage} 阶段`;
    return `${projectName} 已超时 ${stageLabel}，请确认是否继续当前计时。`;
  }

  function playReminder() {
    const audio = reminderAudioRef.current;
    if (audio) {
      audio.pause();
      audio.currentTime = 0;
      audio.volume = 0.92;
      void audio.play().catch((error) => {
        console.warn('Reminder audio file not available, using fallback tone:', error);
        playReminderFallback();
      });
      return;
    }

    playReminderFallback();
  }

  function playReminderFallback() {
    try {
      const AudioContextClass = window.AudioContext || (window as typeof window & {
        webkitAudioContext?: typeof AudioContext;
      }).webkitAudioContext;

      if (!AudioContextClass) {
        return;
      }

      const context = new AudioContextClass();
      const pattern = [
        { delay: 0, duration: 0.22, frequency: 880, peak: 0.15 },
        { delay: 0.4, duration: 0.22, frequency: 880, peak: 0.14 },
        { delay: 0.8, duration: 0.26, frequency: 932, peak: 0.15 },
      ];

      pattern.forEach(({ delay, duration, frequency, peak }) => {
        const oscillator = context.createOscillator();
        const gainNode = context.createGain();
        oscillator.connect(gainNode);
        gainNode.connect(context.destination);
        oscillator.type = 'triangle';
        oscillator.frequency.value = frequency;
        gainNode.gain.value = 0.0001;
        oscillator.start(context.currentTime + delay);
        gainNode.gain.exponentialRampToValueAtTime(
          peak,
          context.currentTime + delay + 0.03,
        );
        gainNode.gain.exponentialRampToValueAtTime(
          0.0001,
          context.currentTime + delay + duration,
        );
        oscillator.stop(context.currentTime + delay + duration + 0.04);
      });

      const totalDuration =
        pattern[pattern.length - 1].delay + pattern[pattern.length - 1].duration + 0.12;
      window.setTimeout(() => {
        void context.close().catch(() => undefined);
      }, totalDuration * 1000);
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

  async function handleImportBackup(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = '';

    if (!file) {
      return;
    }

    try {
      const importedState = await importJsonBackup(file);
      setState(importedState);
      setEditingProjectId(null);
      setActiveSelect(null);
      setShowCustomDraftColor(false);
      setShowCustomEditColor(false);
      showToast('备份已导入，本地数据已恢复。');
    } catch (error) {
      console.error('Failed to import backup:', error);
      showToast('导入失败，请选择 Tempo 导出的 JSON 备份文件。');
    }
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
          lastReminderAt: null,
          reminderStage: -1,
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

  function handleProjectDragStart(projectId: string) {
    setDraggingProjectId(projectId);
    setDragOverProjectId(projectId);
  }

  function handleProjectDragOver(projectId: string) {
    if (!draggingProjectId || draggingProjectId === projectId) {
      return;
    }

    setDragOverProjectId(projectId);
  }

  function handleProjectDrop(targetProjectId: string) {
    if (!draggingProjectId || draggingProjectId === targetProjectId) {
      setDraggingProjectId(null);
      setDragOverProjectId(null);
      return;
    }

    setState((current) => {
      const sourceIndex = current.projects.findIndex((project) => project.id === draggingProjectId);
      const targetIndex = current.projects.findIndex((project) => project.id === targetProjectId);

      if (sourceIndex === -1 || targetIndex === -1) {
        return current;
      }

      const nextProjects = [...current.projects];
      const [movedProject] = nextProjects.splice(sourceIndex, 1);
      nextProjects.splice(targetIndex, 0, movedProject);

      return {
        ...current,
        projects: nextProjects,
      };
    });

    setDraggingProjectId(null);
    setDragOverProjectId(null);
  }

  function handleProjectDragEnd() {
    setDraggingProjectId(null);
    setDragOverProjectId(null);
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

  function ensureMiniWindowShell(popup: MiniWindowHandle) {
    if (popup.__tempoMiniReady) {
      return;
    }

    popup.document.open();
    popup.document.write(`
      <!doctype html>
      <html lang="zh-CN">
        <head>
          <meta charset="UTF-8" />
          <meta name="viewport" content="width=device-width, initial-scale=1.0" />
          <title>Tempo Mini</title>
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
              letter-spacing: -0.02em;
              font-variant-numeric: tabular-nums;
              font-feature-settings: "tnum" 1, "lnum" 1;
              font-family: Inter, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif;
            }
          </style>
        </head>
        <body>
          <div class="mini-shell">
            <div class="mini-topbar">
              <span class="mini-label">Tempo Mini</span>
            </div>
            <h1 class="mini-name" id="mini-name">当前空闲</h1>
            <p class="mini-status" id="mini-status">等待开始</p>
            <div class="mini-time" id="mini-time">--:--:--</div>
          </div>
          <script>
            (function () {
              var payload = {
                sessionId: null,
                projectName: '当前空闲',
                statusText: '等待开始',
                startAt: null,
                targetMinutes: 0,
                reminderStage: -1
              };
              var reminderStageDelays = ${JSON.stringify([...REMINDER_STAGE_DELAYS_SEC])};
              var reminderStageLabels = ${JSON.stringify([...REMINDER_STAGE_LABELS])};
              var nameNode = document.getElementById('mini-name');
              var statusNode = document.getElementById('mini-status');
              var timeNode = document.getElementById('mini-time');
              var reminderAudio = null;
              var localReminderStage = -1;
              var titleTimer = null;
              var baseTitle = 'Tempo Mini';

              function formatAdaptiveClock(totalSeconds) {
                var seconds = Math.max(0, Math.floor(totalSeconds));
                var hours = Math.floor(seconds / 3600);
                var minutes = Math.floor((seconds % 3600) / 60);
                var remain = seconds % 60;

                if (hours > 0) {
                  return hours + ':' + String(minutes).padStart(2, '0') + ':' + String(remain).padStart(2, '0');
                }

                return String(minutes).padStart(2, '0') + ':' + String(remain).padStart(2, '0');
              }

              function formatCountdownClock(targetMinutes, elapsedSec) {
                var targetSeconds = Math.max(0, Math.round(targetMinutes * 60));
                var diffSeconds = targetSeconds - Math.max(0, Math.floor(elapsedSec));

                if (diffSeconds >= 0) {
                  return formatAdaptiveClock(diffSeconds);
                }

                return '+' + formatAdaptiveClock(Math.abs(diffSeconds));
              }

              function getDueStage(targetMinutes, elapsedSec) {
                var targetSeconds = Math.max(0, Math.round(targetMinutes * 60));
                var overdueSec = Math.max(0, Math.floor(elapsedSec) - targetSeconds);
                if (targetSeconds <= 0 || overdueSec < 0) {
                  return -1;
                }

                var dueStage = -1;
                reminderStageDelays.forEach(function (delaySec, index) {
                  if (overdueSec >= delaySec) {
                    dueStage = index;
                  }
                });
                return dueStage;
              }

              function getReminderText(projectName, stage) {
                if (stage === 0) {
                  return projectName + ' 已到设定时间，请停止当前计时或继续专注。';
                }

                var stageLabel = reminderStageLabels[stage] || (stage + ' 阶段');
                return projectName + ' 已超时 ' + stageLabel + '，请确认是否继续当前计时。';
              }

              function flashTitle(reminderText) {
                if (titleTimer) {
                  window.clearInterval(titleTimer);
                }

                var highlighted = false;
                titleTimer = window.setInterval(function () {
                  document.title = highlighted ? baseTitle : '提醒: ' + reminderText;
                  highlighted = !highlighted;
                }, 900);

                window.setTimeout(function () {
                  if (titleTimer) {
                    window.clearInterval(titleTimer);
                    titleTimer = null;
                  }
                  document.title = baseTitle;
                }, 6000);
              }

              function playReminderFallback() {
                try {
                  var AudioContextClass = window.AudioContext || window.webkitAudioContext;
                  if (!AudioContextClass) {
                    return;
                  }

                  var context = new AudioContextClass();
                  var pattern = [
                    { delay: 0, duration: 0.22, frequency: 880, peak: 0.15 },
                    { delay: 0.4, duration: 0.22, frequency: 880, peak: 0.14 },
                    { delay: 0.8, duration: 0.26, frequency: 932, peak: 0.15 }
                  ];

                  pattern.forEach(function (item) {
                    var oscillator = context.createOscillator();
                    var gainNode = context.createGain();
                    oscillator.connect(gainNode);
                    gainNode.connect(context.destination);
                    oscillator.type = 'triangle';
                    oscillator.frequency.value = item.frequency;
                    gainNode.gain.value = 0.0001;
                    oscillator.start(context.currentTime + item.delay);
                    gainNode.gain.exponentialRampToValueAtTime(
                      item.peak,
                      context.currentTime + item.delay + 0.03
                    );
                    gainNode.gain.exponentialRampToValueAtTime(
                      0.0001,
                      context.currentTime + item.delay + item.duration
                    );
                    oscillator.stop(context.currentTime + item.delay + item.duration + 0.04);
                  });

                  var totalDuration = pattern[pattern.length - 1].delay + pattern[pattern.length - 1].duration + 0.12;
                  window.setTimeout(function () {
                    if (context && typeof context.close === 'function') {
                      context.close().catch(function () {
                        return undefined;
                      });
                    }
                  }, totalDuration * 1000);
                } catch (error) {
                  console.warn('Mini reminder audio not available:', error);
                }
              }

              function playReminderSound() {
                if (!reminderAudio) {
                  reminderAudio = new Audio('/sounds/universfield-new-notification-036-485897.mp3');
                  reminderAudio.preload = 'auto';
                }

                reminderAudio.pause();
                reminderAudio.currentTime = 0;
                reminderAudio.volume = 0.92;
                reminderAudio.play().catch(function () {
                  playReminderFallback();
                });
              }

              function notifyHost(stage) {
                try {
                  if (
                    window.opener &&
                    !window.opener.closed &&
                    typeof window.opener.__tempoMiniHandleReminder === 'function'
                  ) {
                    window.opener.__tempoMiniHandleReminder(stage);
                  }
                } catch (error) {
                  console.warn('Mini reminder cannot sync to opener:', error);
                }
              }

              function triggerMiniReminder(stage) {
                var reminderText = getReminderText(payload.projectName, stage);
                playReminderSound();
                flashTitle(reminderText);

                if ('Notification' in window) {
                  if (Notification.permission === 'granted') {
                    new Notification('Tempo 计时到点', {
                      body: reminderText
                    });
                  } else if (Notification.permission === 'default') {
                    Notification.requestPermission();
                  }
                }

                notifyHost(stage);
              }

              function render() {
                if (!nameNode || !statusNode || !timeNode) {
                  return;
                }

                nameNode.textContent = payload.projectName;
                statusNode.textContent = payload.statusText;

                if (!payload.startAt) {
                  localReminderStage = -1;
                  document.title = baseTitle;
                  timeNode.textContent = '--:--:--';
                  return;
                }

                var elapsedSec = Math.max(1, Math.round((Date.now() - payload.startAt) / 1000));
                timeNode.textContent = formatCountdownClock(payload.targetMinutes, elapsedSec);

                var knownStage = Math.max(localReminderStage, payload.reminderStage);
                var dueStage = getDueStage(payload.targetMinutes, elapsedSec);
                if (dueStage > knownStage) {
                  localReminderStage = dueStage;
                  triggerMiniReminder(dueStage);
                }
              }

              window.__tempoMiniUpdate = function (nextPayload) {
                var isNewSession = payload.sessionId !== nextPayload.sessionId;
                payload = nextPayload;
                localReminderStage = isNewSession
                  ? nextPayload.reminderStage
                  : Math.max(localReminderStage, nextPayload.reminderStage);
                document.title = baseTitle;
                render();
              };

              render();
              window.setInterval(render, 250);
            })();
          <\/script>
        </body>
      </html>
    `);
    popup.document.close();
    popup.__tempoMiniReady = true;
  }

  function syncMiniWindow() {
    const popup = miniWindowRef.current as MiniWindowHandle | null;
    if (!popup || popup.closed) {
      miniWindowRef.current = null;
      return;
    }

    ensureMiniWindowShell(popup);
    popup.document.title = 'Tempo Mini';
    popup.__tempoMiniUpdate?.(miniWindowPayload);

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
              多项目计时看板，量化每日真实专注时长。
            </p>
          </div>
        </div>

        <div className="toolbar">
          <button className="btn btn-primary toolbar-main-action" onClick={openMiniWindow}>
            打开迷你计时窗
          </button>
          <input
            ref={importInputRef}
            type="file"
            accept="application/json,.json"
            style={{ display: 'none' }}
            onChange={handleImportBackup}
          />
        </div>
      </header>

      <div className="layout">
        <aside className="stack">
          <section className="panel glass">
            <span className="eyebrow">Create Project</span>
            <div className="section-title">
              <h2>新增计时</h2>
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

            <p className="hint">任意时刻最多只有一个项目处于计时中</p>
            <div className="mini-window-note">
              迷你计时窗可作为悬浮窗使用，只显示当前计时项目。
            </div>
          </section>

          <OverviewPanel stats={overviewStats} />

          <section className="panel glass">
            <span className="eyebrow">Data Export</span>
            <div className="section-title">
              <h3>数据迁移</h3>
            </div>
            <div className="data-actions">
              <button
                className="btn btn-secondary"
                onClick={() => importInputRef.current?.click()}
              >
                导入备份
              </button>
              <button className="btn btn-secondary" onClick={() => exportSessionsCsv(state.sessions)}>
                导出计时明细
              </button>
              <button className="btn btn-secondary" onClick={() => exportDailySummaryCsv(state)}>
                导出日汇总
              </button>
              <button className="btn btn-secondary" onClick={() => exportJsonBackup(state)}>
                导出完整备份
              </button>
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
          {state.activeSession?.lastReminderAt &&
            (!state.activeSession.reminderAcknowledgedAt ||
              state.activeSession.reminderAcknowledgedAt < state.activeSession.lastReminderAt) && (
            <ReminderBanner
              projectName={activeProject?.name || '当前项目'}
              overtime={activeOvertime}
              onStop={() => stopActiveSession('manual')}
              onContinue={acknowledgeReminder}
            />
          )}

          <section className="panel glass">
            <span className="eyebrow">Project Timers</span>
            <div className="section-title">
              <h2>全部项目</h2>
              <span className="subtle">单项目计时模式，每次只专注一件事，也允许全部空闲</span>
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
                      isDragging={draggingProjectId === project.id}
                      isDragOver={dragOverProjectId === project.id && draggingProjectId !== project.id}
                      timerText={
                        isActive
                          ? formatCountdownClock(project.targetMinutes, activeElapsedSec)
                          : formatAdaptiveClock(todayDuration)
                      }
                      timerLabel={
                        isActive
                          ? getCountdownMeta(project.targetMinutes, activeElapsedSec).timerLabel
                          : '今日累计'
                      }
                      todayDuration={formatDurationCompact(todayDuration)}
                      weekDuration={formatDurationCompact(weekDuration)}
                      interruptionCount={interruptedCount}
                      completedCount={completedCount}
                      hasRunningSession={Boolean(state.activeSession)}
                      onDragStart={handleProjectDragStart}
                      onDragOver={handleProjectDragOver}
                      onDrop={handleProjectDrop}
                      onDragEnd={handleProjectDragEnd}
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
            sessions={state.sessions}
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
