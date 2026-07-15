from __future__ import annotations

import html
import os
import re
import tempfile
from datetime import datetime
from pathlib import Path
from urllib.parse import urlparse
from zoneinfo import ZoneInfo

import pandas as pd
import streamlit as st


APP_DIR = Path(__file__).resolve().parent
DATA_DIR = APP_DIR / "data"
PLACES_PATH = Path(os.getenv("JEJU_IRANG_PLACES_PATH", DATA_DIR / "jeju_irang.csv"))
BOOKMARKS_PATH = Path(os.getenv("JEJU_IRANG_BOOKMARKS_PATH", DATA_DIR / "bookmarks.csv"))

PLACE_COLUMNS = [
    "place_id", "place_name", "category_level_2", "city_name", "legal_dong_name",
    "region_group", "road_address", "latitude", "longitude", "phone", "website_url",
    "closed_days", "opening_hours", "free_parking", "paid_parking", "has_admission_fee",
    "admission_fee", "admission_fee_detail", "has_age_limit", "minimum_age", "nursing_room",
    "stroller_rental", "reservation_url", "space_type", "resident_discount",
    "diaper_changing_table", "photo_url", "description", "review_summary",
]
BOOKMARK_COLUMNS = ["bookmark_id", "nickname", "place_id", "created_at"]
BOOLEAN_COLUMNS = {
    "free_parking", "paid_parking", "has_admission_fee", "has_age_limit", "nursing_room",
    "stroller_rental", "resident_discount", "diaper_changing_table",
}
NUMERIC_COLUMNS = {"admission_fee", "minimum_age", "latitude", "longitude"}
FILTER_LABELS = {
    "free_parking": "무료주차",
    "paid_parking": "유료주차",
    "nursing_room": "수유실",
    "stroller_rental": "유모차 대여",
    "diaper_changing_table": "기저귀교환대",
    "resident_discount": "도민 할인",
}


st.set_page_config(page_title="제주아이랑", page_icon="🍊", layout="wide", initial_sidebar_state="expanded")
st.markdown(
    """
    <style>
      .block-container {padding-top: 2rem; padding-bottom: 3rem; max-width: 1240px;}
      [data-testid="stSidebar"] {background: #fffaf2;}
      .hero {padding: 1.4rem 1.6rem; border: 1px solid #f4d7b6; border-radius: 22px;
        background: linear-gradient(135deg, #fff8ed 0%, #fff 62%, #f0fbf7 100%); margin-bottom: 1.2rem;}
      .hero h1 {margin: 0 0 .35rem; color: #27352d; font-size: 2.15rem;}
      .hero p {margin: 0; color: #66736c; font-size: 1.02rem;}
      .badge {display: inline-block; margin: 0 .35rem .35rem 0; padding: .28rem .6rem;
        border-radius: 999px; background: #eef8f3; color: #27624a; border: 1px solid #cfe8dc; font-size: .84rem;}
      .detail-card {border: 1px solid #e9e5dd; border-radius: 18px; padding: 1.1rem 1.25rem;
        background: #fff; box-shadow: 0 5px 18px rgba(63, 54, 42, .05);}
      .muted {color: #758078; font-size: .92rem;}
      .empty-photo {min-height: 230px; border-radius: 18px; background: #f4f1ea; display: flex;
        align-items: center; justify-content: center; color: #827b70; border: 1px dashed #d7d0c3;}
      div[data-testid="stMetric"] {background: #fff; border: 1px solid #ece8df; padding: .8rem 1rem; border-radius: 16px;}
    </style>
    """,
    unsafe_allow_html=True,
)


def _as_bool(value: object) -> bool:
    if pd.isna(value):
        return False
    return str(value).strip().lower() in {"true", "1", "yes", "y", "예"}


