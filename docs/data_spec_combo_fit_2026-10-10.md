# 조합 정합도 데이터 정의서 (2026-10-10 확정)

목적: **추천한 캐스트 조합이 그 사람 취향에 맞았는지**를 배워서 조합 추천 정합도를 올린다.
사용 지표(앱 열기, 체류 시간 같은 것)는 범위 밖이다.

## 원칙
- 가입은 없다. 브라우저마다 무작위 익명 ID(`anon_id`) 하나와 방문 ID(`session_id`)만 쓴다.
- 이름·연락처·자유 글은 보내지 않는다. 사용자가 쓴 '왜 좋아요' 글은 화면 안 태그 후보 찾기에만 쓰고, 기록은 고른 태그만 한다.
- 키는 화이트리스트로만 받고, 문자열 길이를 제한하고, 기록 하나는 4KB 이하로 한다.
- 첫 화면에 안내 한 줄과 끄기 버튼을 둔다. 끄면 아무것도 쌓지 않는다.
- 아래는 7c의 개인정보 조사(docs/privacy_logging_research_2026-10-10.md)를 반영한 것이다. 요지: 이렇게 지키면 개인정보가 아닐 가능성이 높다.
  - 익명 ID는 브라우저 난수(`crypto.randomUUID()`)로만 만든다. 설문 응답·연락처 같은 다른 데이터와 잇는 키를 만들지 않는다.
  - IP·User-Agent·화면 크기·언어·위치는 저장하지 않는다. 시각은 날짜 단위로만 저장하고, 같은 방문 안의 순서는 `seq`로 남긴다.
  - 제3자 분석·광고 도구를 달지 않고, 기록을 광고에 쓰거나 외부에 주지 않는다.
  - **[기록 끄기]와 [이 기기 기록 지우기]**를 설정에 둔다. 끄면 익명 ID를 폐기하고 다시 만들지 않는다. 이미 서버에 간 기록은 이름 없는 상태로 보관 기간이 지나면 지워진다. 끄거나 거부해도 추천은 그대로 쓸 수 있다. 버튼은 같은 크기로 두고, 켜게 유도하는 문구는 쓰지 않는다.
  - 짧은 '기록·개인정보 안내'(처리방침) 링크를 첫 화면과 설정에 항상 둔다. Supabase(해외 법인 운영)에 저장한다는 사실도 예방 차원에서 적는다.
  - 보관 기간: **6개월**(공식 권장 기준) 뒤 자동 삭제.
- 사용자 확정(2026-10-10): 기록 기본값은 **켜짐 + 안내 + 끄기**, 나이는 **묻지 않음**, 첫 화면 배너는 **B안**(docs/privacy_notice_draft_2026-10-10.md). 안내문 문의처는 보류 → **문의처 없이 기록을 켬(사용자 결정, 2026-10-13)**.

## 기록 종류 (event)

### 1. `combo_rating`: 조합 평가 (핵심, 정답 데이터)
| 필드 | 내용 |
|---|---|
| stage | `expected`(추천 직후) / `experienced`(관람 후) |
| taste | 그때 취향: 5축 값(-2~2), 좋아하는 배우 목록, 고른 태그 목록 |
| work, run, date, time | 작품, 시즌, 회차(직후 평가는 날짜가 없을 수 있음) |
| cast | 배역 → 배우 (주연) |
| reasons | 배우별로 맞춘 태그, 조합 태그(음색·보컬 조화 등) |
| algo | 추천 방식 버전(예: `rule-v1`, 나중에 `cf-v1`) |
| score | 1~5 |
| chips | `[{chip, dir, actors}]`, dir은 `+`(끌린 점) 또는 `-`(안 맞은 점) |

이유 칩 7개: `목소리` · `성량·가창` · `연기·해석` · `두 배우 케미` · `특정 배우` · `설명이 틀렸어요` · `날짜·가격·이미 봄`

