import type { ReportParseResult } from './report/reportTypes';

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

export type Brand = {
  id: string;
  name: string;
  color: string;
  shareToken: string;
  metaAdAccountId: string;
  commissionPercent: number;
  visibleReportTabs: ReportTabKey[];
  dailyToplineMetrics: DailyToplineMetric[];
  createdAt: number;
};

export type BrandPatch = {
  name?: string;
  color?: string;
  metaAdAccountId?: string;
  commissionPercent?: number;
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

export type ParsedRow = {
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
  raw?: Record<string, unknown>;
};

export type StatRow = {
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
  source: 'singleone' | 'meta';
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
