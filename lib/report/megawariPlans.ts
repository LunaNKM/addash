import type { NormalizedReportRow } from './reportTypes';

/** 미디어믹스 한 줄. 캠페인명 규칙(YYMM_DK_{매체}_{목적}_Qoo10_Megawari)으로 실적 행과 맞춘다. */
export type MegawariPlanLine = {
  label: string;
  /** row.media 소문자 값 */
  media: 's-meta' | 'meta';
  /** 캠페인명 안의 목적 토큰 */
  objective: 'atc' | 'purchase' | 'traffic';
  /** 광고세트명이 RT면 'rt', RT가 아니면 'non'. 비우면 둘 다 */
  audience?: 'rt' | 'non';
  budgetNet: number;
  budgetGross: number;
  impressions: number;
  clicks: number;
  /** ATC 목적 라인은 장바구니 수, 그 외는 구매 전환 수 */
  conversions?: number;
  sales?: number;
};

export type MegawariPlan = {
  brandId: string;
  title: string;
  start: string;
  end: string;
  source: string;
  lines: MegawariPlanLine[];
};

// shortcut: 메가와리마다 미디어믹스 시트 값을 여기에 직접 옮긴다. 브랜드가 늘거나 자주 바뀌면 설정 화면으로 옮길 것.
export const MEGAWARI_PLANS: MegawariPlan[] = [
  {
    brandId: 'rETPe2kRxXmZZgeNlqwS', // WISHCOMPANY
    title: 'Q4 메가와리 성과 및 현황',
    start: '2026-11-16',
    end: '2026-12-02',
    source: '위시컴퍼니 Qoo10 미디어믹스 26.11',
    lines: [
      { label: 'ATC', media: 's-meta', objective: 'atc', budgetNet: 3130435, budgetGross: 3600000, impressions: 273614, clicks: 6330, conversions: 743, sales: 29877685 },
      { label: 'Purchase (NON)', media: 's-meta', objective: 'purchase', audience: 'non', budgetNet: 12805435, budgetGross: 14726250, impressions: 459965, clicks: 13799, conversions: 1829, sales: 65238696 },
      { label: 'Purchase (RT)', media: 's-meta', objective: 'purchase', audience: 'rt', budgetNet: 17325000, budgetGross: 19923750, impressions: 666757, clicks: 23336, conversions: 2559, sales: 91298980 },
      { label: 'Traffic (NON)', media: 's-meta', objective: 'traffic', budgetNet: 1956522, budgetGross: 2250000, impressions: 246297, clicks: 6750 },
      { label: 'Traffic (PA)', media: 'meta', objective: 'traffic', budgetNet: 3913044, budgetGross: 4500000, impressions: 502579, clicks: 42418 }
    ]
  }
];

/** 선택 기간이 메가와리 기간과 겹칠 때만 그 브랜드의 플랜을 돌려준다. */
export function findMegawariPlan(brandId: string, periodStart: string, periodEnd: string): MegawariPlan | undefined {
  return MEGAWARI_PLANS.find(plan => plan.brandId === brandId && periodStart <= plan.end && periodEnd >= plan.start);
}

export function matchesMegawariLine(row: NormalizedReportRow, plan: MegawariPlan, line: MegawariPlanLine): boolean {
  if (!row.date || row.date < plan.start || row.date > plan.end) return false;
  const campaign = row.campaignName.toLowerCase();
  if (!campaign.includes('megawari') || !campaign.includes(`_${line.objective}_`)) return false;
  if (row.media.trim().toLowerCase() !== line.media) return false;
  if (!line.audience) return true;
  const isRt = /(^|_)rt($|[_(])/i.test(row.adgroupName);
  return line.audience === 'rt' ? isRt : !isRt;
}
