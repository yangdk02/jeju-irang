# 제주아이랑 검수용 Google Sheet 설계

작성일: 2026-07-17  
기준 문서: `docs/data_update_design.md`, `docs/google_form_design.md`  
기준 데이터: `data/jeju-irang.csv`

> **2026-07-17 변경 결정:** Form에서는 `target_place_id`를 받지 않는다. `review_queue.target_place_id` 컬럼은 내부 관리용으로 유지하며, UPDATE 요청의 `target_place_name`이 운영 데이터에서 정확히 한 건 일치할 때 자동으로 채운다. 일치 결과가 0건 또는 여러 건이면 비워 두고 관리자 확인 대상으로 처리한다. 아래의 Form 입력값 복사 관련 기존 설명보다 이 결정이 우선한다.

> **2026-07-17 API 변경:** 장소 후보 검색은 VWorld 검색 API 2.0으로 전환하며 검수 컬럼은 `source_provider`, `source_place_id`, `source_place_name`, `source_address`, `source_road_address`, `source_latitude`, `source_longitude`, `source_category`를 사용한다. 아래의 `kakao_*` 관련 기존 설명보다 이 결정이 우선한다.

> **2026-07-20 운영 변경:** 일반 검수자는 상태 컬럼을 직접 바꾸지 않는다.
> `review_queue`에서 행을 선택하고
> `🍊 제주아이랑 검수 → 선택 행 승인·반영`을 실행한다. 이 메뉴가 VWorld
> 확인, 승인 상태 변경, master 반영, CSV 생성과 로그 기록을 한 번에 처리한다.
> 실제 운영 절차는 `docs/reviewer_manual.md`를 우선한다.

## 1. 설계 목표

장소 제안·수정 Google Form의 원본 응답을 보존하면서, 관리자가 카카오 장소와 최종 반영값을 검수하고 승인된 요청만 `data/jeju-irang.csv`에 반영할 수 있는 구조를 만든다.

핵심 원칙은 다음과 같다.

- Form 원본 응답은 수정하지 않는다.
- `review_queue`에는 원본값, 관리자 확정값, 자동 생성값을 구분해서 둔다.
- 관리자는 정상 응답에서 `review_status`, `admin_action`, `match_status`를 직접 수정하지 않는다.
- VWorld 검색 결과는 자동으로 제안할 수 있지만, 최종 장소는 관리자가 확인한다.
- 주소·좌표·지역 그룹은 확정된 VWorld 장소에서 자동 생성한다.
- 수정 요청의 빈 값은 기존 CSV 값을 삭제하지 않는다.
- 승인과 CSV 동기화 결과는 `sync_log`에 추가 기록하며 과거 기록을 수정하지 않는다.

## 2. 전체 시트 구성

| 시트 | 역할 | 직접 수정 주체 | 보호 수준 |
|---|---|---|---|
| `form_responses` | Google Form 원본 응답 저장 | Google Form만 기록 | 시트 전체 보호 |
| `review_queue` | 응답 정규화, 카카오 매칭, 관리자 검수와 승인 | 관리자와 자동화가 지정된 컬럼만 각각 수정 | 기본 전체 보호 후 관리자 입력 컬럼만 예외 허용 |
| `sync_log` | CSV 반영 시도와 결과의 이력 | 동기화 자동화만 추가 | 시트 전체 보호, 행 추가 전용 |

권장 탭 순서는 `review_queue`, `form_responses`, `sync_log`이다. 관리자가 가장 자주 사용하는 `review_queue`를 첫 탭에 둔다.

## 3. 작성 주체 구분

| 구분 | 표기색 권장 | 의미 |
|---|---|---|
| 원본 복사·자동 생성 | 연한 회색 `#F3F4F6` | Form 또는 자동화가 기록하며 관리자는 수정하지 않음 |
| 관리자 입력 | 연한 노랑 `#FFF1C7` | 관리자가 검수 과정에서 직접 선택하거나 수정 |
| 관리자 확인 후 자동 갱신 | 연한 하늘 `#DDF4F8` | 자동 초깃값이 들어오지만 관리자가 최종 선택할 수 있음 |
| 동기화 결과 | 연한 민트 `#DDF5EC` | CSV 반영 자동화가 기록하며 관리자는 수정하지 않음 |
| 오류·차단 | 연한 분홍 `#FCE3EA` | 확인 또는 보완이 필요한 값 |

