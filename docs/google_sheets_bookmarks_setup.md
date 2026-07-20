# 즐겨찾기 Google Sheet 저장소 설정

이 문서는 `bookmarks.csv`의 기존 데이터를 비공개 Google Sheet로 한 번 옮기고,
이후 Streamlit 앱이 즐겨찾기·메모·나만의 카테고리를 Google Sheet에서 읽고 쓰도록
설정하는 절차를 설명한다.

## 1. 비공개 Spreadsheet 준비

1. Google Drive에서 새 Spreadsheet를 만든다.
2. 파일 이름은 알아보기 쉽게 `제주아이랑 즐겨찾기`로 지정한다.
3. 첫 번째 시트의 이름을 정확히 `bookmarks`로 바꾼다.
4. 공유 설정은 **제한됨**으로 유지한다. 링크가 있는 모든 사용자에게 공개하지 않는다.

이미 `[connections.gsheets]`로 연결한 비공개 Spreadsheet가 있다면 새 파일을 만들지
않아도 된다. 그 Spreadsheet에 이름이 정확히 `bookmarks`인 새 탭만 추가하면 앱과
이전 도구가 기존 서비스 계정 연결을 자동으로 재사용한다.

`bookmarks` 시트는 비어 있어도 된다. 최초 이전 도구가 다음 열을 만든다.

```text
bookmark_id,nickname,place_id,created_at,password_salt,password_hash,memo,custom_category
```

## 2. Google Cloud 서비스 계정 준비

기존 Google Cloud 프로젝트를 사용해도 된다.

1. Google Cloud Console에서 프로젝트를 선택한다.
2. **API 및 서비스 → 라이브러리**에서 다음 두 API를 사용 설정한다.
   - Google Sheets API
   - Google Drive API
3. **IAM 및 관리자 → 서비스 계정**에서 서비스 계정을 만든다.
4. 서비스 계정의 **키 → 키 추가 → 새 키 만들기 → JSON**을 선택한다.
5. 내려받은 JSON 파일은 외부에 공유하거나 GitHub에 올리지 않는다.

## 3. Spreadsheet를 서비스 계정과 공유

1. JSON 파일에서 `client_email` 값을 확인한다.
2. `제주아이랑 즐겨찾기` Spreadsheet의 **공유**를 누른다.
3. `client_email` 주소를 추가한다.
4. 권한은 반드시 **편집자**로 지정한다.

Google Cloud 프로젝트의 IAM 역할과 Spreadsheet의 공유 권한은 별개다. 앱이 행을
추가·수정·삭제하려면 Spreadsheet 공유 화면에서 편집자 권한을 받아야 한다.

## 4. 로컬 Secrets 입력

`.streamlit/secrets.toml.example`의 `[connections.bookmarks]` 예시를
`.streamlit/secrets.toml`에 복사한다.

- `spreadsheet`: 새 Spreadsheet의 전체 URL
- `worksheet`: `bookmarks`
- 나머지 값: 내려받은 서비스 계정 JSON의 같은 이름 값을 그대로 입력

`private_key` 안의 줄바꿈은 `\n`을 유지한다. `secrets.toml`은 `.gitignore`에 포함되어
있으므로 GitHub에 커밋하지 않는다.

이미 완전한 `[connections.gsheets]` 서비스 계정 설정이 있다면 이 단계는 생략할 수
있다. 앱은 `[connections.bookmarks]`를 우선 사용하고, 없으면
`[connections.gsheets]`의 Spreadsheet 안에 있는 `bookmarks` 탭을 사용한다.

## 5. 기존 CSV를 한 번 이전

프로젝트 루트에서 필요한 연결 모듈을 설치한 뒤 이전 도구를 실행한다.

```powershell
python -m pip install -r requirements.txt
streamlit run scripts/migrate_bookmarks_to_gsheet.py
```

브라우저에서 다음 순서로 진행한다.

1. CSV 즐겨찾기 건수를 확인한다.
2. 필요하면 **이전 전 CSV 백업 내려받기**를 누른다.
3. 처음 만든 빈 시트라면 덮어쓰기 확인란을 선택하지 않는다.
4. **연결 확인 및 CSV 이전**을 한 번 누른다.
5. `이전 완료`와 이전된 건수가 표시되는지 확인한다.
6. Google Sheet의 `bookmarks` 탭에서도 같은 행이 보이는지 확인한다.

버튼을 여러 번 누르지 않는다. Google Sheet에 이미 데이터가 있으면 이전 도구가
기본적으로 중단한다.

## 6. Streamlit Community Cloud Secrets 입력

1. `https://share.streamlit.io`에서 제주아이랑 앱을 연다.
2. **Settings → Secrets**를 연다.
3. 로컬 `secrets.toml`의 `[connections.bookmarks]` 블록을 그대로 추가한다.
4. 저장한 뒤 앱이 재실행될 때까지 기다린다.

배포 앱에서 테스트용 닉네임으로 장소 하나를 저장하고, Google Sheet에 새 행이
생기는지 확인한다. 메모와 나만의 카테고리를 수정한 뒤 Sheet 값도 바뀌는지 확인한다.

## 7. CSV를 GitHub에서 제외

Google Sheet 이전과 배포 앱 테스트가 모두 끝난 후에만 실행한다.

```powershell
git rm --cached data/bookmarks.csv
git add .gitignore
git commit -m "Move bookmarks to private Google Sheets storage"
git push
```

`--cached`는 Git 추적만 중단하고 로컬 파일은 남긴다. 이후 `bookmarks.csv`는 로컬
개발용 또는 이전 백업으로만 사용하며 배포 앱의 저장소로 사용하지 않는다.

이미 공개 GitHub 이력에 들어간 비밀번호 해시는 최신 파일에서 삭제해도 과거
커밋에는 남을 수 있다. 저장소가 공개 상태라면 기존 사용자가 다른 서비스에서도 같은
비밀번호를 사용하지 않도록 안내하는 것이 안전하다.

## 앱의 저장소 선택 규칙

- `[connections.bookmarks]`가 정상 설정됨: Google Sheet만 읽고 쓴다.
- Google Sheet 연결 오류: CSV로 우회 저장하지 않고 오류를 표시한다.
- 설정 자체가 없음: 로컬 개발을 위해 `data/bookmarks.csv`를 사용한다.

이 규칙은 연결 장애 때 일부 데이터가 Google Sheet와 CSV로 나뉘는 문제를 막는다.
