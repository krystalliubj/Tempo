import {
  ActiveSession,
  DailyProjectRow,
  ProjectCategory,
  SessionSegment,
  TempoState,
  TimerProject,
  TimerSession,
} from '../types';

export const STORAGE_KEY = 'tempo-react';
export const STORAGE_BACKUP_KEY = 'tempo-react-backup';

export const CATEGORY_OPTIONS: ProjectCategory[] = ['专注', '运动', '学习', '休息', '自定义'];

export const COLOR_OPTIONS = [
  '#6366f1',
  '#8b5cf6',
  '#ec4899',
  '#f97316',
  '#10b981',
  '#3b82f6',
] as const;

export function createId(): string {
  return `id-${Math.random().toString(36).slice(2, 10)}-${Date.now().toString(36)}`;
}

export function createDefaultProjects(): TimerProject[] {
  return [
    {
      id: createId(),
      name: '专注工作',
      category: '专注',
      color: '#6366f1',
      targetMinutes: 45,
      createdAt: Date.now() - 1000,
    },
    {
      id: createId(),
      name: '活动一下',
      category: '运动',
      color: '#10b981',
      targetMinutes: 10,
      createdAt: Date.now() - 2000,
    },
  ];
}

export function createDefaultState(): TempoState {
  return {
    projects: createDefaultProjects(),
    sessions: [],
    activeSession: null,
  };
}

export function clampMinutes(value: number, fallback = 25): number {
  if (!Number.isFinite(value)) {
    return fallback;
  }

  return Math.min(480, Math.max(1, Math.round(value)));
}

export function normalizeColor(value: string): string {
  return /^#[0-9a-fA-F]{6}$/.test(value) ? value : '#6366f1';
}

export function formatDateKey(timestamp: number): string {
  const date = new Date(timestamp);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function formatShortDate(dateKey: string): string {
  const parts = dateKey.split('-');
  return `${parts[1]}/${parts[2]}`;
}

export function formatDateTime(timestamp: number): string {
  const date = new Date(timestamp);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');
  const seconds = String(date.getSeconds()).padStart(2, '0');
  return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`;
}

export function formatTime(timestamp: number): string {
  const date = new Date(timestamp);
  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');
  const seconds = String(date.getSeconds()).padStart(2, '0');
  return `${hours}:${minutes}:${seconds}`;
}

export function formatClock(totalSeconds: number): string {
  const seconds = Math.max(0, Math.floor(totalSeconds));
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const remain = seconds % 60;
  return [
    String(hours).padStart(2, '0'),
    String(minutes).padStart(2, '0'),
    String(remain).padStart(2, '0'),
  ].join(':');
}

export function formatAdaptiveClock(totalSeconds: number): string {
  const seconds = Math.max(0, Math.floor(totalSeconds));
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const remain = seconds % 60;

  if (hours > 0) {
    return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(remain).padStart(2, '0')}`;
  }

  return `${String(minutes).padStart(2, '0')}:${String(remain).padStart(2, '0')}`;
}

export function formatCountdownClock(targetMinutes: number, elapsedSec: number): string {
  const targetSeconds = Math.max(0, Math.round(targetMinutes * 60));
  const diffSeconds = targetSeconds - Math.max(0, Math.floor(elapsedSec));

  if (diffSeconds >= 0) {
    return formatAdaptiveClock(diffSeconds);
  }

  return `+${formatAdaptiveClock(Math.abs(diffSeconds))}`;
}

export function getCountdownMeta(targetMinutes: number, elapsedSec: number): {
  timerText: string;
  timerLabel: string;
} {
  const targetSeconds = Math.max(0, Math.round(targetMinutes * 60));
  const safeElapsed = Math.max(0, Math.floor(elapsedSec));

  if (safeElapsed > targetSeconds) {
    return {
      timerText: `+${formatAdaptiveClock(safeElapsed - targetSeconds)}`,
      timerLabel: '已超时',
    };
  }

  return {
    timerText: formatAdaptiveClock(targetSeconds - safeElapsed),
    timerLabel: '剩余时间',
  };
}