@st.cache_data(show_spinner=False)
def load_places(path: str) -> tuple[pd.DataFrame, tuple[str, ...]]:
    frame = pd.read_csv(path, encoding="utf-8-sig", dtype="string")
    source_columns = set(frame.columns)
    missing = tuple(column for column in PLACE_COLUMNS if column not in source_columns)

    for column in PLACE_COLUMNS:
        if column not in frame.columns:
            frame[column] = False if column in BOOLEAN_COLUMNS else pd.NA
    for column in BOOLEAN_COLUMNS:
        frame[column] = frame[column].map(_as_bool)
    for column in NUMERIC_COLUMNS:
        frame[column] = pd.to_numeric(frame[column], errors="coerce")

    if "place_id" not in source_columns:
        frame["place_id"] = [f"ROW{i:03d}" for i in range(1, len(frame) + 1)]
    if "place_name" not in source_columns:
        frame["place_name"] = [f"이름 없는 장소 {i}" for i in range(1, len(frame) + 1)]
    return frame, missing


def load_bookmarks() -> tuple[pd.DataFrame, tuple[str, ...]]:
    if not BOOKMARKS_PATH.exists() or BOOKMARKS_PATH.stat().st_size == 0:
        return pd.DataFrame(columns=BOOKMARK_COLUMNS), tuple()
    frame = pd.read_csv(BOOKMARKS_PATH, encoding="utf-8-sig", dtype="string")
    source_columns = set(frame.columns)
    missing = tuple(column for column in BOOKMARK_COLUMNS if column not in source_columns)
    for column in BOOKMARK_COLUMNS:
        if column not in frame.columns:
            frame[column] = pd.NA
    return frame[BOOKMARK_COLUMNS], missing


def _next_bookmark_id(bookmarks: pd.DataFrame) -> str:
    numbers = []
    for value in bookmarks.get("bookmark_id", pd.Series(dtype="string")).dropna():
        match = re.fullmatch(r"B(\d+)", str(value).strip(), flags=re.IGNORECASE)
        if match:
            numbers.append(int(match.group(1)))
    return f"B{max(numbers, default=0) + 1:03d}"


def save_bookmark(nickname: str, place_id: str) -> tuple[bool, str]:
    nickname = nickname.strip()
    if not nickname:
        return False, "닉네임을 입력해 주세요."
    if len(nickname) > 20:
        return False, "닉네임은 20자 이내로 입력해 주세요."
    bookmarks, missing = load_bookmarks()
    if missing:
        return False, f"즐겨찾기 파일에 필요한 컬럼이 없습니다: {', '.join(missing)}"
    duplicate = bookmarks["nickname"].fillna("").str.strip().eq(nickname) & bookmarks["place_id"].fillna("").str.strip().eq(place_id)
    if duplicate.any():
        return False, "이미 즐겨찾기에 저장한 장소예요."

    new_row = pd.DataFrame([{
        "bookmark_id": _next_bookmark_id(bookmarks), "nickname": nickname, "place_id": place_id,
        "created_at": datetime.now(ZoneInfo("Asia/Seoul")).strftime("%Y-%m-%d %H:%M:%S"),
    }])
    updated = pd.concat([bookmarks, new_row], ignore_index=True)[BOOKMARK_COLUMNS]
    handle, temp_name = tempfile.mkstemp(prefix="bookmarks_", suffix=".csv", dir=DATA_DIR)
    os.close(handle)
    try:
        updated.to_csv(temp_name, index=False, encoding="utf-8-sig")
        os.replace(temp_name, BOOKMARKS_PATH)
    finally:
        if os.path.exists(temp_name):
            os.unlink(temp_name)
    return True, "즐겨찾기에 저장했습니다."


def text(value: object, fallback: str = "정보 없음") -> str:
    return fallback if pd.isna(value) or str(value).strip() == "" else str(value).strip()


def safe_url(value: object) -> str | None:
    candidate = text(value, "")
    parsed = urlparse(candidate)
    return candidate if parsed.scheme in {"http", "https"} and parsed.netloc else None


