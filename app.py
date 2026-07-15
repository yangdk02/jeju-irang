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
PLACES_PATH = DATA_DIR / "jeju_irang.csv"
BOOKMARKS_PATH = DATA_DIR / "bookmarks.csv"
BOOKMARK_COLUMNS = ["bookmark_id", "nickname", "place_id", "created_at"]
BOOLEAN_COLUMNS = [
    "free_parking",
    "paid_parking",
    "has_admission_fee",
    "has_age_limit",
    "nursing_room",
    "stroller_rental",
    "resident_discount",
    "diaper_changing_table",
]


st.set_page_config(
    page_title="제주아이랑",
    page_icon="🍊",
    layout="wide",
    initial_sidebar_state="expanded",
)

st.markdown(
    """
    <style>
      .block-container {padding-top: 2rem; padding-bottom: 3rem; max-width: 1240px;}
      [data-testid="stSidebar"] {background: #fffaf2;}
      .hero {
        padding: 1.4rem 1.6rem;
        border: 1px solid #f4d7b6;
        border-radius: 22px;
        background: linear-gradient(135deg, #fff8ed 0%, #fff 62%, #f0fbf7 100%);
        margin-bottom: 1.2rem;
      }
      .hero h1 {margin: 0 0 .35rem; color: #27352d; font-size: 2.15rem;}
      .hero p {margin: 0; color: #66736c; font-size: 1.02rem;}
      .badge {
        display: inline-block; margin: 0 .35rem .35rem 0; padding: .28rem .6rem;
        border-radius: 999px; background: #eef8f3; color: #27624a;
        border: 1px solid #cfe8dc; font-size: .84rem;
      }
      .detail-card {
        border: 1px solid #e9e5dd; border-radius: 18px; padding: 1.1rem 1.25rem;
        background: #ffffff; box-shadow: 0 5px 18px rgba(63, 54, 42, .05);
      }
      .muted {color: #758078; font-size: .92rem;}
      .empty-photo {
        min-height: 230px; border-radius: 18px; background: #f4f1ea;
        display: flex; align-items: center; justify-content: center;
        color: #827b70; font-size: 1rem; border: 1px dashed #d7d0c3;
      }
      div[data-testid="stMetric"] {
        background: #fff; border: 1px solid #ece8df; padding: .8rem 1rem; border-radius: 16px;
      }
    </style>
    """,
    unsafe_allow_html=True,
)


def _as_bool(value: object) -> bool:
    if pd.isna(value):
        return False
    return str(value).strip().lower() in {"true", "1", "yes", "y", "예"}


@st.cache_data(show_spinner=False)
def load_places(path: str) -> pd.DataFrame:
    frame = pd.read_csv(path, encoding="utf-8-sig", dtype={"place_id": "string", "phone": "string"})
    for column in BOOLEAN_COLUMNS:
        if column in frame.columns:
            frame[column] = frame[column].map(_as_bool)
    for column in ["admission_fee", "minimum_age", "latitude", "longitude"]:
        if column in frame.columns:
            frame[column] = pd.to_numeric(frame[column], errors="coerce")
    return frame


def load_bookmarks() -> pd.DataFrame:
    if not BOOKMARKS_PATH.exists() or BOOKMARKS_PATH.stat().st_size == 0:
        return pd.DataFrame(columns=BOOKMARK_COLUMNS)
    frame = pd.read_csv(BOOKMARKS_PATH, encoding="utf-8-sig", dtype="string")
    for column in BOOKMARK_COLUMNS:
        if column not in frame.columns:
            frame[column] = pd.NA
    return frame[BOOKMARK_COLUMNS]


def _next_bookmark_id(bookmarks: pd.DataFrame) -> str:
    numbers: list[int] = []
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

    bookmarks = load_bookmarks()
    duplicate = (
        bookmarks["nickname"].fillna("").str.strip().eq(nickname)
        & bookmarks["place_id"].fillna("").str.strip().eq(place_id)
    )
    if duplicate.any():
        return False, "이미 즐겨찾기에 저장한 장소예요."

    new_row = pd.DataFrame(
        [
            {
                "bookmark_id": _next_bookmark_id(bookmarks),
                "nickname": nickname,
                "place_id": place_id,
                "created_at": datetime.now(ZoneInfo("Asia/Seoul")).strftime("%Y-%m-%d %H:%M:%S"),
            }
        ]
    )
    updated = pd.concat([bookmarks, new_row], ignore_index=True)[BOOKMARK_COLUMNS]
    DATA_DIR.mkdir(parents=True, exist_ok=True)
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
    if pd.isna(value) or str(value).strip() == "":
        return fallback
    return str(value).strip()


def safe_url(value: object) -> str | None:
    candidate = text(value, "")
    if not candidate:
        return None
    parsed = urlparse(candidate)
    return candidate if parsed.scheme in {"http", "https"} and parsed.netloc else None


