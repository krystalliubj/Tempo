import React from 'react';

interface ReminderBannerProps {
  projectName: string;
  overtime: string;
  onStop: () => void;
  onContinue: () => void;
}

const ReminderBanner: React.FC<ReminderBannerProps> = ({
  projectName,
  overtime,
  onStop,
  onContinue,
}) => {
  return (
    <section className="banner show">
      <div>
        <p>
          <strong>{projectName}</strong> 已到设定时长，当前已超时 <strong>{overtime}</strong>。
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
