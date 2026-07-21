'use client';

import { useState } from 'react';
import type { User } from 'firebase/auth';
import type { Brand } from '@/lib/types';

type Campaign = { id: string; name: string };
type Adset = { id: string; name: string; campaignId: string; campaignName: string };
type Ad = {
  id: string;
  adId: string;
  name: string;
  adsetId: string;
  adsetName: string;
  campaignId: string;
  campaignName: string;
};

export type MetaCreativeSelection = {
  adId: string;
  campaignName: string;
  adgroupName: string;
  adName: string;
};

function AdsetCreativeRow({
  adset,
  ads,
  selectedAdIds,
  onToggleAdset,
  onToggleAd
}: {
  adset: Adset;
  ads: Ad[];
  selectedAdIds: Set<string>;
  onToggleAdset: (ads: Ad[]) => void;
  onToggleAd: (adId: string) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const selectedCount = ads.filter(ad => selectedAdIds.has(ad.id)).length;
  const allChecked = ads.length > 0 && selectedCount === ads.length;
  const someChecked = selectedCount > 0 && !allChecked;

  return (
    <div className="meta-creative-adset">
      <div className="meta-adset-select-row">
        <input
          type="checkbox"
          checked={allChecked}
          ref={element => { if (element) element.indeterminate = someChecked; }}
          onChange={() => onToggleAdset(ads)}
        />
        <button type="button" className="meta-expand-btn" onClick={() => setExpanded(value => !value)}>
          {expanded ? '접기' : '펼치기'}
        </button>
        <span>{adset.name}</span>
        <span className="meta-count-badge">{selectedCount}/{ads.length}</span>
      </div>
      {expanded && (
        <div className="meta-ad-list">
          {ads.map(ad => (
            <label key={ad.id} className="meta-ad-row">
              <input
                type="checkbox"
                checked={selectedAdIds.has(ad.id)}
                onChange={() => onToggleAd(ad.id)}
              />
              <span>{ad.name}</span>
            </label>
          ))}
        </div>
      )}
    </div>
  );
}

function CampaignCreativeRow({
  campaign,
  adsets,
  ads,
  selectedAdIds,
  onToggleCampaign,
  onToggleAdset,
  onToggleAd
}: {
  campaign: Campaign;
  adsets: Adset[];
  ads: Ad[];
  selectedAdIds: Set<string>;
  onToggleCampaign: (ads: Ad[]) => void;
  onToggleAdset: (ads: Ad[]) => void;
  onToggleAd: (adId: string) => void;
}) {
  const [expanded, setExpanded] = useState(true);
  const selectedCount = ads.filter(ad => selectedAdIds.has(ad.id)).length;
  const allChecked = ads.length > 0 && selectedCount === ads.length;
  const someChecked = selectedCount > 0 && !allChecked;

  return (
    <div className="meta-campaign-group">
      <div className="meta-campaign-row">
        <input
          type="checkbox"
          checked={allChecked}
          ref={element => { if (element) element.indeterminate = someChecked; }}
          onChange={() => onToggleCampaign(ads)}
        />
        <button type="button" className="meta-expand-btn" onClick={() => setExpanded(value => !value)}>
          {expanded ? '접기' : '펼치기'}
        </button>
        <span className="meta-campaign-name">{campaign.name}</span>
        <span className="meta-count-badge">{selectedCount}/{ads.length}</span>
      </div>
      {expanded && (
        <div className="meta-adset-list">
          {adsets.map(adset => (
            <AdsetCreativeRow
              key={adset.id}
              adset={adset}
              ads={ads.filter(ad => ad.adsetId === adset.id)}
              selectedAdIds={selectedAdIds}
              onToggleAdset={onToggleAdset}
              onToggleAd={onToggleAd}
            />
          ))}
        </div>
      )}
    </div>
  );
}

export function MetaCreativeFilterModal({
  brand,
  user,
  onClose,
  onImport,
  apiPath = '/api/report-meta'
}: {
  brand: Brand;
  user: User;
  onClose: () => void;
  onImport: (ads: MetaCreativeSelection[], dateStart: string, dateEnd: string) => void;
  apiPath?: string;
}) {
  const [dateStart, setDateStart] = useState('');
  const [dateEnd, setDateEnd] = useState('');
  const [step, setStep] = useState<'date' | 'filter'>('date');
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [adsets, setAdsets] = useState<Adset[]>([]);
  const [ads, setAds] = useState<Ad[]>([]);
  const [selectedAdIds, setSelectedAdIds] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const adAccountIds = parseAdAccountIds(brand.metaAdAccountId || '');

  async function loadAds() {
    setLoading(true);
    setError('');
    try {
      if (dateStart > dateEnd) throw new Error('종료일은 시작일 이후여야 합니다.');
      const token = await user.getIdToken(true);
      const params = new URLSearchParams({
        mode: 'creative-options',
        adAccountId: brand.metaAdAccountId || '',
        dateStart,
        dateEnd
      });
      const resp = await fetch(`${apiPath}?${params}`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      const data = await readJsonResponse(resp);
      if (!resp.ok) throw new Error(data.error || 'Meta 광고 목록 조회에 실패했습니다.');
      if (!data.ads?.length) throw new Error('해당 기간에 이미지 조회가 가능한 광고가 없습니다.');
      setCampaigns(data.campaigns || []);
      setAdsets(data.adsets || []);
      setAds(data.ads);
      setSelectedAdIds(new Set(data.ads.map((ad: Ad) => ad.id)));
      setStep('filter');
    } catch (err) {
      setError(err instanceof Error ? err.message : '오류가 발생했습니다.');
    } finally {
      setLoading(false);
    }
  }

  function toggleItems(targetAds: Ad[]) {
    const ids = targetAds.map(ad => ad.id);
    const allSelected = ids.length > 0 && ids.every(id => selectedAdIds.has(id));
    setSelectedAdIds(previous => {
      const next = new Set(previous);
      if (allSelected) ids.forEach(id => next.delete(id));
      else ids.forEach(id => next.add(id));
      return next;
    });
  }

  function toggleAd(adId: string) {
    setSelectedAdIds(previous => {
      const next = new Set(previous);
      if (next.has(adId)) next.delete(adId);
      else next.add(adId);
      return next;
    });
  }

  function handleImport() {
    const selected = ads
      .filter(ad => selectedAdIds.has(ad.id))
      .map(ad => ({
        adId: ad.adId,
        campaignName: ad.campaignName,
        adgroupName: ad.adsetName,
        adName: ad.name
      }));
    onImport(selected, dateStart, dateEnd);
  }

  return (
    <div className="modal">
      <div className="modal-card meta-creative-modal">
        <h3>Meta 소재 이미지 불러오기</h3>
        {adAccountIds.length
          ? <p className="muted">Ad Accounts: {adAccountIds.map(id => `act_${id}`).join(', ')}</p>
          : <p style={{ color: 'var(--c-warn)' }}>브랜드 설정에서 Ad Account ID를 먼저 입력해주세요.</p>}

        {step === 'date' && (
          <>
            <div className="kpi-edit" style={{ gap: 12, marginTop: 16 }}>
              <label>
                시작일
                <input type="date" value={dateStart} onChange={event => setDateStart(event.target.value)} />
              </label>
              <label>
                종료일
                <input type="date" value={dateEnd} onChange={event => setDateEnd(event.target.value)} />
              </label>
            </div>
            {error && <p style={{ color: 'var(--c-danger)', fontSize: 13, marginTop: 8 }}>{error}</p>}
            <div className="modal-actions">
              <button type="button" className="btn outline" onClick={onClose}>취소</button>
              <button
                type="button"
                className="btn brand"
                disabled={!adAccountIds.length || !dateStart || !dateEnd || loading}
                onClick={loadAds}
              >
                {loading ? '광고 조회 중...' : '다음'}
              </button>
            </div>
          </>
        )}

        {step === 'filter' && (
          <>
            <div className="meta-filter-header">
              <span className="panel-title" style={{ margin: 0 }}>캠페인 / 광고세트 / 광고 선택</span>
              <div className="meta-filter-actions">
                <button type="button" className="btn outline compact" onClick={() => setSelectedAdIds(new Set(ads.map(ad => ad.id)))}>전체 선택</button>
                <button type="button" className="btn outline compact" onClick={() => setSelectedAdIds(new Set())}>전체 해제</button>
              </div>
            </div>
            <div className="meta-filter-list scrollbox meta-creative-filter-list">
              {campaigns.map(campaign => {
                const campaignAdsets = adsets.filter(adset => adset.campaignId === campaign.id);
                const campaignAds = ads.filter(ad => ad.campaignId === campaign.id);
                return (
                  <CampaignCreativeRow
                    key={campaign.id}
                    campaign={campaign}
                    adsets={campaignAdsets}
                    ads={campaignAds}
                    selectedAdIds={selectedAdIds}
                    onToggleCampaign={toggleItems}
                    onToggleAdset={toggleItems}
                    onToggleAd={toggleAd}
                  />
                );
              })}
            </div>
            <p className="muted meta-selection-count">
              {selectedAdIds.size.toLocaleString()} / {ads.length.toLocaleString()}개 광고 선택됨
            </p>
            {error && <p style={{ color: 'var(--c-danger)', fontSize: 13, marginTop: 8 }}>{error}</p>}
            <div className="modal-actions">
              <button type="button" className="btn outline" onClick={() => { setStep('date'); setError(''); }}>이전</button>
              <button type="button" className="btn brand" disabled={!selectedAdIds.size} onClick={handleImport}>
                이미지 불러오기
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

async function readJsonResponse(response: Response): Promise<any> {
  const text = await response.text();
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`서버 응답 오류 (${response.status}): ${text.replace(/\s+/g, ' ').slice(0, 160)}`);
  }
}

function parseAdAccountIds(value: string): string[] {
  return Array.from(new Set(
    value
      .split(/[\s,;]+/)
      .map(part => part.trim().replace(/^act_/, ''))
      .filter(Boolean)
  )).slice(0, 2);
}
