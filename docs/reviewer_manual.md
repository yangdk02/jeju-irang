# 제주아이랑 초간단 검수자 매뉴얼

> 이 문서가 현재 운영 기준입니다. 과거 설계 문서에 있는 `admin_action`,
> `review_status`, `match_status` 수동 변경 절차보다 이 문서의 한 번 실행
> 절차를 우선합니다.

## 먼저 기억할 두 가지

- Google Form 응답: `review_queue` 행 확인 → `선택 행 승인·반영`
- 관리자 직접 수정: `jeju_irang_master` 수정 → `exportJejuIrangCsv`

## 1. Google Form 응답 처리

### 정상 응답

1. Google Spreadsheet의 `review_queue`에서 처리할 행의 아무 셀이나 클릭합니다.
2. 장소명, VWorld 장소명·주소, `approved_*` 최종값을 확인합니다.
3. Spreadsheet 상단 메뉴에서
   `🍊 제주아이랑 검수 → 선택 행 승인·반영`을 누릅니다.
4. 확인창 내용이 맞으면 `예`를 누릅니다.

이것으로 검수는 끝입니다. 다음 작업은 자동으로 처리됩니다.

- VWorld 후보 확정
- `admin_action=APPROVE`, `review_status=APPROVED` 설정
- 신규 장소 추가 또는 기존 장소 수정
- 반영 전 백업 CSV 생성
- `jeju_irang_master`, `jeju_irang_export` 갱신
- Google Drive에 최종 CSV 생성
- `sync_log` 기록
- 처리한 요청을 `APPLIED`로 변경

정상 응답에서는 `admin_action`, `review_status`, `match_status`를 직접 수정하지
않습니다.

사용자가 장소명만 입력해도 정상 응답입니다. 실내/실외, 시설유형, 입장료,
연령제한, 수유실, 유모차 대여, 주차를 모르거나 비워 둔 경우에는
`approved_*` 값도 비어 있을 수 있습니다. 이 값들은 Form 접수 단계에서는
오류가 아니며, CSV 반영 전에 관리자가 확인하여 채웁니다.

### 확인창 내용이 틀릴 때

`아니오`를 누르고 같은 `review_queue` 행의 잘못된 값만 고칩니다. 수정 후
같은 행을 다시 선택하여 `선택 행 승인·반영`을 누릅니다.

#### 장소 정보가 잘못된 경우

실제 반영할 값인 해당 `approved_*` 셀을 수정합니다.

| 정보 | 수정할 컬럼 |
|---|---|
| 장소명 | `approved_place_name` |
| 시설유형 | `approved_category` |
| 실내·실외 | `approved_space_type` |
| 주차 | `approved_parking` |
| 운영시간 | `approved_opening_hours` |
| 입장료 여부 | `approved_has_admission_fee` |
| 한 줄 설명 | `approved_description` |

그 밖의 정보도 이름이 같은 `approved_*` 컬럼에서 수정합니다.

#### VWorld 장소가 잘못된 경우

올바른 후보를 확인하여 다음 값을 수정합니다.

- `source_place_name`
- `source_address` 또는 `source_road_address`
- `source_latitude`
- `source_longitude`
- `source_provider`: `VWORLD`

다시 승인할 때 확인창에서 `예`를 누르면 `match_status=CONFIRMED`는 자동으로
설정됩니다.

#### 기존 장소 수정 대상을 찾지 못한 경우

`target_place_name`을 `jeju_irang_master`의 장소명과 글자와 띄어쓰기까지
같게 수정합니다.

#### 변경할 항목이 잘못된 경우

`apply_fields`에 실제 변경할 CSV 컬럼명만 쉼표로 입력하고, 대응하는
`approved_*` 값을 확인합니다.

```text
phone, opening_hours, description
```

#### 기존 값을 삭제하려는 경우

`approved_*`를 빈칸으로 만드는 것만으로는 기존 값이 삭제되지 않습니다.
`clear_fields`에 삭제할 CSV 컬럼명을 입력합니다.

