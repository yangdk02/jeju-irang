from __future__ import annotations

import hashlib
import hmac
import os
import secrets
import shutil
import tempfile
import time
from datetime import datetime
from pathlib import Path

import numpy as np
import pandas as pd
import pydeck as pdk
import streamlit as st
from streamlit_geolocation import streamlit_geolocation


APP_DIR = Path(__file__).resolve().parent
DATA_DIR = APP_DIR / "data"
PLACES_PATH = DATA_DIR / "jeju-irang.csv"
BOOKMARKS_PATH = DATA_DIR / "bookmarks.csv"
BOOKMARK_BACKUP_DIR = DATA_DIR / "backups"
BOOKMARK_COLUMNS = [
    "bookmark_id",
    "nickname",
    "place_id",
    "created_at",
    "password_salt",
    "password_hash",
    "memo",
]
PASSWORD_ITERATIONS = 200_000

REGIONS = ["전체", "구좌/조천", "서귀포시", "성산/표선", "안덕/대정", "애월/한림", "제주시"]
FEATURE_FILTERS = {
    "입장료 있음": "has_admission_fee",
    "연령제한 있음": "has_age_limit",
    "수유실 있음": "nursing_room",
    "유모차 대여 가능": "stroller_rental",
    "기저귀 교환대 있음": "diaper_changing_table",
    "도민 할인 있음": "resident_discount",
}
BOOL_COLUMNS = list(FEATURE_FILTERS.values())


st.set_page_config(
    page_title="제주아이랑",
    page_icon="🍊",
    layout="wide",
    initial_sidebar_state="expanded",
)

