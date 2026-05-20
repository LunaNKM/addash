import type { StatRow } from '@/lib/types';
import { sortDetailRows, sortOptions } from '@/lib/dashUtils';
import { DetailTable } from './DetailTable';

export function DailyDetailSection({ rows, sort, setSort, open, setOpen }: {
  rows: StatRow[];
  sort: string;
  setSort: (v: string) => void;
  open: boolean;
  setOpen: (v: boolean) => void;
}) {
  const sorted = sortDetailRows(rows, sort);
  const maxCtr = Math.max(0, ...sorted.map(row => row.ctr));
  return (
    <section className="section">
      <div className="section-head">
        <b>일자별 상세 데이터</b>
        <select value={sort} onChange={event => setSort(event.target.value)}>
          {sortOptions(['spend', 'impression', 'ctr', 'cpc']).map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
        </select>
      </div>
      <button className="collapse" onClick={() => setOpen(!open)}>{open ? '일자별 상세 데이터 접기' : '일자별 상세 데이터 펼치기'}</button>
      {open && <DetailTable rows={sorted} maxCtr={maxCtr} />}
    </section>
  );
}
