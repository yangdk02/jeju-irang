# 제주아이랑 초간단 검수자 매뉴얼

> 이 문서가 현재 운영 기준입니다. 과거 설계 문서에 있는 `admin_action`,
> `review_status`, `match_status` 수동 변경 절차보다 이 문서의 한 번 실행
> 절차를 우선합니다.

## 먼저 기억할 세 가지

- Google Form 응답: `review_queue` 행 확인 → `선택 행 승인·반영`
- 관리자 직접 수정: `jeju_irang_master` 수정 → `exportJejuIrangCsv`
- 관광사진 갱신: `TourAPI 사진 업데이트·CSV 생성` 한 번 클릭

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

## 3. 국문 관광정보·최신 사진을 한 번에 갱신할 때

### 평소에 누르는 버튼은 이것 하나입니다

Apps Script 편집기 위쪽의 **함수 선택 목록**에서 아래 함수를 선택하고
`실행`을 한 번 누릅니다.

```text
startAllTourDataUpdateAndExport
```

이 함수 하나가 순서대로 처리합니다.

1. 국문 관광정보에서 한 줄 설명을 찾아 `jeju_irang_master`의
   `description`을 업데이트합니다.
2. 관광사진갤러리에서 최신 사진을 찾아 `jeju_irang_master`의
   `photo_url`을 업데이트합니다.
3. `jeju_irang_export`를 갱신합니다.
4. 다운로드할 최종 CSV를 생성합니다.

다른 TourAPI 함수는 평소에 누르지 않습니다. 처리 중에는 같은 함수를 다시
누르지 말고 완료될 때까지 기다립니다.

1. `vworld_enrichment.gs`, `csv_sync_export.gs`가 들어 있는 **기존 별도
   Apps Script 프로젝트**를 엽니다.
2. 함수 목록에서 `startAllTourDataUpdateAndExport`를 선택하고 `실행`을
   한 번 누릅니다.
3. 이후에는 다시 누르지 않고 기다립니다. Spreadsheet를 닫아도 작은
   묶음으로 자동 처리됩니다.
4. 국문 관광정보 처리가 끝나면 최신 관광사진 확인과 CSV 생성이 자동으로
   이어집니다.
5. `tourapi_photo_log`의 마지막 `COMPLETE` 행에서 최종 CSV 링크를
   확인합니다.

업데이트 결과는 다음 위치에서 확인합니다.

| 확인할 내용 | 시트와 컬럼 |
|---|---|
| 한 줄 설명 | `jeju_irang_master` → `description` |
| 최신 사진 URL | `jeju_irang_master` → `photo_url` |
| 최종 내보내기 결과 | `jeju_irang_export` |
| 다운로드 CSV 링크 | `tourapi_photo_log`의 마지막 `COMPLETE` 행 |

첫 실행은 현재 `jeju_irang_master`의 모든 장소를 보강합니다. 이후에는
새 장소, 장소명·주소·좌표가 바뀐 장소, TourAPI의 `modifiedtime`이 바뀐
장소만 상세 정보를 다시 받아옵니다. 새 장소를 `jeju_irang_master`에
추가한 뒤에도 같은 함수 하나만 실행하면 됩니다.

자동으로 받을 수 있는 정보는 주소·좌표·전화·홈페이지·운영시간·휴무일·
이용요금·연령 정보·유모차·주차·소개문·관광 이미지
등입니다. API의 빈 값은 기존 master 값을 삭제하지 않습니다. 사진은
국문 관광정보의 대표 이미지보다 관광사진갤러리의 최신 사진을 우선합니다.

오래 기다려도 `tourapi_kor_log`가 늘지 않고 실행 상태만 남아 있다면 최신
코드로 교체한 뒤 다음 복구 함수를 **한 번만** 실행합니다.

```text
recoverStuckTourApiKorUpdate
```

멈춘 상태와 관련 트리거를 정리하고 1분 뒤 전체 업데이트를 처음부터 다시
시작합니다. master의 장소 데이터는 삭제하지 않습니다.

장소명이 정확히 일치하지 않거나 제주 후보가 여러 개면 자동 반영하지 않고
`tourapi_kor_review`에 기록합니다. 이 경우 master의 기존 값은 유지됩니다.

### 남겨 두는 TourAPI 보조 시트

다음 네 개만 보조 시트로 유지하며 직접 수정하지 않습니다.

- `tourapi_kor_map`: 앱 장소와 TourAPI `contentid` 연결 및 증분 처리 기준
- `tourapi_kor_review`: 자동 확정하지 않은 후보
- `tourapi_kor_log`: 반영 필드·오류·완료 이력
- `tourapi_photo_log`: 사진 변경 이력과 최종 CSV 링크

반려동물 기능과 예전 보조 시트를 정리할 때는 최신 코드를 저장하고 다음
함수를 한 번 실행합니다.

```text
cleanupTourApiSheetsAndRemovePetColumns
```

이 함수는 실행 중인 TourAPI 작업을 중지하고 `pet_allowed`, `pet_info`를
master와 export에서 제거합니다. 다음 시트도 삭제합니다.