st.markdown(
    """
    <style>
    :root {
        --jeju-orange: #ff8a00;
        --jeju-orange-deep: #ef6c00;
        --jeju-mint: #65c7a5;
        --jeju-sky: #65bde8;
        --jeju-surface: color-mix(in srgb, var(--background-color) 97%, #fff8ec 3%);
        --jeju-soft-surface: color-mix(in srgb, var(--secondary-background-color) 82%, #fff8ec 18%);
        --jeju-accent-soft: color-mix(in srgb, var(--jeju-orange) 12%, var(--background-color) 88%);
        --jeju-mint-soft: color-mix(in srgb, var(--jeju-mint) 13%, var(--background-color) 87%);
        --jeju-sky-soft: color-mix(in srgb, var(--jeju-sky) 13%, var(--background-color) 87%);
        --jeju-border: color-mix(in srgb, var(--jeju-orange) 18%, var(--text-color) 10%);
        --jeju-muted: color-mix(in srgb, var(--text-color) 66%, transparent);
    }
    [data-testid="stApp"] {
        background:
            radial-gradient(circle at 8% 4%, color-mix(in srgb, #ffd89b 16%, transparent), transparent 28%),
            radial-gradient(circle at 92% 18%, color-mix(in srgb, #bcebdc 12%, transparent), transparent 25%),
            var(--background-color);
    }
    header[data-testid="stHeader"] {background: transparent;}
    [data-testid="stAppViewBlockContainer"],
    .block-container {
        max-width: 1320px;
        padding-top: 5rem;
        padding-bottom: 4rem;
    }
    [data-testid="stSidebar"] {
        background: color-mix(in srgb, var(--secondary-background-color) 92%, #fff8ec 8%);
        color: var(--text-color);
        border-right: 1px solid var(--jeju-border);
    }
    [data-testid="stSidebarContent"] {padding-top: 1.2rem;}
    [data-testid="stVerticalBlockBorderWrapper"] {
        border-color: var(--jeju-border) !important;
        border-radius: 22px !important;
        background: color-mix(in srgb, var(--jeju-surface) 94%, transparent);
        box-shadow: 0 8px 26px color-mix(in srgb, #8d6335 9%, transparent);
    }
    .brand {
        display: flex; align-items: center; gap: .75rem; min-height: 2.7rem;
    }
    .brand-mark {
        display: grid; place-items: center; width: 2.7rem; height: 2.7rem;
        border-radius: 50%; background: var(--jeju-orange); font-size: 1.45rem;
        box-shadow: 0 5px 14px color-mix(in srgb, var(--jeju-orange) 30%, transparent);
    }
    .brand h1 {margin: 0; color: var(--text-color); font-size: 1.75rem; letter-spacing: -.05em;}
    .nav-divider {text-align: center; color: var(--jeju-border); font-size: 1.25rem; line-height: 2.5rem;}
    .home-hero {
        position: relative; overflow: hidden; padding: 3.2rem 3.4rem; border-radius: 30px;
        background: linear-gradient(
            135deg,
            color-mix(in srgb, #fff3d9 48%, var(--background-color)) 0%,
            color-mix(in srgb, #fffaf1 75%, var(--background-color)) 54%,
            color-mix(in srgb, #dff3ea 42%, var(--background-color)) 100%
        );
        border: 1px solid var(--jeju-border);
        margin: .9rem 0 1.35rem;
        box-shadow: 0 16px 42px color-mix(in srgb, #9c7042 11%, transparent);
    }
    .home-hero::after {
        content: "☁️     ⛰️  🌊     🌺"; position: absolute; right: 4%; bottom: 12%;
        font-size: clamp(2rem, 5vw, 5rem); opacity: .72; white-space: nowrap;
        filter: saturate(.82);
    }
    .home-hero .eyebrow, .page-kicker {
        color: var(--jeju-orange-deep); font-weight: 750; letter-spacing: .02em;
    }
    .home-hero h2 {margin: .55rem 0 .75rem; max-width: 650px; font-size: clamp(2.25rem, 5vw, 4.1rem); letter-spacing: -.055em; line-height: 1.12; color: var(--text-color);}
    .home-hero p {margin: 0; max-width: 560px; color: var(--jeju-muted); font-size: 1.12rem; line-height: 1.75;}
    .page-title {font-size: clamp(2rem, 4vw, 3rem); font-weight: 800; letter-spacing: -.045em; margin: .25rem 0 .3rem; color: var(--text-color);}
    .result-heading {display: flex; align-items: center; gap: .7rem; margin: 1.35rem 0 .7rem; font-size: 1.55rem; font-weight: 760;}
    .result-heading b {font-size: .85rem; color: var(--jeju-orange-deep); background: var(--jeju-accent-soft); border-radius: 999px; padding: .35rem .65rem;}
    .region-title {font-size: 1.55rem; font-weight: 780; letter-spacing: -.035em; margin-bottom: .15rem;}
    .section-title {font-size: 1.45rem; font-weight: 760; color: var(--text-color); margin: .8rem 0 .3rem;}
    [data-testid="stImage"] img {
        aspect-ratio: 16 / 9; object-fit: cover; border-radius: 20px;
        border: 1px solid var(--jeju-border);
        box-shadow: 0 8px 20px color-mix(in srgb, #7d5e40 10%, transparent);
    }
    .photo-placeholder {
        display: grid; place-items: center; aspect-ratio: 16 / 9; border-radius: 20px 20px 0 0;
        background: linear-gradient(135deg, var(--jeju-sky-soft), var(--jeju-mint-soft));
        border: 1px solid var(--jeju-border); font-size: 3rem;
    }
    .place-card {
        min-height: 165px; padding: 1.1rem 1.15rem; border: 1px solid var(--jeju-border);
        border-radius: 20px; background: var(--jeju-surface);
        box-shadow: 0 8px 24px color-mix(in srgb, #7d5e40 10%, transparent);
    }
    .place-card h3 {margin: .35rem 0 .45rem; font-size: 1.22rem; color: var(--text-color); letter-spacing: -.025em;}
    .place-card p {margin: .25rem 0; color: var(--jeju-muted); font-size: .91rem;}
    .facility-line {margin-top: .7rem !important; color: color-mix(in srgb, var(--jeju-mint) 76%, var(--text-color)) !important; font-weight: 650;}
    .tag {
        display: inline-block; background: var(--jeju-accent-soft); color: var(--text-color);
        border: 1px solid color-mix(in srgb, var(--jeju-orange) 22%, var(--jeju-border)); border-radius: 999px;
        padding: .22rem .58rem; margin: .1rem .18rem .1rem 0; font-size: .8rem;
    }
    .info-box {
        padding: 1rem 1.1rem; border-radius: 16px; background: var(--jeju-soft-surface);
        border: 1px solid var(--jeju-border); margin-bottom: .6rem;
    }
    .info-label {color: var(--jeju-muted); font-size: .84rem; margin-bottom: .22rem;}
    .info-value {color: var(--text-color); white-space: pre-wrap; overflow-wrap: anywhere;}
    .muted {color: var(--jeju-muted);}
    .spacer {height: 1.3rem;}
    [data-testid="stMetric"] {background: var(--jeju-mint-soft); border: 1px solid color-mix(in srgb, var(--jeju-mint) 35%, var(--jeju-border)); border-radius: 16px; padding: .8rem;}
    div.stButton > button, div.stDownloadButton > button, a[data-testid="stLinkButton"] {
        border-radius: 14px; border-color: var(--jeju-border); font-weight: 680;
        transition: transform .15s ease, border-color .15s ease, box-shadow .15s ease;
    }
    div.stButton > button:hover, div.stDownloadButton > button:hover, a[data-testid="stLinkButton"]:hover {
        border-color: var(--jeju-orange); color: var(--jeju-orange-deep);
        transform: translateY(-1px); box-shadow: 0 7px 16px color-mix(in srgb, var(--jeju-orange) 16%, transparent);
    }
    button[kind="primary"] {background: linear-gradient(90deg, var(--jeju-orange), #ffad28) !important; border: none !important; color: white !important;}
    button[kind="tertiary"] {
        border: none !important; background: transparent !important; box-shadow: none !important;
        padding-left: .25rem !important; padding-right: .25rem !important;
    }
    button[kind="tertiary"]:hover {
        border: none !important; color: var(--jeju-orange-deep) !important;
        transform: none !important; box-shadow: none !important;
    }
    div[role="radiogroup"] {background: var(--jeju-soft-surface); border: 1px solid var(--jeju-border); border-radius: 16px; padding: .35rem .7rem;}
    @media (max-width: 768px) {
        [data-testid="stAppViewBlockContainer"],
        .block-container {padding-top: 4.5rem;}
        .home-hero {padding: 2rem 1.35rem 7rem;}
        .home-hero::after {right: 5%; bottom: 5%; font-size: 2.5rem;}
        .brand p {display: none;}
    }
    </style>
    """,
    unsafe_allow_html=True,
)


def clean_text(value: object, fallback: str = "정보 없음") -> str:
    if pd.isna(value):
        return fallback
    text = str(value).strip()
    return text if text else fallback


def parse_bool(value: object) -> object:
    """Return True/False for known values and pd.NA for missing/unknown values."""
    if pd.isna(value):
        return pd.NA
    normalized = str(value).strip().lower()
    if normalized in {"true", "1", "yes", "y", "예"}:
        return True
    if normalized in {"false", "0", "no", "n", "아니오"}:
        return False
    return pd.NA


@st.cache_data(show_spinner=False)
def load_places(path: Path, modified_at: float) -> pd.DataFrame:
    del modified_at  # cache invalidation key
    frame = pd.read_csv(path, dtype={"place_id": "string"})
    frame.columns = frame.columns.str.strip()
    for column in BOOL_COLUMNS:
        if column not in frame.columns:
            frame[column] = pd.Series(pd.NA, index=frame.index, dtype="boolean")
        else:
            frame[column] = frame[column].map(parse_bool).astype("boolean")
    for column in ("latitude", "longitude"):
        if column not in frame.columns:
            frame[column] = pd.NA
        frame[column] = pd.to_numeric(frame[column], errors="coerce")
    frame["_data_order"] = range(len(frame))
    return frame


