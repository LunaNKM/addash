'use client';

import { useEffect, useMemo, useRef, useState, type ChangeEvent, type DragEvent } from 'react';

const MAX_FILES = 20;
const MAX_SOURCE_FILE_BYTES = 25 * 1024 * 1024;
const MAX_IMAGE_DATA_LENGTH = 760_000;
const MAX_IMAGE_DIMENSION = 2048;

export type CreativeUploadTarget = {
  key: string;
  label: string;
  campaignName: string;
  adgroupName: string;
  adName: string;
  media: string;
};

export type PreparedCreativeUpload = CreativeUploadTarget & {
  fileName: string;
  imageData: string;
  mimeType: string;
  width: number;
  height: number;
  imageHash: string;
};

type UploadItem = {
  id: string;
  file: File;
  previewUrl: string;
  targetKey: string;
};

export function ImageImportSourceModal({
  onClose,
  onSelectMeta,
  onSelectUpload
}: {
  onClose: () => void;
  onSelectMeta: () => void;
  onSelectUpload: () => void;
}) {
  return (
    <div className="modal" role="dialog" aria-modal="true" aria-label="이미지 불러오기 방식 선택">
      <div className="modal-card image-import-source-modal">
        <h3>이미지 불러오기</h3>
        <p className="muted">소재 이미지를 가져올 방식을 선택해주세요.</p>
        <div className="image-import-source-grid">
          <button type="button" className="image-import-source-card" onClick={onSelectMeta}>
            <span className="image-import-source-icon" aria-hidden="true">M</span>
            <b>META API</b>
            <small>Meta 광고에서 소재 이미지를 자동으로 불러옵니다.</small>
          </button>
          <button type="button" className="image-import-source-card" onClick={onSelectUpload}>
            <span className="image-import-source-icon upload" aria-hidden="true">↑</span>
            <b>직접 업로드</b>
            <small>고해상도 이미지 파일을 직접 선택해 소재에 연결합니다.</small>
          </button>
        </div>
        <div className="modal-actions">
          <button type="button" className="btn outline" onClick={onClose}>취소</button>
        </div>
      </div>
    </div>
  );
}