칩 질문은 점수에 따라 바꾼다.
- 4~5점: "뭐가 끌렸어요?" (dir `+`)
- 1~2점: "뭐가 안 맞았어요?" (dir `-`)
- 3점: 둘 다 고를 수 있다.

`특정 배우`와 `설명이 틀렸어요`를 누르면 조합 안의 배우 중 누구인지 한 번 더 고른다(`actors`).

### 2. `combo_choice`: 실제로 고른 조합 (행동으로 드러난 선호)
'볼 예정 담기'나 '예매처로'를 누를 때 남긴다.

| 필드 | 내용 |
|---|---|
| action | `plan`(날짜 카드·회차 상세의 [볼 예정에 담기]) / `ticket`(볼 예정에 담은 뒤 화면의 [예매처로 이동], 2026-10-13부터 날짜 카드·회차 상세에는 예매처 버튼이 없다) |
| work, run, date, time, cast | 고른 회차와 조합 |
| shown | 그때 보여 준 추천 조합 상위 3개(조합, PICK 여부) |
| filters | 기간, ⭐ 꼭 볼 배우, 🚫 제외 배우 |

### 3. `actor_pick`: ⭐ 꼭 볼 / 🚫 제외
work, role, actor, action(`pin` / `unpin` / `avoid` / `unavoid`)

### 4. `role_duel`: 배역별 이상형 월드컵
| 필드 | 내용 |
|---|---|
| work, role | 작품, 배역 |
| left, right | 배우와 그때 보여 준 태그. 위치 쏠림을 보려고 좌우를 함께 남긴다 |
| result | `left` / `right` / `tie` |

### 5. `actor_rating`: 회차 캐스팅이 없는 공연(KOPIS만)의 배우 단위 평가
show_id, actor, score(1~5), chips(1번과 같은 형식)

### 6. `video_reaction`: 배우 영상 반응 (2026-10-13 추가)
공연 화면 ② 누구로 볼까요?의 배우 칸에서 영상 썸네일(유튜브 새 탭)을 누른 **뒤에만** '이 영상 어땠어요?'가 나오고, 거기에 답할 때 한 줄 남긴다. 영상 ID가 없는 '영상 찾아보기' 검색 링크에는 질문이 없다.
| 필드 | 내용 |
|---|---|
| work, role, actor | 작품, 배역, 배우 |
| video | 유튜브 영상 ID(11자). 주소·제목이 아니라 ID만 |
| reaction | `like`(마음에 들어요) / `unsure`(모르겠어요) / `dislike`(취향 아니에요) |
| traits | (선택) `like`일 때만 '어떤 점이 좋았어요? (선택)'에서 고른 특징 태그 목록 `[태그]`(최대 6). **사전 '확정' 배우 태그만**(목소리 태그 6개: 맑음·부드러움·허스키·묵직한 음색·성량·고음). 아무것도 안 골랐거나 다 풀면 `[]` |

- 답을 **바꿀 때마다** 한 줄 더 남긴다(같은 답을 다시 눌러도 안 남긴다). 영상을 연 것만으로는 남기지 않는다. 기록을 끈 사람은 안 보낸다.
- 답에 따른 다음 단계(꼭 볼 배우로 담기·빼기·유튜브 검색)는 사용자가 직접 누르는 기존 `actor_pick`(⭐/🚫)을 그대로 쓴다. 자동으로 담거나 빼지 않는다.
- **'마음에 들어요'를 누른 뒤에만** '⭐ 꼭 볼 배우로 담을까요?' 줄과 같이 '어떤 점이 좋았어요? (선택)' 칩 한 줄(작게)이 나온다. 여러 개 고를 수 있고, 칩을 누를 때마다 한 줄 더 남긴다(`reaction: like` + 지금 고른 특징 전체 `traits`, 다 풀면 `[]`). 분석은 같은 (기기, 영상)의 **마지막 줄**만 본다.
- '모르겠어요'·'취향 아니에요'에는 묻지 않고 특징도 모으지 않는다(부정적 특징은 모으지 않는 원칙). 답을 다른 것으로 바꾸면 고른 특징은 이 기기에서도 지우고, 그때 남는 줄에는 `traits`가 없다(마지막 줄이 이긴다).
- 칩 목록은 앱이 정하고, 값 검사는 `taste_snapshot`의 `likeTags` 값과 같다(사전 확정 배우 태그만, 엉뚱한 태그는 버림, 7개 이상이면 `traits` 통째로 버림).
- 이 사람의 추천에는 바로 쓰지 않는다. 모두의 추천에는 `public.actor_trait_votes` 집계(9번)로 들어간다(`refresh_actor_trait_votes()`가 `taste_snapshot.likeTags`와 `video_reaction.traits`를 함께 센다).
- 이 기기에는 영상을 연 상태·답·고른 특징(`t`)을 (작품, 배우, 영상 ID)별로 저장한다(`pickle_v2.proto.vr`, 기존 키는 그대로, 새 키만 덧붙임).

