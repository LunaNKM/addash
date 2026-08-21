'use client';

import { useEffect, useState } from 'react';
import type { InsightDoc } from '@/lib/types';
import { NoteHistoryButton } from './NoteHistoryModal';
import { RichText, RichTextEditor } from './RichText';

/** 관리자가 직접 적는 인사이트. 굵게는 Ctrl+B(⌘B)로 지정한 부분에만 적용된다. */
export function InsightSection({ insights, isAdmin, busy, brandId, tabId, historyKey, onSave }: {
  insights: InsightDoc[];
  isAdmin: boolean;
  busy: string;
  brandId: string;
  tabId: string;
  /** 저장할 때마다 값이 바뀌어 캘린더 이력을 다시 읽게 한다. */
  historyKey: number;
  onSave: (text: string) => Promise<void> | void;
}) {
  const latest = insights[0];
  const [editing, setEditing] = useState(false);

  // 탭을 옮기면 편집 상태를 닫고 그 탭에 저장된 내용으로 되돌린다.
  useEffect(() => {
    setEditing(false);
  }, [latest?.id]);

  if (!isAdmin && !latest?.text) return null;

  return (
    <section className="section">
      <div className="section-head">
        <b>
          인사이트
          <NoteHistoryButton brandId={brandId} tabId={tabId} kind="insight" title="인사이트" refreshKey={historyKey} />
        </b>
        {isAdmin && !editing && (
          <button className="btn outline" disabled={Boolean(busy)} onClick={() => setEditing(true)}>
            {latest?.text ? '수정' : '작성'}
          </button>
        )}
      </div>

      {editing ? (
        <RichTextEditor
          initialText={latest?.text || ''}
          placeholder="이번 기간 성과에 대해 공유할 내용을 적어주세요."
          busy={busy}
          onCancel={() => setEditing(false)}
          onSave={async text => {
            await onSave(text);
            setEditing(false);
          }}
        />
      ) : (
        <div className="insight-box">
          {latest?.text
            ? <RichText text={latest.text} className="insight-content" />
            : <span className="muted">관리자가 작성한 인사이트가 여기에 표시됩니다.</span>}
        </div>
      )}
    </section>
  );
}
