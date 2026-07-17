# 제주아이랑 VWorld 정보 보강 Apps Script 설치 안내

작성일: 2026-07-17  
스크립트: `scripts/google_apps_script/vworld_enrichment.gs`

## 처리 흐름

1. Google Form 원본 응답은 `form_responses`에 그대로 보존한다.
2. 설치형 Form Submit 트리거가 응답을 읽어 고유 `request_id`를 생성한다.
3. VWorld 검색 API 2.0의 `type=place`로 장소 후보를 검색한다.
4. 제주 경계 안의 결과만 남기고 `review_queue`에 후보 정보를 기록한다.
5. 후보가 한 건이어도 자동 승인하지 않고 관리자가 확인한다.

## 준비

1. VWorld에서 검색 API 2.0을 사용할 수 있는 OpenAPI 인증키를 발급받는다.
2. Google Apps Script의 `프로젝트 설정 → 스크립트 속성`을 연다.
3. `VWORLD_API_KEY` 속성에 발급받은 키를 저장한다.
4. API 키를 코드, Google Sheet 셀, 실행 로그에 직접 입력하지 않는다.

## 기존 Apps Script 교체

1. 기존 `kakao_enrichment` 파일의 내용을 모두 지운다.
2. 파일명을 `vworld_enrichment`로 바꾼다.
3. 로컬 `scripts/google_apps_script/vworld_enrichment.gs` 전체 내용을 붙여 넣고 저장한다.
4. `Code.gs`도 최신 `create_google_form.gs` 내용으로 교체한다.

## 기존 Form과 Sheet 마이그레이션

다음 함수를 순서대로 한 번 실행한다.

1. `applyVworldFormSettings`
2. `migrateReviewQueueToVworld`

첫 번째 함수는 Form의 위치 단서 안내에서 카카오맵 URL 표현을 제거한다. 두 번째 함수는 기존 `kakao_*` 헤더를 `source_*` 헤더로 바꾸고 필요한 컬럼을 추가한다. 기존 응답 행은 삭제하지 않는다.

## 연결 시험과 트리거

다음 함수를 순서대로 실행한다.

1. `checkSetup`
2. `testVworldSearch`
3. `installFormSubmitTrigger`

`testVworldSearch`의 기본 검색 대상은 `아쿠아플라넷 제주`, 위치 단서는 `서귀포시 성산읍`이다. 실행 로그에 후보 ID, 장소명, 주소, 위도와 경도가 나오면 정상이다.

`installFormSubmitTrigger`는 같은 Spreadsheet에 동일한 트리거가 있으면 중복 생성하지 않는다. 기존에 설치한 `onFormSubmit` 트리거가 있으면 새 코드가 같은 함수명을 사용하므로 그대로 재사용할 수 있다.

## 최종 제출 시험

1. Google Form에서 테스트 응답 한 건을 제출한다.
2. `form_responses`에 원본 행이 생겼는지 확인한다.
3. `review_queue`에서 다음 값을 확인한다.
   - `request_id`
   - `source_provider=VWORLD`
   - `source_place_id`
   - `source_place_name`
   - `source_address`, `source_road_address`
   - `source_latitude`, `source_longitude`
   - `source_candidate_count`, `source_candidates`
4. `match_status`가 `SINGLE_CANDIDATE`, `MULTIPLE_CANDIDATES`, `NO_MATCH` 중 하나인지 확인한다.
5. 후보가 한 건이어도 관리자가 확인하기 전에는 `CONFIRMED`로 간주하지 않는다.

## 오류 확인

| 메시지 | 확인할 내용 |
|---|---|
| `VWORLD_API_KEY가 설정되지 않았습니다` | Script Properties의 속성명과 키 값 |
| `INVALID_KEY` | 발급 키가 검색 API 2.0을 사용할 수 있는지 |
| `INCORRECT_KEY` | 인증키 신청 시 등록한 도메인과 호출 설정 |
| `OVER_REQUEST_LIMIT` | 일일 호출 한도 |
| `NO_MATCH` | 장소명 철자와 주소·동네 단서 |

### 502·503 등 일시적인 서버 오류

최신 `vworld_enrichment.gs`는 HTTP 429, 500, 502, 503, 504 응답을 최대 3회 자동 재시도한다.

이미 `review_queue`에 `VWORLD_API_ERROR`로 기록된 요청은 Form을 다시 제출하지 않는다. 함수 목록에서 `retryFailedVworldSearches`를 실행하면 `match_status=UNSEARCHED`인 VWorld 오류 행만 다시 검색하고 기존 `request_id`를 유지한다.

## 사용 API

- 요청 URL: `https://api.vworld.kr/req/search`
- `service=search`
- `request=search`
- `version=2.0`
- `type=place`
- `crs=EPSG:4326`
- 제주 검색 영역: `126.0,33.0,127.1,33.7`

공식 문서: <https://www.vworld.kr/dev/v4dv_search2_s001.do>
