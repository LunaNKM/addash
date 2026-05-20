import React from 'react';
import type { InsightDoc } from '@/lib/types';

export function InsightSection({ insights, isAdmin, onGenerate }: {
  insights: InsightDoc[];
  isAdmin: boolean;
  onGenerate: () => void;
}) {
  const latest = insights[0];
  return (
    <section className="section">
      <div className="section-head">
        <b>AI 인사이트</b>
        {isAdmin && <button className="btn outline" onClick={onGenerate}>인사이트 생성</button>}
      </div>
      <div className="insight-box">
        {latest
          ? <div className="insight-content">{latest.text.split('\n').map((line, index) => <React.Fragment key={index}>{line}<br /></React.Fragment>)}</div>
          : <span className="muted">관리자가 생성한 인사이트가 여기에 표시됩니다.</span>}
      </div>
    </section>
  );
}
