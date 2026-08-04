'use client';

import { useEffect, useMemo, useRef, useState, type ChangeEvent, type DragEvent } from 'react';

const MAX_FILES = 20;
const MAX_IMAGE_FILE_BYTES = 25 * 1024 * 1024;
const MAX_VIDEO_FILE_BYTES = 250 * 1024 * 1024;
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
            <small>이미지 또는 영상 파일을 선택해 고해상도 썸네일로 소재에 연결합니다.</small>
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
    const mediaFiles = incoming.filter(file => isSupportedMediaFile(file));
    const acceptable = mediaFiles.filter(file => file.size <= sourceFileSizeLimit(file));
    const rejectedTypeCount = incoming.length - mediaFiles.length;
    const rejectedSizeCount = mediaFiles.length - acceptable.length;

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
    if (rejectedTypeCount) messages.push(`이미지·영상이 아닌 파일 ${rejectedTypeCount}개 제외`);
    if (rejectedSizeCount) messages.push(`허용 용량 초과 파일 ${rejectedSizeCount}개 제외`);
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
        setProgress(`${index + 1}/${items.length} 썸네일 생성 중`);
        const image = await optimizeMediaThumbnail(item.file);
        prepared.push({ ...target, fileName: item.file.name, ...image });
      }
      setProgress('썸네일 저장 중');
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
        <p className="muted">이미지 또는 영상 파일을 최대 20개까지 추가하고 연결할 소재를 확인해주세요. 영상은 대표 프레임만 썸네일로 저장됩니다.</p>

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
              <b>이미지 또는 영상을 여기에 드래그 앤 드롭</b>
              <span>이미지 최대 25MB · 영상 최대 250MB · 영상은 재생되지 않고 썸네일만 저장</span>
              <button type="button" className="btn outline" disabled={items.length >= MAX_FILES || processing} onClick={() => inputRef.current?.click()}>
                내 PC에서 찾기
              </button>
              <input ref={inputRef} hidden type="file" accept="image/*,video/*" multiple onChange={handleFileInput} />
            </div>

            <div className="creative-upload-list-head">
              <b>업로드 목록</b>
              <span>{items.length}/{MAX_FILES}</span>
            </div>
            {items.length > 0 ? (
              <div className="creative-upload-list">
                {items.map(item => (
                  <div className="creative-upload-item" key={item.id}>
                    {isVideoFile(item.file)
                      ? <video src={item.previewUrl} muted playsInline preload="metadata" aria-label={`${item.file.name} 영상 미리보기`} />
                      : <img src={item.previewUrl} alt="" />}
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

function isVideoFile(file: File): boolean {
  return file.type.startsWith('video/') || /\.(mp4|mov|m4v|webm|ogv)$/i.test(file.name);
}

function isSupportedMediaFile(file: File): boolean {
  return file.type.startsWith('image/')
    || /\.(jpe?g|png|webp|gif|bmp|avif)$/i.test(file.name)
    || isVideoFile(file);
}

function sourceFileSizeLimit(file: File): number {
  return isVideoFile(file) ? MAX_VIDEO_FILE_BYTES : MAX_IMAGE_FILE_BYTES;
}

type LoadedThumbnailSource = {
  source: CanvasImageSource;
  width: number;
  height: number;
  cleanup: () => void;
};

async function optimizeMediaThumbnail(file: File): Promise<{
  imageData: string;
  mimeType: string;
  width: number;
  height: number;
  imageHash: string;
}> {
  const loaded = isVideoFile(file) ? await loadVideoThumbnailSource(file) : await loadImageThumbnailSource(file);
  try {
    const scale = Math.min(1, MAX_IMAGE_DIMENSION / Math.max(loaded.width, loaded.height));
    let width = Math.max(1, Math.round(loaded.width * scale));
    let height = Math.max(1, Math.round(loaded.height * scale));
    let quality = 0.9;
    let imageData = '';

    for (let attempt = 0; attempt < 12; attempt += 1) {
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const context = canvas.getContext('2d');
      if (!context) throw new Error(`${file.name} 썸네일을 처리할 수 없습니다.`);
      context.imageSmoothingEnabled = true;
      context.imageSmoothingQuality = 'high';
      context.drawImage(loaded.source, 0, 0, width, height);
      imageData = canvas.toDataURL('image/webp', quality);
      if (imageData.length <= MAX_IMAGE_DATA_LENGTH) break;
      if (quality > 0.56) quality -= 0.08;
      else {
        width = Math.max(1, Math.round(width * 0.84));
        height = Math.max(1, Math.round(height * 0.84));
      }
    }

    if (!imageData || imageData.length > MAX_IMAGE_DATA_LENGTH) {
      throw new Error(`${file.name}의 썸네일 용량을 안전하게 줄이지 못했습니다.`);
    }

    const bytes = Uint8Array.from(atob(imageData.split(',')[1] || ''), character => character.charCodeAt(0));
    const digest = await crypto.subtle.digest('SHA-256', bytes);
    const imageHash = Array.from(new Uint8Array(digest)).map(byte => byte.toString(16).padStart(2, '0')).join('');
    return { imageData, mimeType: 'image/webp', width, height, imageHash };
  } finally {
    loaded.cleanup();
  }
}

function loadImageThumbnailSource(file: File): Promise<LoadedThumbnailSource> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    const url = URL.createObjectURL(file);
    image.onload = () => {
      URL.revokeObjectURL(url);
      resolve({
        source: image,
        width: image.naturalWidth,
        height: image.naturalHeight,
        cleanup: () => undefined
      });
    };
    image.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error(`${file.name} 이미지 형식을 읽을 수 없습니다.`));
    };
    image.src = url;
  });
}

function loadVideoThumbnailSource(file: File): Promise<LoadedThumbnailSource> {
  return new Promise((resolve, reject) => {
    const video = document.createElement('video');
    const url = URL.createObjectURL(file);
    let settled = false;
    const timeout = window.setTimeout(() => fail('대표 프레임 추출 시간이 초과되었습니다.'), 20_000);

    function cleanup() {
      window.clearTimeout(timeout);
      video.removeAttribute('src');
      video.load();
      URL.revokeObjectURL(url);
    }

    function fail(reason: string) {
      if (settled) return;
      settled = true;
      cleanup();
      reject(new Error(`${file.name} 영상에서 썸네일을 만들 수 없습니다. ${reason}`));
    }

    function finish() {
      if (settled) return;
      if (!video.videoWidth || !video.videoHeight) {
        fail('지원되지 않는 영상 코덱일 수 있습니다.');
        return;
      }
      settled = true;
      window.clearTimeout(timeout);
      resolve({
        source: video,
        width: video.videoWidth,
        height: video.videoHeight,
        cleanup
      });
    }

    video.preload = 'auto';
    video.muted = true;
    video.playsInline = true;
    video.onloadeddata = () => {
      const duration = Number.isFinite(video.duration) ? video.duration : 0;
      const targetTime = Math.min(1, Math.max(0, duration * 0.1));
      if (targetTime > 0.05) video.currentTime = targetTime;
      else finish();
    };
    video.onseeked = finish;
    video.onerror = () => fail('브라우저에서 지원하지 않는 영상 형식 또는 코덱입니다.');
    video.src = url;
    video.load();
  });
}

function formatBytes(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
  return `${Math.max(1, Math.round(bytes / 1024)).toLocaleString()}KB`;
}