def get_places() -> pd.DataFrame:
    if not PLACES_PATH.exists():
        st.error(f"장소 데이터 파일을 찾을 수 없습니다: {PLACES_PATH}")
        st.stop()
    return load_places(PLACES_PATH, PLACES_PATH.stat().st_mtime)


def empty_bookmarks() -> pd.DataFrame:
    return pd.DataFrame(columns=BOOKMARK_COLUMNS)


def load_bookmarks() -> pd.DataFrame:
    if not BOOKMARKS_PATH.exists() or BOOKMARKS_PATH.stat().st_size == 0:
        return empty_bookmarks()
    try:
        frame = pd.read_csv(BOOKMARKS_PATH, dtype="string")
    except (pd.errors.EmptyDataError, UnicodeDecodeError):
        return empty_bookmarks()
    for column in empty_bookmarks().columns:
        if column not in frame.columns:
            frame[column] = pd.NA
    return frame[list(empty_bookmarks().columns)]


def write_bookmarks(frame: pd.DataFrame) -> bool:
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    if BOOKMARKS_PATH.exists() and BOOKMARKS_PATH.stat().st_size > 0:
        BOOKMARK_BACKUP_DIR.mkdir(parents=True, exist_ok=True)
        timestamp = datetime.now().strftime("%Y%m%d_%H%M%S_%f")
        try:
            shutil.copy2(BOOKMARKS_PATH, BOOKMARK_BACKUP_DIR / f"bookmarks_{timestamp}.csv")
        except OSError:
            st.warning("백업 파일을 만들지 못했지만 저장을 계속 시도합니다.")
    handle, temp_name = tempfile.mkstemp(prefix="bookmarks_", suffix=".csv", dir=DATA_DIR)
    os.close(handle)
    try:
        frame.to_csv(temp_name, index=False, encoding="utf-8-sig")
        # Windows에서는 Streamlit의 파일 감시나 백신 검사 때문에 기존 CSV의
        # 이름 교체가 아주 잠깐 거부될 수 있으므로 먼저 자동 재시도합니다.
        for attempt in range(5):
            try:
                os.replace(temp_name, BOOKMARKS_PATH)
                return True
            except PermissionError:
                if attempt < 4:
                    time.sleep(0.2)

        # 파일 삭제/이름 교체만 막힌 경우에는 기존 파일에 직접 덮어쓸 수 있습니다.
        try:
            shutil.copyfile(temp_name, BOOKMARKS_PATH)
            return True
        except PermissionError:
            st.error(
                "bookmarks.csv가 다른 프로그램에서 사용 중이라 저장하지 못했습니다. "
                "엑셀이나 메모장에서 파일을 닫은 뒤 다시 저장해 주세요."
            )
            return False
    finally:
        if os.path.exists(temp_name):
            try:
                os.remove(temp_name)
            except OSError:
                pass


def password_digest(password: str, salt: str) -> str:
    return hashlib.pbkdf2_hmac(
        "sha256",
        password.encode("utf-8"),
        bytes.fromhex(salt),
        PASSWORD_ITERATIONS,
    ).hex()


def create_password_credentials(password: str) -> tuple[str, str]:
    salt = secrets.token_hex(16)
    return salt, password_digest(password, salt)


def verify_password(password: str, salt: object, expected_hash: object) -> bool:
    if pd.isna(salt) or pd.isna(expected_hash):
        return False
    salt_text = str(salt).strip()
    hash_text = str(expected_hash).strip()
    if not salt_text or not hash_text:
        return False
    try:
        actual_hash = password_digest(password, salt_text)
    except ValueError:
        return False
    return hmac.compare_digest(actual_hash, hash_text)


def nickname_mask(bookmarks: pd.DataFrame, nickname: str) -> pd.Series:
    return bookmarks["nickname"].fillna("").str.strip().eq(nickname)


def authenticate_nickname(bookmarks: pd.DataFrame, nickname: str, password: str) -> tuple[bool, str]:
    mine = bookmarks[nickname_mask(bookmarks, nickname)]
    if mine.empty:
        return False, "닉네임 또는 비밀번호가 맞지 않습니다."
    protected = mine[
        mine["password_salt"].fillna("").str.strip().ne("")
        & mine["password_hash"].fillna("").str.strip().ne("")
    ]
    if protected.empty:
        return False, "기존 형식의 닉네임입니다. 장소 상세 화면에서 비밀번호를 처음 연결해 주세요."
    credential = protected.iloc[0]
    if not verify_password(password, credential["password_salt"], credential["password_hash"]):
        return False, "닉네임 또는 비밀번호가 맞지 않습니다."
    return True, ""


def initialize_state() -> None:
    defaults = {
        "page": "home",
        "selected_place_id": None,
        "selected_region": "전체",
        "search_query": "",
        "category_filter": [],
        "space_filter": [],
        "parking_filter": [],
        "feature_filter": [],
        "sort_order": "기본순",
        "view_mode": "갤러리 보기",
        "user_latitude": None,
        "user_longitude": None,
        "user_location_accuracy": None,
        "ignore_location_result": False,
        "nickname": "",
        "bookmark_lookup": "",
        "bookmark_authenticated_nickname": None,
    }
    for key, value in defaults.items():
        if key not in st.session_state:
            st.session_state[key] = value
    # Streamlit normally removes widget keys when their page is not rendered.
    # Reassigning them keeps the list controls stable while the detail page is open.
    for key in (
        "selected_region",
        "search_query",
        "category_filter",
        "space_filter",
        "parking_filter",
        "feature_filter",
        "sort_order",
        "view_mode",
    ):
        widget_key = f"_{key}_widget"
        if widget_key in st.session_state:
            st.session_state[widget_key] = st.session_state[widget_key]


def go_to(page: str, place_id: str | None = None) -> None:
    st.session_state.page = page
    st.session_state.selected_place_id = place_id


