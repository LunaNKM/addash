import type { ReportColumnKey, SheetDetection } from './reportTypes';

export const DEFAULT_EXCHANGE_RATE = 9.28;
export const DEFAULT_COMMISSION_PERCENT = 15;
export const DEFAULT_GROSS_RATE = 1.15;
export const PRE_JULY_2026_GROSS_RATE = 1.1;
export const GROSS_RATE_CHANGE_DATE = '2026-07-14';

export function grossRateForDate(date: string): number {
  return date && date < GROSS_RATE_CHANGE_DATE ? PRE_JULY_2026_GROSS_RATE : DEFAULT_GROSS_RATE;
}

/** 특정 날짜부터 적용되는 브랜드별 수수료율 (startDate 포함). */
export type CommissionRule = {
  startDate: string;
  percent: number;
};

/**
 * 브랜드별 수수료 설정.
 * - commissionRules: 구간별 수수료율. 행 날짜 이하의 startDate 중 가장 늦은 구간이 적용된다.
 * - commissionPercent: 어떤 구간에도 속하지 않는 날짜(첫 구간 시작 이전)에 적용되는 기본 수수료율.
 */
export type CommissionSetting = {
  commissionPercent?: number;
  commissionRules?: CommissionRule[];
};

export function isValidCommissionPercent(value: unknown): boolean {
  const percent = Number(value);
  return Number.isFinite(percent) && percent >= 0 && percent <= 100;
}

export function isValidCommissionStartDate(value: unknown): boolean {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value);
}

export function sortCommissionRules(rules: CommissionRule[]): CommissionRule[] {
  return [...rules].sort((a, b) => a.startDate.localeCompare(b.startDate));
}

/** 해당 날짜에 적용할 수수료율(%). 설정이 없으면 null. */
export function commissionPercentForDate(date: string, setting?: number | CommissionSetting): number | null {
  if (typeof setting === 'number') return isValidCommissionPercent(setting) ? setting : null;
  if (!setting) return null;
  const rules = sortCommissionRules((setting.commissionRules || []).filter(
    rule => isValidCommissionStartDate(rule?.startDate) && isValidCommissionPercent(rule?.percent)
  ));
  if (date) {
    const matched = rules.filter(rule => rule.startDate <= date).pop();
    if (matched) return Number(matched.percent);
  }
  return isValidCommissionPercent(setting.commissionPercent) ? Number(setting.commissionPercent) : null;
}

export function toGrossCostKrw(netCostKrw: number, date: string, setting?: number | CommissionSetting): number {
  const percent = commissionPercentForDate(date, setting);
  const grossRate = percent === null ? grossRateForDate(date) : 1 + Math.max(0, percent) / 100;
  return netCostKrw ? netCostKrw * grossRate : 0;
}

export const requiredColumns: ReportColumnKey[] = ['date', 'impressions', 'clicks'];

export const recommendedColumns: ReportColumnKey[] = [
  'promotion',
  'campaignName',
  'adgroupName',
  'adName',
  'conversions',
  'costKrw',
  'salesKrw',
  'addToCart'
];

const columnAliases: Record<ReportColumnKey, string[]> = {
  date: ['date', 'day', 'reporting starts', 'reporting start', '날짜', '일자'],
  brand: ['brand', '브랜드'],
  media: ['media', 'publisher', 'platform', '매체', '미디어'],
  promotion: ['promotion', 'promo', 'channel', '채널', '프로모션', '캠페인 구분'],
  campaignName: ['campaign_name', 'campaign name', 'campaign', 'campaign_name ', '캠페인명', '캠페인 이름', '캠페인'],
  adgroupName: [
    'adgroup_name',
    'ad group name',
    'adset_name',
    'ad set name',
    'adset',
    '광고세트명',
    '광고 세트 이름',
    '광고그룹',
    '그룹'
  ],
  adName: ['ad_name', 'ad name', 'creative', 'creative name', '소재명', '광고명', '광고 이름', '소재'],
  impressions: ['impressions', 'impression', 'imp', '노출', '노출수'],
  clicks: ['clicks', 'click', 'link clicks', '클릭', '클릭수', '링크 클릭'],
  conversions: ['conversions', 'conversion', 'conv', 'purchase', 'purchases', '구매', '전환', '전환수'],
  costJpy: ['엔화', 'cost jpy', 'cost_jpy', 'spend jpy', 'media spend jpy', '광고비(엔화)', '광고비 엔화'],
  costKrw: ['cost (원화)', 'cost krw', 'cost_krw', 'media spend', 'spend', '광고비용', '광고비', '원화 cost', 'cost'],
  grossCostKrw: ['광고비(gross)', 'gross cost', 'gross_cost', 'gross spend', '수수료 포함'],
  salesJpy: ['sales (엔화)', 'sales jpy', 'sales_jpy', 'revenue jpy', '매출 엔화', '매출(엔화)'],
  salesKrw: ['sales (원화)', 'sales krw', 'sales_krw', 'revenue', 'sales', '매출', '매출액', '원화 sales'],
  addToCart: ['cv_add_cart_conversion', 'add cart', 'add_to_cart', 'add_cart', 'atc', '장바구니', 'add_cart_conversion'],
  registration: ['registration', 'registrations', 'signup', 'sign up', '회원가입', '가입'],
  lead: ['lead', 'leads', '리드'],
  order: ['order', 'orders', '주문', '주문수']
};