export function formatDurationCompact(totalSeconds: number): string {
  const seconds = Math.max(0, Math.round(totalSeconds));
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);

  if (hours > 0) {
    return `${hours}h ${String(minutes).padStart(2, '0')}m`;
  }

  return `${minutes}m`;
}

export function getLastNDays(days: number): string[] {
  return Array.from({ length: days }, (_, index) => {
    const date = new Date();
    date.setHours(0, 0, 0, 0);
    date.setDate(date.getDate() - (days - 1 - index));
    return formatDateKey(date.getTime());
  });
}

export function getActiveElapsedSec(activeSession: ActiveSession | null, now: number): number {
  if (!activeSession) {
    return 0;
  }

  return Math.max(1, Math.round((now - activeSession.startAt) / 1000));
}

export function getProjectById(projects: TimerProject[], projectId: string): TimerProject | null {
  return projects.find((project) => project.id === projectId) || null;
}

export function createSessionFromActive(
  activeSession: ActiveSession,
  project: TimerProject | null,
  endAt: number,
  stopReason: TimerSession['stopReason'],
): TimerSession {
  const durationSec = Math.max(1, Math.round((endAt - activeSession.startAt) / 1000));
  const targetSec = activeSession.targetMinutes * 60;
  const reachedTarget = targetSec === 0 ? true : durationSec >= targetSec;

  return {
    id: activeSession.id,
    projectId: activeSession.projectId,
    projectName: project?.name || '已删除项目',
    category: project?.category || '自定义',
    color: project?.color || '#94a3b8',
    startAt: activeSession.startAt,
    endAt,
    durationSec,
    targetMinutes: activeSession.targetMinutes,
    reachedTarget,
    interrupted: !reachedTarget,
    stopReason,
  };
}

export function getAllSessions(
  state: TempoState,
  now: number,
  includeActive: boolean,
): TimerSession[] {
  if (!includeActive || !state.activeSession) {
    return state.sessions;
  }

  const project = getProjectById(state.projects, state.activeSession.projectId);
  return [
    createSessionFromActive(state.activeSession, project, now, 'active'),
    ...state.sessions,
  ];
}

export function getSessionSegments(session: TimerSession): SessionSegment[] {
  const start = Number(session.startAt);
  const end = Number(session.endAt);

  if (!(start > 0) || !(end > start)) {
    return [];
  }

  const segments: SessionSegment[] = [];
  let cursor = start;

  while (cursor < end) {
    const current = new Date(cursor);
    const nextDay = new Date(
      current.getFullYear(),
      current.getMonth(),
      current.getDate() + 1,
    ).getTime();
    const segmentEnd = Math.min(end, nextDay);
    segments.push({
      dateKey: formatDateKey(cursor),
      projectId: session.projectId,
      projectName: session.projectName,
      category: session.category,
      durationSec: Math.round((segmentEnd - cursor) / 1000),
    });
    cursor = segmentEnd;
  }

  return segments;
}

export function getProjectDurationByDate(
  projectId: string,
  state: TempoState,
  now: number,
  dateKey: string,
): number {
  return getAllSessions(state, now, true).reduce((total, session) => {
    if (session.projectId !== projectId) {
      return total;
    }

    return (
      total +
      getSessionSegments(session).reduce(
        (segmentTotal, segment) => segmentTotal + (segment.dateKey === dateKey ? segment.durationSec : 0),
        0,
      )
    );
  }, 0);
}

export function getProjectDurationByDates(
  projectId: string,
  state: TempoState,
  now: number,
  dateKeys: string[],
): number {
  return dateKeys.reduce(
    (total, dateKey) => total + getProjectDurationByDate(projectId, state, now, dateKey),
    0,
  );
}