def select_region(region: str) -> None:
    st.session_state.selected_region = region
    st.session_state.page = "list"


def reset_filters() -> None:
    reset_values = {
        "selected_region": "전체",
        "search_query": "",
        "category_filter": [],
        "space_filter": [],
        "parking_filter": [],
        "feature_filter": [],
        "sort_order": "기본순",
    }
    for key, value in reset_values.items():
        st.session_state[key] = value
        widget_key = f"_{key}_widget"
        if widget_key in st.session_state:
            st.session_state[widget_key] = value


def prepare_filter_widget(state_key: str) -> str:
    widget_key = f"_{state_key}_widget"
    if widget_key not in st.session_state:
        st.session_state[widget_key] = st.session_state[state_key]
    return widget_key


def hero() -> None:
    with st.container(border=True):
        brand, find_nav, divider, bookmark_nav = st.columns(
            [5, 1.05, .12, 1.05], vertical_alignment="center"
        )
        with brand:
            st.markdown(
                """
                <div class="brand">
                    <div class="brand-mark">🍊</div>
                    <div><h1>제주아이랑</h1></div>
                </div>
                """,
                unsafe_allow_html=True,
            )
        with find_nav:
            st.button(
                "장소 찾기", key="header_find", type="tertiary", use_container_width=True,
                on_click=go_to, args=("home",),
            )
        with divider:
            st.markdown('<div class="nav-divider">|</div>', unsafe_allow_html=True)
        with bookmark_nav:
            st.button(
                "즐겨찾기",
                key="header_bookmarks",
                type="tertiary",
                use_container_width=True,
                on_click=go_to,
                args=("bookmarks",),
            )


def display_tags(place: pd.Series, include_region: bool = True) -> str:
    values = [clean_text(place.get("category"), "")]
    if include_region:
        values.append(clean_text(place.get("region_group"), ""))
    values.extend(
        [clean_text(place.get("space_type"), ""), clean_text(place.get("parking"), "")]
    )
    return "".join(f'<span class="tag">{value}</span>' for value in values if value)


def format_distance(distance_km: object) -> str:
    if pd.isna(distance_km):
        return ""
    distance = float(distance_km)
    if distance < 1:
        return f"약 {max(1, round(distance * 1000)):,}m"
    return f"약 {distance:.1f}km"


def render_place_grid(frame: pd.DataFrame, key_prefix: str, columns: int = 3) -> None:
    for start in range(0, len(frame), columns):
        row_columns = st.columns(columns)
        for offset, (_, place) in enumerate(frame.iloc[start : start + columns].iterrows()):
            with row_columns[offset]:
                description = clean_text(place.get("description"), "아이와 함께 둘러볼 제주 장소")
                location = " · ".join(
                    part
                    for part in [clean_text(place.get("city_name"), ""), clean_text(place.get("legal_dong_name"), "")]
                    if part
                )
                distance = format_distance(place.get("_distance_km"))
                distance_line = f"<p>🧭 현재 위치에서 {distance}</p>" if distance else ""
                photo_url = clean_text(place.get("photo_url"), "")
                if photo_url:
                    st.image(photo_url, use_container_width=True)
                else:
                    st.markdown('<div class="photo-placeholder">🍊</div>', unsafe_allow_html=True)
                facilities = [f"🚗 {clean_text(place.get('parking'), '주차 정보 없음')}"]
                for value, label in (
                    (place.get("nursing_room"), "🍼 수유실"),
                    (place.get("stroller_rental"), "🛒 유모차"),
                    (place.get("diaper_changing_table"), "👶 교환대"),
                ):
                    if pd.notna(value) and bool(value):
                        facilities.append(label)
                st.markdown(
                    f"""
                    <div class="place-card">
                        <div>{display_tags(place)}</div>
                        <h3>{clean_text(place.get('place_name'))}</h3>
                        <p>{description}</p>
                        <p>📍 {location or '위치 정보 없음'}</p>
                        {distance_line}<div class="facility-line">{' · '.join(facilities)}</div>
                    </div>
                    """,
                    unsafe_allow_html=True,
                )
                st.button(
                    "자세히 보기  →",
                    key=f"{key_prefix}_{place['place_id']}",
                    use_container_width=True,
                    on_click=go_to,
                    args=("detail", str(place["place_id"])),
                )


def render_home(places: pd.DataFrame) -> None:
    st.markdown(
        """
        <section class="home-hero">
            <h2>오늘, 아이랑<br>어디 갈까요?</h2>
            <p>지역을 먼저 선택하면 우리 가족에게 맞는 제주 나들이 장소를 쉽고 빠르게 찾아드려요.</p>
        </section>
        """,
        unsafe_allow_html=True,
    )
    with st.container(border=True):
        st.markdown('<div class="region-title">📍 어느 지역으로 갈까요?</div>', unsafe_allow_html=True)
        st.caption("지역을 선택하면 장소 목록과 상세 필터가 열립니다.")
        region_columns = st.columns(4)
        for index, region in enumerate(REGIONS):
            count = len(places) if region == "전체" else int((places["region_group"] == region).sum())
            with region_columns[index % 4]:
                st.button(
                    f"{region}  ·  {count}곳",
                    key=f"home_region_{region}",
                    use_container_width=True,
                    on_click=select_region,
                    args=(region,),
                )


