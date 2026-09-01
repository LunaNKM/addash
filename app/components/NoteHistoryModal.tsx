'use client';

import { useEffect, useMemo, useState } from 'react';
import { kstDateKey, listNoteHistory } from '@/lib/store';
import type { NoteHistoryDoc, NoteHistoryKind } from '@/lib/types';
import { RichText } from './RichText';

const WEEKDAYS = ['일', '월', '화', '수', '목', '금', '토'];

/** 인사이트 / Comment 제목 옆에 붙는 캘린더 버튼. 누르면 작성 이력 모달이 열린다. */
export function NoteHistoryButton({ brandId, tabId, kind, title, refreshKey }: {
  brandId: string;
  tabId: string;
  kind: NoteHistoryKind;
  title: string;
  /** 저장 직후 값이 바뀌면 이력을 다시 불러온다. */
  refreshKey?: number;
}) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        type="button"
        className="note-history-btn"
        title={`${title} 작성 이력`}
        aria-label={`${title} 작성 이력`}
        onClick={() => setOpen(true)}
      >
        <CalendarIcon />
      </button>
      {open && (
        <NoteHistoryModal
          brandId={brandId}
          tabId={tabId}
          kind={kind}
          title={title}
          refreshKey={refreshKey}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  );
}

function NoteHistoryModal({ brandId, tabId, kind, title, refreshKey, onClose }: {
  brandId: string;
  tabId: string;
  kind: NoteHistoryKind;
  title: string;
  refreshKey?: number;
  onClose: () => void;
}) {
  const [entries, setEntries] = useState<NoteHistoryDoc[] | null>(null);
  const [error, setError] = useState('');
  const [cursor, setCursor] = useState(() => monthKey(kstDateKey()));
  const [selected, setSelected] = useState('');

  useEffect(() => {
    let alive = true;
    setEntries(null);
    listNoteHistory(brandId, tabId, kind)
      .then(list => {
        if (!alive) return;
        setEntries(list);
        const latest = list[0];
        if (latest) {
          setCursor(monthKey(latest.date));
          setSelected(latest.date);
        }
      })
      .catch(err => {
        if (alive) setError(err instanceof Error ? err.message : String(err));
      });
    return () => { alive = false; };
  }, [brandId, tabId, kind, refreshKey]);

  const byDate = useMemo(() => {
    const map = new Map<string, NoteHistoryDoc>();
    (entries || []).forEach(entry => map.set(entry.date, entry));
    return map;
  }, [entries]);

  const cells = useMemo(() => monthCells(cursor), [cursor]);
  const picked = selected ? byDate.get(selected) : undefined;

  // 배경을 눌러 닫는다. (모달 안쪽 클릭은 무시)
  return (
    <div className="modal" role="dialog" aria-modal="true" aria-label={`${title} 작성 이력`} onClick={onClose}>
      <div className="modal-card note-history-card" onClick={event => event.stopPropagation()}>
        <h3>{title} 작성 이력</h3>
        <span className="muted">점이 찍힌 날짜를 누르면 그날 저장한 내용을 볼 수 있습니다.</span>

        <div className="note-history-nav">
          <button className="btn ghost" type="button" onClick={() => setCursor(shiftMonth(cursor, -1))}>‹</button>
          <b>{cursor.slice(0, 4)}년 {Number(cursor.slice(5, 7))}월</b>
          <button className="btn ghost" type="button" onClick={() => setCursor(shiftMonth(cursor, 1))}>›</button>
        </div>

        <div className="note-history-grid">
          {WEEKDAYS.map(day => <span className="note-history-weekday" key={day}>{day}</span>)}
          {cells.map((date, index) => {
            if (!date) return <span className="note-history-cell blank" key={`blank-${index}`} />;
            const has = byDate.has(date);
            const classes = ['note-history-cell'];
            if (has) classes.push('has');
            if (date === selected) classes.push('active');
            if (date === kstDateKey()) classes.push('today');
            return (
              <button
                type="button"
                className={classes.join(' ')}
                key={date}
                disabled={!has}
                onClick={() => setSelected(date)}
              >
                <em>{Number(date.slice(8, 10))}</em>
                {has && <i className="note-history-dot" />}
              </button>
            );
          })}
        </div>

        {error && <div className="warn">{error}</div>}

        <div className="note-history-view">
          {entries === null ? (
            <span className="muted">이력을 불러오는 중입니다...</span>
          ) : picked ? (
            <>
              <div className="note-history-view-head">
                <b>{formatDate(picked.date)}</b>
                {picked.periodStart && picked.periodEnd && (
                  <span className="muted">데이터 기간 {picked.periodStart} ~ {picked.periodEnd}</span>
                )}
              </div>
              <RichText text={picked.text} className="note-history-content" lineClassName="note-history-line" />
            </>
          ) : (
            <span className="muted">
              {entries.length ? '날짜를 선택하면 그날 작성한 내용이 표시됩니다.' : '아직 저장된 작성 이력이 없습니다.'}
            </span>
          )}
        </div>

        <div className="modal-actions">
          <button className="btn outline" type="button" onClick={onClose}>닫기</button>
        </div>
      </div>
    </div>
  );
}

function CalendarIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <rect x="1.75" y="2.75" width="12.5" height="11.5" rx="2" stroke="currentColor" strokeWidth="1.3" />
      <path d="M1.75 6.25h12.5" stroke="currentColor" strokeWidth="1.3" />
      <path d="M5.25 1.5v2.2M10.75 1.5v2.2" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
      <circle cx="5.4" cy="9.4" r="0.95" fill="currentColor" />
      <circle cx="10.6" cy="9.4" r="0.95" fill="currentColor" />
    </svg>
  );
}

/* ------------------------------------------------------------------ 날짜 계산 */

function monthKey(date: string): string {
  return date.slice(0, 7) || kstDateKey().slice(0, 7);
}

function shiftMonth(cursor: string, delta: number): string {
  const year = Number(cursor.slice(0, 4));
  const month = Number(cursor.slice(5, 7)) - 1 + delta;
  const next = new Date(Date.UTC(year, month, 1));
  return next.toISOString().slice(0, 7);
}

/** 앞쪽 빈칸을 포함한 한 달치 칸. 빈칸은 빈 문자열이다. */
function monthCells(cursor: string): string[] {
  const year = Number(cursor.slice(0, 4));
  const month = Number(cursor.slice(5, 7)) - 1;
  const first = new Date(Date.UTC(year, month, 1));
  const days = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  const cells: string[] = Array.from({ length: first.getUTCDay() }, () => '');
  for (let day = 1; day <= days; day += 1) {
    cells.push(`${cursor}-${String(day).padStart(2, '0')}`);
  }
  return cells;
}

function formatDate(date: string): string {
  return `${date.slice(0, 4)}년 ${Number(date.slice(5, 7))}월 ${Number(date.slice(8, 10))}일 작성`;
}