### 7. `taste_snapshot`: 취향 스냅숏 (2026-10-13 추가)
취향 고르기(취향폼)를 저장하거나 고칠 때(다음·건너뛰기·추천 보러 가기를 누를 때), 그리고 홈 '비슷한 배우' 자리의 묻는 칸에서 좋아하는 배우의 특징을 골라 [찾기]를 누를 때 한 줄 남긴다.
| 필드 | 내용 |
|---|---|
| likes | 좋아하는 배우 이름 목록(최대 10). **앱 데이터에 있는 이름만**(배역 캐스트·KOPIS 출연진·배우 프로필). 이름 칸에 직접 쓴 다른 글은 버린다 |
| axes | 취향 5축 값(-2~2, 지금 화면은 ±1만) |
| tags | 고른 카드의 태그(최대 12) |
| likeTags | 좋아하는 배우별로 고른 특징 태그 `{배우: [태그]}`(배우 최대 10명, 배우마다 최대 8개). 배우는 앱 데이터에 있는 이름, 태그는 **사전 '확정' 배우 태그**(음색·성량·연기·해석 등)만. 취향폼의 '어떤 점이 좋아요?'에서 고른 칩과 홈 묻는 칸에서 고른 칩이 같은 곳(`S.likes`)에 모인다 |
- '어떤 점이 좋아요?' 같은 **직접 쓴 글은 절대 보내지 않는다**(고른 태그 칩만).
- 홈 묻는 칸(좋아하는 배우의 특징 태그가 하나도 없어 '비슷한 배우' 줄이 빌 때): 특징 없는 첫 배우 한 명에게만 "○○의 어떤 점이 좋아요? 고르면 비슷한 배우가 나오는 공연을 찾아 드려요"와 칩 6~8개(목소리 6 + 연기·해석 2)를 보여 주고, [찾기]를 누르면 `S.likes`에 저장돼 그 자리에서 줄이 채워진다. [건너뛰기]는 저장해 다시 안 묻는다(`S.likes`의 `asked`). 새 이벤트는 만들지 않고 이 `taste_snapshot`을 쓴다(DB 허용 목록 그대로).
- 직전에 보낸 것(같은 기기 번호 + 같은 내용)과 똑같으면 다시 보내지 않는다. 처음부터 빈 취향은 남기지 않는다. 기록을 끈 사람은 안 보낸다.
- 마지막으로 보낸 내용의 요약은 이 기기에 둔다(`pickle_v2.proto.snap`, 새 키).

### 8. `rec_feedback`: 홈 추천 줄 카드 피드백 (2026-10-13 추가)
홈 추천 줄(좋아하는 배우가 나와요 · 비슷한 배우가 나와요 · 내 취향 추천)의 포스터 카드 모서리 ⋯ 에서 [이미 봤어요]·[관심 없어요]를 고르거나 '되돌리기'를 누를 때 한 줄 남긴다.
| 필드 | 내용 |
|---|---|
| show | 공연 id(KOPIS) 또는 시드 작품 이름 |
| row | 어느 줄이었는지: `fav`(좋아하는 배우 출연작) / `similar`(비슷한 배우 출연작) / `taste`(내 취향 추천) |
| action | `seen`(이미 봤어요) / `not_interested`(관심 없어요) / `undo`(되돌리기) |
- 고르면 그 공연은 추천 줄에서만 바로 빠진다('지금 하는 공연 전체'에는 그대로). 추천 줄 아래 '숨긴 공연 N개 · 되돌리기'로 다시 볼 수 있다. 숨긴 목록은 이 기기에만 둔다(`pickle_v2.proto.hid`, 새 키).

