'use client';

import React, { useEffect, useState } from 'react';
import type { InsightDoc } from '@/lib/types';

/** 관리자가 직접 적는 인사이트. 저장하면 공유 링크에서도 같은 내용이 보인다. */
export function InsightSection({ insights, isAdmin, busy, onSave }: {
  insights: InsightDoc[];
  isAdmin: boolean;
  busy: string;
  onSave: (text: string) => Promise<void> | void;
}) {
  const latest = insights[0];
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(latest?.text || '');

  // 탭을 옮기면 그 탭에 저장된 내용으로 초안을 되돌린다.
  useEffect(() => {
    setDraft(latest?.text || '');
    setEditing(false);
  }, [latest?.id, latest?.text]);

  if (!isAdmin && !latest?.text) return null;

  return (
    <section className="section">
      <div className="section-head">
        <b>인사이트</b>
        {isAdmin && !editing && (
          <button className="btn outline" disabled={Boolean(busy)} onClick={() => { setDraft(latest?.text || ''); setEditing(true); }}>
            {latest?.text ? '수정' : '작성'}
          </button>
        )}
      </div>

      {editing ? (
        <div className="report-comment-editor">
          <textarea
            value={draft}
            placeholder="이번 기간 성과에 대해 공유할 내용을 적어주세요."
            onChange={event => setDraft(event.target.value)}
          />
          <div className="modal-actions">
            <button className="btn outline" disabled={Boolean(busy)} onClick={() => { setDraft(latest?.text || ''); setEditing(false); }}>
              취소
            </button>
            <button className="btn brand" disabled={Boolean(busy)} onClick={async () => { await onSave(draft); setEditing(false); }}>
              저장
            </button>
          </div>
        </div>
      ) : (
        <div className="insight-box">
          {latest?.text
            ? <div className="insight-content">{latest.text.split('\n').map((line, index) => <React.Fragment key={index}>{line}<br /></React.Fragment>)}</div>
            : <span className="muted">관리자가 작성한 인사이트가 여기에 표시됩니다.</span>}
        </div>
      )}
    </section>
  );
}