`review_queue`와 `sync_log`의 1행에는 영문 컬럼명을 사용하고, 셀 메모에 한글 설명과 수정 주체를 적는다. 이 두 시트의 컬럼명을 한글로 바꾸면 향후 자동화 연결이 깨질 수 있으므로 변경하지 않는다. `form_responses`는 예외로, Google Form이 생성한 원래 한글 질문 제목을 그대로 보존한다.

## 4. `form_responses` 설계

### 4-1. 역할

Google Form이 응답을 추가하는 원본 시트다. 이 시트는 감사 기록이므로 오탈자가 보여도 직접 수정하지 않는다. 수정·정규화는 `review_queue`에서 수행한다.

### 4-2. 컬럼 순서

아래 영문명은 자동화에서 사용할 **논리 필드명**이다. `form_responses`의 실제 1행 헤더는 Google Form이 만든 한글 질문 제목을 그대로 두고, 후속 자동화에서 이 표에 따라 영문 필드로 매핑한다.

| 순서 | 논리 필드명 | 출처 | 설명 |
|---:|---|---|---|
| 1 | `submitted_at` | Google Form | 제출 시각 |
| 2 | `request_type` | Form | 새로운 장소 제안 또는 기존 장소 수정 |
| 3 | `target_place_id` | Form | 수정 대상 내부 장소 ID |
| 4 | `target_place_name` | Form | 수정 대상 기존 장소명 |
| 5 | `changed_fields` | Form | 사용자가 수정한다고 선택한 항목 |
| 6 | `update_note` | Form | 수정 사유 또는 설명 |
| 7 | `place_name` | Form | 장소명 |
| 8 | `space_type` | Form | 실내·실외 구분 |
| 9 | `category` | Form | 시설유형 |
| 10 | `has_admission_fee` | Form | 입장료 여부 |
| 11 | `has_age_limit` | Form | 연령제한 여부 |
| 12 | `nursing_room` | Form | 수유실 여부 |
| 13 | `stroller_rental` | Form | 유모차 대여 여부 |
| 14 | `parking` | Form | 주차 유형 |
| 15 | `location_hint` | Form | 카카오맵 URL 또는 주소·동네 단서 |
| 16 | `phone` | Form | 전화번호 |
| 17 | `website_url` | Form | 홈페이지 URL |
| 18 | `opening_hours` | Form | 운영시간 |
| 19 | `closed_days` | Form | 휴무일 |
| 20 | `admission_fee_detail` | Form | 이용요금 상세 |
| 21 | `age_limit_detail` | Form | 연령제한 상세 |
| 22 | `diaper_changing_table` | Form | 기저귀 교환대 |
| 23 | `resident_discount` | Form | 도민 할인 |
| 24 | `reservation_url` | Form | 예약 URL |
| 25 | `photo_url` | Form | 이미지 URL |
| 26 | `description` | Form | 한 줄 설명 |
| 27 | `review_summary` | Form | 후기 또는 참고사항 |

### 4-3. 운영 규칙

- 시트 전체를 보호한다.
- 행 정렬, 행 삭제, 컬럼 삽입, 질문 제목 변경을 하지 않는다.
- 필터가 필요하면 원본 범위를 직접 정렬하지 말고 필터 보기를 사용한다.
- Form 질문을 추가하면 이 시트의 오른쪽에 새 컬럼이 생기는지 확인하고 `review_queue` 매핑을 갱신한다.
- 응답 중복 여부는 이 시트가 아니라 `review_queue.request_id`와 `source_hash`로 판단한다.

## 5. `review_queue` 설계

### 5-1. 기본 화면 구성

- 1행 고정
- A~F 열 고정 권장
- 전체 범위에 필터 적용
- 기본 정렬: `review_status` 우선순위 → `submitted_at` 오름차순
- 관리자 입력 컬럼은 연한 노랑, 카카오 확인 컬럼은 연한 하늘, 자동 컬럼은 연한 회색으로 구분
- 긴 텍스트인 `admin_note`, `update_note`, `description`, `review_summary`는 줄바꿈 표시
- 기술 컬럼인 `source_hash`, 검증 메시지, 기존값 해시는 평소 숨기고 오류 조사 때만 표시

### 5-2. 관리 컬럼 A:R

사용자가 지정한 관리 컬럼을 시트 왼쪽에 고정 배치한다.