def fee_label(row: pd.Series, available: set[str]) -> str:
    if "has_admission_fee" in available and not bool(row.get("has_admission_fee", False)):
        return "무료"
    fee = row.get("admission_fee")
    if "admission_fee" in available and pd.notna(fee):
        return f"{int(fee):,}원부터"
    return "유료" if "has_admission_fee" in available else "정보 없음"


def badge_html(row: pd.Series, available: set[str]) -> str:
    badges = []
    for column in ("category_level_2", "space_type"):
        if column in available and text(row.get(column), ""):
            badges.append(text(row.get(column)))
    for column, label in FILTER_LABELS.items():
        if column in available and bool(row.get(column, False)):
            badges.append(label)
    return "".join(f'<span class="badge">{html.escape(label)}</span>' for label in badges)


def link_line(label: str, value: object) -> None:
    url = safe_url(value)
    if url:
        st.markdown(f"[{label}]({url})")


def show_place_detail(row: pd.Series, available: set[str], bookmark_ready: bool) -> None:
    st.markdown("### 장소 상세정보")
    photo_col, info_col = st.columns([1, 1.6], gap="large")
    with photo_col:
        photo_url = safe_url(row.get("photo_url")) if "photo_url" in available else None
        if photo_url and "example.com" not in photo_url:
            st.image(photo_url, width="stretch")
        elif "photo_url" in available:
            st.markdown('<div class="empty-photo">🍊 장소 사진 준비 중</div>', unsafe_allow_html=True)

    with info_col:
        location_parts = [text(row.get(c), "") for c in ("region_group", "city_name", "legal_dong_name") if c in available]
        location = " · ".join(part for part in location_parts if part)
        description = html.escape(text(row.get("description"))) if "description" in available else ""
        st.markdown(
            f'<div class="detail-card"><div class="muted">{html.escape(location)}</div>'
            f'<h2 style="margin:.25rem 0 .55rem;">{html.escape(text(row.get("place_name")))}</h2>'
            f'<div>{badge_html(row, available)}</div><p style="margin:.7rem 0 0;">{description}</p></div>',
            unsafe_allow_html=True,
        )
        metrics = []
        if "opening_hours" in available:
            metrics.append(("운영시간", text(row.get("opening_hours"), "미정")))
        if {"has_admission_fee", "admission_fee"} & available:
            metrics.append(("이용요금", fee_label(row, available)))
        if "closed_days" in available:
            metrics.append(("휴무일", text(row.get("closed_days"), "미정")))
        if metrics:
            for column, (label, value) in zip(st.columns(len(metrics)), metrics):
                column.metric(label, value)

    left, right = st.columns(2, gap="large")
    with left:
        st.markdown("#### 이용 정보")
        if "road_address" in available:
            st.write(f"**주소**  {text(row.get('road_address'))}")
        if "phone" in available:
            st.write(f"**연락처**  {text(row.get('phone'))}")
        if "admission_fee_detail" in available:
            st.write(f"**요금 안내**  {text(row.get('admission_fee_detail'), fee_label(row, available))}")
        if "has_age_limit" in available:
            if bool(row.get("has_age_limit", False)) and "minimum_age" in available and pd.notna(row.get("minimum_age")):
                st.write(f"**최소 이용 연령**  {int(row['minimum_age'])}세")
            else:
                st.write("**연령 제한**  없음")
        if "website_url" in available:
            link_line("홈페이지 열기 ↗", row.get("website_url"))
        if "reservation_url" in available:
            link_line("예약 페이지 열기 ↗", row.get("reservation_url"))
    with right:
        if "review_summary" in available:
            st.markdown("#### 방문 참고")
            st.write(text(row.get("review_summary"), "등록된 후기 요약이 없습니다."))
        if {"latitude", "longitude"}.issubset(available) and pd.notna(row.get("latitude")) and pd.notna(row.get("longitude")):
            st.markdown("#### 위치")
            st.map(pd.DataFrame({"lat": [float(row["latitude"])], "lon": [float(row["longitude"])]}), zoom=11)

    if bookmark_ready and "place_id" in available:
        st.markdown("#### 즐겨찾기 저장")
        with st.form(f"bookmark_form_{text(row.get('place_id'))}", clear_on_submit=False):
            nickname = st.text_input("닉네임", placeholder="예: 아진맘", max_chars=20)
            submitted = st.form_submit_button("이 장소 저장", type="primary")
            if submitted:
                success, message = save_bookmark(nickname, text(row.get("place_id"), ""))
                (st.success if success else st.warning)(message)


