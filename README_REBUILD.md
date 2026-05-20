# GFU DASH Next.js + Firebase 재작성본

이 버전은 기존 순수 HTML/단일 app.js/Supabase/Firebase REST 래퍼 누적 패치 구조를 폐기하고, Next.js + TypeScript + Firebase Web SDK로 다시 구성한 버전입니다.

## 사용 환경변수

Vercel에는 아래 3개 이름으로 등록합니다.

```txt
FIREBASE_WEB_CONFIG={"apiKey":"...","authDomain":"...firebaseapp.com","projectId":"...","storageBucket":"...","messagingSenderId":"...","appId":"..."}
GFU_DASH_PRIMARY_ADMIN_EMAIL=kangmin.j@gfutures.co
OPENAI_API_KEY=sk-...
```

`FIREBASE_WEB_CONFIG`는 한 줄 JSON이어야 합니다.

## Firebase 설정

1. Authentication → Sign-in method → Google 활성화
2. Authentication → Settings → Authorized domains에 `gfu-dash.vercel.app` 추가
3. Firestore Database 생성
4. `firestore.rules` 내용을 Rules에 붙여넣고 Publish

## Firestore 보안 구조

조직 규정상 서비스 계정을 쓰지 않는 구조입니다.

- 읽기: 공개
- 쓰기: 관리자만 가능

비로그인 공유 링크를 서비스 계정 없이 유지하려면 Firestore 읽기 공개가 필요합니다. UI에서는 공유 토큰 브랜드만 보여주지만, DB 레벨에서 비로그인 사용자를 특정 브랜드로만 강제하려면 서버 privileged read가 필요합니다.

## 주요 기능

- Google 로그인
- 관리자 이메일 권한
- 브랜드 관리
- 브랜드별 자유 탭
- 탭별 KPI
- 파일 업로드 전 컬럼 감지/검증
- 탭별 파일 저장
- KPI 카드
- AI 인사이트
- 일별 추세
- 접힘형 일별 데이터
- 접힘형 일자별 상세 데이터
- 캠페인별 비교
- 광고세트별 비교
- 광고세트 비중
- 소재 포지셔닝
- 접힘형 캠페인별 데이터
- PDF 다운로드
- 파비콘

## 기존 데이터

기존 Supabase 또는 이전 Firestore REST 구조의 데이터와 호환되지 않습니다. 새 브랜드/탭을 만들고 파일을 다시 업로드하는 방식을 권장합니다.