| 열 | 컬럼명 | 생성·수정 주체 | 입력 방식 | 보호 | 설명 |
|---|---|---|---|---|---|
| A | `request_id` | 자동 | `REQ-YYYYMMDD-일련번호` | 보호 | 요청 고유 ID. 한 번 생성 후 변경 금지 |
| B | `request_type` | 자동 | `NEW`, `UPDATE` 정규화 | 보호 | Form의 요청 유형 |
| C | `target_place_id` | 자동 | Form 값 복사 | 보호 | UPDATE일 때 필수, NEW는 빈 값 |
| D | `review_status` | 자동 | 상태 전환 결과 | 보호 | 현재 처리 상태 |
| E | `admin_action` | 관리자 | 드롭다운 | 관리자만 편집 | 다음에 수행할 검수 작업 |
| F | `admin_note` | 관리자 | 자유 입력 | 관리자만 편집 | 보완·반려·수정 사유. 일부 작업에서는 필수 |
| G | `kakao_place_id` | 자동 제안 후 관리자 확인 | 단답형 | 관리자만 편집 | 최종 선택한 카카오 장소 ID |
| H | `kakao_place_name` | 자동 | G의 장소 ID 조회값 | 보호 | 카카오 장소명 |
| I | `kakao_address` | 자동 | 카카오 지번주소 | 보호 | 도로명주소가 없을 때 교차 확인용 |
| J | `kakao_road_address` | 자동 | 카카오 도로명주소 | 보호 | CSV `road_address` 우선값 |
| K | `kakao_latitude` | 자동 | 카카오 응답 `y` | 보호 | CSV `latitude` 후보 |
| L | `kakao_longitude` | 자동 | 카카오 응답 `x` | 보호 | CSV `longitude` 후보 |
| M | `kakao_place_url` | 자동 | 카카오 장소 URL | 보호 | 관리자가 장소 페이지 확인 |
| N | `match_status` | 자동 초깃값 후 관리자 확인 | 드롭다운 | 관리자만 편집 | 카카오 장소 매칭 상태 |
| O | `approved_at` | 자동 | 승인 처리 시각 | 보호 | `APPROVED` 전환 시 기록 |
| P | `synced_place_id` | 자동 | CSV 반영 결과 | 보호 | 신규 생성 또는 수정된 `place_id` |
| Q | `synced_at` | 자동 | CSV 반영 완료 시각 | 보호 | 성공 시에만 기록 |
| R | `sync_message` | 자동 | 반영 결과 요약 | 보호 | 성공 내용 또는 오류 원인 |

### 5-3. 원본 추적·검수 범위 컬럼 S:AA

| 열 | 컬럼명 | 생성·수정 주체 | 보호 | 설명 |
|---|---|---|---|---|
| S | `source_response_row` | 자동 | 보호 | `form_responses`의 원본 행 번호 |
| T | `submitted_at` | 자동 | 보호 | Form 제출 시각 |
| U | `target_place_name` | 자동 | 보호 | Form에 사전 입력된 기존 장소명 |
| V | `changed_fields` | 자동 | 보호 | 사용자가 수정 요청한 항목 |
| W | `update_note` | 자동 | 보호 | 사용자의 수정 설명 |
| X | `location_hint` | 자동 | 보호 | 카카오 검색 보조 정보 |
| Y | `source_hash` | 자동 | 보호·숨김 | 동일 응답의 중복 처리 방지값 |
| Z | `apply_fields` | 자동 초깃값 후 관리자 | 관리자만 편집 | 실제 UPDATE에 반영할 컬럼 목록 |
| AA | `clear_fields` | 관리자 | 관리자만 편집 | 기존 값을 명시적으로 삭제할 컬럼 목록 |

`apply_fields`는 UPDATE에서 필수이며 기본값은 `changed_fields`를 CSV 컬럼명으로 변환한 목록이다. `clear_fields`에 없는 빈 값은 기존 값을 유지한다.

### 5-4. 제안 원본 컬럼 AB:AU

이 그룹은 Form 응답을 영문 내부값과 CSV 형식으로 정규화한 읽기 전용 컬럼이다. 관리자가 제안 내용과 최종 승인값을 비교할 때 사용한다.

