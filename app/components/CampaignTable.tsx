import type { StatRow } from '@/lib/types';
import { sortOptions, sortRows } from '@/lib/dashUtils';
import { SimpleTable } from './SimpleTable';

export function CampaignTable({ rows, open, setOpen, sort, setSort }: {
  rows: StatRow[];
  open: boolean;
  setOpen: (v: boolean) => void;
  sort: string;
  setSort: (v: string) => void;
}) {
  const sorted = sortRows(rows, sort).slice(0, 300);
  return (
    <section className="section">
      <div className="section-head">
        <b>캠페인별 데이터</b>
        <select value={sort} onChange={event => setSort(event.target.value)}>
          {sortOptions(['spend', 'impression', 'ctr']).map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
        </select>
      </div>
      <button className="collapse" onClick={() => setOpen(!open)}>{open ? '캠페인별 데이터 접기' : '캠페인별 데이터 펼치기'}</button>
      {open && <SimpleTable rows={sorted} columns={['campaignAdsetAd', 'spend', 'impression', 'click', 'landingPageView', 'ctr', 'linkCtr', 'cpm', 'cpc', 'roas']} />}
    </section>
  );
}
