# 제주아이랑 장소 제안·수정 데이터 흐름 설계

> 이 문서는 초기 데이터 구조와 처리 규칙을 설명하는 설계 기록입니다. 현재
> 관리자의 실제 검수·반영 절차는 `docs/reviewer_manual.md`를 우선합니다.
> 정상적인 Form 응답은 `review_queue`에서 행을 선택한 뒤
> `🍊 제주아이랑 검수 → 선택 행 승인·반영` 한 번으로 처리합니다.

- 문서 상태: 1단계 설계안
- 작성 기준: `app.py`, `data/jeju-irang.csv`의 현재 상태
- 범위: Google Form 접수부터 관리자 검수, 승인 데이터의 CSV 반영까지
- 제외 범위: Google Form 생성, Apps Script 작성, CSV 수정, Streamlit UI 구현

> **2026-07-17 변경 결정:** 장소명이 중복되지 않는다는 운영 전제에 따라 사용자는 수정 대상 `place_id`를 입력하지 않는다. 수정 대상은 `target_place_name`으로 조회하여 정확히 한 행이 일치할 때만 내부 `place_id`를 확정한다. 0건 또는 2건 이상이면 자동 반영하지 않고 관리자 확인 상태로 보낸다. 아래의 사용자 `target_place_id` 입력 관련 기존 설명보다 이 결정이 우선한다.

> **2026-07-17 API 변경:** 사업자 정보가 필요한 카카오맵 API 대신 VWorld 검색 API 2.0의 `type=place`를 사용한다. 검수 컬럼은 `kakao_*`가 아닌 `source_*`로 관리하고, `source_provider`는 `VWORLD`로 기록한다. 이 문서 아래의 카카오 API 및 `kakao_*` 관련 기존 설명보다 이 결정이 우선한다.

## 1. 설계 결론

Google Form과 Google Sheet는 **접수·검수용 스테이징 영역**으로 사용하고, 서비스가 읽는 최종 원본은 계속 `data/jeju-irang.csv`로 유지한다.

권장 흐름은 다음과 같다.

1. 사용자가 앱에서 `장소 제안하기` 또는 `장소 정보 수정 제안`을 선택한다.
2. Google Form 응답은 수정하지 않는 원본 응답 시트에 저장한다.
3. Apps Script가 요청 ID를 만들고 카카오 장소 검색 후보를 검수 시트에 기록한다.
4. 관리자가 장소 후보와 입력값을 확인·보정한다.
5. 관리자가 `APPROVED`로 승인한 행만 동기화 대상이 된다.
6. 동기화 도구가 먼저 dry-run 결과를 보여준다.
7. 관리자가 적용을 승인하면 백업 후 `jeju-irang.csv`에 신규 추가 또는 기존 행 수정을 수행한다.
8. 성공한 요청은 `SYNCED`, 실패한 요청은 `ERROR`로 기록한다.

핵심 원칙은 다음과 같다.

- Form 응답이 들어왔다고 바로 서비스 데이터에 반영하지 않는다.
- 기존 장소 수정은 장소명이 아니라 `target_place_id`로만 수행한다.
- 신규 `place_id`는 접수 시점이 아니라 최종 반영 시점에 생성한다.
- 선택 입력의 빈칸은 기존 값을 삭제하지 않는다.
- 카카오 검색 첫 결과를 자동 확정하지 않는다.
- Google Form 원본 응답은 관리자가 직접 수정하지 않는다.
- `jeju-irang.csv` 반영 전에는 항상 백업과 dry-run을 수행한다.

## 2. 현재 데이터와 앱 동작 분석

### 2.1 현재 데이터 요약

- 장소 수: 268개
- 컬럼 수: 27개
- `place_id`: 중복 없음
- ID 범위: `P001`~`P347`
- ID 번호 사이에 결번이 있으므로 다음 ID는 행 개수에 1을 더하지 않고 **현재 최대 숫자 + 1**로 생성해야 한다.
- 장소명 중복은 현재 없음.
- 같은 주소와 좌표를 공유하는 서로 다른 장소는 여러 개 존재한다.
  - 같은 주소가 최대 4개 장소에서 사용된다.
  - 같은 좌표가 최대 4개 장소에서 사용된다.
  - 따라서 주소 또는 좌표만으로 중복을 확정하면 안 된다.