def filter_places(places: pd.DataFrame) -> pd.DataFrame:
    result = places.copy()
    region = st.session_state.selected_region
    if region != "전체":
        result = result[result["region_group"] == region]

    query = st.session_state.search_query.strip()
    if query:
        result = result[result["place_name"].fillna("").str.contains(query, case=False, regex=False)]

    for state_key, column in (
        ("category_filter", "category"),
        ("space_filter", "space_type"),
        ("parking_filter", "parking"),
    ):
        selected = st.session_state[state_key]
        if selected:
            result = result[result[column].isin(selected)]

    # Every selected convenience condition must be true (AND).
    for label in st.session_state.feature_filter:
        column = FEATURE_FILTERS[label]
        result = result[result[column].fillna(False)]
        if label == "도민 할인 있음":
            # Free venues must not appear in resident-discount results.
            result = result[result["has_admission_fee"].fillna(False)]

    user_lat = st.session_state.user_latitude
    user_lon = st.session_state.user_longitude
    if user_lat is not None and user_lon is not None:
        result = add_distances(result, float(user_lat), float(user_lon))

    if st.session_state.sort_order == "거리순" and "_distance_km" in result.columns:
        result = result.sort_values("_distance_km", ascending=True, kind="stable", na_position="last")
    elif st.session_state.sort_order == "장소명순 (가나다)":
        result = result.sort_values("place_name", ascending=True, kind="stable", na_position="last")
    else:
        result = result.sort_values("_data_order", kind="stable")
    return result


def add_distances(frame: pd.DataFrame, user_lat: float, user_lon: float) -> pd.DataFrame:
    """Calculate straight-line distance in kilometres with the Haversine formula."""
    result = frame.copy()
    latitudes = pd.to_numeric(result["latitude"], errors="coerce")
    longitudes = pd.to_numeric(result["longitude"], errors="coerce")
    lat1 = np.radians(user_lat)
    lon1 = np.radians(user_lon)
    lat2 = np.radians(latitudes)
    lon2 = np.radians(longitudes)
    delta_lat = lat2 - lat1
    delta_lon = lon2 - lon1
    haversine = (
        np.sin(delta_lat / 2) ** 2
        + np.cos(lat1) * np.cos(lat2) * np.sin(delta_lon / 2) ** 2
    )
    result["_distance_km"] = 6371.0088 * 2 * np.arcsin(np.sqrt(haversine.clip(0, 1)))
    return result


def valid_location(location: object) -> bool:
    if not isinstance(location, dict):
        return False
    latitude = location.get("latitude")
    longitude = location.get("longitude")
    try:
        return -90 <= float(latitude) <= 90 and -180 <= float(longitude) <= 180
    except (TypeError, ValueError):
        return False


def forget_location() -> None:
    st.session_state.user_latitude = None
    st.session_state.user_longitude = None
    st.session_state.user_location_accuracy = None
    st.session_state.ignore_location_result = True
    if st.session_state.sort_order == "거리순":
        st.session_state.sort_order = "기본순"
        widget_key = "_sort_order_widget"
        if widget_key in st.session_state:
            st.session_state[widget_key] = "기본순"


def reuse_location() -> None:
    st.session_state.ignore_location_result = False


def render_location_control() -> None:
    st.markdown("#### 내 위치")
    st.caption("아래 위치 버튼을 누르면 거리순 정렬을 사용할 수 있어요.")
    location = streamlit_geolocation()

    if valid_location(location) and not st.session_state.ignore_location_result:
        st.session_state.user_latitude = float(location["latitude"])
        st.session_state.user_longitude = float(location["longitude"])
        accuracy = location.get("accuracy")
        st.session_state.user_location_accuracy = (
            float(accuracy) if accuracy is not None and pd.notna(accuracy) else None
        )

    if st.session_state.user_latitude is not None:
        accuracy = st.session_state.user_location_accuracy
        accuracy_text = f" · 정확도 약 {accuracy:.0f}m" if accuracy is not None else ""
        st.success(f"현재 위치를 확인했어요{accuracy_text}.")
        st.caption("위치는 이 브라우저 세션에서 거리 계산에만 사용하며 파일에 저장하지 않습니다.")
        st.button("위치 정보 지우기", use_container_width=True, on_click=forget_location)
    elif st.session_state.ignore_location_result and valid_location(location):
        st.info("현재 위치 사용을 중지했습니다.")
        st.button("위치 다시 사용", use_container_width=True, on_click=reuse_location)
    else:
        st.caption("권한 요청이 나타나면 ‘허용’을 선택하세요. 배포 환경에서는 HTTPS가 필요합니다.")


def active_filter_labels() -> list[str]:
    labels = []
    if st.session_state.selected_region != "전체":
        labels.append(st.session_state.selected_region)
    labels.extend(st.session_state.category_filter)
    labels.extend(st.session_state.space_filter)
    labels.extend(st.session_state.parking_filter)
    labels.extend(st.session_state.feature_filter)
    if st.session_state.search_query.strip():
        labels.append(f'검색: {st.session_state.search_query.strip()}')
    return labels


def open_selected_table_place() -> None:
    state = st.session_state.get("places_table")
    selection = state.get("selection", {}) if state else {}
    selected_rows = selection.get("rows", [])
    place_ids = st.session_state.get("places_table_place_ids", [])
    if selected_rows and selected_rows[0] < len(place_ids):
        go_to("detail", place_ids[selected_rows[0]])


def open_selected_map_place() -> None:
    state = st.session_state.get("places_map")
    selection = state.get("selection", {}) if state else {}
    selected_objects = selection.get("objects", {}).get("places", [])
    if selected_objects:
        go_to("detail", str(selected_objects[0]["place_id"]))


def render_place_table(frame: pd.DataFrame) -> None:
    source = frame.reset_index(drop=True)
    st.session_state.places_table_place_ids = source["place_id"].astype(str).tolist()
    table = source.copy()
    table["거리"] = table.get("_distance_km", pd.Series(pd.NA, index=table.index)).map(format_distance)
    table = table[
        ["place_name", "category", "region_group", "space_type", "parking", "거리"]
    ].rename(
        columns={
            "place_name": "장소명",
            "category": "시설유형",
            "region_group": "지역",
            "space_type": "실내외",
            "parking": "주차",
        }
    )
    if not table["거리"].fillna("").str.strip().any():
        table = table.drop(columns="거리")
    st.caption("장소 행을 클릭하면 상세정보로 이동합니다.")
    st.dataframe(
        table,
        hide_index=True,
        use_container_width=True,
        key="places_table",
        on_select=open_selected_table_place,
        selection_mode="single-row",
    )