export function getTotalDurationByDate(state: TempoState, now: number, dateKey: string): number {
  return getAllSessions(state, now, true).reduce((total, session) => {
    return (
      total +
      getSessionSegments(session).reduce(
        (segmentTotal, segment) => segmentTotal + (segment.dateKey === dateKey ? segment.durationSec : 0),
        0,
      )
    );
  }, 0);
}

export function getCategoryDuration(
  state: TempoState,
  now: number,
  dateKeys: string[],
  category: ProjectCategory,
): number {
  const keyMap = new Set(dateKeys);

  return getAllSessions(state, now, true).reduce((total, session) => {
    if (session.category !== category) {
      return total;
    }

    return (
      total +
      getSessionSegments(session).reduce(
        (segmentTotal, segment) =>
          segmentTotal + (keyMap.has(segment.dateKey) ? segment.durationSec : 0),
        0,
      )
    );
  }, 0);
}

export function getInterruptedCountByDate(state: TempoState, dateKey: string): number {
  return state.sessions.filter(
    (session) => session.interrupted && formatDateKey(session.endAt) === dateKey,
  ).length;
}

export function getInterruptedCountForProject(
  projectId: string,
  state: TempoState,
  dateKeys: string[],
): number {
  const keyMap = new Set(dateKeys);
  return state.sessions.filter(
    (session) =>
      session.projectId === projectId &&
      session.interrupted &&
      keyMap.has(formatDateKey(session.endAt)),
  ).length;
}

export function getCompletedSessionsForProject(
  projectId: string,
  state: TempoState,
  dateKeys: string[],
): number {
  const keyMap = new Set(dateKeys);
  return state.sessions.filter(
    (session) =>
      session.projectId === projectId &&
      session.reachedTarget &&
      keyMap.has(formatDateKey(session.endAt)),
  ).length;
}

export function getChartProjects(state: TempoState, now: number): TimerProject[] {
  const dateKeys = getLastNDays(7);
  const projects = state.projects.filter((project) => {
    const hasRecentData = dateKeys.some(
      (dateKey) => getProjectDurationByDate(project.id, state, now, dateKey) > 0,
    );

    return hasRecentData || state.activeSession?.projectId === project.id;
  });

  return (projects.length ? projects : state.projects).slice(0, 10);
}

export function buildDailyProjectRows(state: TempoState): DailyProjectRow[] {
  const dailyMap = new Map<string, DailyProjectRow>();

  state.sessions.forEach((session) => {
    getSessionSegments(session).forEach((segment) => {
      const key = `${segment.dateKey}|${segment.projectId}`;
      const current =
        dailyMap.get(key) ||
        ({
          date: segment.dateKey,
          projectId: segment.projectId,
          projectName: segment.projectName,
          category: segment.category,
          durationSec: 0,
          interruptedCount: 0,
          reachedTargetCount: 0,
        } satisfies DailyProjectRow);

      current.durationSec += segment.durationSec;
      dailyMap.set(key, current);
    });

    const stopKey = `${formatDateKey(session.endAt)}|${session.projectId}`;
    const aggregate =
      dailyMap.get(stopKey) ||
      ({
        date: formatDateKey(session.endAt),
        projectId: session.projectId,
        projectName: session.projectName,
        category: session.category,
        durationSec: 0,
        interruptedCount: 0,
        reachedTargetCount: 0,
      } satisfies DailyProjectRow);

    if (session.interrupted) {
      aggregate.interruptedCount += 1;
    }

    if (session.reachedTarget) {
      aggregate.reachedTargetCount += 1;
    }

    dailyMap.set(stopKey, aggregate);
  });

  return Array.from(dailyMap.values()).sort((a, b) => {
    if (a.date === b.date) {
      return a.projectName.localeCompare(b.projectName, 'zh-CN');
    }

    return a.date.localeCompare(b.date);
  });
}