### 9. 읽기 전용 집계 `public.actor_trait_votes`: 다른 사람들이 고른 배우 특징 (2026-10-13 추가)
이벤트가 아니라 **앱이 읽어 가는 표**다. 앱은 이 표에 아무것도 쓰지 않는다(기록은 위 `taste_snapshot`의 `likeTags`가 그대로 원천).
| 열 | 내용 |
|---|---|
| actor | 배우 이름 |
| tag | 배우 태그(사전 확정 태그) |
| n | 그 배우에 그 태그를 고른 **서로 다른 `anon_id` 수**(같은 기기가 여러 번 보내도 1) |
| updated_on | 계산한 날짜 |
- 원천: `public.events`의 `taste_snapshot.payload.likeTags`(배우별로 고른 태그)와 `video_reaction.payload.traits`(`reaction`이 `like`인 줄의 특징, 같은 기기·영상은 마지막 줄만). **n이 2 이상인 줄만** 둔다(1명이 고른 건 표에 안 나온다).
- 다시 계산: **1시간마다**. 함수 `public.refresh_actor_trait_votes()`(security definer, anon·authenticated·public의 실행 권한 회수), 예약(cron) `trait-votes-refresh`(매시 15분, `15 * * * *`).
- 표·함수·예약은 사용자가 SQL로 만든다(열은 위 표 그대로).
- 권한: 익명(anon)은 **이 표 읽기(select)만** 가능. `public.events`는 그대로 넣기만 된다. 이 표에는 누가 골랐는지(`anon_id`·`session_id`)가 없다.
- 앱이 읽는 법: 기록 설정(`window.PICKLE_TRACK`: 주소 + 공개 키)이 있을 때만, 시작할 때 `GET {url}/rest/v1/actor_trait_votes?select=actor,tag,n`. 헤더는 기록 보내기와 같은 규칙(`apikey`, JWT 형식 키일 때만 `Authorization`). 3초 안에 못 받거나 실패하면 조용히 없는 것으로 쓴다. 받은 것은 이 기기에 **1시간** 둔다(새 키 `pickle_votes`). 기록을 꺼도 읽는다(읽기만 하고 보내는 건 없다).
- 앱이 거르는 법: 앱 데이터에 있는 배우, 사전 확정 배우 태그, n이 2 이상인 줄만 받고 나머지는 버린다.
- 추천에 쓰는 법: 배우·특징마다 **서로 다른 근거 수** = 시트 근거의 서로 다른 출처 수(`sk`) + 이 표의 n. 근거 1개는 가중치 1, 2개 이상은 1.5(비슷한 배우 줄의 순서에만 영향, 근거가 1개뿐이어도 빼지 않는다). 내가 '어떤 점이 좋아요'에서 직접 고른 특징은 늘 1.5. 목소리 특징은 후보 배우에게도 더하고, 연기·해석 특징은 배역을 모르므로 후보 쪽에서는 그 배역 기록에 이미 있는 태그의 근거 수만 올린다. 화면에는 근거도 숫자도 안 낸다.
- 안내문 한 줄(앱 안 안내·`docs/privacy_notice_draft_2026-10-10.md`와 같은 문장): "여러 사람(2명 이상)이 고른 배우 특징은 누가 골랐는지 없이 합계로만 추천에 쓰여요."

## 공통 필드
`anon_id`, `session_id`, `app_version`, `event`, `payload`(위 필드들, JSON, 방문 안 순서 `seq` 포함). 날짜는 서버가 붙이고 시각은 남기지 않는다.

