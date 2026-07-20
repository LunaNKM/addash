chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type !== 'GFU_DASH_COLLECT_SINGLEONE') return;

  collectAndSend(message.config)
    .then(result => sendResponse({ ok: true, ...result }))
    .catch(err => sendResponse({ ok: false, error: err.message || String(err) }));

  return true;
});

async function collectAndSend(config) {
  validateConfig(config);
  const rows = findRows(config);
  const rawAssets = rows
    .map(row => readAsset(row, config))
    .filter(asset => asset.adName && asset.mediaElement && asset.mediaUrl);
  if (!rawAssets.length) throw new Error('현재 페이지에서 이미지 또는 영상이 있는 소재 행을 찾지 못했습니다.');

  const assets = [];
  for (const raw of rawAssets) {
    try {
      const thumbnail = await mediaElementToWebpDataUrl(raw.mediaElement, raw.mediaUrl);
      assets.push({
        media: config.media || 's-meta',
        campaignName: raw.campaignName,
        adgroupName: raw.adgroupName,
        adName: raw.adName,
        imageData: thumbnail.imageData,
        mimeType: thumbnail.mimeType,
        width: thumbnail.width,
        height: thumbnail.height,
        imageHash: await sha256(thumbnail.imageData)
      });
    } catch (err) {
      throw new Error(`${raw.adName} 소재 처리 실패 (${safeSourceLabel(raw.mediaUrl)}): ${err.message || err}`);
    }
  }

  const upload = await chrome.runtime.sendMessage({
    type: 'GFU_DASH_UPLOAD_CREATIVES',
    config: {
      baseUrl: config.baseUrl,
      brandId: config.brandId,
      tabId: config.tabId,
      authToken: config.authToken,
      collectorToken: config.collectorToken
    },
    assets
  });
  if (!upload?.ok) throw new Error(upload?.error || 'GFU DASH 업로드에 실패했습니다.');
  return { count: upload.count || assets.length };
}

function validateConfig(config) {
  for (const key of ['baseUrl', 'brandId', 'tabId']) {
    if (!config?.[key]) throw new Error(`${key} 값이 필요합니다.`);
  }
  if (!config.authToken && !config.collectorToken) throw new Error('authToken 또는 collectorToken이 필요합니다.');
}

function findRows(config) {
  const selector = config.rowSelector || 'tr, [role="row"], [data-row-key], .ant-table-row';
  const candidates = [...new Set(document.querySelectorAll(selector))];
  return candidates.filter(row => {
    const hasCells = [...row.children].some(child => child.matches?.('td, [role="cell"], .ant-table-cell'));
    return hasCells && Boolean(row.querySelector('img, video'));
  });
}

function readAsset(row, config) {
  const selectors = config.selectors || {};
  const cells = [...row.children].filter(child => child.matches?.('td, [role="cell"], .ant-table-cell'));
  const indexes = readColumnIndexes(row, cells.length);
  const creativeCell = cells[indexes.creative] || row;
  const selectedMedia = selectors.image ? row.querySelector(selectors.image) : null;
  const mediaElement = resolveMediaElement(selectedMedia || creativeCell.querySelector('video, img') || row.querySelector('video, img'));

  return {
    campaignName: readText(row, selectors.campaignName) || readCellValue(cells[indexes.campaign]),
    adgroupName: readText(row, selectors.adgroupName) || readCellValue(cells[indexes.adgroup]),
    adName: readText(row, selectors.adName) || readCellValue(cells[indexes.adName]),
    mediaElement,
    mediaUrl: readMediaUrl(mediaElement)
  };
}

function readColumnIndexes(row, cellCount) {
  const table = row.closest('table');
  const headers = [...(table?.querySelectorAll('thead th') || [])].map(header => normalizeHeader(header.innerText));
  const findIndex = aliases => headers.findIndex(header => aliases.includes(header));
  const hasSingleOneLayout = cellCount >= 5;

  return {
    adName: validIndex(findIndex(['name', '소재명', '광고명']), hasSingleOneLayout ? 1 : 0),
    campaign: validIndex(findIndex(['campaign', '캠페인', '캠페인명']), hasSingleOneLayout ? 2 : 1),
    adgroup: validIndex(findIndex(['adgroup', '광고그룹', '광고그룹명']), hasSingleOneLayout ? 3 : 2),
    creative: validIndex(findIndex(['creative', '크리에이티브', '소재']), hasSingleOneLayout ? 4 : 3)
  };
}

function validIndex(index, fallback) {
  return index >= 0 ? index : fallback;
}

function readCellValue(cell) {
  if (!cell) return '';
  const labelled = cell.querySelector('[aria-label]');
  const ariaLabel = labelled?.getAttribute('aria-label');
  if (ariaLabel) return normalizeSpace(ariaLabel);
  const primaryText = cell.querySelector('p, [role="link"], a');
  return normalizeSpace(primaryText?.textContent || cell.textContent || '');
}

function readText(root, selector) {
  if (!selector) return '';
  const element = root.querySelector(selector);
  return normalizeSpace(element?.getAttribute?.('aria-label') || element?.innerText || element?.textContent || '');
}

