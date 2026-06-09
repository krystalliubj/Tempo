import React from 'react';
import { TimerProject } from '../types';

interface ProjectCardProps {
  project: TimerProject;
  isActive: boolean;
  timerText: string;
  timerLabel: string;
  todayDuration: string;
  weekDuration: string;
  interruptionCount: number;
  completedCount: number;
  hasRunningSession: boolean;
  isDragging: boolean;
  isDragOver: boolean;
  onDragStart: (projectId: string) => void;
  onDragOver: (projectId: string) => void;
  onDrop: (projectId: string) => void;
  onDragEnd: () => void;
  onEdit: (projectId: string) => void;
  onStart: (projectId: string) => void;
  onStop: () => void;
  onDelete: (projectId: string) => void;
}

const ProjectCard: React.FC<ProjectCardProps> = ({
  project,
  isActive,
  timerText,
  timerLabel,
  todayDuration,
  weekDuration,
  interruptionCount,
  completedCount,
  hasRunningSession,
  isDragging,
  isDragOver,
  onDragStart,
  onDragOver,
  onDrop,
  onDragEnd,
  onEdit,
  onStart,
  onStop,
  onDelete,
}) => {
  const buttonLabel = !hasRunningSession ? '开始计时' : isActive ? '停止计时' : '切换到此项目';
  const hasOvertimePrefix = timerText.startsWith('+');
  const rawTimerText = hasOvertimePrefix ? timerText.slice(1) : timerText;
  const parts = rawTimerText.split(':');

  return (
    <article
      className={`project-card${isActive ? ' active' : ''}${isDragging ? ' dragging' : ''}${isDragOver ? ' drag-over' : ''}`}
      draggable
      onDragStart={() => onDragStart(project.id)}
      onDragOver={(event) => {
        event.preventDefault();
        onDragOver(project.id);
      }}
      onDrop={(event) => {
        event.preventDefault();
        onDrop(project.id);
      }}
      onDragEnd={onDragEnd}
    >
      <div className="project-accent" style={{ background: project.color }} />
      <div className="project-top">
        <div>
          <span className="badge">{project.category}</span>
          <h3 className="project-name">{project.name}</h3>
          <div className="project-meta">
            <span>目标 {project.targetMinutes} 分钟</span>
          </div>
        </div>
        <div className="project-top-actions">
          <div className="status-chip project-status">
            <span className={`status-dot${isActive ? ' live' : ''}`} />
            {isActive ? '专注中' : '空闲'}
          </div>
        </div>
      </div>

      <div className="timer-value" aria-label={timerText}>
        {parts.length === 2 || parts.length === 3 ? (
          <>
            {hasOvertimePrefix && <span className="timer-sign">+</span>}
            {parts.map((part, index) => (
              <React.Fragment key={`${part}-${index}`}>
                {index > 0 && <span className="timer-separator">:</span>}
                <span className="timer-group">{part}</span>
              </React.Fragment>
            ))}
          </>
        ) : (
          timerText
        )}
      </div>
      <div className="timer-meta">
        <div className="timer-note">{timerLabel}</div>
        <div className="project-actions">
          <button className="btn btn-secondary" onClick={() => onEdit(project.id)}>
            编辑
          </button>
          <button className="btn btn-secondary" onClick={() => onDelete(project.id)}>
            删除
          </button>
        </div>
      </div>

      <div className="mini-stats">
        <div className="mini-stat">
          <strong>{todayDuration}</strong>
          <span>今日累计</span>
        </div>
        <div className="mini-stat">
          <strong>{weekDuration}</strong>
          <span>最近 7 天</span>
        </div>
        <div className="mini-stat">
          <strong>{interruptionCount}</strong>
          <span>中断次数</span>
        </div>
      </div>

      <div className="mini-stats secondary">
        <div className="mini-stat">
          <strong>{completedCount}</strong>
          <span>达标会话</span>
        </div>
        <div className="mini-stat">
          <strong>{project.category}</strong>
          <span>项目类型</span>
        </div>
        <div className="mini-stat">
          <strong>{project.targetMinutes}m</strong>
          <span>单次目标</span>
        </div>
      </div>

      <div className="card-actions">
        <button
          className={`btn ${isActive ? 'btn-danger' : 'btn-primary'}`}
          onClick={() => (isActive ? onStop() : onStart(project.id))}
        >
          {buttonLabel}
        </button>
      </div>
    </article>
  );
};

export default ProjectCard;