현재 허용되는 분류값은 다음과 같다.

| 컬럼 | 현재 값 |
|---|---|
| `category` | `관광지`, `영화/연극/공연`, `전시/기념관` |
| `space_type` | `실내`, `실외`, `실내/실외` |
| `parking` | `무료`, `유료`, `무료/유료 주차`, `주차 불가` |
| `city_name` | `제주시`, `서귀포시` |
| `region_group` | `구좌/조천`, `서귀포시`, `성산/표선`, `안덕/대정`, `애월/한림`, `제주시` |

현재 선택 컬럼의 비어 있는 정도는 다음과 같다.

| 컬럼 | 비어 있는 행 | 비고 |
|---|---:|---|
| `phone` | 45 | 선택 정보 |
| `website_url` | 113 | 값이 있는 155개 중 8개는 `http://` 또는 `https://` 형식이 아님 |
| `closed_days` | 96 | 선택 정보 |
| `opening_hours` | 98 | 선택 정보 |
| `admission_fee_detail` | 268 | 현재 전부 비어 있음 |
| `reservation_url` | 268 | 현재 전부 비어 있음 |
| `resident_discount` | 268 | 현재 전부 비어 있음 |
| `diaper_changing_table` | 268 | 현재 전부 비어 있음 |
| `photo_url` | 268 | 현재 전부 비어 있음 |
| `description` | 268 | 현재 전부 비어 있음 |
| `review_summary` | 268 | 현재 전부 비어 있음 |

### 2.2 `app.py`의 데이터 처리 규칙

- CSV를 읽을 때 `place_id`는 문자열로 유지한다.
- 다음 boolean 컬럼은 `TRUE/FALSE`, `1/0`, `yes/no`, `예/아니오`를 인식한다.
  - `has_admission_fee`
  - `has_age_limit`
  - `nursing_room`
  - `stroller_rental`
  - `resident_discount`
  - `diaper_changing_table`
- 인식할 수 없는 boolean 값은 결측값으로 처리된다.
- `latitude`, `longitude`는 숫자로 변환하며 변환 실패 시 결측값이 된다.
- CSV에 앱이 사용하지 않는 추가 컬럼이 있어도 현재 로더는 이를 제거하지 않는다. 따라서 `kakao_place_id` 같은 내부 컬럼을 추가해도 기존 화면에는 바로 노출되지 않는다.
- 검색 카드의 태그 순서는 `region_group` → `space_type` → `category`이다.
- 주차 가능 필터는 `무료`, `유료`, `무료/유료 주차`를 주차 가능으로 판단한다.
- 상세 화면은 URL이 `http://` 또는 `https://`로 시작할 때만 홈페이지·예약 링크를 활성화한다.
- `has_admission_fee=TRUE`이지만 요금 상세가 비어 있으면 `입장료 있음`으로 표시한다.
- `has_age_limit=FALSE`인 경우 `연령제한 없음`으로 표시한다.

## 3. CSV 컬럼과 Google Form 질문 매핑

### 3.1 Form 및 검수 전용 필드

다음 필드는 요청 처리용이며 `jeju-irang.csv`에는 저장하지 않는다.

