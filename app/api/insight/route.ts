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

function stripInsight(text: string) {
  return String(text || '')
    .split('\n')
    .map(line => line.trim())
    .filter(Boolean)
    .filter(line => !/^(총평|결론|요약)[:：]/.test(line))
    .filter(line => !/(제안|권장|추천|개선|확대|축소|조정|실행|액션)/.test(line))
    .map(line => line.startsWith('•') ? '• ' + line.replace(/^•\s*/, '') : '• ' + line)
    .map(line => wrap(line, 40))
    .join('\n');
}

function wrap(line: string, max = 40) {
  if (line.length <= max) return line;
  const prefix = line.startsWith('• ') ? '• ' : '';
  const indent = prefix ? '  ' : '';
  const body = prefix ? line.slice(2) : line;
  const out: string[] = [];
  let cur = prefix;
  for (const token of body.split(/(\s+)/)) {
    if (!token) continue;
    if ((cur + token).length > max && cur.trim().length > prefix.length) {
      out.push(cur.trimEnd());
      cur = indent + token.trimStart();
    } else {
      cur += token;
    }
  }
  if (cur.trim()) out.push(cur.trimEnd());
  return out.join('\n');
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
    const { brandName, tabName, total, adsets = [], campaigns = [], daily = [] } = body || {};
    const prompt = `당신은 Meta 광고 성과 분석가입니다. 아래 데이터를 바탕으로 한국어 인사이트만 작성하세요.\n\n규칙:\n- 제안/권장/개선/실행/액션 문장 금지\n- 총평/결론/요약 금지\n- 3~5개 bullet\n- 각 문장은 40자 이내\n- 관찰된 사실과 수치만 작성\n\n브랜드: ${brandName}\n탭: ${tabName}\n전체: ${JSON.stringify(total)}\n광고세트 상위: ${JSON.stringify(adsets.slice(0, 12))}\n캠페인 상위: ${JSON.stringify(campaigns.slice(0, 12))}\n일별: ${JSON.stringify(daily.slice(0, 20))}`;

    const resp = await fetch('https://api.openai.com/v1/responses', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${process.env.OPENAI_API_KEY}` },
      body: JSON.stringify({ model: 'gpt-5.4', input: prompt, max_output_tokens: 900 })
    });
    const data = await resp.json();
    if (!resp.ok) {
      return NextResponse.json({ error: data?.error?.message || 'OpenAI 요청 실패', details: data }, { status: resp.status });
    }
    const text = data.output_text || data.output?.[0]?.content?.find((x: any) => x.type === 'output_text')?.text || '';
    return NextResponse.json({ text: stripInsight(text) });
  } catch (err: any) {
    return NextResponse.json({ error: err.message || '인사이트 생성 실패' }, { status: 500 });
  }
}
