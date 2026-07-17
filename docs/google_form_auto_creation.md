# 제주아이랑 Google Form 자동 생성 실행 안내

## 준비된 스크립트

- `scripts/google_apps_script/create_google_form.gs`
- `scripts/google_apps_script/vworld_enrichment.gs`

두 파일을 같은 Google Apps Script 프로젝트에 넣으면 Form 생성부터 VWorld 후보 검색까지 이어서 설정할 수 있다.

## 사용자가 해야 할 일

### 1. 새 Apps Script 프로젝트 만들기

1. <https://script.google.com>에 접속한다.
2. `새 프로젝트`를 누른다.
3. 프로젝트 이름을 `제주아이랑 장소 제안·수정`으로 변경한다.

Google Sheet나 Google Form을 먼저 만들 필요는 없다.

### 2. Form 생성 코드 붙여 넣기

1. 기본 `Code.gs`를 연다.
2. 기존 내용을 모두 지운다.
3. 로컬의 `scripts/google_apps_script/create_google_form.gs` 전체 내용을 붙여 넣는다.
4. 저장한다.

### 3. VWorld 보강 코드도 같은 프로젝트에 추가하기

1. Apps Script 편집기 왼쪽 `파일` 옆의 `+`를 누른다.
2. `스크립트`를 선택한다.
3. 파일 이름을 `vworld_enrichment`로 입력한다.
4. 로컬의 `scripts/google_apps_script/vworld_enrichment.gs` 전체 내용을 붙여 넣는다.
5. 저장한다.

이 단계는 나중에 해도 되지만, 지금 같이 넣어 두면 생성된 응답 Sheet ID가 자동으로 연결된다.

### 4. Form 자동 생성 실행하기

1. 상단 함수 목록에서 `createJejuIrangForm`을 선택한다.
2. `실행`을 누른다.
3. Google 권한 요청을 승인한다.
4. 실행이 끝날 때까지 기다린다.

처음 실행하면 다음 항목이 자동 생성된다.

- `제주아이랑 장소 제안·수정` Google Form
- `제주아이랑 장소 제안·수정 응답` Google Spreadsheet
- `form_responses` 시트
- `review_queue` 시트
- `sync_log` 시트
- 신규 장소 제안용 사전 입력 URL

정상 생성 후 같은 함수를 다시 실행하면 새 Form을 만들지 않고 기존 링크만 다시 표시한다.

### 5. 생성된 링크 확인하기

Apps Script 하단의 `실행 로그`에서 다음 링크를 확인한다.

- Form 편집 URL
- Form 응답 URL
- 응답 Spreadsheet URL
- 신규 장소 제안 사전 입력 URL

로그를 닫은 경우 `showJejuIrangFormLinks`를 실행하면 다시 볼 수 있다.

### 6. Form 화면 확인하기

Form 편집 URL을 열어 다음을 확인한다.

- 제목이 `제주아이랑 장소 제안·수정`인가
- 첫 질문이 `요청 유형`인가
- `새로운 장소 제안`을 선택하면 신규 안내 뒤 장소 기본 정보로 이동하는가
- `기존 장소 수정`을 선택하면 수정 대상 질문이 나오는가
- 질문 25개와 섹션 5개가 있는가
- 응답 수집이 켜져 있는가

### 7. VWorld OpenAPI 인증키 입력하기

Apps Script의 `프로젝트 설정 → 스크립트 속성`에서 다음 값을 추가한다.

| 속성 | 값 |
|---|---|
| `VWORLD_API_KEY` | VWorld에서 발급한 검색 API 2.0 인증키 |

Form 생성 함수가 다음 속성은 자동으로 저장하므로 직접 입력하지 않는다.

- `JEJU_IRANG_FORM_ID`
- `JEJU_IRANG_SPREADSHEET_ID`
- `JEJU_IRANG_FORM_ITEM_IDS_JSON`

### 8. VWorld 연결 확인 및 트리거 등록

다음 함수를 순서대로 실행한다.

1. `migrateReviewQueueToVworld`
2. `checkSetup`
3. `testVworldSearch`
4. `installFormSubmitTrigger`

