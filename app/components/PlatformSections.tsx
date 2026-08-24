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
  /** 업로드 파일에서 이 열을 어느 헤더로 읽었는지 찾을 때 쓰는 지표 키. */
  metric?: string;
  value: (row: StatRow) => string;
};

/**
 * 원본 헤더명 중 대시보드에 이미 쓰는 명칭이 있는 것만 바꿔 부른다.
 * (없는 것은 헤더명을 그대로 쓴다 — 예: 상호작용 수, 클릭수, TrueView 평균 CPV)
 */
const EXISTING_NAMES: Record<string, string> = {
  '비용': '광고비',
  '노출수': '노출',
  '평균 CPM': 'CPM',
  '평균 CPC': 'CPC',
  '클릭률(CTR)': 'CTR'
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

/** X 광고 관리자 export 기준. 인게이지먼트 중심으로 본다. */
const xColumns: Column[] = [
  { label: '광고비', title: 'Spend', value: row => formatWon(row.spend) },
  { label: 'IMP', title: 'Impressions (노출)', value: row => formatCount(row.impression) },
  { label: 'ENG', title: 'Engagements (인게이지먼트, 광고비 ÷ Cost per engagement)', value: row => formatCount(row.engagements || 0) },
  { label: 'ER', title: 'Engagement rate (ENG ÷ IMP)', value: row => formatRate(engagementRate(row)) },
  { label: 'CPM', title: 'CPM', value: row => formatWon(row.cpm) },
  { label: 'CPE', title: 'Cost per engagement', value: row => formatWon(cpe(row)) },
  { label: '프로필방문', title: 'Profile visits', value: row => formatCount(row.profileVisits || 0) }
];

/** Google Ads 광고 보고서 헤더 기준. 기존 명칭이 있는 열(광고비·노출·CPM)만 기존 이름을 쓴다. */
const youtubeColumns: Column[] = [
  { label: '광고비', title: '비용', metric: 'spend', value: row => formatWon(row.spend) },
  { label: '노출', title: '노출수', metric: 'impression', value: row => formatCount(row.impression) },
  { label: '클릭수', title: '클릭수 / 상호작용 수', metric: 'click', value: row => formatCount(row.click) },
  { label: 'CTR', title: '클릭률(CTR) / 상호작용 발생률', metric: 'ctr', value: row => formatRate(row.ctr) },
  { label: 'CPC', title: '평균 CPC / 평균 비용', metric: 'cpc', value: row => formatWon(row.cpc) },
  { label: 'CPM', title: '평균 CPM', metric: 'cpm', value: row => formatWon(row.cpm) },
  { label: 'TrueView 평균 CPV', title: 'TrueView 평균 CPV', metric: 'cpv', value: row => formatWon(row.cpv || 0) }
];

const columnsByPlatform: Record<AdPlatform, Column[]> = {
  meta: metaColumns,
  x: xColumns,
  youtube: youtubeColumns
};

/** 매체별 요약 카드. 표의 앞쪽 지표를 그대로 쓴다. */
const summaryByPlatform: Record<AdPlatform, string[]> = {
  meta: ['광고비', '노출', '링크클릭', 'CTR', 'CPM', 'CPC'],
  x: ['광고비', 'IMP', 'ENG', 'ER', 'CPM', 'CPE'],
  youtube: ['광고비', '노출', '클릭수', 'CTR', 'CPM', 'TrueView 평균 CPV']
};

/** 인게이지먼트 발생률. 노출 대비 인게이지먼트 비율을 퍼센트로 돌려준다. */
function engagementRate(row: StatRow): number {
  return row.impression ? (Number(row.engagements || 0) / row.impression) * 100 : 0;
}

function cpe(row: StatRow): number {
  const engagements = Number(row.engagements || 0);
  return engagements ? row.spend / engagements : 0;
}

/** 업로드한 파일이 실제로 쓴 헤더명으로 열 이름을 맞춘다. 파일마다 다르면 둘 다 보여준다. */
function columnLabel(column: Column, files: FileDoc[]): { label: string; title?: string } {
  if (!column.metric) return { label: column.label, title: column.title };
  const headers = Array.from(new Set(files.map(file => file.sourceLabels?.[column.metric!]).filter(Boolean) as string[]));
  if (!headers.length) return { label: column.label, title: column.title };
  return {
    label: Array.from(new Set(headers.map(header => EXISTING_NAMES[header] || header))).join(' / '),
    title: headers.join(' / ')
  };
}

/**
 * X·YouTube 합계는 보고서 탭 X 표와 같이 합계에서 다시 계산한다.
 * (클릭 없이 비용만 나간 행이 있으면 가중평균 CPC가 광고 관리자 숫자와 어긋난다)
 * Meta는 CTR(전체)처럼 원본 열을 그대로 써야 하는 지표가 있어 기존 가중평균을 유지한다.
 */
function derivedTotal(rows: StatRow[], fallback: StatRow): StatRow {
  if (!rows.length) return fallback;
  const sum = rows.reduce((acc, row) => {
    acc.spend += row.spend;
    acc.impression += row.impression;
    acc.click += row.click;
    acc.landingPageView += row.landingPageView;
    acc.reach += Number(row.reach || 0);
    acc.likes += Number(row.likes || 0);
    acc.replies += Number(row.replies || 0);
    acc.reposts += Number(row.reposts || 0);
    acc.follows += Number(row.follows || 0);
    acc.engagements += Number(row.engagements || 0);
    acc.profileVisits += Number(row.profileVisits || 0);
    acc.cpvWeighted += Number(row.cpv || 0) * row.impression;
    return acc;
  }, {
    spend: 0, impression: 0, click: 0, landingPageView: 0,
    reach: 0, likes: 0, replies: 0, reposts: 0, follows: 0, engagements: 0, profileVisits: 0, cpvWeighted: 0
  });

  return {
    key: fallback.key,
    spend: sum.spend,
    impression: sum.impression,
    click: sum.click,
    landingPageView: sum.landingPageView,
    ctr: ratio(sum.click * 100, sum.impression),
    cpm: ratio(sum.spend * 1000, sum.impression),
    cpc: ratio(sum.spend, sum.click),
    roas: 0,
    reach: sum.reach,
    likes: sum.likes,
    replies: sum.replies,
    reposts: sum.reposts,
    follows: sum.follows,
    engagements: sum.engagements,
    profileVisits: sum.profileVisits,
    cpv: ratio(sum.cpvWeighted, sum.impression)
  };
}

function ratio(numerator: number, denominator: number): number {
  return denominator ? numerator / denominator : 0;
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
  const base = columnsByPlatform[bundle.platform];
  // YouTube는 캠페인 목표에 따라 헤더가 달라져(클릭수 ↔ 상호작용 수) 파일이 쓴 이름을 그대로 따른다.
  const columns = bundle.platform === 'youtube'
    ? base.map(column => ({ ...column, ...columnLabel(column, bundle.files) }))
    : base;
  const summaryLabels = summaryByPlatform[bundle.platform];
  const sorted = [...bundle.data.dailyStats].sort((a, b) => String(a.date || '').localeCompare(String(b.date || '')));
  // 날짜 열이 없는 export(기간 전체 한 줄)는 합계 행과 내용이 같아 일자 행을 접는다.
  const rows = sorted.length === 1 && !sorted[0].date ? [] : sorted;
  const total = bundle.platform === 'meta' ? bundle.data.total : derivedTotal(sorted, bundle.data.total);
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
          .filter((column, index) => summaryLabels.includes(base[index].label))
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