| 필드 | Form 질문/생성 방식 | 필수 여부 | 용도 |
|---|---|---:|---|
| `request_id` | 제출 후 자동 생성 | 자동 | 요청의 영구 식별자 |
| `submitted_at` | Google Form 타임스탬프 | 자동 | 접수 시각 |
| `request_type` | `새 장소 제안` / `기존 장소 수정` | 필수 | 신규·수정 구분 |
| `target_place_id` | 수정 링크에서 미리 채움 | 수정 필수 | 수정할 기존 장소 식별 |
| `target_place_name` | 수정 링크에서 미리 채움 | 수정 필수 | 관리자 확인용 스냅샷 |
| `kakao_map_url` | 카카오맵 장소 URL | 선택, 권장 | 동명 장소 판별 보조 |
| `address_hint` | 주소 또는 동네 힌트 | 선택, 권장 | 카카오 검색 정확도 보조 |
| `changed_fields` | 수정할 항목 선택 | 수정 필수 권장 | 수정 요청의 덮어쓰기 범위 제한 |
| `submitter_contact` | 연락 가능한 이메일 또는 연락처 | 선택 | `NEEDS_INFO` 처리 시 보완 요청 |
| `review_status` | 관리자 드롭다운 | 자동/관리 | 검수 상태 |
| `admin_note` | 관리자 입력 | 선택 | 보정·반려 사유 |
| `clear_fields` | 관리자 전용 다중 선택 | 선택 | 기존 값을 명시적으로 삭제할 컬럼 |
| `synced_at` | 동기화 성공 시 자동 | 자동 | 최종 반영 시각 |
| `sync_message` | 동기화 결과 | 자동 | 성공·실패 상세 |

### 3.2 서비스 CSV 매핑

| CSV 컬럼 | 타입 | Google Form 질문 | 신규 필수 | 수정 처리 | 값의 출처/검수 규칙 |
|---|---|---|---:|---|---|
| `place_id` | string | 없음 | 자동 | 변경 금지 | 승인 후 반영 시 생성. 수정은 기존 ID 유지 |
| `place_name` | string | 상호 또는 장소명 | 예 | 변경 대상으로 선택했을 때만 갱신 | 앞뒤 공백 제거. 빈 문자열 금지 |
| `category` | string | 시설유형 | 예 | 선택한 경우만 갱신 | 현재 3개 허용값 중 하나 |
| `city_name` | string | 없음 | 자동 | 위치 변경 승인 시 재생성 | 카카오 주소의 시 단위 값. `제주시` 또는 `서귀포시`만 허용 |
| `legal_dong_name` | string | 없음 | 자동 | 위치 변경 승인 시 재생성 | 카카오 주소의 읍·면·법정동에서 생성 |
| `region_group` | string | 없음 | 자동 | 위치 변경 승인 시 재생성 | 이 문서의 지역 그룹 규칙 사용 |
| `road_address` | string | 주소 힌트는 별도 접수 | 자동 | 위치 변경 승인 시 재생성 | 카카오 도로명주소 우선, 없으면 지번주소 후보를 관리자 확인 |
| `latitude` | float | 없음 | 자동 | 위치 변경 승인 시 재생성 | 카카오 응답의 `y` |
| `longitude` | float | 없음 | 자동 | 위치 변경 승인 시 재생성 | 카카오 응답의 `x` |
| `phone` | string | 전화번호 | 아니오 | 빈칸은 유지 | 카카오 후보값 또는 Form 입력값을 관리자가 선택 |
| `website_url` | string | 홈페이지 URL | 아니오 | 빈칸은 유지 | `http://` 또는 `https://` 검증 |
| `closed_days` | string | 휴무일 | 아니오 | 빈칸은 유지 | 자유 텍스트, 줄바꿈 허용 가능 |
| `opening_hours` | string | 운영시간 | 아니오 | 빈칸은 유지 | 자유 텍스트 |
| `parking` | string | 주차 유형 | 예 | 선택한 경우만 갱신 | `무료`, `유료`, `무료/유료 주차`, `주차 불가` 중 하나 |
| `has_admission_fee` | boolean | 입장료가 있나요? | 예 | 선택한 경우만 갱신 | CSV에는 `TRUE`/`FALSE`로 저장 |
| `admission_fee_detail` | string | 입장료 상세 | 아니오 | 빈칸은 유지 | 입장료 있음인데 비어 있으면 관리자 경고, 반영 차단 여부는 결정 필요 |
| `has_age_limit` | boolean | 연령제한이 있나요? | 예 | 선택한 경우만 갱신 | CSV에는 `TRUE`/`FALSE`로 저장 |
| `age_limit_detail` | string | 연령제한 상세 | 아니오 | 빈칸은 유지 | 제한 없음이면 `연령제한 없음`으로 정규화 권장 |
| `nursing_room` | boolean | 수유실이 있나요? | 예 | 선택한 경우만 갱신 | `TRUE`/`FALSE` |
| `stroller_rental` | boolean | 유모차 대여가 가능한가요? | 예 | 선택한 경우만 갱신 | `TRUE`/`FALSE` |
| `space_type` | string | 공간 유형 | 예 | 선택한 경우만 갱신 | `실내`, `실외`, `실내/실외` 중 하나 |
| `reservation_url` | string | 예약 URL | 아니오 | 빈칸은 유지 | `http://` 또는 `https://` 검증 |
| `resident_discount` | boolean | 도민 할인이 있나요? | 아니오 | 빈칸은 유지 | 미응답은 `FALSE`가 아니라 `미확인/빈칸`으로 유지 권장 |
| `diaper_changing_table` | boolean | 기저귀 교환대가 있나요? | 아니오 | 빈칸은 유지 | 미응답은 `FALSE`가 아니라 `미확인/빈칸`으로 유지 권장 |
| `photo_url` | string | 대표 이미지 URL | 아니오 | 빈칸은 유지 | 공개 접근 가능한 `http://` 또는 `https://` URL인지 검수 |
| `description` | string | 한 줄 설명 | 아니오 | 빈칸은 유지 | 카드에 표시할 짧은 문장 |
| `review_summary` | string | 참고사항 또는 후기 요약 | 아니오 | 빈칸은 유지 | 관리자 편집 허용 |
| `kakao_place_id` | string | 없음 | 자동 권장 | 위치 후보 확정 시 갱신 | 카카오 장소 ID. 내부 중복 판별용 신규 컬럼 권장 |