def render_place_map(frame: pd.DataFrame) -> None:
    map_frame = frame.copy()
    map_frame["lat"] = pd.to_numeric(map_frame["latitude"], errors="coerce")
    map_frame["lon"] = pd.to_numeric(map_frame["longitude"], errors="coerce")
    map_frame = map_frame.dropna(subset=["lat", "lon"])
    if map_frame.empty:
        st.info("지도에 표시할 위치 정보가 없습니다.")
    else:
        st.caption("지도에서 장소 마커를 클릭하면 상세정보로 이동합니다.")
        layer = pdk.Layer(
            "ScatterplotLayer",
            data=map_frame[
                ["place_id", "place_name", "category", "region_group", "lat", "lon"]
            ],
            id="places",
            get_position="[lon, lat]",
            get_fill_color=[255, 95, 75, 210],
            get_line_color=[255, 255, 255, 230],
            get_radius=220,
            radius_min_pixels=6,
            radius_max_pixels=18,
            line_width_min_pixels=1,
            pickable=True,
            auto_highlight=True,
        )
        deck = pdk.Deck(
            layers=[layer],
            initial_view_state=pdk.ViewState(
                latitude=float(map_frame["lat"].mean()),
                longitude=float(map_frame["lon"].mean()),
                zoom=8.5,
                pitch=0,
            ),
            tooltip={"html": "<b>{place_name}</b><br>{category} · {region_group}"},
            map_style=None,
        )
        st.pydeck_chart(
            deck,
            use_container_width=True,
            key="places_map",
            on_select=open_selected_map_place,
            selection_mode="single-object",
        )
        missing_count = len(frame) - len(map_frame)
        if missing_count:
            st.caption(f"위도·경도가 없는 {missing_count}곳은 지도에서 제외했습니다.")


def render_list(places: pd.DataFrame) -> None:
    with st.sidebar:
        st.title("장소 찾기")
        render_location_control()
        st.divider()
        st.session_state.selected_region = st.selectbox(
            "지역",
            REGIONS,
            key=prepare_filter_widget("selected_region"),
        )
        st.session_state.search_query = st.text_input(
            "장소명 검색",
            key=prepare_filter_widget("search_query"),
            placeholder="장소명을 입력하세요",
        )
        st.session_state.category_filter = st.multiselect(
            "시설유형",
            sorted(places["category"].dropna().astype(str).unique()),
            key=prepare_filter_widget("category_filter"),
        )
        st.session_state.space_filter = st.multiselect(
            "실내외 구분",
            sorted(places["space_type"].dropna().astype(str).unique()),
            key=prepare_filter_widget("space_filter"),
        )
        st.session_state.parking_filter = st.multiselect(
            "주차 유형",
            sorted(places["parking"].dropna().astype(str).unique()),
            key=prepare_filter_widget("parking_filter"),
        )
        st.session_state.feature_filter = st.multiselect(
            "편의·이용 조건 (모두 충족)",
            list(FEATURE_FILTERS),
            key=prepare_filter_widget("feature_filter"),
            help="여러 항목을 선택하면 모든 조건을 충족하는 장소만 표시합니다.",
        )
        st.session_state.sort_order = st.selectbox(
            "정렬",
            ["기본순", "장소명순 (가나다)", "거리순"],
            key=prepare_filter_widget("sort_order"),
        )
        if st.session_state.sort_order == "거리순" and st.session_state.user_latitude is None:
            st.warning("거리순을 사용하려면 위의 위치 버튼을 눌러 주세요.")
        st.button("전체 조건 초기화", use_container_width=True, on_click=reset_filters)
        st.divider()
        st.button("처음 화면", use_container_width=True, on_click=go_to, args=("home",))
        st.button("즐겨찾기", use_container_width=True, on_click=go_to, args=("bookmarks",))

    filtered = filter_places(places)
    selected_categories = st.session_state.category_filter
    if len(selected_categories) == 1:
        title = f"{selected_categories[0]} 장소 목록"
    elif len(selected_categories) > 1:
        title = "선택한 시설유형 장소 목록"
    else:
        title = "전체 장소 목록"

    st.markdown('<div class="page-kicker">장소 찾기</div>', unsafe_allow_html=True)
    st.markdown('<div class="page-title">아이와 어디로 떠나볼까요?</div>', unsafe_allow_html=True)
    st.caption("조건을 선택하면 우리 가족에게 맞는 장소를 찾아드려요.")
    labels = active_filter_labels()
    if labels:
        st.markdown(" ".join(f'<span class="tag">{label}</span>' for label in labels), unsafe_allow_html=True)
        st.write("")

    st.markdown(
        f'<div class="result-heading"><span>{title}</span><b>{len(filtered):,}곳</b></div>',
        unsafe_allow_html=True,
    )

    if filtered.empty:
        st.info("선택한 조건에 맞는 장소가 없습니다. 조건을 일부 해제해 보세요.")
        st.button("모든 조건 초기화", on_click=reset_filters)
        return

    st.session_state.view_mode = st.radio(
        "보기 형식",
        ["갤러리 보기", "표로 보기", "지도 보기"],
        horizontal=True,
        key=prepare_filter_widget("view_mode"),
    )
    if st.session_state.view_mode == "표로 보기":
        render_place_table(filtered)
    elif st.session_state.view_mode == "지도 보기":
        render_place_map(filtered)
    else:
        render_place_grid(filtered, "list_place")


def yes_no_unknown(value: object, yes: str = "있음", no: str = "없음") -> str:
    if pd.isna(value):
        return "정보 없음"
    return yes if bool(value) else no


def info_box(label: str, value: object) -> None:
    st.markdown(
        f"""
        <div class="info-box">
            <div class="info-label">{label}</div>
            <div class="info-value">{clean_text(value)}</div>
        </div>
        """,
        unsafe_allow_html=True,
    )


