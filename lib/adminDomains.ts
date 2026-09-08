/**
 * 회사 도메인 계정은 admins 컬렉션에 따로 등록하지 않아도 관리자로 본다.
 *
 * 로그인은 Google 계정으로만 되기 때문에 도메인은 구글이 보증한다. 그동안은
 * admins에 등록된 사람만 통과해서, 같은 회사 사람이 Comment를 저장하면
 * 권한 오류가 났다.
 *
 * 이 목록은 클라이언트(Firestore 규칙 통과 여부 판단)와 서버 API가 함께 쓴다.
 * 실제 쓰기 허용은 firestore.rules의 isCompanyAdmin()이 결정하므로,
 * 도메인을 바꾸면 규칙도 함께 배포해야 한다.
 */
const DEFAULT_ADMIN_EMAIL_DOMAINS = ['gfutures.co'];

export function adminEmailDomains(): string[] {
  const raw = process.env.GFU_DASH_ADMIN_EMAIL_DOMAINS || process.env.NEXT_PUBLIC_ADMIN_EMAIL_DOMAINS || '';
  const configured = raw.split(',').map(item => item.trim().toLowerCase().replace(/^@/, '')).filter(Boolean);
  return configured.length ? configured : DEFAULT_ADMIN_EMAIL_DOMAINS;
}

export function isCompanyAdminEmail(email: string | null | undefined): boolean {
  const normalized = (email || '').trim().toLowerCase();
  const at = normalized.lastIndexOf('@');
  if (at < 1) return false;
  const domain = normalized.slice(at + 1);
  return adminEmailDomains().includes(domain);
}