### 3.3 주차 질문 설계

사용자 요구의 `주차 가능 여부`를 단순 예/아니오로 받으면 현재 CSV의 네 가지 주차값으로 변환할 수 없다. 따라서 Form에서는 다음 단일 선택 질문을 필수로 받는 방식을 권장한다.

- 무료 주차 → `무료`
- 유료 주차 → `유료`
- 무료와 유료 주차 모두 있음 → `무료/유료 주차`
- 주차 불가 → `주차 불가`
- 잘 모름 → 검수 시 `NEEDS_INFO`; 신규 장소에는 그대로 반영하지 않음

## 4. 신규 장소와 기존 장소 수정의 구분

### 4.1 권장안: 진입 링크는 두 개, 검수 시트는 하나

앱에는 서로 다른 진입 링크를 둔다.

- `장소 제안하기`: 신규 장소용 Form 또는 신규 섹션
- `장소 정보 수정 제안`: 상세 페이지에서 `target_place_id`, `target_place_name`을 미리 채운 수정용 Form 또는 수정 섹션

두 Form을 사용하더라도 같은 검수 Spreadsheet로 모을 수 있다. 구현 단순성과 실수 방지를 고려하면 **신규 Form과 수정 Form을 분리하는 방식**이 가장 안전하다.

### 4.2 신규 요청 판정

다음을 모두 만족해야 신규 요청으로 처리한다.

- `request_type=NEW`
- `target_place_id`가 비어 있음
- 신규 필수 질문이 모두 응답됨
- 관리자가 카카오 장소 후보를 확정함
- 중복 검사에서 기존 장소와 동일한 장소가 아님
- `review_status=APPROVED`

### 4.3 수정 요청 판정

다음을 모두 만족해야 수정 요청으로 처리한다.

- `request_type=UPDATE`
- `target_place_id`가 비어 있지 않음
- 해당 `place_id`가 현재 CSV에 정확히 1개 존재함
- 수정 링크에 미리 채워진 장소명과 현재 장소명을 관리자가 비교함
- `changed_fields`에 수정 대상이 명시됨
- `review_status=APPROVED`

`target_place_id`가 없거나 존재하지 않는 경우 장소명으로 임의 수정하지 않고 `NEEDS_INFO` 또는 `REJECTED`로 보낸다.

### 4.4 필수 질문에 대한 주의점

신규 장소에서는 장소명·공간·시설유형·입장료·연령제한·수유실·유모차·주차를 필수로 받는 것이 적절하다.

수정 Form에서도 모든 항목을 필수로 받으면 사용자가 수정할 의도가 없는 값까지 기존 데이터를 덮어쓸 위험이 있다. 수정 요청에는 다음 중 하나가 필요하다.

