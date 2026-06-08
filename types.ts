export type ProjectCategory = '专注' | '运动' | '学习' | '休息' | '自定义';

export type SessionStopReason = 'manual' | 'switch' | 'active';

export interface TimerProject {
  id: string;
  name: string;
  category: ProjectCategory;
  color: string;
  targetMinutes: number;
  createdAt: number;
}

export interface TimerSession {
  id: string;
  projectId: string;
  projectName: string;
  category: ProjectCategory;
  color: string;
  startAt: number;
  endAt: number;
  durationSec: number;
  targetMinutes: number;
  reachedTarget: boolean;
  interrupted: boolean;
  stopReason: SessionStopReason;
}

export interface ActiveSession {
  id: string;
  projectId: string;
  startAt: number;
  targetMinutes: number;
  alertedAt: number | null;
  lastReminderAt: number | null;
  reminderStage: number;
  reminderAcknowledgedAt: number | null;
}

export interface TempoState {
  projects: TimerProject[];
  sessions: TimerSession[];
  activeSession: ActiveSession | null;
}

export interface SessionSegment {
  dateKey: string;
  projectId: string;
  projectName: string;
  category: ProjectCategory;
  durationSec: number;
}

export interface DailyProjectRow {
  date: string;
  projectId: string;
  projectName: string;
  category: ProjectCategory;
  durationSec: number;
  interruptedCount: number;
  reachedTargetCount: number;
}