```text
website_url, reservation_url
```

#### 실행 후 오류가 난 경우

같은 행의 `sync_message`를 확인하고 원인이 된 값을 수정한 다음
`선택 행 승인·반영`을 다시 누릅니다.

#### `VWORLD_API_ERROR` 또는 `502 Bad Gateway`가 나온 경우

VWorld 서버의 일시 오류이므로 Google Form을 다시 제출하거나
`form_responses`를 수정하지 않습니다.

1. Apps Script 편집기를 엽니다.
2. 상단 함수 목록에서 `retryFailedVworldSearches`를 선택합니다.
3. `실행`을 누릅니다.
4. `review_queue`의 기존 요청에서 `match_status`, VWorld 후보 정보와
   `sync_message`가 갱신되었는지 확인합니다.

이 함수는 기존 `request_id`와 Form 응답을 유지한 채
`match_status=UNSEARCHED`이고 `sync_message`가 `VWORLD_API_ERROR:`로 시작하는
행만 다시 검색합니다. 다시 502 오류가 발생하면 행을 삭제하지 말고
10~30분 뒤 같은 함수를 다시 실행합니다.

### 승인하면 안 되는 경우

다음 요청은 승인·반영하지 않습니다.

- 기존 장소와 중복되는 신규 제안
- 장소명·주소·좌표가 서로 다른 VWorld 후보
- 사용자 입력만으로 장소를 특정할 수 없는 요청

필요하면 `admin_note`에 이유를 기록하고 `admin_action=REJECT`,
`review_status=REJECTED`로 표시합니다.

## 2. 관리자가 직접 장소 정보를 입력·수정할 때

1. `jeju_irang_master`에서 기존 행을 수정하거나 신규 행을 추가합니다.
2. 신규 행은 중복되지 않는 다음 `P번호`를 사용하고 필수 컬럼을 채웁니다.
3. Apps Script 편집기를 엽니다.
4. 함수 목록에서 `exportJejuIrangCsv`를 선택하고 `실행`을 누릅니다.
5. 생성된 `jeju-irang-export-날짜-시간.csv`를 내려받습니다.
6. 프로젝트의 `data/jeju-irang.csv`를 교체하고 GitHub에 반영합니다.

`exportJejuIrangCsv`는 `jeju_irang_export`를 자동 갱신하지만, Form 요청을
처리한 것이 아니므로 `sync_log`에는 기록하지 않습니다.

## 3. 시트별 수정 원칙

| 시트 | 관리자가 직접 수정하는 경우 |
|---|---|
| `form_responses` | 없음. Google Form 원본이므로 수정하지 않음 |
| `review_queue` | Form 응답의 승인값 또는 예외를 보정할 때만 수정 |
| `jeju_irang_master` | 관리자가 장소 데이터를 직접 입력·수정할 때 |
| `jeju_irang_export` | 없음. 자동 생성 결과 확인용 |
| `sync_log` | 없음. 자동 처리 이력 확인용 |

## 4. 앱에 반영하는 마지막 단계

두 경로 모두 최종 CSV가 생성된 뒤에는 다음 작업이 필요합니다.

1. 최신 `jeju-irang-export-날짜-시간.csv`를 내려받습니다.
2. 로컬 프로젝트의 `data/jeju-irang.csv`를 교체합니다.
3. 앱에서 검색·상세 화면을 확인합니다.
4. GitHub에 커밋·푸시하여 Streamlit 앱을 다시 배포합니다.

## 5. 처음 한 번만 설정

1. 응답 Google Spreadsheet에서 `확장 프로그램 → Apps Script`를 엽니다.
2. 최신 `csv_sync_export.gs` 코드를 붙여 넣고 저장합니다.
3. Spreadsheet를 새로고침합니다.
4. Spreadsheet 맨 위 메뉴에 `🍊 제주아이랑 검수`가 나타나는지 확인합니다.

시트 안에 별도 버튼을 만들고 싶다면 다음 함수명을 할당합니다.

```text
approveAndSyncSelectedRequest
```
