import type { ReportParseResult } from './report/reportTypes';

export type MetricKey = 'spend' | 'impression' | 'click' | 'landingPageView' | 'ctr' | 'cpm' | 'cpc' | 'roas';

export type Brand = {
  id: string;
  name: string;
  color: string;
  shareToken: string;
  metaAdAccountId: string;
  createdAt: number;
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

export type InsightDoc = {
  id: string;
  text: string;
  createdAt: number;
  fileIds: string[];
  periodStart: string;
  periodEnd: string;
};
