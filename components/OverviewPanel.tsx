import React from 'react';

interface OverviewStat {
  label: string;
  value: string;
  note: string;
}

interface OverviewPanelProps {
  stats: OverviewStat[];
}

const OverviewPanel: React.FC<OverviewPanelProps> = ({ stats }) => {
  return (
    <section className="panel glass">
      <span className="eyebrow">Overview</span>
      <div className="section-title">
        <h3>当前状态</h3>
      </div>
      <div className="stats-grid">
        {stats.map((stat) => (
          <div key={stat.label} className="stat-card">
            <div className="stat-label">{stat.label}</div>
            <div className="stat-value">{stat.value}</div>
            <div className="stat-note">{stat.note}</div>
          </div>
        ))}
      </div>
    </section>
  );
};

export default OverviewPanel;
