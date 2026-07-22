# 제주아이랑 유지보수 설정 안내

이 문서는 Google Form, VWorld, CSV 동기화, TourAPI, 즐겨찾기 저장소를 새로 설정하거나 장애 후 복구할 때만 사용합니다.

일상적인 장소 검수와 데이터 갱신은 [`reviewer_manual.md`](reviewer_manual.md)를 따릅니다.

## 1. 사용 중인 구성

| 구성 | 용도 | 관련 파일 |
|---|---|---|
| Streamlit | 웹 앱 실행 | `app.py` |
| Google Form | 신규 장소 및 정보 수정 제안 접수 | `create_google_form.gs` |
| VWorld API | 제안 장소의 주소·좌표 후보 검색 | `vworld_enrichment.gs` |
| Google Sheets | 검수, 기준 데이터, 즐겨찾기 저장 | `csv_sync_export.gs` |
| TourAPI | 관광정보와 대표 사진 보강 | `tourapi_kor_sync.gs`, `tourapi_photo_sync.gs` |

API 키와 서비스 계정 정보는 코드나 GitHub에 저장하지 않습니다. Google Apps Script의 스크립트 속성 또는 Streamlit Secrets에만 저장합니다.

## 2. 장소 제안 Google Form 설정

1. <https://script.google.com>에서 `제주아이랑 장소 제안·수정` 프로젝트를 만듭니다.
2. `scripts/google_apps_script/create_google_form.gs`와 `vworld_enrichment.gs`를 같은 프로젝트에 추가합니다.
3. `createJejuIrangForm`을 실행하고 Google 권한을 승인합니다.
4. Form, 응답 Spreadsheet, `form_responses`, `review_queue`, `sync_log`가 생성되었는지 확인합니다.
5. 링크를 다시 확인하려면 `showJejuIrangFormLinks`를 실행합니다.

기존 Form을 최신 구조로 바꿀 때는 최신 코드를 저장한 뒤 필요한 함수만 한 번 실행합니다.

- 장소 ID 질문 제거: `applyPlaceNameOnlyUpdateForm`
- 모르는 장소 정보를 선택 항목으로 변경: `applyOptionalPlaceInformationSettings`
- VWorld 형식으로 변경: `applyVworldFormSettings`, `migrateReviewQueueToVworld`

Form을 새로 만들거나 질문을 다시 생성했다면 `showStreamlitFormSecrets`를 실행합니다. 출력된 `[google_form]` 설정을 로컬 `.streamlit/secrets.toml`과 Streamlit Community Cloud의 **Settings → Secrets**에 반영합니다.

## 3. VWorld 연결과 제출 트리거

Apps Script의 **프로젝트 설정 → 스크립트 속성**에 다음 값을 저장합니다.

```text
VWORLD_API_KEY = VWorld 검색 API 2.0 인증키
```

다음 함수를 순서대로 실행합니다.

1. `checkSetup`
2. `testVworldSearch`
3. `installFormSubmitTrigger`

Form에서 테스트 응답을 한 건 제출한 뒤 다음을 확인합니다.

- `form_responses`에 원본 응답이 보임
- `review_queue`에 `request_id`와 `source_provider=VWORLD`가 기록됨
- 주소, 위도, 경도와 후보 수가 기록됨
- 후보가 한 건이어도 관리자가 확인하기 전에는 자동 승인되지 않음

HTTP 429, 500, 502, 503, 504 오류는 자동 재시도합니다. 이미 `VWORLD_API_ERROR`가 기록된 행은 Form을 다시 제출하지 않고 `retryFailedVworldSearches`를 실행합니다.

## 4. 기준 데이터와 CSV 내보내기 설정

1. 같은 Apps Script 프로젝트에 `scripts/google_apps_script/csv_sync_export.gs`를 추가합니다.
2. `setupCsvSyncSheets`와 `setupAdminReviewControls`를 각각 한 번 실행합니다.
3. 최초 설정일 때만 `data/jeju-irang.csv`를 Google Drive에 CSV 형식 그대로 올립니다.
4. 스크립트 속성에 다음 값을 저장합니다.

```text
JEJU_IRANG_CSV_FILE_ID = 업로드한 CSV 파일 ID
JEJU_IRANG_EXPORT_FOLDER_ID = 내보낼 Drive 폴더 ID(선택)
```