| 열 | 컬럼명 | 보호 | 정규화 예 |
|---|---|---|---|
| AB | `proposed_place_name` | 보호 | 앞뒤 공백 제거 |
| AC | `proposed_space_type` | 보호 | `실내`, `실외`, `실내/실외` |
| AD | `proposed_category` | 보호 | 현재 허용된 시설유형 3개 중 하나 |
| AE | `proposed_has_admission_fee` | 보호 | `TRUE`, `FALSE` |
| AF | `proposed_has_age_limit` | 보호 | `TRUE`, `FALSE` |
| AG | `proposed_nursing_room` | 보호 | `TRUE`, `FALSE` |
| AH | `proposed_stroller_rental` | 보호 | `TRUE`, `FALSE` |
| AI | `proposed_parking` | 보호 | `무료`, `유료`, `무료/유료 주차`, `주차 불가`, 미확정 |
| AJ | `proposed_phone` | 보호 | 공백 정리한 문자열 |
| AK | `proposed_website_url` | 보호 | URL 또는 빈 값 |
| AL | `proposed_opening_hours` | 보호 | 줄바꿈 보존 |
| AM | `proposed_closed_days` | 보호 | 문자열 |
| AN | `proposed_admission_fee_detail` | 보호 | 문자열 |
| AO | `proposed_age_limit_detail` | 보호 | 문자열 |
| AP | `proposed_diaper_changing_table` | 보호 | `TRUE`, `FALSE`, 미확정 |
| AQ | `proposed_resident_discount` | 보호 | `TRUE`, `FALSE`, 미확정 |
| AR | `proposed_reservation_url` | 보호 | URL 또는 빈 값 |
| AS | `proposed_photo_url` | 보호 | URL 또는 빈 값 |
| AT | `proposed_description` | 보호 | 최대 100자 후보 |
| AU | `proposed_review_summary` | 보호 | 문자열 |

### 5-5. 관리자 최종 승인값 컬럼 AV:BO

이 그룹은 CSV에 실제로 반영할 콘텐츠 값이다. 자동화가 초깃값을 만들고 관리자가 검수·수정한다.

| 열 | 컬럼명 | 관리자 수정 | 초깃값 규칙 |
|---|---|---:|---|
| AV | `approved_place_name` | 가능 | NEW는 제안값, UPDATE는 기존값에 승인 범위 적용 |
| AW | `approved_space_type` | 가능 | 같은 규칙 |
| AX | `approved_category` | 가능 | 같은 규칙 |
| AY | `approved_has_admission_fee` | 가능 | 같은 규칙 |
| AZ | `approved_has_age_limit` | 가능 | 같은 규칙 |
| BA | `approved_nursing_room` | 가능 | 같은 규칙 |
| BB | `approved_stroller_rental` | 가능 | 같은 규칙 |
| BC | `approved_parking` | 가능 | 같은 규칙 |
| BD | `approved_phone` | 가능 | 같은 규칙 |
| BE | `approved_website_url` | 가능 | 같은 규칙 |
| BF | `approved_opening_hours` | 가능 | 같은 규칙 |
| BG | `approved_closed_days` | 가능 | 같은 규칙 |
| BH | `approved_admission_fee_detail` | 가능 | 같은 규칙 |
| BI | `approved_age_limit_detail` | 가능 | 같은 규칙 |
| BJ | `approved_diaper_changing_table` | 가능 | 같은 규칙 |
| BK | `approved_resident_discount` | 가능 | 같은 규칙 |
| BL | `approved_reservation_url` | 가능 | 같은 규칙 |
| BM | `approved_photo_url` | 가능 | 같은 규칙 |
| BN | `approved_description` | 가능 | 같은 규칙 |
| BO | `approved_review_summary` | 가능 | 같은 규칙 |

UPDATE 요청의 승인값 초기화 순서는 다음과 같다.

1. `target_place_id`의 기존 CSV 행을 기준값으로 복사한다.
2. `apply_fields`에 포함된 제안값만 승인값 후보로 덮어쓴다.
3. 제안값이 비어 있으면 기존 값을 유지한다.
4. `clear_fields`에 포함된 컬럼만 의도적으로 빈 값으로 만든다.
5. 관리자가 승인값을 최종 보정한다.

### 5-6. 지역·검증 및 카카오 후보 자동 컬럼 BP:BY