1. **권장:** `changed_fields`에서 선택한 컬럼만 갱신한다.
2. 모든 핵심 항목을 다시 받되, 관리자가 기존 값과 비교한 후 `apply_fields`를 별도로 선택한다.

## 5. 관리자 검수 상태와 상태 전환

| 상태 | 의미 | 다음 상태 |
|---|---|---|
| `PENDING` | Form 접수 완료, 아직 검수 전 | `NEEDS_INFO`, `APPROVED`, `REJECTED` |
| `NEEDS_INFO` | 카카오 후보가 없거나 여러 개, 필수 정보 불명확 | `PENDING`, `APPROVED`, `REJECTED` |
| `APPROVED` | 관리자가 후보와 최종값을 확정, 동기화 대기 | `SYNCED`, `ERROR` |
| `REJECTED` | 중복·부적합·확인 불가로 반려 | 종료 |
| `SYNCED` | CSV 반영 성공 | 종료. 추가 수정은 새 요청으로 생성 |
| `ERROR` | 승인 데이터 반영 실패 | 원인 수정 후 `APPROVED`로 되돌려 재시도 |

상태 전환 규칙:

- 자동화는 `PENDING`, `NEEDS_INFO`, `ERROR`만 자동 설정할 수 있다.
- `APPROVED`, `REJECTED`는 관리자만 설정한다.
- `SYNCED`는 동기화 도구만 설정한다.
- `SYNCED` 행을 직접 수정해 재사용하지 않는다. 수정이 필요하면 새 `request_id`를 만든다.
- `APPROVED` 시점의 최종값을 별도 승인 스냅샷으로 보존한다.

## 6. 승인된 데이터의 CSV upsert 규칙

### 6.1 공통 선행 조건

- `review_status=APPROVED`인 행만 처리한다.
- 이미 같은 `request_id`가 성공 처리된 행은 다시 처리하지 않는다.
- CSV 헤더와 인코딩을 보존한다.
- 반영 전에 타임스탬프가 포함된 백업을 만든다.
- 실제 저장 전 임시 파일에 전체 데이터를 쓰고 검증한 뒤 원자적으로 교체한다.
- 파일이 Excel 등에서 열려 있어 교체가 실패하면 원본을 그대로 유지하고 `ERROR`를 기록한다.

### 6.2 신규 장소 INSERT

1. 필수 필드와 카카오 후보 확정 여부를 검사한다.
2. 중복 검사를 수행한다.
3. 현재 CSV의 `place_id`에서 `P` 뒤 숫자의 최댓값을 찾는다.
4. 최대값 + 1을 최소 세 자리로 포맷한다.
   - 현재 최대값이 `P347`이므로 현재 기준 다음 후보는 `P348`이다.
5. 새 행을 CSV 끝에 추가한다.
6. 성공 후 `synced_place_id`, `synced_at`을 기록하고 상태를 `SYNCED`로 바꾼다.

행 개수 268을 기준으로 `P269`를 만들면 기존 ID와 충돌할 수 있으므로 금지한다.

### 6.3 기존 장소 UPDATE

1. `target_place_id`로 정확히 1개 행을 찾는다.
2. `place_id`는 어떤 경우에도 변경하지 않는다.
3. `changed_fields` 또는 관리자 `apply_fields`에 포함된 컬럼만 수정한다.
4. Form의 빈칸은 기존 값을 유지한다.
5. 위치 변경이 승인된 경우에만 주소·좌표·지역 파생값과 `kakao_place_id`를 함께 갱신한다.
6. 갱신 후 필수값·허용값·좌표·URL을 다시 검증한다.

### 6.4 값 정규화

- 문자열: 앞뒤 공백 제거
- boolean: CSV 저장 시 `TRUE`, `FALSE`, 또는 미확인 빈칸
- URL: 값이 있으면 `http://` 또는 `https://`로 시작해야 함
- 위도·경도: float 변환 가능해야 함
- `category`, `space_type`, `parking`, `region_group`: 허용 목록 외 값은 반영 금지
- `age_limit_detail`: `has_age_limit=FALSE`이면 `연령제한 없음` 권장
- `resident_discount=TRUE`이면서 `has_admission_fee=FALSE`이면 현재 앱 정책상 도민 할인 필터에서 제외되므로 관리자 경고 필요