5. 빈 `jeju_irang_master`에 한해 `importJejuIrangCsvFromDrive`를 한 번 실행합니다.
6. `place_id` 중복과 전체 장소 수를 확인합니다.

일반 검수에서는 Spreadsheet 메뉴의 **🍊 제주아이랑 검수 → 선택 행 승인·반영**만 사용합니다. 이 작업은 승인 전 백업, 기준 데이터 반영, 최종 CSV 생성과 로그 기록을 함께 수행합니다.

관리자가 `jeju_irang_master`를 직접 수정했거나 현재 기준 데이터만 다시 내려받을 때는 `exportJejuIrangCsv`를 실행합니다. 생성된 CSV는 로컬 `data/jeju-irang.csv`를 교체한 뒤 앱에서 확인하고 배포합니다.

## 5. TourAPI 관광정보와 사진 설정

`vworld_enrichment.gs`와 `csv_sync_export.gs`가 연결된 Apps Script 프로젝트에 다음 최신 파일을 추가합니다.

- `scripts/google_apps_script/tourapi_kor_sync.gs`
- `scripts/google_apps_script/tourapi_photo_sync.gs`

스크립트 속성을 확인합니다.

```text
TOUR_API_SERVICE_KEY = 공공데이터포털 일반 인증키(Decoding)
JEJU_IRANG_SPREADSHEET_ID = 기준 Spreadsheet ID
```

평소 관광정보와 사진을 함께 갱신할 때는 `startAllTourDataUpdateAndExport`를 한 번 실행하고 완료될 때까지 기다립니다. Apps Script 실행시간 제한을 피하기 위해 작업이 자동으로 나뉘어 이어집니다. 진행 상황과 오류 대응은 `reviewer_manual.md`를 따릅니다.

## 6. 즐겨찾기 Google Sheet 설정

1. 비공개 Spreadsheet에 이름이 정확히 `bookmarks`인 시트를 만듭니다.
2. Google Cloud에서 Google Sheets API와 Google Drive API를 사용 설정합니다.
3. 서비스 계정을 만들고 JSON 키를 발급합니다. 키 파일은 GitHub에 올리지 않습니다.
4. Spreadsheet를 서비스 계정의 `client_email`에 **편집자** 권한으로 공유합니다.
5. `.streamlit/secrets.toml.example`의 `[connections.bookmarks]`를 로컬 Secrets와 Streamlit Community Cloud Secrets에 복사하고 실제 값으로 바꿉니다.

즐겨찾기 컬럼은 다음과 같습니다.

```text
bookmark_id,nickname,place_id,created_at,password_salt,password_hash,memo,custom_category
```

기존 `data/bookmarks.csv`를 한 번 이전해야 한다면 프로젝트 루트에서 다음 도구를 실행합니다.

```powershell
streamlit run scripts/migrate_bookmarks_to_gsheet.py
```

이전 전 CSV 백업을 내려받고, Google Sheet가 비어 있는지 확인한 뒤 한 번만 실행합니다. 이전 건수와 Sheet 행 수가 같은지 확인합니다.

저장소 선택 규칙은 다음과 같습니다.

- `[connections.bookmarks]`가 설정됨: Google Sheet 사용
- 전용 연결이 없고 `[connections.gsheets]`가 설정됨: 같은 Spreadsheet의 `bookmarks` 탭 사용
- Google Sheet 연결 오류: 데이터가 두 저장소로 나뉘지 않도록 CSV로 우회하지 않고 오류 표시
- 연결 설정 자체가 없음: 로컬 개발용 `data/bookmarks.csv` 사용

## 7. 설정 완료 확인

- 앱에서 신규 장소 제안과 장소 정보 수정 링크가 열림
- Form 제출 후 `review_queue`에 VWorld 후보가 생성됨
- 승인 시 백업과 최종 CSV가 생성되고 `sync_log`에 결과가 남음
- 관광정보 갱신 완료 후 설명·사진과 최종 CSV 링크를 확인할 수 있음
- 배포 앱에서 즐겨찾기 추가·메모·카테고리 수정 결과가 Google Sheet에 반영됨
- 앱의 장소 검색, 상세정보, 지도와 즐겨찾기가 정상 동작함