| 열 | 컬럼명 | 생성 주체 | 보호 | 설명 |
|---|---|---|---|---|
| BP | `resolved_city_name` | 자동 | 보호 | 카카오 주소에서 `제주시` 또는 `서귀포시` 생성 |
| BQ | `resolved_legal_dong_name` | 자동 | 보호 | 읍·면·동 추출 |
| BR | `resolved_region_group` | 자동 | 보호 | 지역 그룹 매핑 규칙 적용 |
| BS | `duplicate_status` | 자동 초깃값 후 관리자 확인 | 관리자만 편집 | 중복 판별 상태 |
| BT | `validation_status` | 자동 | 보호 | `PASS`, `WARNING`, `BLOCKED` |
| BU | `validation_message` | 자동 | 보호 | 승인 차단 또는 경고 사유 |
| BV | `current_record_hash` | 자동 | 보호·숨김 | UPDATE 대상이 검수 중 외부에서 바뀌었는지 확인 |
| BW | `processed_action_key` | 자동 | 보호·숨김 | 같은 관리자 작업의 중복 실행 방지 |
| BX | `kakao_candidate_count` | 자동 | 보호 | 제주 지역 카카오 검색 후보 개수 |
| BY | `kakao_candidates` | 자동 | 보호 | 최대 10개 후보의 ID, 장소명, 주소, 좌표, URL 요약 |

최종 CSV 위치값은 다음과 같이 대응한다.

| CSV 컬럼 | `review_queue` 출처 |
|---|---|
| `kakao_place_id` | `kakao_place_id` |
| `road_address` | `kakao_road_address`, 없으면 검수된 `kakao_address` |
| `latitude` | `kakao_latitude` |
| `longitude` | `kakao_longitude` |
| `city_name` | `resolved_city_name` |
| `legal_dong_name` | `resolved_legal_dong_name` |
| `region_group` | `resolved_region_group` |

## 6. 관리자 입력 컬럼과 자동 컬럼 요약

### 관리자가 직접 수정하는 컬럼

- `admin_action`
- `admin_note`
- `kakao_place_id`
- `match_status`
- `apply_fields`
- `clear_fields`
- `approved_*` 콘텐츠 컬럼 20개
- `duplicate_status`의 최종 판정

### 자동 생성하고 보호하는 컬럼

- 요청 식별: `request_id`, `source_response_row`, `source_hash`
- 원본 정규화: `request_type`, `target_place_id`, `submitted_at`, `target_place_name`, `changed_fields`, `update_note`, `location_hint`, 모든 `proposed_*`
- 카카오 파생값: `kakao_place_name`, 주소, 도로명주소, 위도, 경도, 장소 URL
- 상태·시간: `review_status`, `approved_at`, `synced_place_id`, `synced_at`, `sync_message`
- 지역 파생값: `resolved_city_name`, `resolved_legal_dong_name`, `resolved_region_group`
- 검증값: `validation_status`, `validation_message`, `current_record_hash`, `processed_action_key`
- 후보 목록: `kakao_candidate_count`, `kakao_candidates`

### 자동 초깃값 후 관리자가 확인하는 컬럼

- `kakao_place_id`
- `match_status`
- `apply_fields`
- `approved_*`
- `duplicate_status`

## 7. 드롭다운 설계

Google Sheets의 데이터 유효성 검사로 목록 밖의 값을 거부하도록 설정한다. `apply_fields`와 `clear_fields`만 다중 선택 드롭다운 칩을 사용하고, 나머지는 단일 선택으로 한다.

| 컬럼 | 선택지 | 입력 거부 | 비고 |
|---|---|---:|---|
| `admin_action` | 빈 값, `START_REVIEW`, `REQUEST_INFO`, `APPROVE`, `REJECT`, `RETRY_SYNC` | 예 | 관리자의 유일한 상태 전환 명령 |
| `match_status` | `UNSEARCHED`, `AUTO_MATCHED`, `MULTIPLE_CANDIDATES`, `NO_MATCH`, `CONFIRMED`, `MISMATCH` | 예 | 승인 전 `CONFIRMED` 필수 |
| `duplicate_status` | `NOT_CHECKED`, `CLEAR`, `POSSIBLE_DUPLICATE`, `DUPLICATE` | 예 | 신규 승인 전 `CLEAR` 필수 |
| `apply_fields` | CSV 수정 가능 컬럼 목록 | 예 | UPDATE 필수, 다중 선택 |
| `clear_fields` | 빈 값 삭제가 허용된 선택 컬럼 목록 | 예 | 다중 선택, 기본 빈 값 |
| `approved_space_type` | `실내`, `실외`, `실내/실외` | 예 | CSV 값과 동일 |
| `approved_category` | `관광지`, `영화/연극/공연`, `전시/기념관` | 예 | CSV 값과 동일 |
| `approved_parking` | `무료`, `유료`, `무료/유료 주차`, `주차 불가` | 예 | 미확정 상태로 승인 불가 |
| `approved_has_admission_fee` | `TRUE`, `FALSE` | 예 | 필수 boolean |
| `approved_has_age_limit` | `TRUE`, `FALSE` | 예 | 필수 boolean |
| `approved_nursing_room` | `TRUE`, `FALSE` | 예 | 필수 boolean |
| `approved_stroller_rental` | `TRUE`, `FALSE` | 예 | 필수 boolean |
| `approved_diaper_changing_table` | 빈 값, `TRUE`, `FALSE` | 예 | 선택 정보 |
| `approved_resident_discount` | 빈 값, `TRUE`, `FALSE` | 예 | 선택 정보 |

