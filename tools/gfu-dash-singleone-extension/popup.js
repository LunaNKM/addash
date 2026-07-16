const configJson = document.getElementById('configJson');
const rowSelector = document.getElementById('rowSelector');
const fieldSelectors = document.getElementById('fieldSelectors');
const statusEl = document.getElementById('status');
const saveBtn = document.getElementById('save');
const sendBtn = document.getElementById('send');

chrome.storage.sync.get(['gfuDashCollector'], data => {
  const saved = data.gfuDashCollector || {};
  configJson.value = saved.configJson || '';
  rowSelector.value = saved.rowSelector || '';
  fieldSelectors.value = saved.fieldSelectors || '';
});

saveBtn.addEventListener('click', async () => {
  await saveConfig();
  setStatus('설정을 저장했습니다.');
});

sendBtn.addEventListener('click', async () => {
  try {
    const config = await saveConfig();
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id) throw new Error('현재 탭을 찾을 수 없습니다.');

    setStatus('싱글원 페이지에서 소재를 수집하는 중...');
    const response = await chrome.tabs.sendMessage(tab.id, {
      type: 'GFU_DASH_COLLECT_SINGLEONE',
      config
    });
    if (!response?.ok) throw new Error(response?.error || '수집에 실패했습니다.');
    setStatus(`전송 완료: ${response.count}개 소재`);
  } catch (err) {
    setStatus(`오류: ${err.message || err}`);
  }
});

async function saveConfig() {
  const base = parseJson(configJson.value, 'GFU DASH 설정 JSON');
  const selectors = fieldSelectors.value.trim()
    ? parseJson(fieldSelectors.value, '선택자 JSON')
    : {};
  const config = {
    ...base,
    rowSelector: rowSelector.value.trim(),
    selectors
  };
  await chrome.storage.sync.set({
    gfuDashCollector: {
      configJson: configJson.value,
      rowSelector: rowSelector.value,
      fieldSelectors: fieldSelectors.value
    }
  });
  return config;
}

function parseJson(value, label) {
  try {
    const parsed = JSON.parse(value || '{}');
    if (!parsed || typeof parsed !== 'object') throw new Error();
    return parsed;
  } catch {
    throw new Error(`${label} 형식이 올바르지 않습니다.`);
  }
}

function setStatus(message) {
  statusEl.textContent = message;
}
