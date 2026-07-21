# 5단계: 관리자 승인 데이터 CSV 반영·내보내기

이 단계는 `review_queue`에서 관리자가 최종 승인한 요청만 `jeju-irang.csv` 형식으로 반영합니다.

- 기준 데이터 시트: `jeju_irang_master`
- 내보내기 확인 시트: `jeju_irang_export`
- 처리 이력: `sync_log`
- 생성 파일: `jeju-irang-export-날짜-시간.csv`
- 자동 백업: `jeju-irang-backup-날짜-시간.csv`

로컬 프로젝트의 `data/jeju-irang.csv`는 Apps Script가 직접 수정하지 않습니다. 최종 CSV를 확인한 다음 직접 내려받아 교체합니다.

## 1. Apps Script에 코드 추가

현재 Google Form과 연결된 Apps Script 프로젝트를 엽니다.

1. 왼쪽 `+` → `스크립트`를 누릅니다.
2. 파일 이름을 `csv_sync_export`로 만듭니다.
3. 프로젝트의 `scripts/google_apps_script/csv_sync_export.gs` 전체를 붙여 넣습니다.
4. 저장합니다.

## 2. 시트 준비

함수 목록에서 `setupCsvSyncSheets`를 선택해 한 번 실행합니다.

다음 시트가 생성됩니다.

- `jeju_irang_master`
- `jeju_irang_export`
- `sync_log` — 이미 있으면 기존 구조를 그대로 확인합니다.

이후 `setupAdminReviewControls`를 한 번 실행합니다. `review_queue`의 검수 상태, 관리자 작업, VWorld 일치 상태에 드롭다운이 적용됩니다.

## 3. 기존 CSV를 기준 데이터로 한 번만 가져오기

1. `data/jeju-irang.csv`를 Google Drive에 업로드합니다. Google Sheet로 변환하지 않고 CSV 파일 그대로 올립니다.
2. 파일을 열었을 때 주소에서 파일 ID를 복사합니다.
   - 예: `https://drive.google.com/file/d/파일_ID/view`
3. Apps Script 왼쪽의 `프로젝트 설정` → `스크립트 속성`에 아래 값을 추가합니다.

| 속성 | 값 |
|---|---|
| `JEJU_IRANG_CSV_FILE_ID` | 업로드한 CSV의 파일 ID |
| `JEJU_IRANG_EXPORT_FOLDER_ID` | 선택 사항. 내보낼 Drive 폴더 ID |

4. `importJejuIrangCsvFromDrive`를 실행합니다.
5. `jeju_irang_master`에 헤더 포함 269행(현재 장소 268개)이 들어왔는지 확인합니다.

주의: `importJejuIrangCsvFromDrive`는 빈 `jeju_irang_master`에만 들어갑니다. 최초 한 번 이후에는 다시 실행하지 않습니다.

## 4. 관리자 검수 방법

현재 검수는 한 번 실행 방식입니다. 정상 응답에서는 `admin_action`,
`review_status`, `match_status`를 직접 설정하지 않습니다.

1. `review_queue`에서 처리할 행의 아무 셀이나 선택합니다.
2. VWorld 장소명·주소와 `approved_*` 최종값을 확인합니다.
3. Spreadsheet 상단 메뉴에서
   `🍊 제주아이랑 검수 → 선택 행 승인·반영`을 누릅니다.
4. 확인창 내용이 맞으면 `예`를 누릅니다.

`approveAndSyncSelectedRequest`가 해당 행 하나만 승인하고 즉시 master와 CSV에
반영합니다. 신규 장소의 `place_id`도 현재 가장 큰 P번호 다음 번호로 자동
발급됩니다.

### 예외가 있을 때만 수정하는 컬럼

- 최종 장소 정보가 틀림: 해당 `approved_*` 수정
- VWorld 후보가 틀림: `source_place_name`, `source_address` 또는
  `source_road_address`, `source_latitude`, `source_longitude` 수정
- 기존 장소를 찾지 못함: `target_place_name`을 master 장소명과 정확히 일치시킴
- 수정할 항목이 틀림: `apply_fields` 수정
- 기존 값을 삭제해야 함: `clear_fields` 수정