다중 선택 드롭다운은 칩 표시에서만 사용할 수 있고 모바일에서는 여러 항목 선택이 제한될 수 있으므로, 검수 작업은 데스크톱에서 하는 것을 권장한다.

## 8. 상태와 관리자 작업 규칙

### 8-1. `review_status`

| 상태 | 의미 | 자동 전환 조건 |
|---|---|---|
| `PENDING` | 새 응답, 검수 전 | `review_queue` 생성 시 |
| `IN_REVIEW` | 관리자 확인 중 | `START_REVIEW` 처리 성공 |
| `NEEDS_INFO` | 장소 또는 정보 보완 필요 | `REQUEST_INFO` 처리 성공 |
| `APPROVED` | 검수 완료, 동기화 대기 | `APPROVE` 요청이 모든 검증을 통과 |
| `REJECTED` | 반영하지 않음 | `REJECT` 처리 성공 |
| `SYNCING` | CSV 반영 진행 중 | 동기화 시작 시 |
| `SYNCED` | CSV 반영 성공 | 동기화와 로그 기록 완료 |
| `ERROR` | 자동 처리 또는 동기화 실패 | 오류 발생 시 |

`APPLIED`와 `SYNCED`를 혼용하지 않고 최종 성공 상태는 `SYNCED`로 통일한다.

### 8-2. `admin_action`

| 작업 | 허용 상태 | 필수 조건 | 결과 |
|---|---|---|---|
| `START_REVIEW` | `PENDING`, `NEEDS_INFO` | 없음 | `IN_REVIEW` |
| `REQUEST_INFO` | `PENDING`, `IN_REVIEW` | `admin_note` 입력 | `NEEDS_INFO` |
| `APPROVE` | `IN_REVIEW`, `NEEDS_INFO` | 검증 통과, 카카오 매칭 확정, 필수 승인값 존재 | `APPROVED` |
| `REJECT` | `PENDING`, `IN_REVIEW`, `NEEDS_INFO` | `admin_note` 입력 | `REJECTED` |
| `RETRY_SYNC` | `ERROR` | 오류 원인 해결 | 재검증 후 `APPROVED` 또는 `SYNCING` |

NEW 요청은 `match_status=CONFIRMED`, `duplicate_status=CLEAR`가 아니면 승인하지 않는다. UPDATE 요청은 위치 변경이 `apply_fields`에 포함되었을 때만 카카오 매칭 재확정을 요구한다.

## 9. 조건부 서식

조건부 서식은 전체 행의 아주 연한 배경색과 핵심 셀의 진한 강조를 함께 사용한다. 규칙이 중복되지 않도록 아래 순서대로 배치한다.

### 9-1. 상태별 행 배경

| 우선순위 | 조건 | 색상 | 의미 |
|---:|---|---|---|
| 1 | `review_status=ERROR` | 분홍·빨강 계열 | 즉시 확인 필요 |
| 2 | `validation_status=BLOCKED` | 연한 분홍 `#FCE3EA` | 승인 불가 |
| 3 | `review_status=NEEDS_INFO` | 연한 주황 `#FFE2B8` | 추가 정보 필요 |
| 4 | `review_status=PENDING` | 연한 노랑 `#FFF1C7` | 미검수 |
| 5 | `review_status=IN_REVIEW` | 연한 하늘 `#DDF4F8` | 검수 중 |
| 6 | `review_status=APPROVED` | 연한 민트 `#DDF5EC` | 동기화 대기 |
| 7 | `review_status=SYNCED` | 바다 스카이의 매우 연한 색 | 반영 완료 |
| 8 | `review_status=REJECTED` | 연한 회색 | 종료 |