const keyWeights: Partial<Record<ReportColumnKey, number>> = {
  date: 10,
  campaignName: 6,
  promotion: 5,
  adgroupName: 4,
  adName: 4,
  impressions: 8,
  clicks: 8,
  conversions: 5,
  costKrw: 8,
  costJpy: 5,
  salesKrw: 7,
  salesJpy: 5,
  addToCart: 4
};

export function normalizeHeader(value: unknown): string {
  return String(value ?? '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .replace(/[()[\]{}:/\\._%-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function compact(value: unknown): string {
  return normalizeHeader(value).replace(/\s/g, '');
}

/**
 * 통화가 붙은 별칭(sales jpy 등)이 통화 표기 없는 헤더("sales", "cost")까지 가져가면
 * 원화 값에 환율이 한 번 더 곱해진다. 부분 일치일 때는 통화 표기가 서로 맞을 때만 인정한다.
 */
const CURRENCY_TOKENS = ['jpy', '엔화', 'krw', '원화'];

function currencyMismatch(aliasCompact: string, headerCompact: string): boolean {
  return CURRENCY_TOKENS.some(token => aliasCompact.includes(token) && !headerCompact.includes(token));
}

export function detectColumns(headers: unknown[]): SheetDetection['columns'] {
  const result: SheetDetection['columns'] = {};
  const normalized = headers.map(header => ({
    header: String(header ?? '').trim(),
    norm: normalizeHeader(header),
    compact: compact(header)
  }));

  for (const [key, aliases] of Object.entries(columnAliases) as [ReportColumnKey, string[]][]) {
    let best: { index: number; confidence: 'exact' | 'alias' | 'fuzzy'; rank: number } | null = null;
    for (let index = 0; index < normalized.length; index += 1) {
      const item = normalized[index];
      if (!item.header) continue;
      for (const alias of aliases) {
        const aliasNorm = normalizeHeader(alias);
        const aliasCompact = compact(alias);
        const exact = item.norm === aliasNorm;
        const compactExact = item.compact === aliasCompact;
        const fuzzy =
          aliasCompact.length >= 4 &&
          item.compact.length >= 4 &&
          (item.compact.includes(aliasCompact) || aliasCompact.includes(item.compact)) &&
          !currencyMismatch(aliasCompact, item.compact);
        if (!exact && !compactExact && !fuzzy) continue;

        const confidence = exact ? 'exact' : compactExact ? 'alias' : 'fuzzy';
        const rank = confidence === 'exact' ? 3 : confidence === 'alias' ? 2 : 1;
        if (!best || rank > best.rank) best = { index, confidence, rank };
      }
    }
    if (best && !Object.values(result).some(column => column?.index === best?.index)) {
      result[key] = {
        key,
        header: normalized[best.index].header,
        index: best.index,
        confidence: best.confidence
      };
    }
  }

  return result;
}

export function scoreDetection(columns: SheetDetection['columns'], rowCount: number): number {
  const columnScore = Object.keys(columns).reduce((sum, key) => sum + (keyWeights[key as ReportColumnKey] ?? 2), 0);
  const rowScore = Math.min(rowCount / 100, 10);
  const hasSpend = columns.costKrw || columns.costJpy ? 12 : 0;
  const hasSales = columns.salesKrw || columns.salesJpy ? 8 : 0;
  const hasGroup = columns.promotion || columns.campaignName ? 8 : 0;
  return columnScore + rowScore + hasSpend + hasSales + hasGroup;
}

export function getMissingColumns(columns: SheetDetection['columns']) {
  const missingRecommended = recommendedColumns.filter(key => {
    if (key === 'costKrw' && (columns.costKrw || columns.costJpy)) return false;
    if (key === 'salesKrw' && (columns.salesKrw || columns.salesJpy)) return false;
    if (key === 'promotion' && (columns.promotion || columns.campaignName)) return false;
    if (key === 'campaignName' && (columns.campaignName || columns.promotion)) return false;
    return !columns[key];
  });

  return {
    missingRequired: requiredColumns.filter(key => !columns[key]),
    missingRecommended
  };
}
