export function normalizeCreativePart(value: unknown): string {
  return String(value || '')
    .normalize('NFKC')
    .trim()
    .replace(/\s+/g, ' ')
    .toLowerCase();
}

export function makeCreativeKey(input: {
  media?: string;
  campaignName?: string;
  adgroupName?: string;
  adName?: string;
}): string {
  return [
    normalizeCreativePart(input.media),
    normalizeCreativePart(input.campaignName),
    normalizeCreativePart(input.adgroupName),
    normalizeCreativePart(input.adName)
  ].join('|||');
}

export function creativeLabelFromKey(key: string): string {
  return key.split('|||').at(-1) || '이름 없는 소재';
}

export function creativeAssetId(key: string): string {
  let hash = 5381;
  for (let index = 0; index < key.length; index += 1) {
    hash = ((hash << 5) + hash) ^ key.charCodeAt(index);
  }
  return `creative_${(hash >>> 0).toString(36)}`;
}