export function DirectCreativeUploadModal({
  targets,
  onClose,
  onUpload
}: {
  targets: CreativeUploadTarget[];
  onClose: () => void;
  onUpload: (uploads: PreparedCreativeUpload[]) => Promise<void>;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const itemsRef = useRef<UploadItem[]>([]);
  const [items, setItems] = useState<UploadItem[]>([]);
  const [dragging, setDragging] = useState(false);
  const [processing, setProcessing] = useState(false);
  const [progress, setProgress] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    itemsRef.current = items;
  }, [items]);

  useEffect(() => () => {
    itemsRef.current.forEach(item => URL.revokeObjectURL(item.previewUrl));
  }, []);

  const selectedKeys = useMemo(() => new Set(items.map(item => item.targetKey).filter(Boolean)), [items]);
  const ready = items.length > 0
    && items.every(item => item.targetKey)
    && selectedKeys.size === items.length
    && !processing;

  function appendFiles(fileList: FileList | File[]) {
    const incoming = Array.from(fileList);
    const images = incoming.filter(file => file.type.startsWith('image/'));
    const acceptable = images.filter(file => file.size <= MAX_SOURCE_FILE_BYTES);
    const rejectedTypeCount = incoming.length - images.length;
    const rejectedSizeCount = images.length - acceptable.length;

    setItems(current => {
      const known = new Set(current.map(item => fileIdentity(item.file)));
      const availableCount = Math.max(0, MAX_FILES - current.length);
      const uniqueFiles = acceptable.filter(file => !known.has(fileIdentity(file))).slice(0, availableCount);
      const usedTargets = new Set(current.map(item => item.targetKey).filter(Boolean));
      const added = uniqueFiles.map(file => {
        const targetKey = findMatchingTarget(file.name, targets, usedTargets);
        if (targetKey) usedTargets.add(targetKey);
        return {
          id: `${fileIdentity(file)}-${crypto.randomUUID()}`,
          file,
          previewUrl: URL.createObjectURL(file),
          targetKey
        };
      });
      return [...current, ...added];
    });

    const messages: string[] = [];
    if (rejectedTypeCount) messages.push(`이미지가 아닌 파일 ${rejectedTypeCount}개 제외`);
    if (rejectedSizeCount) messages.push(`25MB 초과 파일 ${rejectedSizeCount}개 제외`);
    if (items.length + acceptable.length > MAX_FILES) messages.push(`한 번에 최대 ${MAX_FILES}개까지만 추가`);
    setError(messages.join(' · '));
  }

  function handleFileInput(event: ChangeEvent<HTMLInputElement>) {
    if (event.target.files) appendFiles(event.target.files);
    event.target.value = '';
  }

  function handleDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    setDragging(false);
    appendFiles(event.dataTransfer.files);
  }

  function removeItem(id: string) {
    setItems(current => {
      const removed = current.find(item => item.id === id);
      if (removed) URL.revokeObjectURL(removed.previewUrl);
      return current.filter(item => item.id !== id);
    });
  }

  async function submit() {
    if (!ready) return;
    setProcessing(true);
    setError('');
    try {
      const targetByKey = new Map(targets.map(target => [target.key, target]));
      const prepared: PreparedCreativeUpload[] = [];
      for (let index = 0; index < items.length; index += 1) {
        const item = items[index];
        const target = targetByKey.get(item.targetKey);
        if (!target) throw new Error(`${item.file.name}에 연결할 소재를 선택해주세요.`);
        setProgress(`${index + 1}/${items.length} 이미지 최적화 중`);
        const image = await optimizeImage(item.file);
        prepared.push({ ...target, fileName: item.file.name, ...image });
      }
      setProgress('이미지 저장 중');
      await onUpload(prepared);
    } catch (err) {
      setError(err instanceof Error ? err.message : '이미지 업로드 중 오류가 발생했습니다.');
      setProcessing(false);
      setProgress('');
    }
  }

  return (
    <div className="modal" role="dialog" aria-modal="true" aria-label="소재 이미지 직접 업로드">
      <div className="modal-card creative-upload-modal">
        <h3>소재 이미지 직접 업로드</h3>
        <p className="muted">고해상도 이미지 파일을 최대 20개까지 추가하고 연결할 소재를 확인해주세요.</p>

        {!targets.length && (
          <div className="creative-upload-empty">
            현재 보고서에 연결할 소재가 없습니다. 먼저 RAW 또는 META API 데이터를 불러와주세요.
          </div>
        )}

        {targets.length > 0 && (
          <>
            <div
              className={`creative-upload-dropzone ${dragging ? 'dragging' : ''}`}
              onDragEnter={event => { event.preventDefault(); setDragging(true); }}
              onDragOver={event => event.preventDefault()}
              onDragLeave={event => {
                if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDragging(false);
              }}
              onDrop={handleDrop}
            >
              <span className="creative-upload-drop-icon" aria-hidden="true">↑</span>
              <b>이미지를 여기에 드래그 앤 드롭</b>
              <span>JPG, PNG, WebP 등 이미지 파일 · 파일당 최대 25MB</span>
              <button type="button" className="btn outline" disabled={items.length >= MAX_FILES || processing} onClick={() => inputRef.current?.click()}>
                내 PC에서 찾기
              </button>
              <input ref={inputRef} hidden type="file" accept="image/*" multiple onChange={handleFileInput} />
            </div>

            <div className="creative-upload-list-head">
              <b>업로드 목록</b>
              <span>{items.length}/{MAX_FILES}</span>
            </div>
            {items.length > 0 ? (
              <div className="creative-upload-list">
                {items.map(item => (
                  <div className="creative-upload-item" key={item.id}>
                    <img src={item.previewUrl} alt="" />
                    <div className="creative-upload-file">
                      <b title={item.file.name}>{item.file.name}</b>
                      <span>{formatBytes(item.file.size)}</span>
                    </div>
                    <label>
                      <span>연결할 소재</span>
                      <select
                        value={item.targetKey}
                        disabled={processing}
                        onChange={event => setItems(current => current.map(currentItem => currentItem.id === item.id
                          ? { ...currentItem, targetKey: event.target.value }
                          : currentItem))}
                      >
                        <option value="">소재를 선택해주세요</option>
                        {targets.map(target => (
                          <option
                            key={target.key}
                            value={target.key}
                            disabled={selectedKeys.has(target.key) && item.targetKey !== target.key}
                          >
                            {targetOptionLabel(target)}
                          </option>
                        ))}
                      </select>
                    </label>
                    <button type="button" className="creative-upload-remove" aria-label={`${item.file.name} 제거`} disabled={processing} onClick={() => removeItem(item.id)}>×</button>
                  </div>
                ))}
              </div>
            ) : (
              <div className="creative-upload-empty">추가된 이미지가 없습니다.</div>
            )}
          </>
        )}

        {error && <p className="creative-upload-error">{error}</p>}
        {progress && <p className="creative-upload-progress">{progress}</p>}
        <div className="modal-actions">
          <button type="button" className="btn outline" disabled={processing} onClick={onClose}>취소</button>
          <button type="button" className="btn brand" disabled={!ready} onClick={submit}>
            {processing ? progress || '처리 중' : `${items.length.toLocaleString()}개 업로드`}
          </button>
        </div>
      </div>
    </div>
  );
}

