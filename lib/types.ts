import type { CommissionRule } from './report/schema';
import type { ReportParseResult } from './report/reportTypes';
import type { XReportParseResult } from './report/xReport';

export type { CommissionRule };
export const MAX_COMMISSION_RULES = 12;

export const DEFAULT_VISIBLE_REPORT_TABS = ['total', 'campaigns', 'creatives', 'qoo10', 'owned'] as const;
export type ReportTabKey = typeof DEFAULT_VISIBLE_REPORT_TABS[number];

export const DAILY_TOPLINE_METRIC_KEYS = [
  'spend',
  'sales',
  'impressions',
  'clicks',
  'conversions',
  'addToCart',
  'registration',
  'registrationCpa',
  'ctr',
  'cpm',
  'cvr',
  'cpc',
  'cpa',
  'roas'
] as const;
export type DailyToplineMetric = typeof DAILY_TOPLINE_METRIC_KEYS[number];
export const DEFAULT_DAILY_TOPLINE_METRICS: DailyToplineMetric[] = ['spend', 'sales', 'roas'];
export const DAILY_TOPLINE_METRIC_LABELS: Record<DailyToplineMetric, string> = {
  spend: '광고비',
  sales: '매출',
  impressions: '노출',
  clicks: '클릭',
  conversions: '전환',
  addToCart: '장바구니',
  registration: '회원가입수',
  registrationCpa: '회원가입 CPA',
  ctr: 'CTR',
  cpm: 'CPM',
  cvr: 'CVR',
  cpc: 'CPC',
  cpa: 'CPA',
  roas: 'ROAS'
};

export type MetricKey = 'spend' | 'impression' | 'click' | 'landingPageView' | 'ctr' | 'cpm' | 'cpc' | 'roas';

/** 대시보드 파일 하나가 어느 매체 export에서 왔는지. 레거시 파일은 모두 meta로 본다. */
export type AdPlatform = 'meta' | 'x' | 'youtube';
export const AD_PLATFORMS: AdPlatform[] = ['meta', 'x', 'youtube'];
export const AD_PLATFORM_LABELS: Record<AdPlatform, string> = {
  meta: 'Meta',
  x: 'X',
  youtube: 'YouTube'
};

/**
 * 매체별로만 존재하는 지표. 합계 시 단순 합산되며, 값이 없으면 아예 필드를 만들지 않는다.
 * (Meta 파일 문서 크기를 그대로 유지하기 위해 0인 값은 저장하지 않는다.)
 */
export type PlatformExtras = {
  /** X: Reach */
  reach?: number;
  /** X: Likes */
  likes?: number;
  /** X: Replies */
  replies?: number;
  /** X: Reposts */
  reposts?: number;
  /** X: Follows */
  follows?: number;
  /** X: 광고비 ÷ Cost per engagement로 역산한 인게이지먼트 수 */
  engagements?: number;
  /** YouTube: TrueView 평균 CPV (노출 가중 평균) */
  cpv?: number;
};
export type SpendBasis = 'gross' | 'net';

export type Brand = {
  id: string;
  name: string;
  color: string;
  shareToken: string;
  metaAdAccountId: string;
  commissionPercent: number;
  commissionRules: CommissionRule[];
  spendBasis: SpendBasis;
  exchangeRate: number;
  visibleReportTabs: ReportTabKey[];
  dailyToplineMetrics: DailyToplineMetric[];
  createdAt: number;
};

export type BrandPatch = {
  name?: string;
  color?: string;
  metaAdAccountId?: string;
  commissionPercent?: number;
  commissionRules?: CommissionRule[];
  spendBasis?: SpendBasis;
  exchangeRate?: number;
  visibleReportTabs?: ReportTabKey[];
  dailyToplineMetrics?: DailyToplineMetric[];
};

export type DashboardTab = {
  id: string;
  brandId: string;
  name: string;
  sortOrder: number;
  createdAt: number;
};

export type Kpi = {
  spendGoal: number;
  salesGoal: number;
  impressionGoal: number;
  clickGoal: number;
  landingPageViewGoal: number;
  ctrGoal: number;
  cpmGoal: number;
  cpcGoal: number;
  roasGoal: number;
};

export type ParsedRow = PlatformExtras & {
  date: string;
  campaignName: string;
  adsetName: string;
  adName: string;
  spend: number;
  impression: number;
  click: number;
  landingPageView: number;
  ctr: number;
  cpm: number;
  cpc: number;
  roas: number;
  ctrWeight: number;
  cpmWeight: number;
  cpcWeight: number;
  roasWeight: number;
  cpvWeight?: number;
  raw?: Record<string, unknown>;
};

export type StatRow = PlatformExtras & {
  key: string;
  date?: string;
  campaignName?: string;
  adsetName?: string;
  adName?: string;
  spend: number;
  impression: number;
  click: number;
  landingPageView: number;
  ctr: number;
  cpm: number;
  cpc: number;
  roas: number;
};

export type FileDoc = {
  id: string;
  platform: AdPlatform;
  filename: string;
  fileSize: number;
  dateStart: string;
  dateEnd: string;
  rowCount: number;
  total: StatRow;
  dailyStats: StatRow[];
  campaignDailyStats: StatRow[];
  adsetDailyStats: StatRow[];
  detailStats: StatRow[];
  creativeStats: StatRow[];
  createdAt: number;
};

export type ReportFileDoc = {
  id: string;
  filename: string;
  fileSize: number;
  dateStart: string;
  dateEnd: string;
  rowCount: number;
  exchangeRate: number;
  result: ReportParseResult;
  createdAt: number;
};

/** X 광고 관리자 export 파일. SingleOne RAW와 별개로 저장한다. */
export type XReportFileDoc = {
  id: string;
  filename: string;
  fileSize: number;
  dateStart: string;
  dateEnd: string;
  rowCount: number;
  result: XReportParseResult;
  createdAt: number;
};

export type ReportCommentDoc = {
  id: string;
  fileId: string;
  text: string;
  periodStart: string;
  periodEnd: string;
  createdAt: number;
  updatedAt: number;
};

export type CreativeAssetDoc = {
  id: string;
  key: string;
  source: 'singleone' | 'meta' | 'upload';
  media: string;
  campaignName: string;
  adgroupName: string;
  adName: string;
  imageData?: string;
  sourceImageUrl?: string;
  mimeType: string;
  width: number;
  height: number;
  imageHash: string;
  capturedAt: number;
  updatedAt: number;
};

export type SingleOneCollectorSettings = {
  token: string;
  updatedAt: number;
};

export type InsightDoc = {
  id: string;
  text: string;
  createdAt: number;
  fileIds: string[];
  periodStart: string;
  periodEnd: string;
};

/** 인사이트 / Comment를 작성한 날짜별로 남기는 기록. 같은 날 다시 저장하면 그날 것을 갱신한다. */
export type NoteHistoryKind = 'insight' | 'comment';

export type NoteHistoryDoc = {
  id: string;
  kind: NoteHistoryKind;
  /** 작성한 날짜(KST) yyyy-mm-dd */
  date: string;
  text: string;
  periodStart: string;
  periodEnd: string;
  createdAt: number;
  updatedAt: number;
};