### 9-2. 셀 단위 경고

| 대상 | 경고 조건 | 표시 |
|---|---|---|
| `target_place_id` | UPDATE인데 빈 값 또는 존재하지 않는 ID | 빨간 배경 |
| `kakao_place_id` | NEW인데 빈 값 | 빨간 배경 |
| `match_status` | `MULTIPLE_CANDIDATES`, `NO_MATCH`, `MISMATCH` | 주황 또는 빨간 배경 |
| `duplicate_status` | `POSSIBLE_DUPLICATE`, `DUPLICATE` | 주황 또는 빨간 배경 |
| `admin_note` | `REQUEST_INFO` 또는 `REJECT`인데 빈 값 | 빨간 테두리 |
| 필수 `approved_*` | 승인 요청인데 빈 값 | 빨간 배경 |
| URL 승인값 | 값이 있으나 `http://` 또는 `https://`로 시작하지 않음 | 분홍 배경 |
| `approved_at` | 승인 상태가 아닌데 값이 존재 | 빨간 글자 |
| `synced_at` | `SYNCED`인데 빈 값 | 빨간 글자 |

## 10. 보호 설정

Google Sheets의 보호된 시트와 범위 기능으로 편집 권한을 제한한다.

### `form_responses`

- 시트 전체 보호
- Spreadsheet 소유자와 Form 연결 계정만 구조 변경 가능
- 일반 관리자는 보기만 가능

### `review_queue`

- 우선 시트 전체 보호
- 다음 범위만 관리자 그룹에 편집 허용:
  - E:F — 관리자 작업과 메모
  - G, N — 카카오 장소 ID와 매칭 확정
  - Z:AA — 적용·삭제 컬럼
  - AV:BO — 최종 승인값
  - BS — 중복 최종 판정
- 자동화가 쓰는 나머지 범위는 소유자 또는 자동화 실행 계정만 편집
- 보호는 입력 실수를 막는 장치이며, 민감정보 보안이나 열람 제한을 대신하지 않는다.

### `sync_log`

- 시트 전체 보호
- 자동화 실행 계정만 행 추가 가능
- 관리자는 보기와 필터 보기만 사용
- 오류를 고쳐도 기존 로그 행을 수정하지 않고 새 실행 로그를 추가

## 11. `sync_log` 설계

`sync_log`는 동기화 1회 시도마다 한 행을 추가한다. 성공과 실패를 모두 기록한다.

| 순서 | 컬럼명 | 생성 주체 | 설명 |
|---:|---|---|---|
| 1 | `log_id` | 자동 | 로그 고유 ID |
| 2 | `request_id` | 자동 | `review_queue` 요청 연결 |
| 3 | `execution_id` | 자동 | 한 번의 동기화 실행 묶음 ID |
| 4 | `started_at` | 자동 | 시작 시각 |
| 5 | `finished_at` | 자동 | 종료 시각 |
| 6 | `operation` | 자동 | `INSERT`, `UPDATE`, `SKIP` |
| 7 | `target_place_id` | 자동 | UPDATE 대상 ID |
| 8 | `synced_place_id` | 자동 | 실제 반영된 장소 ID |
| 9 | `result` | 자동 | `SUCCESS`, `ERROR`, `SKIPPED` |
| 10 | `applied_fields` | 자동 | 실제 반영한 컬럼 목록 |
| 11 | `cleared_fields` | 자동 | 실제 비운 컬럼 목록 |
| 12 | `before_hash` | 자동 | 반영 전 대상 행 또는 파일 해시 |
| 13 | `after_hash` | 자동 | 반영 후 대상 행 또는 파일 해시 |
| 14 | `rows_before` | 자동 | 반영 전 CSV 행 수 |
| 15 | `rows_after` | 자동 | 반영 후 CSV 행 수 |
| 16 | `backup_path` | 자동 | 생성된 백업 파일 경로 |
| 17 | `message` | 자동 | 성공 요약 또는 오류 상세 |
| 18 | `actor` | 자동 | 실행 계정 또는 관리자 식별값 |

동일한 `request_id`에 `SUCCESS` 로그가 있으면 다시 반영하지 않는다. 재시도는 이전 `ERROR` 로그를 남겨 둔 채 새 로그 행으로 추가한다.

## 12. 승인 전 자동 검증 조건

### 공통