## 7. 빈 값이 기존 데이터를 삭제하지 않게 하는 규칙

수정 요청에서 값의 의미를 세 가지로 구분한다.

| 입력 상태 | 의미 | 처리 |
|---|---|---|
| 값 있음 | 새 값으로 수정 | 해당 컬럼 갱신 |
| 빈칸 | 사용자가 새 값을 제공하지 않음 | 기존 값 유지 |
| 관리자 `clear_fields`에 포함 | 기존 값을 의도적으로 삭제 | 빈칸으로 갱신 |

즉, 일반 Form 빈칸만으로는 절대로 값을 삭제하지 않는다.

boolean 선택 필드는 `예/아니오/잘 모름`을 구분해야 한다.

- 예 → `TRUE`
- 아니오 → `FALSE`
- 잘 모름 또는 미응답 → 신규 필수 필드라면 반영 중단, 선택 필드라면 빈칸/기존 값 유지

## 8. 중복 장소 판별 규칙

현재 데이터에는 같은 주소·좌표를 공유하는 서로 다른 시설이 존재하므로 다단계 판별이 필요하다.

### 8.1 중복 확정 또는 강한 충돌

- `kakao_place_id`가 기존 행과 동일함
- 신규 요청의 장소명 정규화값과 `road_address`가 모두 기존 행과 동일함
- 수정 요청의 `target_place_id`와 확정한 카카오 장소가 기존의 다른 `place_id`에 연결되어 있음

이 경우 자동 INSERT를 중단하고 관리자가 기존 행 수정 여부를 선택한다.

### 8.2 중복 의심 경고

- 장소명이 같고 주소가 유사함
- 장소명이 유사하고 좌표 거리가 매우 가까움
- 전화번호가 같음
- 카카오 URL 또는 카카오 ID는 다르지만 주소와 좌표가 같음

주소나 좌표만 같다는 이유로 중복 확정하지 않는다. 복합 시설, 같은 건물의 여러 전시관, 같은 관광단지 내 시설일 수 있기 때문이다.

### 8.3 정규화 권장

- 장소명: 앞뒤 공백 제거, 연속 공백 축소, 괄호·지점명은 원본과 정규화값을 함께 비교
- 전화번호: 숫자만 남긴 비교용 값을 별도 생성
- 주소: `제주특별자치도` 표기와 공백을 정규화하되 원문은 유지
- 좌표: 문자열 일치가 아니라 거리 기준으로 비교

## 9. `place_id` 자동 생성 규칙

`place_id`는 앱 내부의 불변 기본키다.

- 형식: `P` + 최소 세 자리 숫자
- 생성 시점: 관리자가 승인한 신규 요청을 실제 CSV에 반영할 때
- 생성 방식: 유효한 기존 ID의 숫자 최댓값 + 1
- 현재 기준 다음 후보: `P348`
- 결번은 재사용하지 않음
- 수정 요청에서 변경 금지
- 동시에 여러 반영 작업이 실행되지 않도록 파일 잠금 또는 프로세스 잠금 사용
- 생성 후 CSV 전체에서 중복이 없는지 다시 검사

ID를 Google Form 제출 시점에 만들지 않는 이유는 반려된 요청이 ID를 소모하고 동시 제출에서 충돌할 수 있기 때문이다.

## 10. `kakao_place_id` 내부 컬럼 추가 필요성

### 10.1 권장 결론

`jeju-irang.csv`에 nullable string 컬럼 `kakao_place_id`를 추가하는 것을 권장한다.

이유:

- 장소명이 변경되어도 동일한 카카오 장소인지 추적하기 쉽다.
- 같은 주소를 공유하는 여러 시설을 구분할 수 있다.
- 신규 제안의 중복 검사가 강해진다.
- 관리자 검수 시 선택한 카카오 후보와 최종 데이터의 연결을 보존할 수 있다.
- 현재 `app.py`는 알 수 없는 추가 컬럼을 제거하지 않으므로 화면 기능과 직접 충돌하지 않는다.

