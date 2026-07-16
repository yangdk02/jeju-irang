from __future__ import annotations

import os
import tempfile
from datetime import datetime
from pathlib import Path

import pandas as pd
import streamlit as st


APP_DIR = Path(__file__).resolve().parent
DATA_DIR = APP_DIR / "data"
PLACES_PATH = DATA_DIR / "jeju-irang.csv"
BOOKMARKS_PATH = DATA_DIR / "bookmarks.csv"

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
    page_title="제주 아이랑",
    page_icon="🍊",
    layout="wide",
    initial_sidebar_state="expanded",
)

st.markdown(
    """
    <style>
    :root {
        --jeju-surface: color-mix(in srgb, var(--background-color) 94%, var(--text-color) 6%);
        --jeju-soft-surface: color-mix(in srgb, var(--secondary-background-color) 88%, var(--background-color) 12%);
        --jeju-accent-soft: color-mix(in srgb, var(--primary-color) 14%, var(--background-color) 86%);
        --jeju-border: color-mix(in srgb, var(--text-color) 16%, transparent);
        --jeju-muted: color-mix(in srgb, var(--text-color) 68%, transparent);
    }
    /* Streamlit's fixed header is about 3.75rem tall. Keep content below it. */
    [data-testid="stAppViewBlockContainer"],
    .block-container {
        max-width: 1180px;
        padding-top: 5rem;
        padding-bottom: 4rem;
    }
    [data-testid="stSidebar"] {
        background: var(--secondary-background-color);
        color: var(--text-color);
    }
    [data-testid="stSidebarContent"] {padding-top: 1rem;}
    .hero {
        padding: 2.2rem 2.4rem; border-radius: 24px;
        background: linear-gradient(
            135deg,
            color-mix(in srgb, #f39a2e 18%, var(--background-color)) 0%,
            var(--jeju-accent-soft) 55%,
            color-mix(in srgb, #35a66f 16%, var(--background-color)) 100%
        );
        border: 1px solid var(--jeju-border);
        margin-bottom: 1.6rem;
    }
    .hero h1 {margin: 0; color: var(--text-color); font-size: 2.55rem;}
    .hero p {margin: .55rem 0 0; color: var(--jeju-muted); font-size: 1.08rem;}
    .section-title {font-size: 1.45rem; font-weight: 750; color: var(--text-color); margin: .8rem 0 .3rem;}
    .place-card {
        min-height: 145px; padding: 1.15rem; border: 1px solid var(--jeju-border);
        border-radius: 18px; background: var(--jeju-surface);
        box-shadow: 0 3px 14px color-mix(in srgb, var(--text-color) 8%, transparent);
    }
    .place-card h3 {margin: .2rem 0 .45rem; font-size: 1.12rem; color: var(--text-color);}
    .place-card p {margin: .25rem 0; color: var(--jeju-muted); font-size: .91rem;}
    .tag {
        display: inline-block; background: var(--jeju-accent-soft); color: var(--text-color);
        border: 1px solid var(--jeju-border); border-radius: 999px;
        padding: .22rem .58rem; margin: .1rem .18rem .1rem 0; font-size: .8rem;
    }
    .info-box {
        padding: 1rem 1.1rem; border-radius: 14px; background: var(--jeju-soft-surface);
        border: 1px solid var(--jeju-border); margin-bottom: .6rem;
    }
    .info-label {color: var(--jeju-muted); font-size: .84rem; margin-bottom: .22rem;}
    .info-value {color: var(--text-color); white-space: pre-wrap; overflow-wrap: anywhere;}
    .muted {color: var(--jeju-muted);}
    .spacer {height: 1.3rem;}
    div.stButton > button {border-radius: 12px;}
    @media (max-width: 768px) {
        [data-testid="stAppViewBlockContainer"],
        .block-container {padding-top: 4.5rem;}
        .hero {padding: 1.5rem 1.25rem;}
        .hero h1 {font-size: 2rem;}
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
    return pd.DataFrame(columns=["bookmark_id", "nickname", "place_id", "created_at"])


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


def write_bookmarks(frame: pd.DataFrame) -> None:
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    handle, temp_name = tempfile.mkstemp(prefix="bookmarks_", suffix=".csv", dir=DATA_DIR)
    os.close(handle)
    try:
        frame.to_csv(temp_name, index=False, encoding="utf-8-sig")
        os.replace(temp_name, BOOKMARKS_PATH)
    finally:
        if os.path.exists(temp_name):
            os.remove(temp_name)


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
        "nickname": "",
        "bookmark_lookup": "",
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
    st.markdown(
        """
        <div class="hero">
            <h1>🍊 제주 아이랑</h1>
            <p>제주에서 아이와 함께 가볼 만한 곳을 쉽고 빠르게 찾아보세요.</p>
        </div>
        """,
        unsafe_allow_html=True,
    )


def display_tags(place: pd.Series, include_region: bool = True) -> str:
    values = [clean_text(place.get("category"), "")]
    if include_region:
        values.append(clean_text(place.get("region_group"), ""))
    values.extend(
        [clean_text(place.get("space_type"), ""), clean_text(place.get("parking"), "")]
    )
    return "".join(f'<span class="tag">{value}</span>' for value in values if value)


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
                st.markdown(
                    f"""
                    <div class="place-card">
                        <div>{display_tags(place)}</div>
                        <h3>{clean_text(place.get('place_name'))}</h3>
                        <p>{description}</p>
                        <p>📍 {location or '위치 정보 없음'}</p>
                    </div>
                    """,
                    unsafe_allow_html=True,
                )
                st.button(
                    "장소 보기",
                    key=f"{key_prefix}_{place['place_id']}",
                    use_container_width=True,
                    on_click=go_to,
                    args=("detail", str(place["place_id"])),
                )


def render_home(places: pd.DataFrame) -> None:
    hero()
    top_left, top_right = st.columns([5, 1])
    with top_left:
        st.markdown('<div class="section-title">어느 지역으로 갈까요?</div>', unsafe_allow_html=True)
        st.caption("지역을 선택하면 그 지역의 장소와 상세 필터를 확인할 수 있어요.")
    with top_right:
        st.button("즐겨찾기 조회", use_container_width=True, on_click=go_to, args=("bookmarks",))

    region_columns = st.columns(4)
    for index, region in enumerate(REGIONS):
        count = len(places) if region == "전체" else int((places["region_group"] == region).sum())
        with region_columns[index % 4]:
            st.button(
                f"{region}  {count}",
                key=f"home_region_{region}",
                use_container_width=True,
                on_click=select_region,
                args=(region,),
            )

    st.markdown('<div class="section-title">장소를 둘러보세요</div>', unsafe_allow_html=True)
    st.caption("장소를 바로 선택하거나 지역을 먼저 골라 보세요.")
    render_place_grid(places.head(6), "home_place")
    st.button(
        "전체 장소와 필터 보기 →",
        use_container_width=True,
        on_click=select_region,
        args=("전체",),
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

    if st.session_state.sort_order == "장소명순 (가나다)":
        result = result.sort_values("place_name", ascending=True, kind="stable", na_position="last")
    else:
        result = result.sort_values("_data_order", kind="stable")
    return result


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


def render_list(places: pd.DataFrame) -> None:
    with st.sidebar:
        st.title("장소 찾기")
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
            ["기본순", "장소명순 (가나다)"],
            key=prepare_filter_widget("sort_order"),
        )
        st.button("전체 조건 초기화", use_container_width=True, on_click=reset_filters)
        st.divider()
        st.button("처음 화면", use_container_width=True, on_click=go_to, args=("home",))
        st.button("즐겨찾기 조회", use_container_width=True, on_click=go_to, args=("bookmarks",))

    filtered = filter_places(places)
    selected_categories = st.session_state.category_filter
    if len(selected_categories) == 1:
        title = f"{selected_categories[0]} 장소 목록"
    elif len(selected_categories) > 1:
        title = "선택한 시설유형 장소 목록"
    else:
        title = "전체 장소 목록"

    st.title(title)
    st.caption(f"조건에 맞는 장소 {len(filtered):,}곳")
    labels = active_filter_labels()
    if labels:
        st.markdown(" ".join(f'<span class="tag">{label}</span>' for label in labels), unsafe_allow_html=True)
        st.write("")

    if filtered.empty:
        st.info("선택한 조건에 맞는 장소가 없습니다. 조건을 일부 해제해 보세요.")
        st.button("모든 조건 초기화", on_click=reset_filters)
        return
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

    left, right = st.columns([1, 5])
    with left:
        st.button("← 목록으로", use_container_width=True, on_click=go_to, args=("list",))
    with right:
        st.caption("장소 상세정보")
    st.title(clean_text(place.get("place_name")))
    st.markdown(display_tags(place), unsafe_allow_html=True)
    description = clean_text(place.get("description"), "아이와 함께 둘러볼 제주 장소입니다.")
    st.markdown(f"### {description}")

    photo_url = clean_text(place.get("photo_url"), "")
    if photo_url:
        st.image(photo_url, use_container_width=True)

    st.subheader("위치")
    info_box("도로명주소", place.get("road_address"))
    lat, lon = place.get("latitude"), place.get("longitude")
    if pd.notna(lat) and pd.notna(lon):
        st.map(pd.DataFrame({"lat": [float(lat)], "lon": [float(lon)]}), zoom=13, use_container_width=True)
    else:
        st.info("위치 정보가 등록되지 않았습니다.")

    st.subheader("운영 및 이용 정보")
    col1, col2 = st.columns(2)
    with col1:
        info_box("운영시간", place.get("opening_hours"))
        info_box("휴무일", place.get("closed_days"))
        info_box("입장료", yes_no_unknown(place.get("has_admission_fee"), "있음", "무료"))
        info_box("이용요금 상세", place.get("admission_fee_detail"))
    with col2:
        info_box("전화번호", place.get("phone"))
        info_box("주차", place.get("parking"))
        info_box("연령제한", yes_no_unknown(place.get("has_age_limit")))
        info_box("연령제한 상세", place.get("age_limit_detail"))

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
    st.caption("닉네임으로 저장해 두면 나중에 다시 찾아볼 수 있어요.")
    nickname = st.text_input("닉네임", key="nickname", max_chars=30, placeholder="예: 아진맘")
    if st.button("즐겨찾기에 저장", type="primary"):
        normalized = nickname.strip()
        if not normalized:
            st.warning("닉네임을 입력해 주세요.")
        else:
            bookmarks = load_bookmarks()
            duplicate = (
                bookmarks["nickname"].fillna("").str.strip().eq(normalized)
                & bookmarks["place_id"].astype(str).eq(str(place_id))
            ).any()
            if duplicate:
                st.info("이미 즐겨찾기에 저장한 장소입니다.")
            else:
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
                    }]
                )
                write_bookmarks(pd.concat([bookmarks, new_row], ignore_index=True))
                st.success("즐겨찾기에 저장했습니다.")


def render_bookmarks(places: pd.DataFrame) -> None:
    st.button("← 처음 화면", on_click=go_to, args=("home",))
    st.title("즐겨찾기 조회")
    st.caption("저장할 때 사용한 닉네임을 입력하세요.")
    nickname = st.text_input("닉네임", key="bookmark_lookup", max_chars=30)
    normalized = nickname.strip()
    if not normalized:
        st.info("닉네임을 입력하면 저장한 장소가 표시됩니다.")
        return

    bookmarks = load_bookmarks()
    mine = bookmarks[bookmarks["nickname"].fillna("").str.strip() == normalized].copy()
    if mine.empty:
        st.info("이 닉네임으로 저장한 즐겨찾기가 없습니다.")
        return
    mine["_created"] = pd.to_datetime(mine["created_at"], errors="coerce")
    mine = mine.sort_values("_created", ascending=False, na_position="last")
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
                write_bookmarks(updated)
                st.rerun()


def main() -> None:
    initialize_state()
    places = get_places()
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