if not PLACES_PATH.exists():
    st.error(f"장소 데이터 파일을 찾을 수 없습니다: {PLACES_PATH}")
    st.stop()

places, missing_place_columns = load_places(str(PLACES_PATH))
available = set(PLACE_COLUMNS) - set(missing_place_columns)
bookmarks, missing_bookmark_columns = load_bookmarks()
bookmark_ready = not missing_bookmark_columns

st.markdown(
    '<div class="hero"><h1>제주아이랑 🍊</h1><p>아이의 나이와 외출 상황에 맞는 제주 아이 동반 장소를 쉽고 빠르게 찾아보세요.</p></div>',
    unsafe_allow_html=True,
)
if missing_place_columns:
    st.warning(f"장소 데이터에서 누락된 컬럼: {', '.join(missing_place_columns)} · 관련 기능만 숨기고 나머지 화면은 계속 표시합니다.")
if missing_bookmark_columns:
    st.warning(f"즐겨찾기 데이터에서 누락된 컬럼: {', '.join(missing_bookmark_columns)} · 즐겨찾기 기능을 숨깁니다.")

explore_tab, bookmark_tab = st.tabs(["🔎 장소 찾기", "⭐ 즐겨찾기"])
with explore_tab:
    selected_region = "전체"
    if "region_group" in available:
        preferred = ["구좌/조천", "서귀포시", "성산/표선", "안덕/대정", "애월/한림", "제주시"]
        regions = [str(value) for value in places["region_group"].dropna().unique()]
        options = ["전체"] + [value for value in preferred if value in regions]
        options += sorted(value for value in regions if value not in options)
        st.markdown("#### 어느 지역으로 갈까요?")
        selected_region = st.radio("지역 선택", options, horizontal=True, label_visibility="collapsed")

    with st.sidebar:
        st.markdown("## 조건으로 찾기")
        search_columns = [column for column in ("place_name", "description", "review_summary") if column in available]
        keyword = st.text_input("장소 검색", placeholder="장소명 또는 설명") if search_columns else ""
        categories = st.multiselect("시설 유형", sorted(places["category_level_2"].dropna().astype(str).unique())) if "category_level_2" in available else []
        space_types = st.multiselect("실내·실외", sorted(places["space_type"].dropna().astype(str).unique())) if "space_type" in available else []
        active_boolean_filters = {}
        visible_boolean_columns = [column for column in FILTER_LABELS if column in available]
        if visible_boolean_columns:
            st.markdown("##### 육아·주차 편의시설")
            for column in visible_boolean_columns:
                active_boolean_filters[column] = st.checkbox(FILTER_LABELS[column])
        sort_options = ["기본순"]
        if "admission_fee" in available:
            sort_options.append("이용요금 낮은 순")
        if "place_name" in available:
            sort_options.append("장소명순")
        sort_option = st.selectbox("정렬", sort_options)

    filtered = places.copy()
    if "region_group" in available and selected_region != "전체":
        filtered = filtered[filtered["region_group"].astype(str).eq(selected_region)]
    if keyword.strip() and search_columns:
        searchable = filtered[search_columns].fillna("").astype(str)
        mask = searchable.apply(lambda column: column.str.contains(keyword.strip(), case=False, regex=False)).any(axis=1)
        filtered = filtered[mask]
    if categories:
        filtered = filtered[filtered["category_level_2"].isin(categories)]
    if space_types:
        filtered = filtered[filtered["space_type"].isin(space_types)]
    for column, enabled in active_boolean_filters.items():
        if enabled:
            filtered = filtered[filtered[column]]
    if sort_option == "이용요금 낮은 순":
        filtered = filtered.assign(_fee=filtered["admission_fee"].fillna(float("inf"))).sort_values("_fee").drop(columns="_fee")
    elif sort_option == "장소명순":
        filtered = filtered.sort_values("place_name")

    metric_values = [("검색 결과", f"{len(filtered)}곳")]
    if "has_admission_fee" in available:
        metric_values.append(("무료 입장", f"{int((~filtered['has_admission_fee']).sum())}곳"))
    if "space_type" in available:
        metric_values.append(("실내 장소", f"{int(filtered['space_type'].eq('실내').sum())}곳"))
    for column, (label, value) in zip(st.columns(len(metric_values)), metric_values):
        column.metric(label, value)

    if filtered.empty:
        st.info("선택한 조건에 맞는 장소가 없습니다. 필터를 조금 줄여 보세요.")
    else:
        st.markdown("### 장소 목록")
        display_columns = []
        rename_map = {}
        for source, label in (("place_name", "장소명"), ("region_group", "지역"), ("category_level_2", "시설 유형"),
                              ("space_type", "공간"), ("opening_hours", "운영시간")):
            if source in available:
                display_columns.append(source)
                rename_map[source] = label
        list_frame = filtered.copy()
        if {"has_admission_fee", "admission_fee"} & available:
            list_frame["fee_display"] = list_frame.apply(lambda row: fee_label(row, available), axis=1)
            display_columns.append("fee_display")
            rename_map["fee_display"] = "이용요금"
        st.dataframe(list_frame[display_columns].rename(columns=rename_map), hide_index=True, width="stretch")

        place_ids = filtered["place_id"].astype(str).tolist()
        names = dict(zip(filtered["place_id"].astype(str), filtered["place_name"].astype(str)))
        selected_id = st.selectbox("상세정보를 볼 장소", place_ids, format_func=lambda value: names.get(value, value))
        selected_row = filtered[filtered["place_id"].astype(str).eq(selected_id)].iloc[0]
        show_place_detail(selected_row, available, bookmark_ready)