def render_detail(places: pd.DataFrame) -> None:
    place_id = st.session_state.selected_place_id
    selected = places[places["place_id"].astype(str) == str(place_id)]
    if selected.empty:
        st.error("선택한 장소를 찾을 수 없습니다.")
        st.button("목록으로 돌아가기", on_click=go_to, args=("list",))
        return
    place = selected.iloc[0]

    st.button("← 장소 목록으로", on_click=go_to, args=("list",))
    description = clean_text(place.get("description"), "아이와 함께 둘러볼 제주 장소입니다.")
    photo_url = clean_text(place.get("photo_url"), "")
    media, summary = st.columns([1.35, 1], gap="large", vertical_alignment="top")
    with media:
        if photo_url:
            st.image(photo_url, use_container_width=True)
        else:
            st.markdown('<div class="photo-placeholder">🍊 제주 나들이</div>', unsafe_allow_html=True)
    with summary:
        st.markdown('<div class="page-kicker">장소 상세정보</div>', unsafe_allow_html=True)
        st.title(clean_text(place.get("place_name")))
        st.markdown(display_tags(place), unsafe_allow_html=True)
        st.markdown(f"### {description}")
        info_box("📍 위치", place.get("road_address"))
        info_box("🕘 운영시간", place.get("opening_hours"))
        info_box(
            "🎫 이용요금",
            yes_no_unknown(place.get("has_admission_fee"), "입장료 있음", "무료"),
        )
        info_box("👶 연령제한", yes_no_unknown(place.get("has_age_limit")))

    st.markdown('<div class="spacer"></div>', unsafe_allow_html=True)
    st.subheader("위치")
    lat, lon = place.get("latitude"), place.get("longitude")
    if pd.notna(lat) and pd.notna(lon):
        st.map(pd.DataFrame({"lat": [float(lat)], "lon": [float(lon)]}), zoom=13, use_container_width=True)
    else:
        st.info("위치 정보가 등록되지 않았습니다.")

    st.subheader("운영 및 이용 정보")
    col1, col2 = st.columns(2)
    with col1:
        info_box("휴무일", place.get("closed_days"))
        info_box("이용요금 상세", place.get("admission_fee_detail"))
    with col2:
        info_box("전화번호", place.get("phone"))
        info_box("주차", place.get("parking"))
        info_box("연령제한 상세", place.get("age_limit_detail"))
        info_box("도민 할인", yes_no_unknown(place.get("resident_discount"), "할인 있음", "할인 없음"))

    st.subheader("편의시설")
    conveniences = [
        ("실내외", clean_text(place.get("space_type"))),
        ("수유실", yes_no_unknown(place.get("nursing_room"), "보유", "미보유")),
        ("유모차 대여", yes_no_unknown(place.get("stroller_rental"), "가능", "불가")),
        ("기저귀 교환대", yes_no_unknown(place.get("diaper_changing_table"), "보유", "미보유")),
        ("도민 할인", yes_no_unknown(place.get("resident_discount"), "할인 있음", "할인 없음")),
    ]
    convenience_columns = st.columns(len(conveniences))
    for column, (label, value) in zip(convenience_columns, conveniences):
        with column:
            st.metric(label, value)

    link_columns = st.columns(2)
    website = clean_text(place.get("website_url"), "")
    reservation = clean_text(place.get("reservation_url"), "")
    if website:
        link_columns[0].link_button("홈페이지 열기", website, use_container_width=True)
    if reservation:
        link_columns[1].link_button("예약하기", reservation, use_container_width=True)

    review = clean_text(place.get("review_summary"), "")
    if review:
        st.subheader("방문 후기 요약")
        st.info(review)

    st.markdown('<div class="spacer"></div>', unsafe_allow_html=True)
    st.divider()
    st.subheader("즐겨찾기 저장")
    st.caption("닉네임과 비밀번호로 저장해 두면 나중에 다시 찾아볼 수 있어요.")
    nickname = st.text_input("닉네임", key="nickname", max_chars=30, placeholder="예: 아진맘")
    password = st.text_input(
        "비밀번호",
        key="bookmark_save_password",
        type="password",
        max_chars=50,
        placeholder="4자 이상 입력하세요",
    )
    memo = st.text_area(
        "메모 (선택)",
        key="bookmark_save_memo",
        max_chars=500,
        placeholder="아이와 방문할 때 기억할 내용을 적어 두세요.",
    )
    if st.button("즐겨찾기에 저장", type="primary"):
        normalized = nickname.strip()
        if not normalized:
            st.warning("닉네임을 입력해 주세요.")
        elif len(password) < 4:
            st.warning("비밀번호를 4자 이상 입력해 주세요.")
        else:
            bookmarks = load_bookmarks()
            same_nickname = nickname_mask(bookmarks, normalized)
            protected = bookmarks[
                same_nickname
                & bookmarks["password_salt"].fillna("").str.strip().ne("")
                & bookmarks["password_hash"].fillna("").str.strip().ne("")
            ]
            credentials_updated = False
            authorized = True

            if not protected.empty:
                credential = protected.iloc[0]
                salt = str(credential["password_salt"])
                digest = str(credential["password_hash"])
                if not verify_password(password, salt, digest):
                    st.error("이 닉네임에 설정된 비밀번호와 일치하지 않습니다.")
                    authorized = False
                else:
                    legacy_rows = same_nickname & (
                        bookmarks["password_salt"].fillna("").str.strip().eq("")
                        | bookmarks["password_hash"].fillna("").str.strip().eq("")
                    )
                    if legacy_rows.any():
                        bookmarks.loc[legacy_rows, "password_salt"] = salt
                        bookmarks.loc[legacy_rows, "password_hash"] = digest
                        credentials_updated = True
            else:
                salt, digest = create_password_credentials(password)
                if same_nickname.any():
                    # Existing rows predate the password feature. The first save claims them.
                    bookmarks.loc[same_nickname, "password_salt"] = salt
                    bookmarks.loc[same_nickname, "password_hash"] = digest
                    credentials_updated = True

            duplicate = (same_nickname & bookmarks["place_id"].astype(str).eq(str(place_id))).any()
            if authorized and duplicate:
                if credentials_updated:
                    if write_bookmarks(bookmarks):
                        st.success("기존 즐겨찾기에 비밀번호를 연결했습니다.")
                else:
                    st.info("이미 즐겨찾기에 저장한 장소입니다.")
            elif authorized:
                numeric_ids = pd.to_numeric(
                    bookmarks["bookmark_id"].fillna("").str.extract(r"(\d+)", expand=False),
                    errors="coerce",
                )
                next_number = int(numeric_ids.max()) + 1 if numeric_ids.notna().any() else 1
                new_row = pd.DataFrame(
                    [{
                        "bookmark_id": f"B{next_number:03d}",
                        "nickname": normalized,
                        "place_id": str(place_id),
                        "created_at": datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
                        "password_salt": salt,
                        "password_hash": digest,
                        "memo": memo.strip(),
                    }]
                )
                if write_bookmarks(pd.concat([bookmarks, new_row], ignore_index=True)):
                    st.success("즐겨찾기에 저장했습니다.")