주의:

- `kakao_place_id`는 외부 서비스 식별자이므로 앱의 기본키로 사용하지 않는다.
- `place_id`를 대체하지 않는다.
- 기존 268개 행은 처음에는 빈칸이어도 된다.
- 카카오 장소가 통합·폐업·변경될 수 있으므로 관리자가 수정할 수 있어야 한다.
- 컬럼을 최종 CSV에 추가하지 않기로 결정하면 별도 매핑 시트에라도 영구 보존해야 하지만, CSV와 매핑 시트가 어긋날 위험이 커진다.

## 11. 주소·좌표·지역 자동 생성 규칙

### 11.1 카카오 데이터 선택

1. 장소명과 주소 힌트로 카카오 키워드 장소 검색을 수행한다.
2. 제주 결과만 후보로 남긴다.
3. 관리자가 `kakao_place_id`, 장소명, 주소, 카카오맵 URL을 보고 후보를 확정한다.
4. 확정한 후보의 `x`를 longitude, `y`를 latitude로 사용한다.
5. 후보의 `road_address_name`을 `road_address`로 우선 사용한다.
6. 도로명주소가 비어 있으면 주소 검색 또는 좌표→주소 변환 결과를 사용하고 관리자가 확인한다.

카카오 키워드 검색 결과만으로 읍면동 구조가 불명확하면 확정 좌표를 다시 주소 API에 전달해 구조화된 지역 필드를 얻는다.

### 11.2 `city_name`

- 카카오 주소의 시 단위 값을 사용한다.
- 허용값은 `제주시`, `서귀포시`뿐이다.
- 다른 시·군이 반환되면 제주 장소가 아니므로 자동 승인하지 않는다.

### 11.3 `legal_dong_name`

- 도로명주소의 `region_3depth_name`이 있으면 우선 사용한다.
- 지번주소가 `표선면 가시리`처럼 면과 리를 함께 반환하면 현재 CSV 규칙에 맞춰 `표선면`만 저장한다.
- 읍·면이 아닌 지역은 법정동 이름을 저장한다.
- 값이 모호하거나 행정동만 확인되는 경우 관리자가 현재 CSV의 표기와 대조한다.

### 11.4 `region_group`

현재 CSV의 실제 관계를 기준으로 다음 순서로 생성한다.

| `legal_dong_name` | `region_group` |
|---|---|
| `구좌읍`, `조천읍` | `구좌/조천` |
| `성산읍`, `표선면` | `성산/표선` |
| `안덕면`, `대정읍` | `안덕/대정` |
| `애월읍`, `한림읍`, `한경면` | `애월/한림` |
| 그 외이면서 `city_name=제주시` | `제주시` |
| 그 외이면서 `city_name=서귀포시` | `서귀포시` |

현재 데이터에서 `우도면`은 `제주시`, `남원읍`은 `서귀포시`로 분류되어 있으므로 별도 묶음 지역으로 만들지 않는다.

### 11.5 좌표 검증

- 숫자로 변환 가능해야 한다.
- longitude=`x`, latitude=`y` 순서를 뒤바꾸지 않는다.
- 카카오 주소의 광역 지역이 제주특별자치도인지 확인한다.
- 현재 데이터 범위는 참고 경고값으로 사용할 수 있다.
  - latitude: 약 33.225171~33.559317
  - longitude: 약 126.167620~126.955738
- 현재 범위를 벗어난다는 이유만으로 즉시 거절하지 말고 우도·부속섬·신규 위치 여부를 관리자에게 경고한다.

## 12. 검수 시트 권장 컬럼

원본 응답과 검수 데이터를 분리한다.

### `form_responses`

- Google Form이 직접 쓰는 원본
- 관리자 수정 금지
- 삭제 금지

### `review_queue`

- `request_id`
- `submitted_at`
- `request_type`
- `target_place_id`
- Form 응답 필드
- 카카오 후보 필드
- 정규화된 최종 CSV 필드
- `changed_fields`
- `apply_fields`
- `clear_fields`
- `match_status`
- `review_status`
- `admin_note`
- `approved_at`
- `synced_place_id`
- `synced_at`
- `sync_message`

