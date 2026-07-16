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
  const rawAssets = rows.map(row => readAsset(row, config)).filter(asset => asset.adName && asset.imageUrl);
  if (!rawAssets.length) throw new Error('No creative rows with images were found on this page.');

  const assets = [];
  for (const raw of rawAssets) {
    const image = await imageUrlToWebpDataUrl(raw.imageUrl);
    assets.push({
      media: config.media || 's-meta',
      campaignName: raw.campaignName,
      adgroupName: raw.adgroupName,
      adName: raw.adName,
      imageData: image.imageData,
      mimeType: image.mimeType,
      width: image.width,
      height: image.height,
      imageHash: await sha256(image.imageData)
    });
  }

  const headers = {
    'Content-Type': 'application/json'
  };
  if (config.authToken) headers.Authorization = `Bearer ${config.authToken}`;
  else headers['X-Collector-Token'] = config.collectorToken;

  const resp = await fetch(`${config.baseUrl.replace(/\/$/, '')}/api/singleone-creatives`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      brandId: config.brandId,
      tabId: config.tabId,
      assets
    })
  });
  const data = await resp.json().catch(() => ({}));
  if (!resp.ok) throw new Error(data.error || `GFU DASH upload failed (${resp.status})`);
  return { count: data.count || assets.length };
}

function validateConfig(config) {
  for (const key of ['baseUrl', 'brandId', 'tabId']) {
    if (!config?.[key]) throw new Error(`${key} is required.`);
  }
  if (!config.authToken && !config.collectorToken) throw new Error('authToken or collectorToken is required.');
}

function findRows(config) {
  if (config.rowSelector) return [...document.querySelectorAll(config.rowSelector)];
  const candidates = [
    ...document.querySelectorAll('tr'),
    ...document.querySelectorAll('[role="row"]'),
    ...document.querySelectorAll('[data-row-key]'),
    ...document.querySelectorAll('.ant-table-row')
  ];
  return candidates.filter(row => row.querySelector('img') && normalizeSpace(row.innerText).length > 8);
}

function readAsset(row, config) {
  const selectors = config.selectors || {};
  const cells = [...row.querySelectorAll('td, [role="cell"], .ant-table-cell')];
  const texts = cells.map(cell => normalizeSpace(cell.innerText)).filter(Boolean);
  const rowText = normalizeSpace(row.innerText);
  const img = selectors.image ? row.querySelector(selectors.image) : row.querySelector('img');
  const imageUrl = readImageUrl(img || row);

  return {
    campaignName: readText(row, selectors.campaignName) || texts[0] || '',
    adgroupName: readText(row, selectors.adgroupName) || texts[1] || '',
    adName: readText(row, selectors.adName) || texts[2] || rowText,
    imageUrl
  };
}

function readText(root, selector) {
  if (!selector) return '';
  return normalizeSpace(root.querySelector(selector)?.innerText || root.querySelector(selector)?.textContent || '');
}

function readImageUrl(element) {
  if (!element) return '';
  if (element.tagName === 'IMG') return element.currentSrc || element.src || '';
  const img = element.querySelector?.('img');
  if (img) return img.currentSrc || img.src || '';
  const background = getComputedStyle(element).backgroundImage || '';
  const matched = background.match(/url\(["']?(.+?)["']?\)/);
  return matched?.[1] || '';
}

async function imageUrlToWebpDataUrl(url) {
  const absoluteUrl = new URL(url, location.href).href;
  const response = await fetch(absoluteUrl, { credentials: 'include' });
  if (!response.ok) throw new Error(`Image download failed: ${response.status}`);
  const blob = await response.blob();
  const bitmap = await createImageBitmap(blob);
  const maxSize = 320;
  const ratio = Math.min(1, maxSize / Math.max(bitmap.width, bitmap.height));
  const width = Math.max(1, Math.round(bitmap.width * ratio));
  const height = Math.max(1, Math.round(bitmap.height * ratio));
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Image canvas initialization failed.');
  context.drawImage(bitmap, 0, 0, width, height);
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
    canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error('WebP conversion failed.')), type, quality);
  });
}

function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(reader.error || new Error('Image encoding failed.'));
    reader.readAsDataURL(blob);
  });
}

async function sha256(value) {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('');
}

function normalizeSpace(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}
