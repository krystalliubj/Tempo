import { TempoState, TimerSession } from '../types';
import {
  CATEGORY_OPTIONS,
  clampMinutes,
  normalizeColor,
  STORAGE_BACKUP_KEY,
  STORAGE_KEY,
  buildDailyProjectRows,
  createDefaultState,
  formatClock,
  formatDateTime,
} from '../utils/tempo';

const MIGRATION_SOURCE_KEYS = ['tempo-react-v2'] as const;

export function loadTempoState(): TempoState {
  const primaryState = readStoredTempoState(STORAGE_KEY);
  if (primaryState) {
    return primaryState;
  }

  const backupState = readStoredTempoState(STORAGE_BACKUP_KEY);
  if (backupState) {
    saveTempoState(backupState);
    return backupState;
  }

  for (const key of MIGRATION_SOURCE_KEYS) {
    const migratedState = readStoredTempoState(key);
    if (migratedState) {
      saveTempoState(migratedState);
      return migratedState;
    }
  }

  return createDefaultState();
}

function readStoredTempoState(storageKey: string): TempoState | null {
  try {
    const raw = localStorage.getItem(storageKey);
    if (!raw) {
      return null;
    }

    return normalizeTempoState(JSON.parse(raw) as Partial<TempoState>);
  } catch (error) {
    console.error(`Failed to read Tempo state from ${storageKey}:`, error);
    return null;
  }
}

export function saveTempoState(state: TempoState): void {
  const serialized = JSON.stringify(state);
  localStorage.setItem(STORAGE_KEY, serialized);
  localStorage.setItem(STORAGE_BACKUP_KEY, serialized);
}

export function exportSessionsCsv(sessions: TimerSession[]): void {
  const rows = [
    [
      'session_id',
      'project_id',
      'project_name',
      'category',
      'start_time',
      'end_time',
      'duration_seconds',
      'duration_hms',
      'target_minutes',
      'reached_target',
      'interrupted',
      'stop_reason',
    ],
    ...sessions
      .slice()
      .reverse()
      .map((session) => [
        session.id,
        session.projectId,
        session.projectName,
        session.category,
        formatDateTime(session.startAt),
        formatDateTime(session.endAt),
        String(session.durationSec),
        formatClock(session.durationSec),
        String(session.targetMinutes),
        session.reachedTarget ? 'true' : 'false',
        session.interrupted ? 'true' : 'false',
        session.stopReason,
      ]),
  ];

  downloadCsv(`tempo_sessions_${createDateStamp()}.csv`, rows);
}

export function exportDailySummaryCsv(state: TempoState): void {
  const rows = [
    [
      'date',
      'project_id',
      'project_name',
      'category',
      'duration_seconds',
      'duration_hms',
      'interrupted_count',
      'reached_target_count',
    ],
    ...buildDailyProjectRows(state).map((row) => [
      row.date,
      row.projectId,
      row.projectName,
      row.category,
      String(row.durationSec),
      formatClock(row.durationSec),
      String(row.interruptedCount),
      String(row.reachedTargetCount),
    ]),
  ];

  downloadCsv(`tempo_daily_summary_${createDateStamp()}.csv`, rows);
}

export function exportJsonBackup(state: TempoState): void {
  const payload = {
    exportedAt: new Date().toISOString(),
    version: 1,
    ...state,
  };

  downloadFile(
    `tempo_backup_${createDateStamp()}.json`,
    JSON.stringify(payload, null, 2),
    'application/json;charset=utf-8',
  );
}

export function importJsonBackup(file: File): Promise<TempoState> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const raw = String(reader.result || '');
        resolve(normalizeTempoState(JSON.parse(raw) as Partial<TempoState>));
      } catch (error) {
        reject(error);
      }
    };

    reader.onerror = () => reject(reader.error);
    reader.readAsText(file, 'utf-8');
  });
}

function downloadCsv(filename: string, rows: string[][]): void {
  const csv = rows.map((row) => row.map(csvEscape).join(',')).join('\r\n');
  downloadFile(filename, `\ufeff${csv}`, 'text/csv;charset=utf-8');
}

function downloadFile(filename: string, content: string, mimeType: string): void {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  window.setTimeout(() => URL.revokeObjectURL(url), 500);
}

function csvEscape(value: string): string {
  return `"${String(value).replace(/"/g, '""')}"`;
}

function createDateStamp(): string {
  const date = new Date();
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}${month}${day}`;
}

function normalizeTempoState(parsed: Partial<TempoState>): TempoState {
  if (!Array.isArray(parsed.projects) || !Array.isArray(parsed.sessions)) {
    throw new Error('Invalid backup shape');
  }

  return {
    projects: parsed.projects.map((project) => ({
      ...project,
      category: CATEGORY_OPTIONS.includes(project.category) ? project.category : '自定义',
      color: normalizeColor(project.color),
      targetMinutes: clampMinutes(project.targetMinutes),
    })),
    sessions: parsed.sessions.map((session) => ({
      ...session,
      category: CATEGORY_OPTIONS.includes(session.category) ? session.category : '自定义',
      color: normalizeColor(session.color),
      targetMinutes: clampMinutes(session.targetMinutes),
    })),
    activeSession:
      parsed.activeSession && parsed.activeSession.projectId
        ? {
            ...parsed.activeSession,
            targetMinutes: clampMinutes(parsed.activeSession.targetMinutes),
            alertedAt: parsed.activeSession.alertedAt ?? null,
            lastReminderAt: parsed.activeSession.lastReminderAt ?? null,
            reminderStage: parsed.activeSession.reminderStage ?? -1,
            reminderAcknowledgedAt: parsed.activeSession.reminderAcknowledgedAt ?? null,
          }
        : null,
  };
}