`apply_fields` 예:

```text
phone, opening_hours, description
```

`approved_*`가 빈 값이면 기존 값은 유지됩니다. 값을 일부러 지우려면
`clear_fields`에 CSV 컬럼명을 명시합니다.

```text
website_url, reservation_url
```

`place_id`는 삭제할 수 없으며, 필수 컬럼을 삭제하려 하면 해당 요청은 오류로 남습니다.

오류가 나면 같은 행의 `sync_message`를 확인하고 필요한 값만 수정한 뒤
`선택 행 승인·반영`을 다시 누릅니다.

## 5. 승인 반영과 CSV 생성

일반 검수자는 `syncApprovedRequests`를 별도로 실행하지 않습니다.
`선택 행 승인·반영` 메뉴가 선택한 요청에 한해 이 함수를 내부에서 실행합니다.

스크립트가 아래 순서로 처리합니다.

1. VWorld 후보가 필요하면 관리자에게 확인창 표시
2. 해당 행을 `APPROVE`, `APPROVED`로 자동 설정
3. 신규는 다음 P번호로 추가
4. 수정은 `target_place_name`과 정확히 일치하는 한 행만 수정
5. 승인 전 기준 데이터 백업 CSV 생성
6. `jeju_irang_master`와 `jeju_irang_export` 갱신
7. 최종 CSV를 Google Drive에 생성
8. 성공·실패를 `sync_log`에 기록

성공한 `review_queue` 행은 `review_status=APPLIED`로 바뀌며 `synced_place_id`, `synced_at`, `sync_message`가 채워집니다. 오류가 난 행은 `review_status=ERROR`가 되고 이유가 `sync_message`에 기록됩니다.

같은 승인 내용은 `processed_action_key`로 구분하므로 실수로 다시 실행해도 동일 요청이 중복 반영되지 않습니다.

## 6. 결과 확인과 앱 데이터 교체

1. 실행 로그의 `최종 CSV` 주소를 열거나 `showLatestJejuIrangExportLink`를 실행합니다.
2. `jeju_irang_export`에서 신규·수정 결과를 확인합니다.
3. `sync_log`에서 모든 대상 요청이 `SUCCESS`인지 확인합니다.
4. CSV를 내려받습니다.
5. 로컬 `data/jeju-irang.csv`를 별도 백업한 뒤 내려받은 파일로 교체합니다.
6. Streamlit 앱에서 검색·상세·즐겨찾기 연결을 확인합니다.

승인 요청 없이 현재 master만 다시 내보낼 때는 `exportJejuIrangCsv`를 실행합니다.

### 관리자가 master를 직접 수정한 경우

1. `jeju_irang_master`에서 데이터를 직접 입력·수정합니다.
2. Apps Script에서 `exportJejuIrangCsv`를 실행합니다.
3. 갱신된 `jeju_irang_export`를 확인하고 생성된 CSV를 내려받습니다.

이 수동 내보내기는 `sync_log`에 기록되지 않습니다. `form_responses`,
`jeju_irang_export`, `sync_log`는 관리자가 직접 수정하지 않습니다.

## 오류 확인표

| 메시지 | 확인할 것 |
|---|---|
| `jeju_irang_master가 비어 있습니다` | 3단계 CSV 가져오기를 먼저 실행 |
| `기존 장소명과 정확히 일치... 0건` | `target_place_name`의 띄어쓰기와 글자를 master와 동일하게 수정 |
| `... 2건입니다` | master의 중복 장소명을 먼저 정리 |
| `match_status를 CONFIRMED` | 올바른 `source_*` 장소·주소·좌표를 확인한 뒤 같은 행에서 `선택 행 승인·반영` 재실행 |
| `확정 좌표가 제주 검증 범위를 벗어났습니다` | 잘못 선택한 VWorld 후보인지 확인 |
| `최종 데이터 필수값이 없습니다` | 해당 `approved_*` 값 또는 VWorld 위치값 보완 |
| `동일한 승인 내용이 이미 처리되었습니다` | 이미 반영된 요청. 추가 수정이면 승인값을 고쳐 다시 검수 |
