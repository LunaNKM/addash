export type ReportColumnKey =
  | 'date'
  | 'brand'
  | 'media'
  | 'promotion'
  | 'campaignName'
  | 'adgroupName'
  | 'adName'
  | 'impressions'
  | 'clicks'
  | 'conversions'
  | 'costJpy'
  | 'costKrw'
  | 'grossCostKrw'
  | 'salesJpy'
  | 'salesKrw'
  | 'addToCart'
  | 'registration'
  | 'lead'
  | 'order';

export type DetectedColumn = {
  key: ReportColumnKey;
  header: string;
  index: number;
  confidence: 'exact' | 'alias' | 'fuzzy';
};

export type SheetDetection = {
  sheetName: string;
  headerRowIndex: number;
  rowCount: number;
  score: number;
  columns: Partial<Record<ReportColumnKey, DetectedColumn>>;
  missingRequired: ReportColumnKey[];
  missingRecommended: ReportColumnKey[];
};

export type ReportRawRow = Record<string, unknown>;

export type NormalizedReportRow = {
  sourceRowNumber: number;
  date: string;
  brand: string;
  media: string;
  promotion: string;
  campaignName: string;
  adgroupName: string;
  adName: string;
  /** 행 금액의 실제 통화. 없으면 JPY로 본다(기존에 저장된 행 호환). */
  currency?: string;
  impressions: number;
  clicks: number;
  conversions: number;
  costJpy: number;
  costKrw: number;
  grossCostKrw: number;
  salesJpy: number;
  salesKrw: number;
  addToCart: number;
  registration: number;
  lead: number;
  order: number;
  ctr: number;
  cpm: number;
  cpc: number;
  cvr: number;
  cpa: number;
  cartCpa: number;
  roas: number;
  raw: ReportRawRow;
};

export type DataQualityIssue = {
  level: 'error' | 'warning' | 'info';
  code: string;
  message: string;
  count?: number;
  examples?: number[];
};

export type ReportParseResult = {
  fileName: string;
  sheet: SheetDetection;
  detections: DetectedColumn[];
  rows: NormalizedReportRow[];
  preview: NormalizedReportRow[];
  issues: DataQualityIssue[];
  exchangeRate: number;
  generatedAt: number;
};

export type ReportSummary = {
  key: string;
  label: string;
  rows: number;
  spend: number;
  grossSpend: number;
  impressions: number;
  clicks: number;
  conversions: number;
  sales: number;
  addToCart: number;
  registration: number;
  lead: number;
  order: number;
  ctr: number;
  cpm: number;
  cpc: number;
  cvr: number;
  cpa: number;
  cartCpa: number;
  roas: number;
};

export type ReportAggregation = {
  total: ReportSummary;
  byMonth: ReportSummary[];
  byWeek: ReportSummary[];
  byPromotion: ReportSummary[];
  byCampaign: ReportSummary[];
  byAdgroup: ReportSummary[];
  byDaily: ReportSummary[];
  byCreative: ReportSummary[];
};

export type ReportPeriod = {
  start: string;
  end: string;
  label: string;
};

export type ReportComparisonMetric = {
  key: keyof Pick<ReportSummary, 'spend' | 'sales' | 'impressions' | 'clicks' | 'conversions' | 'addToCart' | 'ctr' | 'cpm' | 'cvr' | 'cpa' | 'roas'>;
  label: string;
  current: number;
  previous: number;
  delta: number;
  deltaRate: number;
};

export type ReportView = {
  currentPeriod: ReportPeriod;
  previousPeriod: ReportPeriod;
  currentRows: NormalizedReportRow[];
  previousRows: NormalizedReportRow[];
  current: ReportAggregation;
  previous: ReportAggregation;
  comparison: ReportComparisonMetric[];
};

export type ReportSourceKind = 'xlsx-upload' | 'meta-api';

export type ReportSourceDescriptor = {
  kind: ReportSourceKind;
  label: string;
  status: 'available' | 'planned';
};