### `sync_log`

- `request_id`
- 실행 시각
- 실행 모드(`DRY_RUN`/`APPLY`)
- 작업(`INSERT`/`UPDATE`/`SKIP`/`ERROR`)
- 대상 `place_id`
- 변경 전·후 요약
- 백업 파일명
- 오류 메시지

## 13. 구현 전에 결정해야 할 사항

다음 항목은 2단계 전에 관리자가 결정해야 한다.

1. 신규와 수정에 Form을 각각 하나씩 사용할지, 하나의 Form에서 섹션을 나눌지
   - 권장: 두 Form, 하나의 검수 Spreadsheet
2. 수정 Form에서 모든 핵심 정보를 다시 필수로 받을지
   - 권장: `changed_fields`로 선택한 값만 반영
3. `kakao_place_id`를 최종 CSV에 추가할지
   - 권장: 추가
4. 주차 질문을 단순 가능 여부로 받을지 정확한 유형으로 받을지
   - 권장: 네 가지 유형 + `잘 모름`
5. `입장료 있음`일 때 상세 요금을 필수로 할지
6. `연령제한 있음`일 때 상세 제한을 필수로 할지
7. `resident_discount`, `diaper_changing_table` 미응답을 빈칸으로 유지할지 `FALSE`로 볼지
   - 권장: 빈칸은 미확인, `FALSE`와 구분
8. 기존 값을 의도적으로 삭제할 관리자용 `clear_fields`를 사용할지
   - 권장: 사용
9. 카카오 후보가 여러 개일 때 후보 1개만 표시할지 상위 여러 개를 검수 시트에 표시할지
   - 권장: 상위 3개와 카카오맵 링크 제공
10. CSV 반영을 로컬 명령으로 시작할지 배포 자동화까지 한 번에 구현할지
    - 권장: 로컬 dry-run/apply로 안정화한 뒤 자동화
11. Google Sheet 접근 방식
    - 관리자 수동 내보내기, Google Sheets API 서비스 계정, 또는 배포 자동화 중 선택
12. 수정 링크의 사전 입력값
    - `target_place_id`, `target_place_name` 외에 현재 값을 얼마나 미리 채울지
13. 사용자 연락처를 받을지와 개인정보 보관 기간
14. 승인자 이름·승인 시각을 기록할지
15. `photo_url`의 허용 호스트·파일 확장자·접근 가능 여부를 어느 수준까지 검증할지

## 14. 구현 단계의 필수 검증 항목

- 필수 컬럼 누락 없음
- `place_id` 중복 없음
- 신규 ID 생성 시 결번 재사용 없음
- 허용되지 않은 category/space/parking/region 값 없음
- boolean 컬럼에 허용되지 않은 문자열 없음
- 위도·경도 뒤바뀜 없음
- 제주 외 지역 자동 승인 없음
- 동일 `request_id` 중복 반영 없음
- UPDATE에서 빈칸이 기존 값을 삭제하지 않음
- `clear_fields`만 의도적 삭제를 수행함
- 주소·좌표만 같은 별도 시설을 잘못 병합하지 않음
- 파일 교체 실패 시 원본 CSV 보존
- 반영 전 백업 존재
- `app.py`의 홈·검색·상세·즐겨찾기 회귀 테스트 통과

## 15. 참고한 공식 문서

- Google Form 응답을 Spreadsheet에 저장: https://support.google.com/docs/answer/2917686
- Apps Script Form Submit 이벤트: https://developers.google.com/apps-script/guides/triggers/events
- Apps Script 설치형 트리거: https://developers.google.com/apps-script/guides/triggers/installable
- Kakao Local REST API: https://developers.kakao.com/docs/ko/local/dev-guide
- Apps Script 외부 HTTP 요청: https://developers.google.com/apps-script/reference/url-fetch/url-fetch-app
- Apps Script Properties Service: https://developers.google.com/apps-script/reference/properties/
- Apps Script Lock Service: https://developers.google.com/apps-script/reference/lock/
