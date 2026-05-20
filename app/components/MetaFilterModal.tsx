'use client';

import { useState } from 'react';
import type { User } from 'firebase/auth';
import type { Brand } from '@/lib/types';

type Campaign = { id: string; name: string };
type Adset = { id: string; name: string; campaignId: string; campaignName: string };

function CampaignRow({
  campaign,
  adsets,
  selectedAdsetIds,
  onToggleCampaign,
  onToggleAdset,
}: {
  campaign: Campaign;
  adsets: Adset[];
  selectedAdsetIds: Set<string>;
  onToggleCampaign: (campaign: Campaign, adsets: Adset[]) => void;
  onToggleAdset: (adsetId: string) => void;
}) {
  const [expanded, setExpanded] = useState(true);
  const selectedCount = adsets.filter(a => selectedAdsetIds.has(a.id)).length;
  const allChecked = selectedCount === adsets.length;
  const someChecked = selectedCount > 0 && !allChecked;

  return (
    <div className="meta-campaign-group">
      <div className="meta-campaign-row">
        <input
          type="checkbox"
          checked={allChecked}
          ref={el => { if (el) el.indeterminate = someChecked; }}
          onChange={() => onToggleCampaign(campaign, adsets)}
        />
        <button className="meta-expand-btn" onClick={() => setExpanded(v => !v)}>
          {expanded ? '▾' : '▸'}
        </button>
        <span className="meta-campaign-name">{campaign.name}</span>
        <span className="meta-count-badge">{selectedCount}/{adsets.length}</span>
      </div>
      {expanded && (
        <div className="meta-adset-list">
          {adsets.map(adset => (
            <label key={adset.id} className="meta-adset-row">
              <input
                type="checkbox"
                checked={selectedAdsetIds.has(adset.id)}
                onChange={() => onToggleAdset(adset.id)}
              />
              <span>{adset.name}</span>
            </label>
          ))}
        </div>
      )}
    </div>
  );
}

export function MetaFilterModal({
  brand,
  user,
  onClose,
  onImport,
}: {
  brand: Brand;
  user: User;
  onClose: () => void;
  onImport: (adsetIds: string[], dateStart: string, dateEnd: string) => void;
}) {
  const [dateStart, setDateStart] = useState('');
  const [dateEnd, setDateEnd] = useState('');
  const [step, setStep] = useState<'date' | 'filter'>('date');
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [adsets, setAdsets] = useState<Adset[]>([]);
  const [selectedAdsetIds, setSelectedAdsetIds] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  async function loadCampaigns() {
    setLoading(true);
    setError('');
    try {
      const token = await user.getIdToken();
      const resp = await fetch(
        `/api/meta?adAccountId=${encodeURIComponent(brand.metaAdAccountId || '')}&dateStart=${dateStart}&dateEnd=${dateEnd}`,
        { headers: { Authorization: `Bearer ${token}` } }
      );
      const data = await resp.json();
      if (!resp.ok) throw new Error(data.error || 'Meta API 오류');
      if (!data.campaigns.length) throw new Error('해당 기간에 활성 캠페인이 없습니다.');
      setCampaigns(data.campaigns);
      setAdsets(data.adsets);
      setSelectedAdsetIds(new Set(data.adsets.map((a: Adset) => a.id)));
      setStep('filter');
    } catch (err) {
      setError(err instanceof Error ? err.message : '오류가 발생했습니다.');
    } finally {
      setLoading(false);
    }
  }

  function toggleCampaign(campaign: Campaign, campaignAdsets: Adset[]) {
    const ids = campaignAdsets.map(a => a.id);
    const allSelected = ids.every(id => selectedAdsetIds.has(id));
    setSelectedAdsetIds(prev => {
      const next = new Set(prev);
      if (allSelected) ids.forEach(id => next.delete(id));
      else ids.forEach(id => next.add(id));
      return next;
    });
  }

  function toggleAdset(adsetId: string) {
    setSelectedAdsetIds(prev => {
      const next = new Set(prev);
      if (next.has(adsetId)) next.delete(adsetId);
      else next.add(adsetId);
      return next;
    });
  }

  function selectAll() { setSelectedAdsetIds(new Set(adsets.map(a => a.id))); }
  function deselectAll() { setSelectedAdsetIds(new Set()); }

  function handleImport() {
    const allSelected = selectedAdsetIds.size === adsets.length;
    onImport(allSelected ? [] : Array.from(selectedAdsetIds), dateStart, dateEnd);
  }

  return (
    <div className="modal">
      <div className="modal-card">
        <h3>Meta API로 데이터 가져오기</h3>
        {brand.metaAdAccountId
          ? <p className="muted">Ad Account: act_{brand.metaAdAccountId}</p>
          : <p style={{ color: 'var(--c-warn)' }}>브랜드 설정 → Ad Account ID를 먼저 입력해주세요.</p>}

        {step === 'date' && (
          <>
            <div className="kpi-edit" style={{ gap: 12, marginTop: 16 }}>
              <label>
                시작일
                <input type="date" value={dateStart} onChange={e => setDateStart(e.target.value)} />
              </label>
              <label>
                종료일
                <input type="date" value={dateEnd} onChange={e => setDateEnd(e.target.value)} />
              </label>
            </div>
            {error && <p style={{ color: 'var(--c-danger)', fontSize: 13, marginTop: 8 }}>{error}</p>}
            <div className="modal-actions">
              <button className="btn outline" onClick={onClose}>취소</button>
              <button
                className="btn brand"
                disabled={!brand.metaAdAccountId || !dateStart || !dateEnd || loading}
                onClick={loadCampaigns}
              >
                {loading ? '불러오는 중...' : '다음 →'}
              </button>
            </div>
          </>
        )}

        {step === 'filter' && (
          <>
            <div className="meta-filter-header">
              <span className="panel-title" style={{ margin: 0 }}>캠페인 / 광고세트 선택</span>
              <div style={{ display: 'flex', gap: 6 }}>
                <button className="btn outline" style={{ fontSize: 11, padding: '3px 8px' }} onClick={selectAll}>전체 선택</button>
                <button className="btn outline" style={{ fontSize: 11, padding: '3px 8px' }} onClick={deselectAll}>전체 해제</button>
              </div>
            </div>
            <div className="meta-filter-list scrollbox" style={{ maxHeight: 340, marginTop: 8 }}>
              {campaigns.map(campaign => {
                const campaignAdsets = adsets.filter(a => a.campaignId === campaign.id);
                return (
                  <CampaignRow
                    key={campaign.id}
                    campaign={campaign}
                    adsets={campaignAdsets}
                    selectedAdsetIds={selectedAdsetIds}
                    onToggleCampaign={toggleCampaign}
                    onToggleAdset={toggleAdset}
                  />
                );
              })}
            </div>
            <p className="muted" style={{ fontSize: 12, marginTop: 8 }}>
              {selectedAdsetIds.size === adsets.length
                ? '전체 광고세트 선택됨'
                : `${selectedAdsetIds.size} / ${adsets.length}개 광고세트 선택됨`}
            </p>
            <div className="modal-actions">
              <button className="btn outline" onClick={() => { setStep('date'); setError(''); }}>← 이전</button>
              <button
                className="btn brand"
                disabled={selectedAdsetIds.size === 0}
                onClick={handleImport}
              >
                가져오기
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
