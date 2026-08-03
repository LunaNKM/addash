'use client';

import { useEffect, useState } from 'react';
import { addAdmin, deleteBrand, deleteFile, deleteReportFile, listAdmins, listFiles, listReportFiles, removeAdmin } from '@/lib/store';
import { BRAND_PRESETS } from '@/lib/brandColor';
import { DEFAULT_VISIBLE_REPORT_TABS, type Brand, type BrandPatch, type DashboardTab, type FileDoc, type Kpi, type ReportFileDoc, type ReportTabKey } from '@/lib/types';
import { darken, kpiLabel } from '@/lib/dashUtils';

export type SettingsMode = 'none' | 'brand' | 'tab' | 'kpi' | 'admin' | 'file';

const REPORT_TAB_LABELS: Record<ReportTabKey, string> = {
  total: '전체 성과',
  campaigns: '캠페인별',
  creatives: '소재별',
  qoo10: 'Qoo10',
  owned: '자사몰'
};

function BrandEditorRow({ brand, onCopyShare, onDelete, onUpdate }: {
  brand: Brand;
  onCopyShare: () => void;
  onDelete: () => Promise<void>;
  onUpdate: (patch: BrandPatch) => Promise<void>;
}) {
  const [expanded, setExpanded] = useState(false);
  const [name, setName] = useState(brand.name);
  const [color, setColor] = useState(brand.color);
  const [adAccountId, setAdAccountId] = useState(brand.metaAdAccountId || '');
  const [commissionPercent, setCommissionPercent] = useState(brand.commissionPercent);
  const [visibleReportTabs, setVisibleReportTabs] = useState<ReportTabKey[]>(brand.visibleReportTabs);
  useEffect(() => {
    setName(brand.name);
    setColor(brand.color);
    setAdAccountId(brand.metaAdAccountId || '');
    setCommissionPercent(brand.commissionPercent);
    setVisibleReportTabs(brand.visibleReportTabs);
  }, [brand.name, brand.color, brand.metaAdAccountId, brand.commissionPercent, brand.visibleReportTabs]);

  const visibleTabsDirty = DEFAULT_VISIBLE_REPORT_TABS.some(tab => visibleReportTabs.includes(tab) !== brand.visibleReportTabs.includes(tab));
  const dirty = name !== brand.name
    || color.toLowerCase() !== brand.color.toLowerCase()
    || adAccountId !== (brand.metaAdAccountId || '')
    || commissionPercent !== brand.commissionPercent
    || visibleTabsDirty;
  const validCommission = Number.isFinite(commissionPercent) && commissionPercent >= 0 && commissionPercent <= 100;
  const validTabSelection = visibleReportTabs.length > 0;

  return (
    <div style={{ marginBottom: 10 }}>
      <div className="item">
        <b>
          <span className="item-brand-dot" style={{ background: brand.color }} />
          {brand.name}
        </b>
        <div className="item-actions">
          <button onClick={() => setExpanded(!expanded)}>{expanded ? '접기' : '편집'}</button>
          <button onClick={onCopyShare}>공유</button>
          <button onClick={onDelete}>삭제</button>
        </div>
      </div>

      {expanded && (
        <div className="brand-editor">
          <div className="brand-editor-row">
            <div>
              <label>브랜드명</label>
              <input type="text" value={name} onChange={event => setName(event.target.value)} />
            </div>
            <div>
              <label>Meta Ad Account ID</label>
              <small className="muted">최대 2개까지 쉼표, 공백, 줄바꿈으로 구분해 입력할 수 있습니다.</small>
              <input type="text" value={adAccountId} onChange={event => setAdAccountId(event.target.value)} placeholder="act_123, act_456" />
            </div>
            <div>
              <label>브랜드 컬러 (HEX)</label>
              <div className="color-input-group">
                <input type="color" className="color-input-swatch" value={color} onChange={event => setColor(event.target.value)} />
                <input type="text" className="color-input-hex" value={color} onChange={event => setColor(event.target.value)} placeholder="#RRGGBB" />
              </div>
            </div>
            <div>
              <label>수수료율 (%)</label>
              <small className="muted">그로스 광고비 = 넷 광고비 × (1 + 수수료율)</small>
              <input
                type="number"
                min="0"
                max="100"
                step="0.1"
                value={commissionPercent}
                onChange={event => setCommissionPercent(Number(event.target.value))}
              />
            </div>
            {!validCommission && <small className="warn">수수료율은 0~100 사이로 입력해주세요.</small>}
          </div>

          <div>
            <label>보고서 표시 탭</label>
            <div className="brand-tab-visibility">
              {DEFAULT_VISIBLE_REPORT_TABS.map(tab => (
                <label className="brand-tab-option" key={tab}>
                  <input
                    type="checkbox"
                    checked={visibleReportTabs.includes(tab)}
                    onChange={event => {
                      setVisibleReportTabs(current => event.target.checked
                        ? DEFAULT_VISIBLE_REPORT_TABS.filter(item => item === tab || current.includes(item))
                        : current.filter(item => item !== tab));
                    }}
                  />
                  <span>{REPORT_TAB_LABELS[tab]}</span>
                </label>
              ))}
            </div>
            <small className="muted">체크를 해제한 탭은 관리자와 공유 화면 모두에서 숨겨집니다.</small>
            {!validTabSelection && <small className="warn">최소 1개의 탭은 표시해야 합니다.</small>}
          </div>

          <div>
            <label style={{ display: 'block', fontSize: 11, fontWeight: 600, letterSpacing: '0.04em', textTransform: 'uppercase', color: 'var(--c-ink-3)', marginBottom: 8 }}>
              프리셋
            </label>
            <div className="color-presets">
              {BRAND_PRESETS.map(preset => (
                <button
                  key={preset.hex}
                  type="button"
                  title={preset.name}
                  className={`color-preset ${color.toLowerCase() === preset.hex.toLowerCase() ? 'active' : ''}`}
                  style={{ background: preset.hex }}
                  onClick={() => setColor(preset.hex)}
                />
              ))}
            </div>
          </div>

          <div className="brand-preview-mini">
            <div className="brand-preview-mini-bar" style={{ background: `linear-gradient(135deg, ${color} 0%, ${darken(color, 20)} 100%)` }} />
            <div className="brand-preview-mini-text">서브 헤더 미리보기</div>
          </div>

          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
            <button className="btn outline" onClick={() => {
              setName(brand.name);
              setColor(brand.color);
              setAdAccountId(brand.metaAdAccountId || '');
              setCommissionPercent(brand.commissionPercent);
              setVisibleReportTabs(brand.visibleReportTabs);
            }}>되돌리기</button>
            <button
              className="btn brand"
              disabled={!dirty || !validCommission || !validTabSelection}
              onClick={async () => {
                await onUpdate({
                  ...(name !== brand.name ? { name } : {}),
                  ...(color.toLowerCase() !== brand.color.toLowerCase() ? { color } : {}),
                  ...(adAccountId !== (brand.metaAdAccountId || '') ? { metaAdAccountId: adAccountId } : {}),
                  ...(commissionPercent !== brand.commissionPercent ? { commissionPercent } : {}),
                  ...(visibleTabsDirty ? { visibleReportTabs } : {})
                });
                setExpanded(false);
              }}
            >
              변경사항 저장
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function FileSettings({ brand, tab, reload }: { brand: Brand; tab: DashboardTab; reload: () => Promise<void> }) {
  const [tabFiles, setTabFiles] = useState<FileDoc[]>([]);
  const [reportFiles, setReportFiles] = useState<ReportFileDoc[]>([]);

  async function refreshFiles() {
    const [dashboard, reports] = await Promise.all([
      listFiles(brand.id, tab.id),
      listReportFiles(brand.id, tab.id)
    ]);
    setTabFiles(dashboard);
    setReportFiles(reports);
  }

  useEffect(() => { refreshFiles(); }, [brand.id, tab.id]);

  return (
    <div>
      <div className="section-head" style={{ marginBottom: 8 }}>
        <b>대시보드 파일</b>
      </div>
      {tabFiles.map(file => (
        <div className="item" key={file.id}>
          <b style={{ fontFamily: 'var(--font-mono)', fontSize: 12 }}>{file.filename}</b>
          <button onClick={async () => {
            if (confirm('삭제할까요?')) {
              await deleteFile(brand.id, tab.id, file.id);
              await reload();
              await refreshFiles();
            }
          }}>삭제</button>
        </div>
      ))}
      {!tabFiles.length && <p className="muted">저장된 대시보드 파일이 없습니다.</p>}

      <div className="section-head" style={{ margin: '18px 0 8px' }}>
        <b>보고서 RAW 파일</b>
      </div>
      {reportFiles.map(file => (
        <div className="item" key={file.id}>
          <b style={{ fontFamily: 'var(--font-mono)', fontSize: 12 }}>{file.filename}</b>
          <span className="muted">{file.dateStart || '-'} ~ {file.dateEnd || '-'} · {file.rowCount.toLocaleString()}행</span>
          <button onClick={async () => {
            if (confirm('삭제할까요?')) {
              await deleteReportFile(brand.id, tab.id, file.id);
              await reload();
              await refreshFiles();
            }
          }}>삭제</button>
        </div>
      ))}
      {!reportFiles.length && <p className="muted">저장된 보고서 RAW 파일이 없습니다.</p>}
    </div>
  );
}

export function SettingsModal({ mode, setMode, brand, tab, brands, tabs, kpi, saveKpi: onSaveKpi, reload, addBrand, refreshBrands, onUpdateBrand, sharePath = '', getShareUrl }: {
  mode: SettingsMode;
  setMode: (v: SettingsMode) => void;
  brand: Brand;
  tab: DashboardTab | null;
  brands: Brand[];
  tabs: DashboardTab[];
  kpi: Kpi;
  saveKpi: (k: Kpi) => Promise<void>;
  reload: () => Promise<void>;
  addBrand: () => Promise<void>;
  refreshBrands: () => Promise<void>;
  onUpdateBrand: (brandId: string, patch: BrandPatch) => Promise<void>;
  sharePath?: string;
  getShareUrl?: (brand: Brand) => string;
}) {
  const [draft, setDraft] = useState<Kpi>(kpi);
  const [admins, setAdmins] = useState<Array<{ email: string; primary?: boolean }>>([]);
  useEffect(() => { setDraft(kpi); }, [kpi]);
  useEffect(() => { if (mode === 'admin') listAdmins().then(items => setAdmins(items as Array<{ email: string; primary?: boolean }>)); }, [mode]);

  return (
    <div className="modal">
      <div className="modal-card">
        <h3>설정</h3>
        <span className="muted">현재 브랜드 · {brand.name}</span>
        <div className="settings-nav">
          <button className={mode === 'brand' ? 'active' : ''} onClick={() => setMode('brand')}>브랜드</button>
          <button className={mode === 'tab' ? 'active' : ''} onClick={() => setMode('tab')}>탭</button>
          <button className={mode === 'kpi' ? 'active' : ''} onClick={() => setMode('kpi')}>KPI</button>
          <button className={mode === 'admin' ? 'active' : ''} onClick={() => setMode('admin')}>관리자</button>
          <button className={mode === 'file' ? 'active' : ''} onClick={() => setMode('file')}>파일</button>
        </div>

        {mode === 'brand' && (
          <div>
            <button className="btn brand" onClick={addBrand} style={{ marginBottom: 12 }}>브랜드 추가</button>
            {brands.map(item => (
              <BrandEditorRow
                key={item.id}
                brand={item}
                onCopyShare={() => {
                  const url = getShareUrl?.(item) || `${location.origin}${sharePath}?share=${item.shareToken}`;
                  navigator.clipboard.writeText(url).then(() => alert('공유 링크를 복사했습니다.'));
                }}
                onDelete={async () => {
                  if (prompt(`삭제하려면 ${item.name} 입력`) === item.name) {
                    await deleteBrand(item.id);
                    await refreshBrands();
                  }
                }}
                onUpdate={patch => onUpdateBrand(item.id, patch)}
              />
            ))}
          </div>
        )}

        {mode === 'tab' && (
          <div>{tabs.map(item => <div className="item" key={item.id}><b>{item.name}</b></div>)}</div>
        )}

        {mode === 'kpi' && (
          <div className="kpi-edit">
            {(Object.keys(draft) as Array<keyof Kpi>).map(key => (
              <label key={key}>
                {kpiLabel(key)}
                <input type="number" value={draft[key]} onChange={event => setDraft({ ...draft, [key]: Number(event.target.value) })} />
              </label>
            ))}
            <button className="btn brand" onClick={() => onSaveKpi(draft)}>저장</button>
          </div>
        )}

        {mode === 'admin' && (
          <div>
            <button className="btn brand" onClick={async () => {
              const email = prompt('관리자 이메일');
              if (email) {
                await addAdmin(email);
                setAdmins(await listAdmins() as Array<{ email: string; primary?: boolean }>);
              }
            }} style={{ marginBottom: 12 }}>관리자 추가</button>
            {admins.map(item => (
              <div className="item" key={item.email}>
                <b>{item.email}{item.primary && <span className="badge" style={{ marginLeft: 8 }}>Primary</span>}</b>
                {!item.primary && (
                  <button onClick={async () => {
                    await removeAdmin(item.email);
                    setAdmins(await listAdmins() as Array<{ email: string; primary?: boolean }>);
                  }}>삭제</button>
                )}
              </div>
            ))}
          </div>
        )}

        {mode === 'file' && tab && <FileSettings brand={brand} tab={tab} reload={reload} />}

        <div className="modal-actions">
          <button className="btn outline" onClick={() => setMode('none')}>닫기</button>
        </div>
      </div>
    </div>
  );
}