## 저장소: Supabase 표 하나
**막지 프로젝트의 `public.events`**(리전 **ap-northeast-2, 서울**)에 저장한다 — **서울 리전에 저장**한다. 아래 SQL은 **실행 완료**(video_reaction 포함, 앱 쪽 넣기 테스트까지 통과). 익명 사용자는 **넣기만** 가능하고, 읽기·수정·삭제는 못 한다.

```sql
create table public.events (
  id uuid primary key default gen_random_uuid(),
  created_on date not null default current_date,
  anon_id uuid not null,
  session_id uuid not null,
  app_version text not null check (char_length(app_version) <= 20),
  event text not null check (event in ('combo_rating','combo_choice','actor_pick','role_duel','actor_rating','video_reaction','taste_snapshot','rec_feedback')),
  payload jsonb not null check (pg_column_size(payload) <= 4096)
);
alter table public.events enable row level security;
create policy "anon insert only" on public.events for insert to anon with check (true);
revoke select, update, delete on public.events from anon, authenticated;
```

- 이미 만든 표의 허용 목록에 이벤트를 더할 때(taste_snapshot·rec_feedback 추가분은 사용자가 실행): `alter table public.events drop constraint events_event_check; alter table public.events add constraint events_event_check check (event in ('combo_rating','combo_choice','actor_pick','role_duel','actor_rating','video_reaction','taste_snapshot','rec_feedback'));`
- 프로젝트 리전은 **서울(ap-northeast-2)**이고, 기록은 서울 리전에 저장한다(앱 안 안내문과 `docs/privacy_notice_draft_2026-10-10.md`에도 같은 문장).
- 6개월 자동 삭제는 Database → Extensions에서 `pg_cron`을 켠 뒤 한 번 실행한다:
  `select cron.schedule('events-retention', '0 3 * * *', $$delete from public.events where created_on < current_date - interval '6 months'$$);`
- 만든 뒤 대시보드 로그 설정에서 요청 IP가 얼마나 보관되는지 확인한다. 7c 조사에서 문서로는 확인하지 못했다.
- 앱에는 **공개 키(anon / publishable)만** 넣는다. `service_role` 키는 절대 앱이나 `.env` 공유본에 넣지 않는다.
- 주소와 공개 키는 `.env`의 `SUPABASE_URL`, `SUPABASE_ANON_KEY`로 둔다. 내보내기 때 앱에 들어간다. 공개 키는 원래 브라우저에 노출되는 키라 괜찮다. 보안은 위의 넣기 전용 설정이 맡는다.
- 전송은 `fetch(…/rest/v1/events, {keepalive: true})`, 헤더는 `Prefer: return=minimal`.

## 이 데이터로 보는 정합도 지표
- 추천 조합의 평균 점수와 4점 이상 비율. 기대 평가와 관람 후 평가를 따로 본다.
- 추천 조합과 실제로 고른 조합이 같은 비율
- 태그·배우별 '설명이 틀렸어요' 비율 → 태그 데이터를 바로잡을 목록
- 이상형 월드컵의 태그별 승률 → 취향 축 × 태그 가중치를 다시 맞추기
- 쌓이는 대로 가중치를 다시 맞춘다. 대략 조합 평가 300건, 월드컵 1,000판쯤부터 의미가 생긴다고 본다.

## 남은 일
- 사용자: ~~Supabase 프로젝트 만들기(서울 리전)·`.env`에 주소·공개 키·SQL 실행~~(완료, 막지 프로젝트 `public.events`) · `pg_cron` 삭제 예약 · 로그 IP 보관 확인
- ~~사용자 결정 남은 것: 안내문에 넣을 문의처~~ → 문의처 없이 켬(2026-10-13)
- 7c: 짧은 '기록·개인정보 안내' 문안 초안
- 정식 오픈 전(선택): 개인정보위 법령해석지원센터에 최종 판단 문의
