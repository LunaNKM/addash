import { NextResponse } from 'next/server';
import { isAdminEmailServer } from '@/lib/server/firestoreRest';

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
  return isAdminEmailServer(email, idToken, primaryAdminEmail);
}

function extractText(data: any): string {
  return data.output_text || data.output?.[0]?.content?.find((item: any) => item.type === 'output_text')?.text || '';
}

function normalizeComment(text: string): string {
  let clean = String(text || '').replace(/\r\n/g, '\n').trim();
  if (!clean) return '';
  // 모델이 코드블록/마크다운 헤더를 붙이는 경우 제거 (사람이 쓴 메모처럼 보이도록)
  clean = clean.replace(/```[a-z]*\n?/gi, '').replace(/^#{1,6}\s*/gm, '');
  // 혹시 라벨 앞뒤에 군더더기가 붙어도 핵심 골격만 남도록 과도한 빈 줄 정리
  clean = clean.replace(/\n{3,}/g, '\n\n').trim();
  return clean;
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
      supportingCreativeSignals = []
    } = body || {};

    const prompt = `당신은 JP Meta 광고 성과를 매일 들여다보는 실무 퍼포먼스 마케터입니다.
아래 집계 데이터만 근거로, 동료에게 빠르게 공유하는 운영 메모처럼 한국어 Comment를 작성하세요.

가장 중요한 것 (반드시 지킬 것):
- "사람이 손으로 적은 메모"처럼 보여야 합니다. AI가 쓴 티가 조금이라도 나면 실패입니다.
- 매끄러운 완결형 보고서 문장 대신, 짧은 단문·명사구 위주로 끊어 쓰세요. (예: "전환율 감소", "CPM 증가", "포어세트 07로 광고비 집중")
- "~을 제안드립니다 / ~로 판단됩니다 / 종합하면 / 결론적으로 / 살펴보면 / 나타났습니다" 같은 정형 보고체·상투어는 절대 쓰지 마세요.
- 확실치 않은 해석은 문장 끝에 "(가설)"을 붙이세요. 인과·전환은 "A -> B" 화살표로 짧게 이으세요.
- 소재는 캠페인 성과 변동을 설명하는 보조로만 짧게. 소재명 단순 나열·순위 평가는 하지 마세요.

출력 구조 (데이터가 완전히 달라져도 이 골격을 항상 그대로 유지):

현 상황

[Daily]
(최근 흐름을 3~5줄. 전환율/CPM/ROAS/매출/광고비 중 실제로 움직인 지표만 짧은 단문으로. 사은품·프로모션 변화 같은 운영 이벤트가 데이터에 있으면 "A -> B"로. 불확실하면 "(가설)".)

[<핵심 프로모션 또는 전체 흐름 라벨>]
(왜 이런 흐름인지 배경·소비자 반응·추이 해석을 2~4줄. 근거가 약하면 "(가설)". 인과는 "-> "로.)

[<광고비/성과 상위 캠페인 또는 광고세트명>]
(그 캠페인에서 광고비가 어디로 쏠리는지, 전환/ROAS 방향, 소재 상태를 2~3줄.)
(상위 캠페인/광고세트를 1~3개, 각각 이런 블록으로 반복.)

NEXT

[META 소재]
(무엇이 문제인지 1~2줄 진단 후, 실행 액션을 번호로.)
1) ...
2) ...
3) ...
(액션은 "예산 이동 / OFF / 별도 광고세트 생성 / 우선 대기·모니터링"처럼 실행 단위로 1~3개.)

작성·형식 규칙:
- 블록 라벨은 반드시 대괄호 [ ]로 감싸고, 본문 문장 안에는 대괄호를 쓰지 마세요.
- "현 상황", "NEXT"는 정확히 그 표기로 각각 한 줄에 두세요.
- 본문 줄 앞에 "-", "•", "ㄴ" 같은 불릿 기호를 붙이지 마세요. 그냥 줄바꿈으로 나열하세요. (번호 액션 "1)"만 예외)
- 입력에 없는 수치·날짜·고유명사는 만들지 마세요. 캠페인/광고세트/프로모션명은 데이터 표기를 그대로.
- 금액은 원 단위. 수치는 판단을 뒷받침할 때만 최소한으로, 나열식으로 늘어놓지 마세요.
- 분량은 예시와 비슷하게: 현 상황 약 12~18줄, NEXT 약 5~8줄. 마크다운(#, \`\`\`, **)은 쓰지 마세요.

아래는 '형식과 말투'만 참고하는 샘플입니다. 여기 나온 브랜드/소재명(골드세트·포어세트 등)·날짜·"메가와리" 같은 고유 정보는 절대 복사하지 말고, 오직 제공된 데이터로만 채우세요.
--- 형식 참고 예시 (내용 복사 금지) ---
현 상황

[Daily]
전환율 감소
CPM 증가
토너 사은품 -> 에멀젼 사은품
토너 대비 에멀젼 니즈가 적다 (가설)

[프로모션]
일자별 사은품이 달라 초반 사은품 구매 대기 (가설)
-> 전환율 감소
프로모션 초기에 전환율·매출 높게 형성 -> 점차 감소하는 추이
라이브 예고로 소비자가 그 시점을 기다리는 중일 수 있음

[골드세트 02]
전환 극대화 - 카테고리 / 리타겟팅
골드세트 02 -> 01로 광고비 집중되나, 전환율 감소로 전반 ROAS 동반 하락

[포어세트 06]
포어세트 07로 광고비 집중
후킹성 우수, 이전 06 소재 수명이 다함

NEXT

[META 소재]
고효율 소재였으나 최근 다른 소재로 노출 집중되며 성과 저하
집중된 타 소재도 성과 부진
1) 이전 고효율 소재 별도 광고세트 생성해 운영
2) 성과 낮은 세트 OFF -> 고효율 세트로 광고비 집중
3) 소진 적은 소재는 대체 소재 성과 우수하므로 우선 대기
--- 예시 끝 ---

브랜드: ${brandName || '-'}
보고서: ${reportName || '-'}
선택 기간: ${JSON.stringify(period)}
전체 데이터 범위: ${JSON.stringify(totalRange)}
선택 기간 Total: ${JSON.stringify(current)}
비교 기간 Total: ${JSON.stringify(previous)}
최근일 Total: ${JSON.stringify(latestDay)}
최근 일별 흐름: ${JSON.stringify(recentDaily)}
프로모션별 성과: ${JSON.stringify(promotions)}
미디어별 성과: ${JSON.stringify(media)}
목적별 성과: ${JSON.stringify(objectives)}
캠페인별 상위 성과: ${JSON.stringify(campaigns)}
광고세트별 상위 성과: ${JSON.stringify(adgroups)}
소재 보조 신호(필요할 때만 짧게 참고): ${JSON.stringify(supportingCreativeSignals)}`;

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
