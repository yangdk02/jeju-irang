from pathlib import Path

import pandas as pd
import streamlit as st
from streamlit_gsheets import GSheetsConnection


PROJECT_DIR = Path(__file__).resolve().parents[1]
BOOKMARKS_CSV_PATH = PROJECT_DIR / "data" / "bookmarks.csv"
BOOKMARK_COLUMNS = [
    "bookmark_id",
    "nickname",
    "place_id",
    "created_at",
    "password_salt",
    "password_hash",
    "memo",
    "custom_category",
]
DEFAULT_WORKSHEET = "bookmarks"


def normalize(frame: pd.DataFrame) -> pd.DataFrame:
    result = frame.copy()
    result.columns = [str(column).strip() for column in result.columns]
    result = result.dropna(how="all")
    for column in BOOKMARK_COLUMNS:
        if column not in result.columns:
            result[column] = pd.NA
    return result[BOOKMARK_COLUMNS].astype("string")


def load_local_csv() -> pd.DataFrame:
    if not BOOKMARKS_CSV_PATH.exists() or BOOKMARKS_CSV_PATH.stat().st_size == 0:
        return pd.DataFrame(columns=BOOKMARK_COLUMNS)
    return normalize(pd.read_csv(BOOKMARKS_CSV_PATH, dtype="string"))


st.set_page_config(page_title="제주아이랑 즐겨찾기 이전", page_icon="🍊")
st.title("즐겨찾기 Google Sheet 이전")
st.write(
    "기존 bookmarks.csv를 비공개 Google Sheet로 한 번만 옮기는 관리자 도구입니다."
)

local = load_local_csv()
st.metric("CSV 즐겨찾기", f"{len(local)}건")
st.dataframe(
    local[["bookmark_id", "nickname", "place_id", "created_at", "custom_category", "memo"]],
    hide_index=True,
    use_container_width=True,
)
st.download_button(
    "이전 전 CSV 백업 내려받기",
    data=local.to_csv(index=False).encode("utf-8-sig"),
    file_name="bookmarks_before_google_sheet.csv",
    mime="text/csv",
)

try:
    connections = st.secrets.get("connections", {})
except (FileNotFoundError, KeyError, AttributeError):
    connections = {}

connection_name = ""
worksheet = DEFAULT_WORKSHEET
for candidate in ("bookmarks", "gsheets"):
    settings = connections.get(candidate, {})
    configured_candidate = bool(
        str(settings.get("spreadsheet", "")).strip()
        and str(settings.get("type", "")).strip() == "service_account"
    )
    if configured_candidate:
        connection_name = candidate
        if candidate == "bookmarks":
            worksheet = (
                str(settings.get("worksheet", DEFAULT_WORKSHEET)).strip()
                or DEFAULT_WORKSHEET
            )
        break

configured = bool(connection_name)

if not configured:
    st.error(
        "사용 가능한 [connections.bookmarks] 또는 [connections.gsheets] "
        "서비스 계정 설정이 없습니다. "
        "docs/maintenance_setup.md의 즐겨찾기 설정을 확인해 주세요."
    )
    st.stop()

st.info(
    f"Secrets의 [connections.{connection_name}] 연결을 사용합니다. "
    f"대상 시트: {worksheet}"
)
conn = st.connection(connection_name, type=GSheetsConnection)
overwrite = st.checkbox(
    "Google Sheet에 기존 행이 있으면 CSV 내용으로 덮어쓰기",
    help="처음 만든 빈 bookmarks 시트라면 선택하지 않아도 됩니다.",
)

if st.button("연결 확인 및 CSV 이전", type="primary", use_container_width=True):
    try:
        current = normalize(conn.read(worksheet=worksheet, ttl=0))
        if not current.empty and not overwrite:
            st.error(
                f"Google Sheet에 이미 {len(current)}건이 있습니다. "
                "덮어쓸지 확인한 뒤 다시 실행해 주세요."
            )
            st.stop()

        conn.update(worksheet=worksheet, data=local.fillna(""))
        verified = normalize(conn.read(worksheet=worksheet, ttl=0))
        expected_ids = set(local["bookmark_id"].fillna("").astype(str))
        actual_ids = set(verified["bookmark_id"].fillna("").astype(str))
        if len(verified) != len(local) or actual_ids != expected_ids:
            st.error(
                "이전 후 건수 또는 bookmark_id가 일치하지 않습니다. "
                "로컬 CSV는 변경하지 않았으니 Sheet 내용을 확인해 주세요."
            )
        else:
            st.success(
                f"이전 완료: {len(verified)}건을 '{worksheet}' 시트에서 확인했습니다."
            )
            st.info(
                "이제 앱의 동일한 Secrets를 Streamlit Community Cloud에 등록한 뒤 "
                "data/bookmarks.csv를 Git 추적에서 제외하세요."
            )
    except Exception:
        st.error(
            "Google Sheet 연결 또는 이전에 실패했습니다. "
            "서비스 계정이 이 스프레드시트의 편집자인지 확인해 주세요."
        )