def clear_bookmark_auth() -> None:
    st.session_state.bookmark_authenticated_nickname = None


def end_bookmark_session() -> None:
    st.session_state.bookmark_authenticated_nickname = None
    st.session_state.bookmark_lookup_password = ""


def render_bookmarks(places: pd.DataFrame) -> None:
    st.button("← 처음 화면", on_click=go_to, args=("home",))
    st.title("즐겨찾기")
    st.caption("저장할 때 사용한 닉네임과 비밀번호를 입력하세요.")
    nickname = st.text_input(
        "닉네임",
        key="bookmark_lookup",
        max_chars=30,
        on_change=clear_bookmark_auth,
    )
    password = st.text_input(
        "비밀번호",
        key="bookmark_lookup_password",
        type="password",
        max_chars=50,
        on_change=clear_bookmark_auth,
    )
    normalized = nickname.strip()
    bookmarks = load_bookmarks()
    if st.button("내 즐겨찾기 보기", type="primary"):
        if not normalized or not password:
            st.warning("닉네임과 비밀번호를 모두 입력해 주세요.")
        else:
            authenticated, message = authenticate_nickname(bookmarks, normalized, password)
            if authenticated:
                st.session_state.bookmark_authenticated_nickname = normalized
            else:
                st.session_state.bookmark_authenticated_nickname = None
                st.error(message)

    if st.session_state.bookmark_authenticated_nickname != normalized or not normalized:
        st.info("닉네임과 비밀번호가 확인되면 저장한 장소가 표시됩니다.")
        return

    st.button("조회 종료", on_click=end_bookmark_session)
    mine = bookmarks[bookmarks["nickname"].fillna("").str.strip() == normalized].copy()
    if mine.empty:
        st.info("이 닉네임으로 저장한 즐겨찾기가 없습니다.")
        return
    mine["_created"] = pd.to_datetime(mine["created_at"], errors="coerce")
    mine = mine.sort_values("_created", ascending=False, na_position="last")
    safe_download_columns = ["bookmark_id", "nickname", "place_id", "created_at", "memo"]
    st.download_button(
        "내 북마크 CSV 내려받기",
        data=mine[safe_download_columns].to_csv(index=False).encode("utf-8-sig"),
        file_name=f"{normalized}_bookmarks.csv",
        mime="text/csv",
        use_container_width=True,
    )
    joined = mine.merge(places, on="place_id", how="left", suffixes=("_bookmark", ""))
    st.caption(f"저장한 장소 {len(joined)}곳 · 최신 저장순")

    for _, place in joined.iterrows():
        card, actions = st.columns([5, 2])
        with card:
            st.markdown(
                f"""
                <div class="place-card">
                    <div>{display_tags(place)}</div>
                    <h3>{clean_text(place.get('place_name'), '삭제되었거나 찾을 수 없는 장소')}</h3>
                    <p>저장일시 · {clean_text(place.get('created_at'))}</p>
                </div>
                """,
                unsafe_allow_html=True,
            )
        with actions:
            memo_value = st.text_area(
                "메모",
                value=clean_text(place.get("memo"), ""),
                key=f"bookmark_memo_{place['bookmark_id']}",
                max_chars=500,
            )
            if st.button(
                "메모 저장",
                key=f"bookmark_memo_save_{place['bookmark_id']}",
                use_container_width=True,
            ):
                # Always update the complete source table by its unique ID.
                # Never write only the nickname-filtered rows shown on screen.
                updated = load_bookmarks()
                target = updated["bookmark_id"].astype(str).eq(str(place["bookmark_id"]))
                if target.sum() != 1:
                    st.error("수정할 북마크를 정확히 찾을 수 없습니다.")
                else:
                    updated.loc[target, "memo"] = memo_value.strip()
                    if write_bookmarks(updated):
                        st.success("메모를 저장했습니다.")
            if pd.notna(place.get("place_name")):
                st.button(
                    "상세 보기",
                    key=f"bookmark_open_{place['bookmark_id']}",
                    use_container_width=True,
                    on_click=go_to,
                    args=("detail", str(place["place_id"])),
                )
            if st.button(
                "삭제", key=f"bookmark_delete_{place['bookmark_id']}", use_container_width=True
            ):
                updated = bookmarks[bookmarks["bookmark_id"] != place["bookmark_id"]]
                if write_bookmarks(updated):
                    st.rerun()


def main() -> None:
    initialize_state()
    places = get_places()
    hero()
    page = st.session_state.page
    if page == "home":
        render_home(places)
    elif page == "list":
        render_list(places)
    elif page == "detail":
        render_detail(places)
    elif page == "bookmarks":
        render_bookmarks(places)
    else:
        st.session_state.page = "home"
        st.rerun()


if __name__ == "__main__":
    main()
