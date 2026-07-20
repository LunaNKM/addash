chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type !== 'GFU_DASH_UPLOAD_CREATIVES') return;

  uploadCreatives(message.config, message.assets)
    .then(result => sendResponse({ ok: true, ...result }))
    .catch(err => sendResponse({ ok: false, error: err.message || String(err) }));

  return true;
});

async function uploadCreatives(config, assets) {
  const headers = { 'Content-Type': 'application/json' };
  if (config.authToken) headers.Authorization = `Bearer ${config.authToken}`;
  else headers['X-Collector-Token'] = config.collectorToken;

  const response = await fetch(`${config.baseUrl.replace(/\/$/, '')}/api/singleone-creatives`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      brandId: config.brandId,
      tabId: config.tabId,
      assets
    })
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || `GFU DASH 업로드 실패 (${response.status})`);
  return { count: data.count || assets.length };
}
