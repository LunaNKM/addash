import { AD_PLATFORM_LABELS, type AdPlatform, type FileDoc, type StatRow } from '@/lib/types';
import { formatCount, formatDateWithDay, formatRate, formatRatio, formatWon } from '@/lib/format';
import type { DashboardBundle } from '@/lib/dashUtils';

export type PlatformBundle = {
  platform: AdPlatform;
  files: FileDoc[];
  data: DashboardBundle;
};

type Column = {
  /** 표에 보여줄 이름. 기존 대시보드 명칭이 있으면 그것을, 없으면 매체 원본 헤더명을 쓴다. */
  label: string;
  /** 원본 export의 헤더명(툴팁). */
  title?: string;
  value: (row: StatRow) => string;
};

const metaColumns: Column[] = [
  { label: '광고비', value: row => formatWon(row.spend) },
  { label: '노출', value: row => formatCount(row.impression) },
  { label: '링크클릭', value: row => formatCount(row.click) },
  { label: 'LP 조회', value: row => formatCount(row.landingPageView) },
  { label: 'CTR', value: row => formatRate(row.ctr) },
  { label: 'CPM', value: row => formatWon(row.cpm) },
  { label: 'CPC', value: row => formatWon(row.cpc) },
  { label: 'ROAS', value: row => formatRatio(row.roas) }
];

/** 보고서 탭 'X 성과' 표와 같은 헤더 구성. */
const xColumns: Column[] = [
  { label: '노출', title: 'Impressions', value: row => formatCount(row.impression) },
  { label: '도달', title: 'Reach', value: row => formatCount(row.reach || 0) },
  { label: '평균 빈도', title: 'Average frequency', value: row => formatRatio(frequency(row)) },
  { label: '광고비', title: 'Spend', value: row => formatWon(row.spend) },
  { label: '클릭', title: 'Link clicks', value: row => formatCount(row.click) },
  { label: '좋아요', title: 'Likes', value: row => formatCount(row.likes || 0) },
  { label: '댓글', title: 'Replies', value: row => formatCount(row.replies || 0) },
  { label: '리포스트', title: 'Reposts', value: row => formatCount(row.reposts || 0) },
  { label: '팔로우', title: 'Follows', value: row => formatCount(row.follows || 0) },
  { label: 'CTR', title: 'CTR', value: row => formatRate(row.ctr) },
  { label: 'CPM', title: 'CPM', value: row => formatWon(row.cpm) },
  { label: 'CPC', title: 'Cost per link click', value: row => formatWon(row.cpc) },
  { label: 'CPE', title: 'Cost per engagement', value: row => formatWon(cpe(row)) }
];

/** Google Ads 광고 보고서 헤더 기준. 기존 명칭이 있는 열(광고비·노출·CPM)만 기존 이름을 쓴다. */
const youtubeColumns: Column[] = [
  { label: '광고비', title: '비용', value: row => formatWon(row.spend) },
  { label: '노출', title: '노출수', value: row => formatCount(row.impression) },
  { label: '상호작용 수', title: '상호작용 수', value: row => formatCount(row.click) },
  { label: '상호작용 발생률', title: '상호작용 발생률', value: row => formatRate(row.ctr) },
  { label: '평균 비용', title: '평균 비용', value: row => formatWon(row.cpc) },
  { label: 'CPM', title: '평균 CPM', value: row => formatWon(row.cpm) },
  { label: 'TrueView 평균 CPV', title: 'TrueView 평균 CPV', value: row => formatWon(row.cpv || 0) }
];

const columnsByPlatform: Record<AdPlatform, Column[]> = {
  meta: metaColumns,
  x: xColumns,
  youtube: youtubeColumns
};

/** 매체별 요약 카드. 표의 앞쪽 지표를 그대로 쓴다. */
const summaryByPlatform: Record<AdPlatform, string[]> = {
  meta: ['광고비', '노출', '링크클릭', 'CTR', 'CPM', 'CPC'],
  x: ['광고비', '노출', '도달', '평균 빈도', 'CPM', 'CPE'],
  youtube: ['광고비', '노출', '상호작용 수', '상호작용 발생률', 'CPM', 'TrueView 평균 CPV']
};

function frequency(row: StatRow): number {
  const reach = Number(row.reach || 0);
  return reach ? row.impression / reach : 0;
}

function cpe(row: StatRow): number {
  const engagements = Number(row.engagements || 0);
  return engagements ? row.spend / engagements : 0;
}

function dateLabel(row: StatRow): string {
  return row.date ? formatDateWithDay(row.date) : '기간 전체';
}

export function PlatformSections({ bundles }: { bundles: PlatformBundle[] }) {
  if (!bundles.length) return null;
  return (
    <>
      {bundles.map(bundle => <PlatformSection key={bundle.platform} bundle={bundle} />)}
    </>
  );
}

function PlatformSection({ bundle }: { bundle: PlatformBundle }) {
  const columns = columnsByPlatform[bundle.platform];
  const summaryLabels = summaryByPlatform[bundle.platform];
  const sorted = [...bundle.data.dailyStats].sort((a, b) => String(a.date || '').localeCompare(String(b.date || '')));
  // 날짜 열이 없는 export(기간 전체 한 줄)는 합계 행과 내용이 같아 일자 행을 접는다.
  const rows = sorted.length === 1 && !sorted[0].date ? [] : sorted;
  const total = bundle.data.total;
  const dated = sorted.map(row => row.date).filter(Boolean) as string[];
  const range = dated.length ? `${dated[0]} ~ ${dated[dated.length - 1]}` : '기간 전체';

  return (
    <section className="section">
      <div className="section-head">
        <b>{AD_PLATFORM_LABELS[bundle.platform]} 성과</b>
        <span className="muted">{bundle.files.length}개 파일 · {range}</span>
      </div>

      <div className="report-stat-grid">
        {columns
          .filter(column => summaryLabels.includes(column.label))
          .map(column => (
            <div className="report-stat-card" key={column.label}>
              <small>{column.label}</small>
              <b>{column.value(total)}</b>
            </div>
          ))}
      </div>

      <div className="table-wrap sticky-detail">
        <table className="promotion-performance-table x-performance-table">
          <thead>
            <tr>
              <th>일자</th>
              {columns.map(column => <th key={column.label} title={column.title}>{column.label}</th>)}
            </tr>
          </thead>
          <tbody>
            <tr className="report-total-row">
              <td>합계</td>
              {columns.map(column => <td key={column.label}>{column.value(total)}</td>)}
            </tr>
            {rows.map(row => (
              <tr key={row.key || row.date || 'all'}>
                <td>{dateLabel(row)}</td>
                {columns.map(column => <td key={column.label}>{column.value(row)}</td>)}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