`installFormSubmitTrigger`는 생성된 응답 Spreadsheet를 대상으로 설치형 Form Submit 트리거를 등록한다.

### 9. 최종 제출 테스트

1. Form 응답 URL을 연다.
2. 테스트 장소 한 건을 제출한다.
3. 응답 Spreadsheet를 연다.
4. `form_responses`에 원본 응답이 생겼는지 확인한다.
5. `review_queue`에 `request_id`와 VWorld 후보가 생겼는지 확인한다.

## 수정용 사전 입력 URL 시험

`showTestUpdatePrefilledUrl`을 실행하면 `아쿠아플라넷 제주`를 예시로 수정용 사전 입력 URL을 만든다.

실제 장소별 링크를 만들 때는 코드에서 `buildJejuIrangUpdatePrefilledUrl(place)`에 해당 장소 정보를 전달한다.

## Streamlit 앱 연결 설정

최신 `create_google_form.gs`를 저장한 뒤 `showStreamlitFormSecrets`를 실행한다. 실행 로그에 `[google_form]`으로 시작하는 설정이 출력된다.

- 로컬 실행: 출력된 내용을 `.streamlit/secrets.toml`에 저장
- Streamlit Community Cloud: 앱의 `Settings → Secrets`에 같은 내용 저장

장소 찾기의 `＋ 장소 제안하기`는 신규 제안 사전입력 URL을 사용한다. 상세 페이지의 `✎ 장소 정보 수정 제안`은 요청 유형, 기존 장소명, 도로명주소를 자동 입력한다.

Form을 새로 만들거나 질문을 다시 생성했다면 `entry` 번호가 바뀔 수 있으므로 `showStreamlitFormSecrets`를 다시 실행해 설정을 갱신한다.

## 기존 Form에서 장소 ID 질문 제거하기

이미 이전 버전으로 Form을 생성했다면 최신 `create_google_form.gs`로 코드를 교체한 뒤 `applyPlaceNameOnlyUpdateForm`을 한 번 실행한다.

- `수정 대상 장소 ID` 질문이 제거된다.
- 사용자는 `기존 장소명`만 입력한다.
- 수정 대상 내부 ID는 관리자 검수·CSV 반영 단계에서 장소명으로 찾아 기록한다.
- 여러 번 실행해도 안전하다.

## 생성 중 오류가 발생한 경우

Apps Script 왼쪽의 `실행` 메뉴에서 실패한 실행을 열어 오류 위치를 확인한다.

Script Properties의 `JEJU_IRANG_FORM_BUILD_STATUS` 값도 확인한다.

- `READY`: 정상 완료
- `BUILDING`: 생성 도중 중단됨
- `ERROR`: 생성 오류

오류 상태에서 무작정 여러 번 실행하면 불완전한 Form이나 Spreadsheet가 Drive에 남을 수 있다. 실행 오류 내용을 먼저 확인한 뒤 다시 진행한다.

### `Form 응답 시트가 제한 시간 안에 생성되지 않았습니다` 오류

이전 버전은 Form과 Spreadsheet를 연결한 뒤 응답 시트가 만들어지는 시간을 15초만 기다렸다. 최신 스크립트는 최대 90초 동안 기다리며, 시트 이름뿐 아니라 Form 연결 정보로 응답 시트를 찾는다.

1. Apps Script의 `Code.gs` 전체를 최신 `create_google_form.gs` 내용으로 교체한다.
2. 저장한다.
3. `createJejuIrangForm`을 다시 실행한다.

실패할 때 저장된 Form ID와 Spreadsheet ID를 재사용하므로, 앞서 만들어진 Form을 삭제하거나 Script Properties를 지울 필요가 없다.

## 참고

- Google Forms Apps Script: <https://developers.google.com/apps-script/reference/forms>
- Form 섹션 이동: <https://developers.google.com/apps-script/reference/forms/multiple-choice-item>
- 응답 사전 입력 URL: <https://developers.google.com/apps-script/reference/forms/form-response>
