import { NextResponse } from 'next/server';

const primaryAdminEmail = (process.env.GFU_DASH_PRIMARY_ADMIN_EMAIL || 'kangmin.j@gfutures.co').toLowerCase();

function webConfig() {
  const raw = process.env.FIREBASE_WEB_CONFIG;
  if (!raw) throw new Error('FIREBASE_WEB_CONFIG is missing.');
  return JSON.parse(raw);
}

async function verifyFirebaseToken(idToken: string): Promise<{ email: string } | null> {
  const { apiKey } = webConfig();
  const resp = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${apiKey}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ idToken })
  });
  if (!resp.ok) return null;
  const data = await resp.json();
  const email = data.users?.[0]?.email?.toLowerCase();
  return email ? { email } : null;
}

async function isInsightAdmin(email: string, idToken: string): Promise<boolean> {
  const normalized = email.toLowerCase();
  if (normalized === primaryAdminEmail) return true;

  const { projectId } = webConfig();
  if (!projectId) throw new Error('FIREBASE_WEB_CONFIG.projectId is missing.');

  const adminDocUrl = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents/admins/${encodeURIComponent(normalized)}`;
  const resp = await fetch(adminDocUrl, {
    headers: { Authorization: `Bearer ${idToken}` },
    cache: 'no-store'
  });

  if (resp.status === 404) return false;
  if (resp.ok) return true;
  throw new Error('관리자 권한 확인에 실패했습니다.');
}

function extractText(data: any): string {
  return data.output_text || data.output?.[0]?.content?.find((item: any) => item.type === 'output_text')?.text || '';
}

function normalizeComment(text: string): string {
  const clean = String(text || '').trim();
  if (!clean) return '';
  const hasSummary = clean.includes('[Summary]');
  const hasInsight = clean.includes('[Insight]');
  const hasAction = clean.includes('[Action]');
  if (hasSummary && hasInsight && hasAction) return clean;
  return `[Summary]\n${clean}`;
}

export async function POST(req: Request) {
  try {
    const auth = req.headers.get('authorization') || '';
    const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
    const user = token ? await verifyFirebaseToken(token) : null;
    const allowed = user ? await isInsightAdmin(user.email, token) : false;
    if (!user || !allowed) {
      return NextResponse.json({ error: '관리자 로그인 후 사용할 수 있습니다.' }, { status: 401 });
    }

    const body = await req.json();
    const {
      brandName,
      reportName,
      period,
      totalRange,
      current,
      previous,
      latestDay,
      recentDaily = [],
      promotions = [],
      media = [],
      objectives = [],
      campaigns = [],
      adgroups = [],
      creatives = []
    } = body || {};

    const prompt = `당신은 JP Meta 광고 주간/일간 보고서를 작성하는 퍼포먼스 마케터입니다.
아래 집계 데이터를 근거로 한국어 Comment를 작성하세요.

출력 형식:
[Summary]
- 전체 또는 주요 기간 Total 성과 1줄
- 최근일 또는 비교 기간 Total 성과 1줄
ㄴ 운영 캠페인/매체/목적을 한 줄로 요약

[Insight]
- 2~4개 묶음으로 작성
ㄴ 각 묶음에는 소진액, 전환/가입/구매, CPA/CPC/CVR/ROAS 등 근거 수치를 포함
ㄴ 소재/캠페인/광고세트명은 데이터에 있는 이름만 사용
ㄴ 성과 변화가 보이면 원인 후보를 데이터 기반으로 설명

[Action]
- 1~3개 제안
ㄴ 예산 이동, OFF/모니터링, 소재/타겟 운영 방향을 구체적으로 작성
ㄴ 확정적으로 단정하지 말고 "제안드립니다", "모니터링 예정입니다"처럼 보고서 톤을 유지

작성 규칙:
- 입력에 없는 수치를 만들지 마세요.
- 모든 금액은 원 단위로 표기하세요.
- 문장은 예시처럼 실무 보고서 톤으로 작성하세요.
- 섹션명은 반드시 [Summary], [Insight], [Action]만 사용하세요.
- 불릿은 "-"와 "ㄴ" 형식을 사용하세요.

브랜드: ${brandName || '-'}
보고서: ${reportName || '-'}
선택 기간: ${JSON.stringify(period)}
전체 데이터 범위: ${JSON.stringify(totalRange)}
선택 기간 Total: ${JSON.stringify(current)}
비교 기간 Total: ${JSON.stringify(previous)}
최근일 Total: ${JSON.stringify(latestDay)}
최근 일별: ${JSON.stringify(recentDaily)}
프로모션별: ${JSON.stringify(promotions)}
미디어별: ${JSON.stringify(media)}
목적별: ${JSON.stringify(objectives)}
캠페인별 상위: ${JSON.stringify(campaigns)}
광고세트별 상위: ${JSON.stringify(adgroups)}
소재별 상위: ${JSON.stringify(creatives)}`;

    const resp = await fetch('https://api.openai.com/v1/responses', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${process.env.OPENAI_API_KEY}` },
      body: JSON.stringify({ model: 'gpt-5.4', input: prompt, max_output_tokens: 2200 })
    });
    const data = await resp.json();
    if (!resp.ok) {
      return NextResponse.json({ error: data?.error?.message || 'OpenAI 요청 실패', details: data }, { status: resp.status });
    }

    return NextResponse.json({ text: normalizeComment(extractText(data)) });
  } catch (err: any) {
    return NextResponse.json({ error: err.message || 'Comment 생성 실패' }, { status: 500 });
  }
}