def fee_label(row: pd.Series) -> str:
    if not bool(row.get("has_admission_fee", False)):
        return "무료"
    fee = row.get("admission_fee")
    return f"{int(fee):,}원부터" if pd.notna(fee) else "유료"


def badge_html(row: pd.Series) -> str:
    badges = [text(row.get("category_level_2")), text(row.get("space_type"))]
    labels = [
        ("free_parking", "무료주차"),
        ("nursing_room", "수유실"),
        ("stroller_rental", "유모차 대여"),
        ("diaper_changing_table", "기저귀교환대"),
        ("resident_discount", "도민 할인"),
    ]
    badges.extend(label for column, label in labels if bool(row.get(column, False)))
    return "".join(f'<span class="badge">{html.escape(label)}</span>' for label in badges)


def link_line(label: str, value: object) -> None:
    url = safe_url(value)
    if url:
        st.markdown(f"[{label}]({url})")


def show_place_detail(row: pd.Series) -> None:
    st.markdown("### 장소 상세정보")
    photo_url = safe_url(row.get("photo_url"))
    photo_col, info_col = st.columns([1, 1.6], gap="large")

    with photo_col:
        if photo_url and "example.com" not in photo_url:
            st.image(photo_url, use_container_width=True)
        else:
            st.markdown('<div class="empty-photo">🍊 장소 사진 준비 중</div>', unsafe_allow_html=True)

    with info_col:
        st.markdown(
            f"""
            <div class="detail-card">
              <div class="muted">{html.escape(text(row.get('region_group')))} · {html.escape(text(row.get('legal_dong_name')))}</div>
              <h2 style="margin:.25rem 0 .55rem;">{html.escape(text(row.get('place_name')))}</h2>
              <div>{badge_html(row)}</div>
              <p style="margin:.7rem 0 0;">{html.escape(text(row.get('description')))}</p>
            </div>
            """,
            unsafe_allow_html=True,
        )
        m1, m2, m3 = st.columns(3)
        m1.metric("운영시간", text(row.get("opening_hours"), "미정"))
        m2.metric("이용요금", fee_label(row))
        m3.metric("휴무일", text(row.get("closed_days"), "미정"))

    left, right = st.columns(2, gap="large")
    with left:
        st.markdown("#### 이용 정보")
        st.write(f"**주소**  {text(row.get('road_address'))}")
        st.write(f"**연락처**  {text(row.get('phone'))}")
        st.write(f"**요금 안내**  {text(row.get('admission_fee_detail'), fee_label(row))}")
        if bool(row.get("has_age_limit", False)) and pd.notna(row.get("minimum_age")):
            st.write(f"**권장 최소 연령**  {int(row['minimum_age'])}세")
        else:
            st.write("**연령 제한**  없음")
    with right:
        st.markdown("#### 방문 참고")
        st.write(text(row.get("review_summary"), "등록된 후기 요약이 없습니다."))
        link_line("홈페이지 열기 ↗", row.get("website_url"))
        link_line("예약 페이지 열기 ↗", row.get("reservation_url"))

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

places = load_places(str(PLACES_PATH))

st.markdown(
    """
    <div class="hero">
      <h1>제주아이랑 🍊</h1>
      <p>아이의 나이와 외출 상황에 맞는 제주 아이 동반 장소를 쉽고 빠르게 찾아보세요.</p>
    </div>
    """,
    unsafe_allow_html=True,
)

explore_tab, bookmark_tab = st.tabs(["🔎 장소 찾기", "⭐ 즐겨찾기"])