with bookmark_tab:
    st.markdown("### 닉네임별 즐겨찾기")
    if not bookmark_ready:
        st.info("즐겨찾기 데이터 컬럼이 복구되면 이 기능이 다시 표시됩니다.")
    else:
        nickname_options = sorted(bookmarks["nickname"].dropna().astype(str).str.strip().unique())
        if not nickname_options:
            st.info("아직 저장된 즐겨찾기가 없습니다. 장소 상세에서 첫 장소를 저장해 보세요.")
        else:
            nickname = st.selectbox("닉네임", nickname_options)
            mine = bookmarks[bookmarks["nickname"].fillna("").str.strip().eq(nickname)].copy()
            if "place_id" in available:
                mine = mine.merge(places, on="place_id", how="left")
            if "created_at" in mine.columns:
                mine = mine.sort_values("created_at", ascending=False)
            st.caption(f"{nickname}님이 저장한 장소 {len(mine)}곳")
            columns = [column for column in ("place_name", "region_group", "category_level_2", "space_type", "created_at") if column in mine.columns]
            labels = {"place_name": "장소명", "region_group": "지역", "category_level_2": "시설 유형", "space_type": "공간", "created_at": "저장 시각"}
            st.dataframe(mine[columns].rename(columns=labels), hide_index=True, width="stretch")
            ids = mine["place_id"].dropna().astype(str).tolist() if "place_id" in mine.columns else []
            if ids and "place_id" in available:
                selected_id = st.selectbox("상세정보를 볼 즐겨찾기", ids, key="bookmark_detail")
                selected = places[places["place_id"].astype(str).eq(selected_id)]
                if not selected.empty:
                    show_place_detail(selected.iloc[0], available, bookmark_ready)