- `request_id`가 고유함
- 필수 승인값이 비어 있지 않음
- category, space_type, parking이 CSV 허용값에 포함됨
- 필수 boolean이 `TRUE` 또는 `FALSE`
- URL 값이 있으면 `http://` 또는 `https://`로 시작
- 위도·경도가 숫자로 변환 가능
- `match_status=CONFIRMED`
- `validation_status`가 `BLOCKED`가 아님

### NEW

- `target_place_id`가 비어 있음
- `duplicate_status=CLEAR`
- 카카오 장소와 주소·좌표가 확정됨
- 다음 `place_id`를 동기화 시점에 생성할 수 있음

### UPDATE

- `target_place_id`가 CSV에 정확히 한 건 존재
- 검수 시작 시 저장한 `current_record_hash`와 동기화 직전 기존 행의 해시가 일치
- `apply_fields`가 비어 있지 않음
- `place_id` 자체는 변경 대상이 아님
- 빈 제안값은 `clear_fields`에 포함되지 않은 한 기존 값 유지
- 위치 변경 시에만 카카오 위치 파생값을 갱신

## 13. 관리자 사용 순서

### Google Form 응답

1. `review_queue`에서 검수할 행의 아무 셀이나 선택한다.
2. Form 제안값, `approved_*`, VWorld 장소명과 주소를 확인한다.
3. `🍊 제주아이랑 검수 → 선택 행 승인·반영`을 누른다.
4. 확인창 내용이 맞으면 `예`를 누른다.
5. 성공 창과 해당 행의 `review_status=APPLIED`를 확인한다.

확인창 내용이 틀릴 때만 같은 행의 `approved_*`, `source_*`,
`target_place_name`, `apply_fields`, `clear_fields` 중 필요한 값을 수정하고 다시
실행한다. 오류가 나면 `sync_message`를 먼저 확인한다.

### 관리자 직접 입력·수정

1. `jeju_irang_master`를 직접 수정한다.
2. Apps Script에서 `exportJejuIrangCsv`를 실행한다.
3. 자동 갱신된 `jeju_irang_export`와 생성된 CSV를 확인한다.

`form_responses`, `jeju_irang_export`, `sync_log`는 직접 수정하지 않는다.

## 14. 구현 전 확인할 사항

- Form 응답 시트의 실제 질문 헤더와 이 문서의 내부 필드 매핑
- Google Form 생성 후 확정되는 질문 순서
- 관리자 Google 계정 또는 관리자 그룹
- 카카오 API 키의 저장 위치와 실행 주체
- CSV가 로컬 PC에 있을 때 Google Apps Script가 직접 접근할 수 없다는 점
- 승인된 Sheet 데이터를 로컬 CSV에 반영할 실행 위치: 로컬 스크립트, 배포 서버 또는 별도 관리자 실행 도구
- `kakao_place_id`를 운영 CSV에 실제로 추가할 시점
- 다중 선택 드롭다운을 사용할 관리자가 데스크톱 환경에서 검수하는지 여부

특히 Google Sheet와 로컬 `data/jeju-irang.csv`는 서로 다른 환경에 있으므로, 4단계에서는 **승인 데이터 전달 방식과 CSV 동기화 실행 위치**를 먼저 결정해야 한다.

## 15. 완료 조건

- 세 시트의 역할과 수정 주체가 분리되어 있다.
- 사용자가 요청한 `review_queue` 관리 컬럼이 모두 포함되어 있다.
- 관리자 입력 컬럼과 자동 생성·보호 컬럼이 구분되어 있다.
- 관리자 상태 변경은 `admin_action`을 통해서만 이루어진다.
- 카카오 장소는 관리자가 확정하고 주소·좌표는 자동 생성된다.
- 드롭다운 선택지와 조건부 서식 규칙이 정의되어 있다.
- 수정 요청의 빈 값이 기존 CSV 값을 삭제하지 않는다.
- 동기화 성공과 실패가 `sync_log`에 누적 기록된다.
- Google Sheet, Apps Script, Streamlit 코드는 아직 만들지 않는다.

## 16. 참고 자료

- Google Sheets 드롭다운과 데이터 유효성 검사: <https://support.google.com/docs/answer/186103?hl=ko>
- Google Sheets 조건부 서식: <https://support.google.com/docs/answer/78413?hl=ko>
- Google Sheets 보호된 시트와 범위: <https://support.google.com/docs/answer/1218656?hl=ko>