with explore_tab:
    preferred_regions = ["구좌/조천", "서귀포시", "성산/표선", "안덕/대정", "애월/한림", "제주시"]
    available_regions = [str(value) for value in places["region_group"].dropna().unique()]
    region_options = ["전체"] + [value for value in preferred_regions if value in available_regions]
    region_options += sorted(value for value in available_regions if value not in region_options)

    st.markdown("#### 어느 지역으로 갈까요?")
    selected_region = st.radio(
        "지역 선택",
        region_options,
        horizontal=True,
        label_visibility="collapsed",
    )

    with st.sidebar:
        st.markdown("## 조건으로 찾기")
        keyword = st.text_input("장소명 검색", placeholder="장소명 또는 설명")
        categories = st.multiselect(
            "시설 유형",
            sorted(places["category_level_2"].dropna().astype(str).unique()),
        )
        space_types = st.multiselect(
            "실내·실외",
            sorted(places["space_type"].dropna().astype(str).unique()),
        )
        st.markdown("##### 육아 편의시설")
        free_parking = st.checkbox("무료주차")
        nursing_room = st.checkbox("수유실")
        stroller = st.checkbox("유모차 대여")
        diaper_table = st.checkbox("기저귀교환대")
        resident_discount = st.checkbox("도민 할인")
        sort_option = st.selectbox("정렬", ["기본순", "이용요금 낮은 순", "장소명순"])
        st.caption("필터를 선택하면 결과가 바로 바뀝니다.")

    filtered = places.copy()
    if selected_region != "전체":
        filtered = filtered[filtered["region_group"].astype(str).eq(selected_region)]
    if keyword.strip():
        needle = keyword.strip()
        searchable = filtered[["place_name", "description", "review_summary"]].fillna("").astype(str)
        mask = searchable.apply(lambda column: column.str.contains(needle, case=False, regex=False)).any(axis=1)
        filtered = filtered[mask]
    if categories:
        filtered = filtered[filtered["category_level_2"].isin(categories)]
    if space_types:
        filtered = filtered[filtered["space_type"].isin(space_types)]
    for enabled, column in [
        (free_parking, "free_parking"),
        (nursing_room, "nursing_room"),
        (stroller, "stroller_rental"),
        (diaper_table, "diaper_changing_table"),
        (resident_discount, "resident_discount"),
    ]:
        if enabled:
            filtered = filtered[filtered[column]]

    if sort_option == "이용요금 낮은 순":
        filtered = filtered.assign(_fee=filtered["admission_fee"].fillna(float("inf"))).sort_values("_fee").drop(columns="_fee")
    elif sort_option == "장소명순":
        filtered = filtered.sort_values("place_name")

    count_col, free_col, indoor_col = st.columns(3)
    count_col.metric("검색 결과", f"{len(filtered)}곳")
    free_col.metric("무료 입장", f"{int((~filtered['has_admission_fee']).sum())}곳" if len(filtered) else "0곳")
    indoor_col.metric("실내 장소", f"{int(filtered['space_type'].eq('실내').sum())}곳" if len(filtered) else "0곳")

    if filtered.empty:
        st.info("선택한 조건에 맞는 장소가 없습니다. 필터를 조금 줄여 보세요.")
    else:
        st.markdown("### 장소 목록")
        list_frame = filtered.copy()
        list_frame["이용요금"] = list_frame.apply(fee_label, axis=1)
        list_frame = list_frame.rename(
            columns={
                "place_name": "장소명",
                "region_group": "지역",
                "category_level_2": "시설 유형",
                "space_type": "공간",
                "opening_hours": "운영시간",
            }
        )
        st.dataframe(
            list_frame[["장소명", "지역", "시설 유형", "공간", "운영시간", "이용요금"]],
            hide_index=True,
            use_container_width=True,
        )

        place_ids = filtered["place_id"].astype(str).tolist()
        place_names = dict(zip(filtered["place_id"].astype(str), filtered["place_name"].astype(str)))
        selected_id = st.selectbox(
            "상세정보를 볼 장소",
            place_ids,
            format_func=lambda value: place_names.get(value, value),
        )
        selected_row = filtered[filtered["place_id"].astype(str).eq(selected_id)].iloc[0]
        show_place_detail(selected_row)

with bookmark_tab:
    st.markdown("### 닉네임별 즐겨찾기")
    bookmarks = load_bookmarks()
    nickname_options = sorted(bookmarks["nickname"].dropna().astype(str).str.strip().unique())
    if not nickname_options:
        st.info("아직 저장된 즐겨찾기가 없습니다. 장소 상세에서 첫 장소를 저장해 보세요.")
    else:
        selected_nickname = st.selectbox("닉네임", nickname_options)
        mine = bookmarks[bookmarks["nickname"].fillna("").str.strip().eq(selected_nickname)].copy()
        mine = mine.merge(places, on="place_id", how="left").sort_values("created_at", ascending=False)
        st.caption(f"{selected_nickname}님이 저장한 장소 {len(mine)}곳")
        display = mine.rename(
            columns={
                "place_name": "장소명",
                "region_group": "지역",
                "category_level_2": "시설 유형",
                "space_type": "공간",
                "created_at": "저장 시각",
            }
        )
        st.dataframe(
            display[["장소명", "지역", "시설 유형", "공간", "저장 시각"]],
            hide_index=True,
            use_container_width=True,
        )
        bookmark_place_ids = mine["place_id"].dropna().astype(str).tolist()
        if bookmark_place_ids:
            bookmarked_id = st.selectbox(
                "상세정보를 볼 즐겨찾기",
                bookmark_place_ids,
                format_func=lambda value: text(
                    mine.loc[mine["place_id"].astype(str).eq(value), "place_name"].iloc[0], value
                ),
                key="bookmark_detail",
            )
            bookmarked_row = places[places["place_id"].astype(str).eq(bookmarked_id)]
            if not bookmarked_row.empty:
                show_place_detail(bookmarked_row.iloc[0])

