# 제주아이랑 데이터 안내

앱에서 사용하는 데이터 테이블은 `jeju_irang.csv`와 `bookmarks.csv` 두 개입니다.

## places (`jeju_irang.csv`)

| 컬럼 | 앱에서의 사용처 |
|---|---|
| place_id | 장소 선택 및 즐겨찾기 연결용 내부 ID |
| place_name | 검색, 목록 제목, 상세 제목 |
| category_level_2 | 시설 유형 필터와 배지 |
| city_name | 상세 위치 표시 |
| legal_dong_name | 상세 읍·면·동 표시 |
| region_group | 지역 필터와 지역 표시 |
| road_address | 상세 주소 |
| latitude, longitude | 상세 지도 |
| phone | 상세 연락처 |
| website_url | 홈페이지 링크 |
| closed_days | 휴무일 지표 |
| opening_hours | 목록과 상세 운영시간 |
| free_parking, paid_parking | 주차 필터와 배지 |
| has_admission_fee, admission_fee | 무료 입장 지표, 요금 표시와 정렬 |
| admission_fee_detail | 상세 요금 안내 |
| has_age_limit, minimum_age | 연령 제한 안내 |
| nursing_room | 수유실 필터와 배지 |
| stroller_rental | 유모차 대여 필터와 배지 |
| reservation_url | 예약 링크 |
| space_type | 실내·실외 필터와 표시 |
| resident_discount | 도민 할인 필터와 배지 |
| diaper_changing_table | 기저귀교환대 필터와 배지 |
| photo_url | 상세 사진 |
| description | 검색과 상세 설명 |
| review_summary | 검색과 방문 후기 요약 |

`minimum_age`의 빈 값은 연령 제한이 없는 장소를 뜻합니다. `review_summary`의 빈 값은 앱에서 "등록된 후기 요약이 없습니다"로 처리합니다.

## bookmarks (`bookmarks.csv`)

| 컬럼 | 앱에서의 사용처 |
|---|---|
| bookmark_id | 즐겨찾기 내부 ID |
| nickname | 저장 및 닉네임별 조회 |
| place_id | 장소 데이터 연결 |
| created_at | 저장 시각 표시와 최신순 정렬 |

앱은 CSV에서 컬럼이 누락되면 누락된 컬럼명을 경고로 보여 주고, 해당 컬럼을 사용하는 기능만 숨깁니다.