function fileIdentity(file: File): string {
  return `${file.name}:${file.size}:${file.lastModified}`;
}

function targetOptionLabel(target: CreativeUploadTarget): string {
  const context = [target.campaignName, target.adgroupName].filter(Boolean).join(' › ');
  return context ? `${target.label} — ${context}` : target.label;
}

function findMatchingTarget(fileName: string, targets: CreativeUploadTarget[], usedTargets: Set<string>): string {
  const baseName = normalizeMatchText(fileName.replace(/\.[^.]+$/, ''));
  if (!baseName) return '';
  const available = targets.filter(target => !usedTargets.has(target.key));
  const exact = available.find(target => normalizeMatchText(target.adName || target.label) === baseName);
  if (exact) return exact.key;
  const partial = available.filter(target => {
    const targetName = normalizeMatchText(target.adName || target.label);
    return targetName.length >= 3 && (baseName.includes(targetName) || targetName.includes(baseName));
  });
  return partial.length === 1 ? partial[0].key : '';
}

function normalizeMatchText(value: string): string {
  return value.normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');
}

async function optimizeImage(file: File): Promise<{
  imageData: string;
  mimeType: string;
  width: number;
  height: number;
  imageHash: string;
}> {
  const image = await loadImage(file);
  const scale = Math.min(1, MAX_IMAGE_DIMENSION / Math.max(image.naturalWidth, image.naturalHeight));
  let width = Math.max(1, Math.round(image.naturalWidth * scale));
  let height = Math.max(1, Math.round(image.naturalHeight * scale));
  let quality = 0.9;
  let imageData = '';

  for (let attempt = 0; attempt < 12; attempt += 1) {
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext('2d');
    if (!context) throw new Error(`${file.name} 이미지를 처리할 수 없습니다.`);
    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = 'high';
    context.drawImage(image, 0, 0, width, height);
    imageData = canvas.toDataURL('image/webp', quality);
    if (imageData.length <= MAX_IMAGE_DATA_LENGTH) break;
    if (quality > 0.56) quality -= 0.08;
    else {
      width = Math.max(1, Math.round(width * 0.84));
      height = Math.max(1, Math.round(height * 0.84));
    }
  }

  if (!imageData || imageData.length > MAX_IMAGE_DATA_LENGTH) {
    throw new Error(`${file.name}의 용량을 안전하게 줄이지 못했습니다. 더 작은 이미지를 사용해주세요.`);
  }

  const bytes = Uint8Array.from(atob(imageData.split(',')[1] || ''), character => character.charCodeAt(0));
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  const imageHash = Array.from(new Uint8Array(digest)).map(byte => byte.toString(16).padStart(2, '0')).join('');
  return { imageData, mimeType: 'image/webp', width, height, imageHash };
}

function loadImage(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    const url = URL.createObjectURL(file);
    image.onload = () => {
      URL.revokeObjectURL(url);
      resolve(image);
    };
    image.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error(`${file.name} 이미지 형식을 읽을 수 없습니다.`));
    };
    image.src = url;
  });
}

function formatBytes(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
  return `${Math.max(1, Math.round(bytes / 1024)).toLocaleString()}KB`;
}
