import React, { useMemo } from 'react';
import { TempoState, TimerProject } from '../types';
import {
  formatDateKey,
  formatDurationCompact,
  formatShortDate,
  getAllSessions,
  getChartProjects,
  getLastNDays,
  getProjectDurationByDate,
} from '../utils/tempo';

interface SevenDayChartProps {
  state: TempoState;
  now: number;
}

const SevenDayChart: React.FC<SevenDayChartProps> = ({ state, now }) => {
  const dateKeys = useMemo(() => getLastNDays(7), []);
  const projects = useMemo(() => getChartProjects(state, now), [state, now]);

  const chartData = useMemo(
    () =>
      dateKeys.map((dateKey) => ({
        dateKey,
        label: formatShortDate(dateKey),
        values: projects.map((project) => ({
          projectId: project.id,
          name: project.name,
          color: project.color,
          durationSec: getProjectDurationByDate(project.id, state, now, dateKey),
        })),
      })),
    [dateKeys, now, projects, state],
  );

  const maxValue = useMemo(() => {
    const currentMax = chartData.reduce((largest, day) => {
      const dayMax = day.values.reduce(
        (valueLargest, item) => Math.max(valueLargest, item.durationSec),
        0,
      );
      return Math.max(largest, dayMax);
    }, 0);

    return Math.max(currentMax, 3600);
  }, [chartData]);

  const summaryMetrics = useMemo(() => {
    const weekDateKeySet = new Set(dateKeys);
    const displayedProjectTotals = projects
      .map((project) => ({
        name: project.name,
        durationSec: dateKeys.reduce(
          (total, dateKey) => total + getProjectDurationByDate(project.id, state, now, dateKey),
          0,
        ),
      }))
      .sort((a, b) => b.durationSec - a.durationSec);
    const highestProject = displayedProjectTotals.find((item) => item.durationSec > 0) || null;

    const weekSessions = getAllSessions(state, now, true).filter((session) =>
      weekDateKeySet.has(formatDateKey(session.endAt)),
    );
    const weekInterruptedCount = weekSessions.filter((session) => session.interrupted).length;
    const longestSession = weekSessions.reduce(
      (longest, session) => (session.durationSec > longest.durationSec ? session : longest),
      weekSessions[0] || null,
    );

    const busiestDay = chartData.reduce(
      (best, day) => {
        const totalDurationSec = day.values.reduce((total, item) => total + item.durationSec, 0);
        if (totalDurationSec > best.totalDurationSec) {
          return {
            dateKey: day.dateKey,
            totalDurationSec,
          };
        }
        return best;
      },
      { dateKey: '', totalDurationSec: 0 },
    );

    return [
      {
        label: '最高时长项目',
        value: highestProject ? highestProject.name : '暂无',
      },
      {
        label: '本周中断次数',
        value: String(weekInterruptedCount),
      },
      {
        label: '最长单次专注',
        value: longestSession ? formatDurationCompact(longestSession.durationSec) : '0m',
      },
      {
        label: '最活跃日期',
        value:
          busiestDay.totalDurationSec > 0
            ? `${formatShortDate(busiestDay.dateKey)} · ${formatDurationCompact(busiestDay.totalDurationSec)}`
            : '暂无',
      },
    ];
  }, [chartData, dateKeys, now, projects, state]);

  return (
    <section className="panel glass">
      <span className="eyebrow">7-Day View</span>
      <div className="section-title">
        <h2>最近 7 天项目时长</h2>
        <span className="subtle">分组柱状图，按项目类型展示</span>
      </div>

      <div className="chart-legend">
        {projects.map((project) => (
          <span key={project.id} className="legend-item">
            <span className="legend-dot" style={{ background: project.color }} />
            {project.name}
          </span>
        ))}
      </div>

      <div className="chart-wrap">
        <GroupedBarSvg chartData={chartData} maxValue={maxValue} projects={projects} />
      </div>

      <div className="chart-summary">
        {summaryMetrics.map((metric) => (
          <SummaryPill key={metric.label} label={metric.label} value={metric.value} />
        ))}
      </div>
    </section>
  );
};

interface GroupedBarSvgProps {
  chartData: Array<{
    dateKey: string;
    label: string;
    values: Array<{
      projectId: string;
      name: string;
      color: string;
      durationSec: number;
    }>;
  }>;
  maxValue: number;
  projects: TimerProject[];
}

const GroupedBarSvg: React.FC<GroupedBarSvgProps> = ({ chartData, maxValue, projects }) => {
  const chartWidth = Math.max(760, chartData.length * Math.max(120, projects.length * 34 + 44));
  const chartHeight = 320;
  const margin = { top: 16, right: 16, bottom: 48, left: 56 };
  const innerWidth = chartWidth - margin.left - margin.right;
  const innerHeight = chartHeight - margin.top - margin.bottom;
  const slotWidth = innerWidth / Math.max(chartData.length, 1);
  const barGap = 6;
  const barWidth = projects.length
    ? Math.max(10, Math.min(22, (slotWidth - 24 - (projects.length - 1) * barGap) / projects.length))
    : 18;

  return (
    <svg width={chartWidth} height={chartHeight} role="img" aria-label="最近 7 天项目时长柱状图">
      {Array.from({ length: 5 }, (_, index) => {
        const yRatio = index / 4;
        const y = margin.top + innerHeight - innerHeight * yRatio;
        const labelValue = Math.round(((maxValue * yRatio) / 3600) * 10) / 10;

        return (
          <React.Fragment key={`grid-${index}`}>
            <line
              x1={margin.left}
              y1={y}
              x2={chartWidth - margin.right}
              y2={y}
              stroke="#e2e8f0"
              strokeDasharray="4 6"
            />
            <text x={margin.left - 10} y={y + 4} textAnchor="end" fontSize="12" fill="#94a3b8">
              {labelValue}h
            </text>
          </React.Fragment>
        );
      })}

      {chartData.map((day, dayIndex) => {
        const groupX = margin.left + dayIndex * slotWidth + 12;
        const textX = groupX + ((day.values.length * (barWidth + barGap) - barGap) || 24) / 2;

        return (
          <React.Fragment key={day.dateKey}>
            {day.values.map((item, itemIndex) => {
              const height = item.durationSec ? (item.durationSec / maxValue) * innerHeight : 0;
              const x = groupX + itemIndex * (barWidth + barGap);
              const y = margin.top + innerHeight - height;

              return (
                <g key={`${day.dateKey}-${item.projectId}`}>
                  <rect
                    x={x}
                    y={y}
                    width={barWidth}
                    height={Math.max(height, 1)}
                    rx={8}
                    fill={item.color}
                  >
                    <title>
                      {day.dateKey} | {item.name} | {formatDurationCompact(item.durationSec)}
                    </title>
                  </rect>
                </g>
              );
            })}

            <text
              x={textX}
              y={chartHeight - 18}
              textAnchor="middle"
              fontSize="12"
              fill="#64748b"
            >
              {day.label}
            </text>
          </React.Fragment>
        );
      })}
    </svg>
  );
};

const SummaryPill: React.FC<{ label: string; value: string }> = ({ label, value }) => {
  return (
    <div className="summary-pill">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
};

export default SevenDayChart;
