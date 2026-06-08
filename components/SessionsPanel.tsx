import React from 'react';
import { Trash2 } from 'lucide-react';
import { TimerSession } from '../types';
import { formatDateTime, formatDurationCompact, formatTime } from '../utils/tempo';

interface SessionsPanelProps {
  sessions: TimerSession[];
  onDeleteSession: (sessionId: string) => void;
}

const SessionsPanel: React.FC<SessionsPanelProps> = ({ sessions, onDeleteSession }) => {
  return (
    <section className="panel glass">
      <span className="eyebrow">Sessions</span>
      <div className="section-title">
        <h2>计时记录</h2>
        <span className="subtle">用于回看开始时间、结束时间、是否达标和是否中断</span>
      </div>

      {sessions.length === 0 ? (
        <p className="empty">还没有历史会话，开始一个项目后这里会自动记录。</p>
      ) : (
        <div className="session-list">
          {sessions.map((session) => (
            <div key={session.id} className="session-item">
              <div>
                <p className="session-title">{session.projectName}</p>
                <p className="session-subtitle">
                  {session.category} · {formatDateTime(session.startAt)} - {formatTime(session.endAt)}
                </p>
              </div>
              <div className="session-metric">{formatDurationCompact(session.durationSec)}</div>
              <span
                className={`badge ${session.interrupted ? 'badge-danger' : 'badge-success'}`}
              >
                {session.interrupted ? '中断' : '达标'}
              </span>
              <button
                type="button"
                className="session-delete"
                aria-label={`删除 ${session.projectName} 会话记录`}
                title="删除这条记录"
                onClick={() => onDeleteSession(session.id)}
              >
                <Trash2 size={14} />
              </button>
            </div>
          ))}
        </div>
      )}
    </section>
  );
};

export default SessionsPanel;