function resolveMediaElement(element) {
  if (!element) return null;
  if (element.tagName === 'IMG' || element.tagName === 'VIDEO') return element;
  return element.querySelector?.('video, img') || null;
}

function readMediaUrl(element) {
  if (!element) return '';
  if (element.tagName === 'VIDEO') return element.currentSrc || element.src || element.poster || '';
  if (element.tagName === 'IMG') return element.currentSrc || element.src || '';
  return '';
}

async function mediaElementToWebpDataUrl(element, url) {
  if (element.tagName === 'VIDEO') return videoElementToWebpDataUrl(element, url);
  return imageElementToWebpDataUrl(element, url);
}

async function imageElementToWebpDataUrl(element, url) {
  try {
    await ensureImageReady(element);
    return drawMediaToWebp(element, element.naturalWidth, element.naturalHeight);
  } catch {
    const absoluteUrl = new URL(url, location.href).href;
    const response = await fetch(absoluteUrl, { credentials: 'include' });
    if (!response.ok) throw new Error(`이미지 다운로드 실패: ${response.status}`);
    const blob = await response.blob();
    if (blob.type && !blob.type.startsWith('image/')) {
      throw new Error(`이미지 대신 ${blob.type} 응답을 받았습니다.`);
    }
    return imageBlobToWebpDataUrl(blob);
  }
}

async function imageBlobToWebpDataUrl(blob) {
  const objectUrl = URL.createObjectURL(blob);
  try {
    const image = new Image();
    image.src = objectUrl;
    await ensureImageReady(image);
    return drawMediaToWebp(image, image.naturalWidth, image.naturalHeight);
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

async function videoElementToWebpDataUrl(element, url) {
  if (element.readyState >= 2 && element.videoWidth && element.videoHeight) {
    return drawMediaToWebp(element, element.videoWidth, element.videoHeight);
  }

  const video = document.createElement('video');
  video.muted = true;
  video.playsInline = true;
  video.preload = 'auto';
  video.src = new URL(url, location.href).href;
  video.style.cssText = 'position:fixed;left:-10000px;top:0;width:1px;height:1px;opacity:0;pointer-events:none';
  document.documentElement.appendChild(video);

  try {
    if (video.readyState < 2) await waitForMediaEvent(video, 'loadeddata', 15000);
    if (Number.isFinite(video.duration) && video.duration > 0.2) {
      video.currentTime = Math.min(0.1, video.duration / 2);
      await waitForMediaEvent(video, 'seeked', 10000);
    }
    return drawMediaToWebp(video, video.videoWidth, video.videoHeight);
  } finally {
    video.pause();
    video.removeAttribute('src');
    video.load();
    video.remove();
  }
}

function ensureImageReady(image) {
  if (image.complete && image.naturalWidth > 0) return Promise.resolve();
  return waitForMediaEvent(image, 'load', 10000);
}

function waitForMediaEvent(element, eventName, timeoutMs) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => finish(new Error(`${eventName} 대기 시간이 초과되었습니다.`)), timeoutMs);
    const onSuccess = () => finish();
    const onError = () => finish(new Error('미디어를 불러오지 못했습니다.'));

    function finish(error) {
      clearTimeout(timeout);
      element.removeEventListener(eventName, onSuccess);
      element.removeEventListener('error', onError);
      if (error) reject(error);
      else resolve();
    }

    element.addEventListener(eventName, onSuccess, { once: true });
    element.addEventListener('error', onError, { once: true });
  });
}

async function drawMediaToWebp(source, sourceWidth, sourceHeight) {
  if (!sourceWidth || !sourceHeight) throw new Error('미디어 크기를 확인할 수 없습니다.');
  const maxSize = 320;
  const ratio = Math.min(1, maxSize / Math.max(sourceWidth, sourceHeight));
  const width = Math.max(1, Math.round(sourceWidth * ratio));
  const height = Math.max(1, Math.round(sourceHeight * ratio));
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('이미지 캔버스를 초기화하지 못했습니다.');
  context.drawImage(source, 0, 0, width, height);
  const webp = await canvasToBlob(canvas, 'image/webp', 0.76);
  return {
    imageData: await blobToDataUrl(webp),
    mimeType: 'image/webp',
    width,
    height
  };
}

function canvasToBlob(canvas, type, quality) {
  return new Promise((resolve, reject) => {
    canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error('WebP 변환에 실패했습니다.')), type, quality);
  });
}

function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(reader.error || new Error('이미지 인코딩에 실패했습니다.'));
    reader.readAsDataURL(blob);
  });
}

async function sha256(value) {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('');
}

function safeSourceLabel(value) {
  try {
    const url = new URL(value, location.href);
    return `${url.host}${url.pathname}`;
  } catch {
    return '알 수 없는 주소';
  }
}

function normalizeHeader(value) {
  return normalizeSpace(value).normalize('NFKC').replace(/\s+/g, '').toLowerCase();
}

function normalizeSpace(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}
