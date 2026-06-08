import React from 'react';

interface ReminderBannerProps {
  projectName: string;
  elapsed: string;
  onStop: () => void;
  onContinue: () => void;
}

const ReminderBanner: React.FC<ReminderBannerProps> = ({
  projectName,
  elapsed,
  onStop,
  onContinue,
}) => {
  return (
    <section className="banner show">
      <div>
        <p>
          <strong>{projectName}</strong> 已到设定时长，当前已累计 <strong>{elapsed}</strong>。
          你可以手动停止，也可以继续计时后再切换到下一个项目。
        </p>
      </div>
      <div className="banner-actions">
        <button className="btn btn-danger" onClick={onStop}>
          停止当前计时
        </button>
        <button className="btn btn-secondary" onClick={onContinue}>
          继续计时
        </button>
      </div>
    </section>
  );
};

export default ReminderBanner;