- `tourapi_kor_content`, `tourapi_kor_repeat`, `tourapi_kor_images`
- `tourapi_kor_pet`, `tourapi_kor_raw`
- `tourapi_photo_map`, `tourapi_photo_review`

`form_responses`, `review_queue`, `jeju_irang_master`의 장소 행,
`jeju_irang_export`, `sync_log`는 삭제하지 않습니다.

실행이 중간에 멈춘 것이 확실할 때만 `restartAllTourDataUpdateAndExport`를
실행합니다. 정상 처리 중에는 이 함수를 누르지 않습니다.

### 사진만 따로 다시 갱신해야 할 때

`description`은 그대로 두고 사진만 다시 확인하려는 예외적인 경우에만
`startTourApiPhotoUpdateAndExport`를 실행합니다. 평소에는 위의
`startAllTourDataUpdateAndExport`를 사용합니다.

1. Spreadsheet 상단 메뉴에서
   `🍊 제주아이랑 검수 → TourAPI 사진 업데이트·CSV 생성`을 누릅니다.
2. 처음 실행할 때만 권한 요청을 승인합니다.
3. 이후에는 다른 버튼을 누르지 않고 기다립니다. Spreadsheet를 닫아도
   20곳씩 자동으로 계속 처리됩니다.
4. 완료 알림이 나타나면 `tourapi_photo_log`의 마지막 `COMPLETE` 행에서
   최종 CSV 링크를 확인합니다.
5. CSV를 내려받아 프로젝트의 `data/jeju-irang.csv`를 교체합니다.

기존에 관리자가 직접 넣은 사진도 장소명이 정확히 일치하면 최신 촬영
사진으로 교체됩니다. 기존 URL과 새 URL은 `tourapi_photo_log`에 남으므로
잘못 교체된 경우 이전 URL로 되돌릴 수 있습니다.

자동 반영 조건은 다음과 같습니다.

- TourAPI 사진 제목과 `place_name`이 정확히 일치
- 촬영 장소 또는 검색 키워드가 제주임
- 상세 사진 중 `galPhotographyMonth`가 가장 최신인 사진

정확히 일치하지 않는 결과는 기존 사진을 유지합니다. `NOT_FOUND`와
`REVIEW_REQUIRED`는 오류가 아니며 자동 반영하지 않은 장소입니다.

다음 보조 시트는 직접 수정하지 않습니다.

- `tourapi_photo_log`: 이전 URL, 새 URL, 오류 및 최종 CSV 링크 확인

## 4. 시트별 수정 원칙

| 시트 | 관리자가 직접 수정하는 경우 |
|---|---|
| `form_responses` | 없음. Google Form 원본이므로 수정하지 않음 |
| `review_queue` | Form 응답의 승인값 또는 예외를 보정할 때만 수정 |
| `jeju_irang_master` | 관리자가 장소 데이터를 직접 입력·수정할 때 |
| `jeju_irang_export` | 없음. 자동 생성 결과 확인용 |
| `sync_log` | 없음. 자동 처리 이력 확인용 |
| `tourapi_kor_map` | 없음. TourAPI 연결 및 증분 처리 기준 |
| `tourapi_kor_review` | 없음. 자동 확정하지 않은 후보 확인용 |
| `tourapi_kor_log` | 없음. 국문 관광정보 처리 이력 확인용 |
| `tourapi_photo_log` | 없음. 사진 변경 이력과 최종 CSV 링크 확인용 |

## 5. 앱에 반영하는 마지막 단계

두 경로 모두 최종 CSV가 생성된 뒤에는 다음 작업이 필요합니다.

1. 최신 `jeju-irang-export-날짜-시간.csv`를 내려받습니다.
2. 로컬 프로젝트의 `data/jeju-irang.csv`를 교체합니다.
3. 앱에서 검색·상세 화면을 확인합니다.
4. GitHub에 커밋·푸시하여 Streamlit 앱을 다시 배포합니다.

## 6. 처음 한 번만 설정

1. `vworld_enrichment.gs`, `csv_sync_export.gs`가 들어 있는 기존 별도
   Apps Script 프로젝트를 엽니다. Google Sheet에 연결된 다른 프로젝트가
   아닙니다.
2. 최신 `csv_sync_export.gs` 코드를 붙여 넣습니다.
3. `tourapi_photo_sync.gs`를 최신 코드로 교체합니다.
4. 새 스크립트 파일 `tourapi_kor_sync`를 만들고 프로젝트의
   `tourapi_kor_sync.gs` 전체 코드를 붙여 넣습니다.
5. 프로젝트 설정의 스크립트 속성에 다음 값을 설정합니다.

```text
TOUR_API_SERVICE_KEY = 일반 인증키(Decoding)
```

6. 기존에 쓰던 `JEJU_IRANG_SPREADSHEET_ID`도 같은 프로젝트에 있는지
   확인합니다.
7. 모든 파일을 저장합니다. 별도 프로젝트에서는 Spreadsheet 메뉴가
   보이지 않아도 정상이며 함수 목록에서 직접 실행하면 됩니다.

시트 안에 별도 버튼을 만들고 싶다면 다음 함수명을 할당합니다.

```text
approveAndSyncSelectedRequest
```
