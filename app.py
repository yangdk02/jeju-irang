from __future__ import annotations

import hashlib
import hmac
import os
import secrets
import shutil
import tempfile
import time
from datetime import datetime
from html import escape
from pathlib import Path

import numpy as np
import pandas as pd
import pydeck as pdk
import streamlit as st
from PIL import Image
from streamlit_geolocation import streamlit_geolocation

try:
    from streamlit_gsheets import GSheetsConnection
except ImportError:  # 로컬에서 Google Sheet를 아직 설정하지 않은 경우
    GSheetsConnection = None

from form_links import build_update_form_url


APP_DIR = Path(__file__).resolve().parent
DATA_DIR = APP_DIR / "data"
ASSETS_DIR = APP_DIR / "assets"
WELCOME_IMAGE_PATH = ASSETS_DIR / "welcome-family-jeju.png"
FAVICON_PATH = ASSETS_DIR / "favicon.png"
PLACES_PATH = DATA_DIR / "jeju-irang.csv"
BOOKMARKS_PATH = DATA_DIR / "bookmarks.csv"
BOOKMARK_BACKUP_DIR = DATA_DIR / "backups"
BOOKMARK_SHEET_CONNECTION_NAME = "bookmarks"
BOOKMARK_SHEET_DEFAULT_WORKSHEET = "bookmarks"
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
PASSWORD_ITERATIONS = 200_000

GOOGLE_FORM_ENV_KEYS = {
    "new_place_url": "GOOGLE_FORM_NEW_PLACE_URL",
    "update_base_url": "GOOGLE_FORM_UPDATE_BASE_URL",
    "request_type_entry": "GOOGLE_FORM_REQUEST_TYPE_ENTRY",
    "target_place_name_entry": "GOOGLE_FORM_TARGET_PLACE_NAME_ENTRY",
    "location_hint_entry": "GOOGLE_FORM_LOCATION_HINT_ENTRY",
    "update_request_value": "GOOGLE_FORM_UPDATE_REQUEST_VALUE",
}

REGIONS = ["전체", "구좌/조천", "서귀포시", "성산/표선", "안덕/대정", "애월/한림", "제주시"]
FEATURE_FILTERS = {
    "입장료 없음": ("has_admission_fee", False),
    "연령제한 없음": ("has_age_limit", False),
    "수유실 있음": ("nursing_room", True),
    "유모차 대여 가능": ("stroller_rental", True),
    "기저귀 교환대 있음": ("diaper_changing_table", True),
    "도민 할인 있음": ("resident_discount", True),
}
PARKING_FEATURE_LABEL = "주차 가능"
BOOL_COLUMNS = list(dict.fromkeys(column for column, _ in FEATURE_FILTERS.values()))


st.set_page_config(
    page_title="제주아이랑",
    page_icon=Image.open(FAVICON_PATH),
    layout="wide",
    initial_sidebar_state="expanded",
)

st.markdown(
    """
    <style>
    @import url('https://cdn.jsdelivr.net/gh/orioncactus/pretendard/dist/web/static/pretendard.css');
    @import url('https://fonts.googleapis.com/css2?family=Jua&display=swap');
    :root {
        --jeju-ivory: #fff9f0;
        --jeju-orange: #ff9f1c;
        --jeju-orange-soft: #ffe2b8;
        --jeju-orange-deep: #e97e00;
        --jeju-yellow: #ffd166;
        --jeju-yellow-soft: #fff1c7;
        --jeju-mint: #82d4b7;
        --jeju-mint-soft: #ddf5ec;
        --jeju-sky: #79cfe3;
        --jeju-sky-soft: #ddf4f8;
        --jeju-pink: #f7b6c8;
        --jeju-pink-soft: #fce3ea;
        --jeju-brown: #49382f;
        --jeju-surface: #ffffff;
        --jeju-soft-surface: var(--jeju-ivory);
        --jeju-accent-soft: var(--jeju-orange-soft);
        --jeju-border: transparent;
        --jeju-muted: #796b63;
    }
    html, body, [data-testid="stApp"], [data-testid="stApp"] * {
        font-family: 'Pretendard', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
    }
    [data-testid="stIconMaterial"], .material-symbols-rounded, .material-symbols-outlined {
        font-family:'Material Symbols Rounded','Material Symbols Outlined' !important;
        font-weight:normal !important; font-style:normal !important; font-size:24px !important;
        line-height:1; letter-spacing:normal; text-transform:none; white-space:nowrap;
        word-wrap:normal; direction:ltr; -webkit-font-feature-settings:'liga';
        -webkit-font-smoothing:antialiased;
    }
    [data-testid="stApp"] {color:var(--jeju-brown);}
    h1, h2, h3, .page-title, .region-title, .section-title, .result-heading,
    .welcome-copy h2, .brand-name {
        font-family:'Jua', 'Pretendard', sans-serif !important;
        font-weight:400 !important;
        color:var(--jeju-brown) !important;
    }
    [data-testid="stApp"] {
        background:
            radial-gradient(circle at 8% 4%, color-mix(in srgb, #ffd89b 16%, transparent), transparent 28%),
            radial-gradient(circle at 92% 18%, color-mix(in srgb, #bcebdc 12%, transparent), transparent 25%),
            var(--jeju-ivory);
    }
    header[data-testid="stHeader"] {background: transparent;}
    [data-testid="stAppViewBlockContainer"],
    .block-container {
        max-width: 1320px;
        padding-top: 3.5rem;
        padding-bottom: 4rem;
    }
    [data-testid="stSidebar"] {
        background: color-mix(in srgb, var(--secondary-background-color) 92%, #fff8ec 8%);
        color: var(--text-color);
        border-right: 1px solid var(--jeju-border);
    }
    [data-testid="stSidebarContent"] {padding-top: 1.2rem;}
    [data-testid="stVerticalBlockBorderWrapper"] {
        border: 0 !important;
        border-radius: 22px !important;
        background: var(--jeju-surface);
        box-shadow: 0 10px 30px rgba(73, 56, 47, .10);
    }
    div[data-testid="stVerticalBlock"][class*="st-key-"] {border:0 !important;}
    .brand {
        display:flex; align-items:center; gap:1.25rem; min-height:3.4rem;
    }
    .brand-mark {
        position:relative; display:block; flex:0 0 auto; width:3.4rem; height:3.4rem;
        border-radius:48% 52% 50% 50%;
        background:
            radial-gradient(circle at 32% 34%, #fff 0 2px, transparent 3px),
            radial-gradient(circle at 55% 24%, #fff 0 1.5px, transparent 2.5px),
            var(--jeju-orange);
        box-shadow: 0 5px 14px color-mix(in srgb, var(--jeju-orange) 30%, transparent);
    }
    .brand-mark::before {
        content:""; position:absolute; width:1rem; height:.52rem; right:-.05rem; top:-.32rem;
        border-radius:100% 0 100% 0; background:var(--jeju-mint); transform:rotate(-20deg);
    }
    .brand-mark::after {
        content:"≈"; position:absolute; right:-.72rem; bottom:-.58rem;
        color:var(--jeju-sky); font-family:Arial,sans-serif; font-size:1.45rem; font-weight:900;
    }
    .brand-name {
        margin:0; font-size:clamp(2rem,4vw,3rem); font-weight:400;
        letter-spacing:-.035em; line-height:1; white-space:nowrap;
        color:var(--jeju-orange) !important;
    }
    .st-key-brand_header {
        margin-bottom:1rem; padding:1.35rem 1.55rem !important; border:0 !important;
        border-radius:0; background:transparent !important;
        box-shadow:none !important;
    }
    .st-key-brand_header [data-testid="stVerticalBlockBorderWrapper"] {
        padding: 1.15rem 1.55rem !important;
        background:transparent !important;
        border: 0 !important;
        box-shadow:none !important;
    }
    .st-key-brand_header [data-testid="stHorizontalBlock"] {align-items:center !important; min-height:4rem;}
    .st-key-brand_header [data-testid="stColumn"] {display:flex !important; align-items:center !important; min-height:4rem;}
    .st-key-brand_header [data-testid="stColumn"] > [data-testid="stVerticalBlock"] {
        width:100%; min-height:4rem; justify-content:center !important;
    }
    .st-key-brand_header [data-testid="stElementContainer"] {margin-top:0 !important; margin-bottom:0 !important;}
    .st-key-brand_header [data-testid="stColumn"]:first-child {position:relative;}
    .st-key-header_brand_link {
        position:absolute !important; left:0 !important; top:0 !important;
        width:20rem !important; max-width:100%; height:4rem !important; z-index:5; min-height:4rem;
    }
    .st-key-header_brand_link .stButton, .st-key-header_brand_link button {
        width:100% !important; height:100% !important; min-height:4rem !important;
        padding:0 !important; margin:0 !important; opacity:0; cursor:pointer;
    }
    .st-key-brand_header [data-testid="stColumn"]:first-child:has(.st-key-header_brand_link):hover .brand-name {
        color:#fff !important;
    }
    .st-key-header_bookmarks .stButton > button {
        min-height:4rem;
        padding:0 .45rem !important;
        border:0 !important;
        border-radius:0 !important;
        background:transparent !important;
        box-shadow:none !important;
        color: var(--jeju-brown) !important;
        font-family:'Pretendard',sans-serif !important;
        font-size:1.05rem !important;
        font-weight:750 !important;
        white-space:nowrap !important; word-break:keep-all !important;
    }
    .st-key-header_bookmarks .stButton > button p {
        font-family:'Pretendard',sans-serif !important;
        font-size:1.05rem !important; font-weight:750 !important; line-height:1.2 !important;
        white-space:nowrap !important; word-break:keep-all !important;
    }
    .st-key-header_bookmarks .stButton > button:hover,
    .st-key-header_bookmarks .stButton > button:focus {
        color: var(--jeju-orange-deep) !important;
        background:transparent !important;
        border-color:transparent !important;
    }
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
    .st-key-welcome_hero [data-testid="stVerticalBlockBorderWrapper"] {
        background:#fffdf8 !important; overflow:hidden; padding:1.1rem 1.2rem !important;
        border:0 !important; box-shadow:0 16px 42px rgba(73,56,47,.11) !important;
    }
    .st-key-welcome_hero {
        padding:1.1rem 1.2rem !important; overflow:hidden; border:0 !important;
        border-radius:22px; background:#fffdf8 !important;
        box-shadow:0 16px 42px rgba(73,56,47,.11) !important;
    }
    .welcome-copy {padding:2.3rem 1rem 1rem 1.6rem;}
    .welcome-copy h2 {font-size:clamp(2.5rem,4.6vw,4rem); line-height:1.15; letter-spacing:-.04em; margin:.2rem 0 1rem; font-weight:850 !important;}
    .welcome-copy p {font-size:1.1rem; line-height:1.7; color:var(--jeju-muted); margin:0 0 1.2rem;}
    .st-key-welcome_start_card [data-testid="stVerticalBlockBorderWrapper"] {
        background:#ffffff !important; border:0 !important; border-radius:20px !important;
        box-shadow:0 8px 24px rgba(73,56,47,.10) !important;
    }
    .st-key-welcome_start_card {
        padding:1rem !important; border:0 !important; border-radius:20px;
        background:#fff !important; box-shadow:0 8px 24px rgba(73,56,47,.10) !important;
    }
    .st-key-welcome_start_card h3 {font-size:1.45rem !important; font-weight:850 !important;}
    .st-key-welcome_start_card [data-testid="stCaptionContainer"] {
        width:100%; text-align:center; margin-top:.15rem;
    }
    .st-key-welcome_visual_image {padding:0 !important; overflow:hidden; border-radius:24px;}
    .st-key-welcome_visual_image [data-testid="stImage"] {margin:0 !important;}
    .st-key-welcome_visual_image [data-testid="stImage"] img {
        display:block; width:100% !important; height:auto !important;
        aspect-ratio:1372 / 1146 !important; object-fit:cover !important; object-position:center;
        border-radius:24px !important; box-shadow:0 12px 30px rgba(73,56,47,.12) !important;
    }
    .page-title {font-size: clamp(2rem, 4vw, 3rem); font-weight: 800; letter-spacing: -.045em; margin: .25rem 0 .3rem; color: var(--text-color);}
    .search-page-title {
        font-family:'Pretendard',sans-serif !important; font-weight:850 !important;
        letter-spacing:-.045em;
    }
    .quiet-proposal {
        margin:2rem 0 .2rem; text-align:center; color:var(--jeju-muted);
        font-size:.84rem; line-height:1.5;
    }
    .quiet-proposal a {
        color:var(--jeju-muted) !important; font-weight:650;
        text-decoration:underline !important; text-underline-offset:.2rem;
        text-decoration-color:#cfc2b8 !important;
    }
    .quiet-proposal a:hover {color:var(--jeju-orange-deep) !important;}
    .quiet-proposal .disabled {color:#aaa099; cursor:not-allowed;}
    .favorites-intro {display:flex; align-items:flex-end; justify-content:space-between; gap:2rem; padding:2rem .5rem 1.3rem;}
    .favorites-intro p {margin:.2rem 0 0; color:var(--jeju-muted);}
    .favorites-title {font-family:'Pretendard',sans-serif !important; font-weight:850 !important;}
    .st-key-favorites_controls {
        margin:.65rem 0 1rem; padding:1rem 1.15rem !important; border-radius:20px;
        background:#fff !important; box-shadow:0 8px 22px rgba(73,56,47,.08) !important;
    }
    .st-key-favorites_controls [data-testid="stButtonGroup"] button {
        border:0 !important; border-radius:999px !important; background:var(--jeju-pink-soft) !important;
        color:var(--jeju-brown) !important; font-weight:750 !important;
    }
    .st-key-favorites_controls [data-testid="stButtonGroup"] button[aria-pressed="true"] {
        background:var(--jeju-pink) !important; color:var(--jeju-brown) !important;
    }
    .result-heading {display: flex; align-items: center; gap: .7rem; margin: 1.35rem 0 .7rem; font-size: 1.55rem; font-weight: 760;}
    .search-result-heading, .favorites-result-heading {font-weight:850 !important;}
    .result-heading b {font-size:.85rem; color:var(--jeju-brown); background:var(--jeju-yellow-soft); border-radius:999px; padding:.35rem .65rem;}
    .detail-recommend-heading {margin-top:2.2rem; margin-bottom:.85rem; font-weight:850 !important;}
    .region-title {font-size: 1.55rem; font-weight: 780; letter-spacing: -.035em; margin-bottom: .15rem;}
    .section-title {font-size: 1.45rem; font-weight: 760; color: var(--text-color); margin: .8rem 0 .3rem;}
    [data-testid="stImage"] img {
        aspect-ratio: 16 / 9; object-fit: cover; border-radius: 20px;
        border:0;
        box-shadow:0 8px 22px rgba(73,56,47,.10);
    }
    .photo-placeholder {
        display: grid; place-items: center; aspect-ratio: 16 / 9; border-radius: 20px 20px 0 0;
        background: linear-gradient(135deg, var(--jeju-sky-soft), var(--jeju-mint-soft));
        border:0; font-size: 3rem;
        box-shadow:0 8px 22px rgba(73,56,47,.10);
    }
    .place-card {
        min-height:165px; padding:1.1rem 1.15rem; border:0;
        border-radius: 20px; background: var(--jeju-surface);
        box-shadow:0 10px 26px rgba(73,56,47,.10);
    }
    .place-card h3 {margin: .35rem 0 .45rem; font-size: 1.22rem; color: var(--text-color); letter-spacing: -.025em;}
    .place-card p {margin: .25rem 0; color: var(--jeju-muted); font-size: .91rem;}
    .favorite-card {min-height:175px; background:linear-gradient(145deg,#fff,var(--jeju-pink-soft));}
    div[data-testid="stVerticalBlock"][class*="st-key-place_card_"],
    div[data-testid="stVerticalBlock"][class*="st-key-favorite_card_"] {
        min-height:180px; padding:1rem 1.1rem !important; border-radius:20px;
        background:#fff; box-shadow:0 10px 26px rgba(73,56,47,.10);
        gap:.3rem !important;
    }
    div[class*="st-key-place_name_"],
    div[class*="st-key-favorite_name_"] {
        min-height:3.5rem; display:flex; align-items:center; margin:0 !important;
        position:relative; transform:translateY(.55rem); z-index:1;
    }
    div[class*="st-key-place_name_"] button,
    div[class*="st-key-favorite_name_"] button {
        justify-content:flex-start !important; width:100%; padding:.45rem 0 .35rem !important;
        color:var(--jeju-brown) !important; font-family:'Pretendard',sans-serif !important;
        font-size:1.5rem !important; font-weight:850 !important; line-height:1.25 !important;
        text-align:left !important;
    }
    div[class*="st-key-place_name_"] button p,
    div[class*="st-key-favorite_name_"] button p {
        font-family:'Pretendard',sans-serif !important; font-size:1.5rem !important;
        font-weight:850 !important; line-height:1.25 !important; text-align:left !important;
    }
    div[class*="st-key-place_name_"] button:hover,
    div[class*="st-key-favorite_name_"] button:hover {
        color:var(--jeju-orange-deep) !important; text-decoration:underline;
    }
    .place-card-copy p {margin:.25rem 0; color:var(--jeju-muted); font-size:.91rem;}
    .saved-at {color:color-mix(in srgb, var(--jeju-pink) 60%, var(--text-color)) !important; font-size:.82rem !important;}
    .tag {
        display:inline-block; background:var(--jeju-mint-soft); color:var(--jeju-brown);
        border:0; border-radius:999px;
        padding: .22rem .58rem; margin: .1rem .18rem .1rem 0; font-size: .8rem;
    }
    .info-box {
        padding:1rem 1.1rem; border-radius:16px; background:var(--jeju-sky-soft);
        border:0; margin-bottom:.6rem; box-shadow:0 6px 18px rgba(73,56,47,.07);
    }
    .info-label {color: var(--jeju-muted); font-size: .84rem; margin-bottom: .22rem;}
    .info-value {color: var(--text-color); white-space: pre-wrap; overflow-wrap: anywhere;}
    .st-key-detail_photo [data-testid="stImage"] img {
        width:100%; height:360px; aspect-ratio:auto; object-fit:cover; border-radius:24px;
        box-shadow:0 12px 30px rgba(73,56,47,.12);
    }
    .detail-photo-placeholder {
        width:100%; height:360px; display:grid; place-items:center; border-radius:24px;
        background:linear-gradient(135deg,var(--jeju-sky-soft),var(--jeju-mint-soft));
        color:var(--jeju-brown); font-weight:900; font-size:clamp(1.2rem,2.5vw,2rem);
        letter-spacing:.12em; box-shadow:0 12px 30px rgba(73,56,47,.10);
    }
    .detail-summary-card {
        margin:1rem 0 .75rem; padding:1.7rem 2rem; border-radius:22px; background:#fff;
        box-shadow:0 10px 28px rgba(73,56,47,.10);
    }
    .detail-summary-card h1 {margin:0 0 .35rem; font-size:clamp(2rem,4vw,2.8rem); font-weight:850 !important;}
    .detail-actions {
        display:grid; grid-template-columns:repeat(2,minmax(8rem,1fr));
        gap:.55rem; width:100%; max-width:21rem; margin:.25rem 0 1rem;
    }
    .detail-mini-link {
        display:inline-flex; align-items:center; justify-content:center; gap:.3rem; padding:.55rem .75rem;
        border-radius:999px; background:var(--jeju-yellow-soft); color:var(--jeju-brown) !important;
        text-decoration:none !important; font-size:.86rem; font-weight:800;
        box-shadow:0 4px 12px rgba(73,56,47,.08); transition:transform .15s ease;
    }
    .detail-mini-link.reserve {background:var(--jeju-pink-soft);}
    .detail-mini-link:not(.disabled):hover {transform:translateY(-1px);}
    .detail-mini-link.disabled {
        background:#eee9e4; color:#aaa099 !important; box-shadow:none;
        cursor:not-allowed; filter:saturate(.35);
    }
    .detail-description {margin:.15rem 0 .65rem; color:var(--jeju-muted); font-size:1.05rem;}
    .detail-tags {margin-bottom:.7rem;}
    .detail-core-row {
        display:grid; grid-template-columns:2rem 6rem minmax(0,1fr); gap:.5rem;
        align-items:start; padding:.72rem 0; border-bottom:1px solid #f3ece4;
    }
    .detail-core-row:last-child {border-bottom:0;}
    .detail-core-row b {font-size:.92rem;}
    .detail-core-row span:last-child {color:#6f6056; white-space:pre-wrap; overflow-wrap:anywhere;}
    .detail-check {margin:.55rem 0; color:#68584f; line-height:1.5;}
    .detail-check::before {
        content:"✓"; display:inline-grid; place-items:center; width:1.3rem; height:1.3rem;
        margin-right:.5rem; border-radius:50%; background:var(--jeju-mint); color:#fff;
        font-size:.72rem; font-weight:900;
    }
    .st-key-detail_points, .st-key-detail_visit, .st-key-detail_map {
        height:360px; min-height:360px; padding:1rem !important; border-radius:20px;
        box-sizing:border-box; overflow-y:auto;
    }
    div[data-testid="stVerticalBlock"].st-key-detail_points {background:#fff !important; border:1px solid var(--jeju-mint) !important;}
    div[data-testid="stVerticalBlock"].st-key-detail_visit {background:#fff !important; border:1px solid var(--jeju-yellow) !important;}
    div[data-testid="stVerticalBlock"].st-key-detail_map {background:#fff !important; border:1px solid var(--jeju-sky) !important;}
    .st-key-detail_points h3, .st-key-detail_visit h3, .st-key-detail_map h3 {
        margin:.1rem 0 .8rem !important; font-size:1.1rem !important;
        line-height:1.35 !important; letter-spacing:-.02em !important; font-weight:850 !important;
    }
    .st-key-detail_map [data-testid="stDeckGlJsonChart"] {
        width:100% !important; max-width:280px !important; height:auto !important;
        aspect-ratio:4 / 3 !important; margin:0 auto !important;
        overflow:hidden; border-radius:14px;
    }
    .st-key-detail_map [data-testid="stElementContainer"]:has([data-testid="stDeckGlJsonChart"]) {
        height:210px !important; min-height:210px !important; overflow:hidden;
    }
    .st-key-detail_map [data-testid="stDeckGlJsonChart"] > div,
    .st-key-detail_map [data-testid="stDeckGlJsonChart"] canvas {
        width:100% !important; height:100% !important;
    }
    .muted {color: var(--jeju-muted);}
    .spacer {height: 1.3rem;}
    [data-testid="stMetric"] {background:var(--jeju-mint-soft); border:0; border-radius:16px; padding:.8rem; box-shadow:0 6px 16px rgba(73,56,47,.07);}
    .st-key-search_filter_panel [data-testid="stVerticalBlockBorderWrapper"] {
        background:#effaf7 !important; border:1px solid #9dddc8 !important;
        box-shadow:0 10px 28px rgba(73,56,47,.09) !important;
    }
    div[data-testid="stVerticalBlock"].st-key-search_filter_panel {
        padding:1rem !important; border:1px solid #9dddc8 !important; border-radius:22px;
        background:#effaf7 !important;
        box-shadow:0 10px 28px rgba(73,56,47,.09) !important;
    }
    .st-key-search_filter_panel [data-testid="stButtonGroup"] button {
        border:0 !important; border-radius:999px !important; background:#fff !important;
        color:var(--jeju-brown) !important; font-weight:750 !important;
        box-shadow:0 4px 12px rgba(73,56,47,.08) !important;
    }
    .st-key-search_filter_panel [data-testid="stButtonGroup"] button[aria-pressed="true"] {
        background:var(--jeju-orange) !important; color:#fff !important;
        box-shadow:0 6px 14px rgba(255,159,28,.25) !important;
    }
    .st-key-favorites_lookup_panel [data-testid="stVerticalBlockBorderWrapper"] {
        background:linear-gradient(120deg,#fff,var(--jeju-pink-soft)) !important;
        border:0 !important; box-shadow:0 10px 28px rgba(73,56,47,.09) !important;
    }
    .st-key-favorites_lookup_panel {
        padding:1rem !important; border:0 !important; border-radius:22px;
        background:linear-gradient(120deg,#fff,var(--jeju-pink-soft)) !important;
        box-shadow:0 10px 28px rgba(73,56,47,.09) !important;
    }
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
    div[role="radiogroup"] {background:transparent !important; border:0; border-radius:16px; padding:.35rem .7rem;}
    @media (max-width: 768px) {
        [data-testid="stAppViewBlockContainer"],
        .block-container {padding-top:3.5rem;}
        .home-hero {padding: 2rem 1.35rem 7rem;}
        .home-hero::after {right: 5%; bottom: 5%; font-size: 2.5rem;}
        .brand p {display: none;}
        .brand-name {font-size:2rem;}
        .brand-mark {width:2.8rem; height:2.8rem;}
        .st-key-brand_header {padding-left:.75rem !important; padding-right:.75rem !important;}
        .st-key-brand_header [data-testid="stHorizontalBlock"] {
            flex-wrap:nowrap !important; gap:.65rem !important;
        }
        .st-key-brand_header [data-testid="stColumn"]:first-child {
            flex:1 1 auto !important; width:auto !important; min-width:0 !important;
        }
        .st-key-brand_header [data-testid="stColumn"]:last-child {
            flex:0 0 7.4rem !important; width:7.4rem !important; min-width:7.4rem !important;
        }
        .st-key-header_bookmarks .stButton > button,
        .st-key-header_bookmarks .stButton > button p {
            font-size:.95rem !important;
        }
        div[class*="st-key-place_name_"] button,
        div[class*="st-key-favorite_name_"] button,
        div[class*="st-key-place_name_"] button p,
        div[class*="st-key-favorite_name_"] button p {font-size:1.3rem !important;}
        .st-key-detail_photo [data-testid="stImage"] img, .detail-photo-placeholder {height:240px;}
        .detail-summary-card {padding:1.25rem;}
        .detail-actions {max-width:none; grid-template-columns:repeat(2,minmax(0,1fr));}
        .detail-core-row {grid-template-columns:1.7rem 5.2rem minmax(0,1fr);}
        .st-key-detail_points, .st-key-detail_visit, .st-key-detail_map {
            height:auto; min-height:auto; overflow-y:visible;
        }
        .st-key-detail_points, .st-key-detail_visit {
            padding-bottom:1.75rem !important;
        }
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


def get_google_form_settings() -> dict[str, str]:
    settings: dict[str, str] = {}
    try:
        secret_section = st.secrets.get("google_form", {})
    except (FileNotFoundError, KeyError, AttributeError):
        secret_section = {}
    for key, env_key in GOOGLE_FORM_ENV_KEYS.items():
        secret_value = secret_section.get(key, "") if secret_section else ""
        settings[key] = str(secret_value or os.getenv(env_key, "")).strip()
    settings["update_request_value"] = (
        settings["update_request_value"] or "기존 장소 수정"
    )
    return settings


def get_place_update_form_url(place: pd.Series) -> str:
    location_hint = clean_text(place.get("road_address"), "")
    if not location_hint:
        location_hint = " ".join(
            value
            for value in (
                clean_text(place.get("city_name"), ""),
                clean_text(place.get("legal_dong_name"), ""),
            )
            if value
        )
    return build_update_form_url(
        get_google_form_settings(),
        clean_text(place.get("place_name"), ""),
        location_hint,
    )


def render_quiet_proposal_link(label: str, url: str) -> None:
    if url:
        content = (
            f'<a href="{escape(url, quote=True)}" target="_blank" '
            f'rel="noopener noreferrer">{escape(label)}</a>'
        )
    else:
        content = (
            f'<span class="disabled" title="Google Form 설정이 필요합니다">'
            f'{escape(label)}</span>'
        )
    st.markdown(
        f'<div class="quiet-proposal">{content}</div>',
        unsafe_allow_html=True,
    )


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


def normalize_bookmarks(frame: pd.DataFrame) -> pd.DataFrame:
    normalized = frame.copy()
    normalized.columns = [str(column).strip() for column in normalized.columns]
    normalized = normalized.dropna(how="all")
    for column in BOOKMARK_COLUMNS:
        if column not in normalized.columns:
            normalized[column] = pd.NA
    return normalized[BOOKMARK_COLUMNS].astype("string")


def load_local_bookmarks() -> pd.DataFrame:
    if not BOOKMARKS_PATH.exists() or BOOKMARKS_PATH.stat().st_size == 0:
        return empty_bookmarks()
    try:
        frame = pd.read_csv(BOOKMARKS_PATH, dtype="string")
    except (pd.errors.EmptyDataError, UnicodeDecodeError):
        return empty_bookmarks()
    return normalize_bookmarks(frame)


def bookmark_sheet_settings() -> tuple[bool, str, str]:
    try:
        connections = st.secrets.get("connections", {})
    except (FileNotFoundError, KeyError, AttributeError):
        return (
            False,
            BOOKMARK_SHEET_CONNECTION_NAME,
            BOOKMARK_SHEET_DEFAULT_WORKSHEET,
        )

    # 전용 연결을 우선 사용하고, 기존 프로젝트의 [connections.gsheets]
    # 서비스 계정 연결이 있으면 같은 Spreadsheet의 bookmarks 탭을 재사용합니다.
    for connection_name in (BOOKMARK_SHEET_CONNECTION_NAME, "gsheets"):
        settings = connections.get(connection_name, {})
        spreadsheet = str(settings.get("spreadsheet", "")).strip()
        connection_type = str(settings.get("type", "")).strip()
        if spreadsheet and connection_type == "service_account":
            worksheet = (
                str(settings.get("worksheet", "")).strip()
                if connection_name == BOOKMARK_SHEET_CONNECTION_NAME
                else BOOKMARK_SHEET_DEFAULT_WORKSHEET
            )
            return (
                True,
                connection_name,
                worksheet or BOOKMARK_SHEET_DEFAULT_WORKSHEET,
            )
    return (
        False,
        BOOKMARK_SHEET_CONNECTION_NAME,
        BOOKMARK_SHEET_DEFAULT_WORKSHEET,
    )


def bookmark_sheet_connection(connection_name: str):
    if GSheetsConnection is None:
        raise RuntimeError(
            "Google Sheet 연결 모듈이 없습니다. requirements.txt의 "
            "st-gsheets-connection 설치를 확인해 주세요."
        )
    return st.connection(
        connection_name,
        type=GSheetsConnection,
    )


def load_bookmarks() -> pd.DataFrame:
    use_google_sheet, connection_name, worksheet = bookmark_sheet_settings()
    if not use_google_sheet:
        return load_local_bookmarks()
    try:
        frame = bookmark_sheet_connection(connection_name).read(
            worksheet=worksheet,
            ttl=0,
        )
        return normalize_bookmarks(frame)
    except Exception:
        st.error(
            "즐겨찾기 Google Sheet를 불러오지 못했습니다. "
            "잠시 후 다시 시도하거나 관리자에게 알려 주세요."
        )
        st.stop()


def write_bookmarks(frame: pd.DataFrame) -> bool:
    normalized = normalize_bookmarks(frame).fillna("")
    use_google_sheet, connection_name, worksheet = bookmark_sheet_settings()
    if use_google_sheet:
        try:
            bookmark_sheet_connection(connection_name).update(
                worksheet=worksheet,
                data=normalized,
            )
            return True
        except Exception:
            st.error(
                "즐겨찾기 Google Sheet에 저장하지 못했습니다. "
                "입력 내용은 반영되지 않았으니 잠시 후 다시 시도해 주세요."
            )
            return False

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
        normalized.to_csv(temp_name, index=False, encoding="utf-8-sig")
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
        "selected_region": [],
        "search_query": "",
        "category_filter": [],
        "space_filter": [],
        "feature_filter": [],
        "sort_order": "기본순",
        "view_mode": "갤러리 보기",
        "user_latitude": None,
        "user_longitude": None,
        "user_location_accuracy": None,
        "ignore_location_result": False,
        "nickname": "",
        "bookmark_save_password": "",
        "bookmark_lookup": "",
        "bookmark_lookup_password": "",
        "welcome_nickname": "",
        "welcome_password": "",
        "welcome_started": False,
        "bookmark_authenticated_nickname": None,
        "bookmark_delete_pending": None,
        "bookmark_view_mode": "갤러리 보기",
        "bookmark_category_filter": "전체",
    }
    for key, value in defaults.items():
        if key not in st.session_state:
            st.session_state[key] = value
    if isinstance(st.session_state.selected_region, str):
        st.session_state.selected_region = [] if st.session_state.selected_region == "전체" else [st.session_state.selected_region]
    if isinstance(st.session_state.get("_selected_region_widget"), str):
        previous_region = st.session_state._selected_region_widget
        st.session_state._selected_region_widget = [] if previous_region == "전체" else [previous_region]
    # Streamlit normally removes widget keys when their page is not rendered.
    # Reassigning them keeps the list controls stable while the detail page is open.
    for key in (
        "selected_region",
        "search_query",
        "category_filter",
        "space_filter",
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
    st.session_state.selected_region = [] if region == "전체" else [region]
    st.session_state.page = "list"


def reset_filters() -> None:
    reset_values = {
        "selected_region": [],
        "search_query": "",
        "category_filter": [],
        "space_filter": [],
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
    is_welcome = st.session_state.page == "home"
    with st.container(border=True, key="brand_header"):
        if is_welcome:
            st.markdown(
                """
                <div class="brand">
                    <div class="brand-mark" role="img" aria-label="감귤, 잎, 바다 물결 로고"></div>
                    <div class="brand-name">제주아이랑</div>
                </div>
                """,
                unsafe_allow_html=True,
            )
        else:
            brand, bookmark_nav = st.columns([6, 1.15], vertical_alignment="center")
            with brand:
                st.markdown(
                    """
                    <div class="brand">
                        <div class="brand-mark" role="img" aria-label="감귤, 잎, 바다 물결 로고"></div>
                        <div class="brand-name">제주아이랑</div>
                    </div>
                    """,
                    unsafe_allow_html=True,
                )
                st.button(
                    "장소 찾기로 이동",
                    key="header_brand_link",
                    on_click=go_to,
                    args=("list",),
                )
            with bookmark_nav:
                st.button(
                    "♥ 즐겨찾기",
                    key="header_bookmarks",
                    type="tertiary",
                    use_container_width=True,
                    on_click=go_to,
                    args=("bookmarks",),
                )


def display_tags(place: pd.Series, include_region: bool = True) -> str:
    values = []
    if include_region:
        values.append(clean_text(place.get("region_group"), ""))
    values.append(clean_text(place.get("space_type"), ""))
    values.append(clean_text(place.get("category"), ""))
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
                with st.container(key=f"place_card_{key_prefix}_{place['place_id']}"):
                    st.markdown(f'<div>{display_tags(place)}</div>', unsafe_allow_html=True)
                    st.button(
                        clean_text(place.get("place_name")),
                        key=f"place_name_{key_prefix}_{place['place_id']}",
                        type="tertiary",
                        use_container_width=True,
                        on_click=go_to,
                        args=("detail", str(place["place_id"])),
                    )
                    st.markdown(
                        f"""
                        <div class="place-card-copy">
                            <p>{escape(description)}</p>
                            <p>📍 {escape(location or '위치 정보 없음')}</p>
                            {distance_line}
                        </div>
                        """,
                        unsafe_allow_html=True,
                    )


def render_home(places: pd.DataFrame) -> None:
    del places
    with st.container(border=True, key="welcome_hero"):
        copy_col, visual_col = st.columns([.9, 1.1], gap="large", vertical_alignment="center")
        with copy_col:
            st.markdown(
                """
                <div class="welcome-copy">
                    <h2>오늘 아이랑<br>어디 갈까요?</h2>
                    <p>우리 가족에게 맞는 제주 나들이 장소를 찾아보세요.</p>
                </div>
                """,
                unsafe_allow_html=True,
            )
            with st.container(border=True, key="welcome_start_card"):
                st.markdown("### 🍊 닉네임으로 시작하기")
                welcome_nickname = st.text_input(
                    "닉네임",
                    key="welcome_nickname",
                    max_chars=30,
                    placeholder="닉네임을 입력해 주세요",
                )
                welcome_password = st.text_input(
                    "비밀번호",
                    key="welcome_password",
                    type="password",
                    max_chars=50,
                    placeholder="비밀번호를 4자 이상 입력해 주세요",
                )
                if st.button("제주아이랑 시작하기", type="primary", use_container_width=True):
                    normalized = welcome_nickname.strip()
                    if not normalized:
                        st.warning("닉네임을 입력해 주세요.")
                    elif len(welcome_password) < 4:
                        st.warning("비밀번호를 4자 이상 입력해 주세요.")
                    else:
                        bookmarks = load_bookmarks()
                        same_nickname = nickname_mask(bookmarks, normalized)
                        protected = bookmarks[
                            same_nickname
                            & bookmarks["password_salt"].fillna("").str.strip().ne("")
                            & bookmarks["password_hash"].fillna("").str.strip().ne("")
                        ]
                        if not protected.empty and not verify_password(
                            welcome_password,
                            protected.iloc[0]["password_salt"],
                            protected.iloc[0]["password_hash"],
                        ):
                            st.error("이 닉네임에 설정된 비밀번호와 일치하지 않습니다.")
                        else:
                            st.session_state.nickname = normalized
                            st.session_state.bookmark_save_password = welcome_password
                            st.session_state.bookmark_lookup = normalized
                            st.session_state.bookmark_lookup_password = welcome_password
                            st.session_state.welcome_started = True
                            st.session_state.selected_region = []
                            go_to("list")
                            st.rerun()
                st.caption("♥ 가입 없이 바로 시작할 수 있어요")
        with visual_col:
            with st.container(key="welcome_visual_image"):
                st.image(
                    WELCOME_IMAGE_PATH,
                    caption=None,
                    width="stretch",
                )


def filter_places(places: pd.DataFrame) -> pd.DataFrame:
    result = places.copy()
    selected_regions = st.session_state.selected_region
    if selected_regions:
        result = result[result["region_group"].isin(selected_regions)]

    query = st.session_state.search_query.strip()
    if query:
        result = result[result["place_name"].fillna("").str.contains(query, case=False, regex=False)]

    for state_key, column in (
        ("category_filter", "category"),
        ("space_filter", "space_type"),
    ):
        selected = st.session_state[state_key]
        if selected:
            result = result[result[column].isin(selected)]

    # Every selected convenience/use condition must match (AND).
    for label in st.session_state.feature_filter:
        if label == PARKING_FEATURE_LABEL:
            result = result[result["parking"].isin(["무료", "유료", "무료/유료 주차"])]
            continue
        if label not in FEATURE_FILTERS:
            continue
        column, required_value = FEATURE_FILTERS[label]
        result = result[result[column].fillna(not required_value).eq(required_value)]
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
    st.markdown("**내 위치** · 거리순 정렬")
    st.caption("위치 버튼을 누르면 가까운 장소부터 볼 수 있어요.")
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
        st.caption("권한 요청이 나타나면 ‘허용’을 선택하세요.")


def active_filter_labels() -> list[str]:
    labels = []
    labels.extend(st.session_state.selected_region)
    labels.extend(st.session_state.space_filter)
    labels.extend(st.session_state.category_filter)
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


def open_selected_map_place(state_key: str = "places_map") -> None:
    state = st.session_state.get(state_key)
    selection = state.get("selection", {}) if state else {}
    selected_objects = selection.get("objects", {}).get("places", [])
    if selected_objects:
        go_to("detail", str(selected_objects[0]["place_id"]))


def open_selected_bookmark_map_place() -> None:
    open_selected_map_place("bookmarks_map")


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


def render_place_map(
    frame: pd.DataFrame,
    chart_key: str = "places_map",
    on_select=open_selected_map_place,
) -> None:
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
            key=chart_key,
            on_select=on_select,
            selection_mode="single-object",
        )
        missing_count = len(frame) - len(map_frame)
        if missing_count:
            st.caption(f"위도·경도가 없는 {missing_count}곳은 지도에서 제외했습니다.")


def render_list(places: pd.DataFrame) -> None:
    st.markdown('<div class="page-title search-page-title">아이와 어디로 떠나볼까요?</div>', unsafe_allow_html=True)
    st.caption("조건을 선택하면 우리 가족에게 맞는 장소를 찾아드려요.")

    search_field, search_action = st.columns([6, 1], vertical_alignment="bottom")
    with search_field:
        st.session_state.search_query = st.text_input(
            "장소 검색",
            key=prepare_filter_widget("search_query"),
            placeholder="장소 이름이나 키워드를 검색해 보세요",
            label_visibility="collapsed",
        )
    with search_action:
        st.button("검색", type="primary", use_container_width=True)

    with st.container(border=True, key="search_filter_panel"):
        region_col, space_col = st.columns(2)
        with region_col:
            st.markdown("**지역** · 여러 개 선택 가능")
            st.session_state.selected_region = st.pills(
                "지역",
                REGIONS[1:],
                selection_mode="multi",
                key=prepare_filter_widget("selected_region"),
                label_visibility="collapsed",
                format_func=lambda value: f"📍 {value}",
            )
        with space_col:
            st.markdown("**공간** · 여러 개 선택 가능")
            available_spaces = set(places["space_type"].dropna().astype(str).unique())
            space_options = [
                value for value in ["실내", "실외", "실내/실외"]
                if value in available_spaces
            ]
            st.session_state.space_filter = st.pills(
                "실내외 구분",
                space_options,
                selection_mode="multi",
                key=prepare_filter_widget("space_filter"),
                label_visibility="collapsed",
                format_func=lambda value: f"{'🏠' if value == '실내' else '🌿'} {value}",
            )

        category_col, feature_col = st.columns(2)
        with category_col:
            st.markdown("**시설유형** · 여러 개 선택 가능")
            category_icons = ["🎨", "🐬", "🌳", "🧸", "🏛️", "🎡"]
            category_options = sorted(places["category"].dropna().astype(str).unique())
            category_icon_map = {
                value: category_icons[index % len(category_icons)]
                for index, value in enumerate(category_options)
            }
            st.session_state.category_filter = st.pills(
                "시설유형",
                category_options,
                selection_mode="multi",
                key=prepare_filter_widget("category_filter"),
                label_visibility="collapsed",
                format_func=lambda value: f"{category_icon_map[value]} {value}",
            )
        with feature_col:
            st.markdown("**편의시설 · 이용조건** · 선택한 조건 모두 충족 (AND)")
            feature_icons = {
                "입장료 없음": "🆓", "연령제한 없음": "👨‍👩‍👧",
                "수유실 있음": "🍼", "유모차 대여 가능": "🛒",
                "기저귀 교환대 있음": "👶", "도민 할인 있음": "🍊",
                PARKING_FEATURE_LABEL: "🚗",
            }
            st.session_state.feature_filter = st.pills(
                "편의·이용 조건 (모두 충족)",
                [*FEATURE_FILTERS, PARKING_FEATURE_LABEL],
                selection_mode="multi",
                key=prepare_filter_widget("feature_filter"),
                label_visibility="collapsed",
                format_func=lambda value: f"{feature_icons[value]} {value}",
                help="선택한 모든 조건을 충족하는 장소만 표시합니다.",
            )
        location_col, _ = st.columns(2)
        with location_col:
            render_location_control()
        st.button("필터 초기화 ↻", key="main_filter_reset", on_click=reset_filters)

    sort_col, view_col = st.columns([1, 2], vertical_alignment="bottom")
    with sort_col:
        st.session_state.sort_order = st.selectbox(
            "정렬",
            ["기본순", "장소명순 (가나다)", "거리순"],
            key=prepare_filter_widget("sort_order"),
        )
    with view_col:
        st.session_state.view_mode = st.radio(
            "보기 형식",
            ["갤러리 보기", "표로 보기", "지도 보기"],
            horizontal=True,
            key=prepare_filter_widget("view_mode"),
        )

    if st.session_state.sort_order == "거리순" and st.session_state.user_latitude is None:
        st.warning("거리순을 사용하려면 필터의 ‘내 위치’에서 위치를 허용해 주세요.")

    filtered = filter_places(places)
    selected_categories = st.session_state.category_filter
    if len(selected_categories) == 1:
        title = f"{selected_categories[0]} 장소 목록"
    elif len(selected_categories) > 1:
        title = "선택한 시설유형 장소 목록"
    else:
        title = "우리 가족을 위한 추천 장소"

    labels = active_filter_labels()
    if labels:
        st.markdown(" ".join(f'<span class="tag">{label}</span>' for label in labels), unsafe_allow_html=True)

    st.markdown(
        f'<div class="result-heading search-result-heading"><span>{title}</span><b>{len(filtered):,}곳</b></div>',
        unsafe_allow_html=True,
    )

    if filtered.empty:
        st.info("조건에 맞는 장소가 없어요. 필터를 바꿔보세요.")
        st.button("모든 조건 초기화", on_click=reset_filters)
        render_quiet_proposal_link(
            "＋ 장소 제안하기",
            get_google_form_settings().get("new_place_url", ""),
        )
        return

    if st.session_state.view_mode == "표로 보기":
        render_place_table(filtered)
    elif st.session_state.view_mode == "지도 보기":
        render_place_map(filtered)
    else:
        render_place_grid(filtered, "list_place")
    render_quiet_proposal_link(
        "＋ 장소 제안하기",
        get_google_form_settings().get("new_place_url", ""),
    )


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


def current_place_is_saved(place_id: str) -> bool:
    nickname = st.session_state.nickname.strip()
    if not nickname:
        return False
    bookmarks = load_bookmarks()
    return bool(
        (
            nickname_mask(bookmarks, nickname)
            & bookmarks["place_id"].astype(str).eq(str(place_id))
        ).any()
    )


def toggle_current_bookmark(place_id: str) -> None:
    nickname = st.session_state.nickname.strip()
    password = st.session_state.bookmark_save_password
    if not nickname or len(password) < 4:
        st.session_state.bookmark_flash = ("error", "로그인 정보가 없습니다. 시작 화면에서 다시 로그인해 주세요.")
        return

    bookmarks = load_bookmarks()
    same_nickname = nickname_mask(bookmarks, nickname)
    protected = bookmarks[
        same_nickname
        & bookmarks["password_salt"].fillna("").str.strip().ne("")
        & bookmarks["password_hash"].fillna("").str.strip().ne("")
    ]
    if not protected.empty:
        credential = protected.iloc[0]
        salt = str(credential["password_salt"])
        digest = str(credential["password_hash"])
        if not verify_password(password, salt, digest):
            st.session_state.bookmark_flash = ("error", "비밀번호가 일치하지 않아 저장 상태를 변경하지 못했습니다.")
            return
        legacy_rows = same_nickname & (
            bookmarks["password_salt"].fillna("").str.strip().eq("")
            | bookmarks["password_hash"].fillna("").str.strip().eq("")
        )
        bookmarks.loc[legacy_rows, "password_salt"] = salt
        bookmarks.loc[legacy_rows, "password_hash"] = digest
    else:
        salt, digest = create_password_credentials(password)
        bookmarks.loc[same_nickname, "password_salt"] = salt
        bookmarks.loc[same_nickname, "password_hash"] = digest

    bookmark_rows = same_nickname & bookmarks["place_id"].astype(str).eq(str(place_id))
    if bookmark_rows.any():
        if write_bookmarks(bookmarks.loc[~bookmark_rows].copy()):
            st.session_state.bookmark_flash = ("info", "저장을 취소했어요.")
        return

    numeric_ids = pd.to_numeric(
        bookmarks["bookmark_id"].fillna("").str.extract(r"(\d+)", expand=False),
        errors="coerce",
    )
    next_number = int(numeric_ids.max()) + 1 if numeric_ids.notna().any() else 1
    new_row = pd.DataFrame([{
        "bookmark_id": f"B{next_number:03d}",
        "nickname": nickname,
        "place_id": str(place_id),
        "created_at": datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
        "password_salt": salt,
        "password_hash": digest,
        "memo": "",
        "custom_category": "",
    }])
    if write_bookmarks(pd.concat([bookmarks, new_row], ignore_index=True)):
        st.session_state.bookmark_flash = ("success", "장소를 저장했어요.")


def detail_row(icon: str, label: str, value: object) -> str:
    return (
        '<div class="detail-core-row">'
        f'<span>{icon}</span><b>{escape(label)}</b>'
        f'<span>{escape(clean_text(value))}</span></div>'
    )


def parking_detail(value: object) -> tuple[str, str]:
    parking_text = clean_text(value, "주차 정보 없음")
    parking_label = {
        "무료": "무료 주차 가능",
        "유료": "유료 주차 가능",
        "무료/유료": "무료/유료 주차 가능",
        "무료/유료 주차": "무료/유료 주차 가능",
        "주차 불가": "주차 불가",
    }.get(parking_text, parking_text)
    return ("❌" if parking_text == "주차 불가" else "🚙", parking_label)


def detail_recommendations(
    places: pd.DataFrame,
    current_place: pd.Series,
    limit: int = 3,
) -> pd.DataFrame:
    candidates = places[
        places["place_id"].astype(str) != str(current_place.get("place_id"))
    ].copy()
    if candidates.empty:
        return candidates

    candidates["_recommend_score"] = 0
    for column, weight in (("category", 4), ("region_group", 2), ("space_type", 1)):
        current_value = clean_text(current_place.get(column), "")
        if current_value and column in candidates.columns:
            candidates["_recommend_score"] += (
                candidates[column].fillna("").astype(str).eq(current_value).astype(int) * weight
            )
    if "photo_url" in candidates.columns:
        candidates["_recommend_score"] += (
            candidates["photo_url"].fillna("").astype(str).str.strip().ne("").astype(int)
        )

    return (
        candidates.sort_values(
            ["_recommend_score", "place_name"],
            ascending=[False, True],
            kind="stable",
        )
        .head(limit)
        .drop(columns=["_recommend_score"])
    )


def render_detail(places: pd.DataFrame) -> None:
    st.html(
        """
        <script>
        (() => {
        const scrollDetailToTop = () => {
            const main = document.querySelector('section[data-testid="stMain"]');
            if (main) main.scrollTo(0, 0);
        };
        scrollDetailToTop();
        requestAnimationFrame(scrollDetailToTop);
        setTimeout(scrollDetailToTop, 80);
        })();
        </script>
        """,
        unsafe_allow_javascript=True,
    )
    place_id = str(st.session_state.selected_place_id)
    selected = places[places["place_id"].astype(str) == place_id]
    if selected.empty:
        st.error("선택한 장소를 찾을 수 없습니다.")
        st.button("목록으로 돌아가기", on_click=go_to, args=("list",))
        return
    place = selected.iloc[0]

    st.button("← 장소 목록으로", on_click=go_to, args=("list",), type="tertiary")
    photo_url = clean_text(place.get("photo_url"), "")
    with st.container(key="detail_photo"):
        if photo_url:
            st.image(photo_url, use_container_width=True)
        else:
            st.markdown('<div class="detail-photo-placeholder">NO IMAGE AVAILABLE</div>', unsafe_allow_html=True)

    description = clean_text(place.get("description"), "아이와 함께 둘러볼 제주 장소입니다.")
    admission_value = (
        "무료" if pd.notna(place.get("has_admission_fee")) and not bool(place.get("has_admission_fee"))
        else clean_text(place.get("admission_fee_detail"), "입장료 있음")
    )
    age_value = (
        "연령제한 없음" if pd.notna(place.get("has_age_limit")) and not bool(place.get("has_age_limit"))
        else clean_text(place.get("age_limit_detail"), "연령제한 있음")
    )
    parking_icon, parking_value = parking_detail(place.get("parking"))
    rows = "".join([
        detail_row("📍", "위치", place.get("road_address")),
        detail_row("🕘", "운영시간", place.get("opening_hours")),
        detail_row("₩", "이용 요금", admission_value),
        detail_row("☺", "연령제한", age_value),
        detail_row(parking_icon, "주차 가능 여부", parking_value),
    ])
    website = clean_text(place.get("website_url"), "")
    reservation = clean_text(place.get("reservation_url"), "")
    if website.startswith(("http://", "https://")):
        website_action = (
            f'<a class="detail-mini-link" href="{escape(website, quote=True)}" '
            'target="_blank" rel="noopener noreferrer">🌐 홈페이지</a>'
        )
    else:
        website_action = (
            '<span class="detail-mini-link disabled" aria-disabled="true" '
            'title="등록된 홈페이지가 없습니다">🌐 홈페이지</span>'
        )
    if reservation.startswith(("http://", "https://")):
        reservation_action = (
            f'<a class="detail-mini-link reserve" href="{escape(reservation, quote=True)}" '
            'target="_blank" rel="noopener noreferrer">🎟 예약하기</a>'
        )
    else:
        reservation_action = (
            '<span class="detail-mini-link reserve disabled" aria-disabled="true" '
            'title="등록된 예약 링크가 없습니다">🎟 예약하기</span>'
        )
    st.markdown(
        f"""
        <section class="detail-summary-card">
            <div class="detail-tags">{display_tags(place)}</div>
            <h1>{escape(clean_text(place.get('place_name')))}</h1>
            <p class="detail-description">{escape(description)}</p>
            <div class="detail-actions">{website_action}{reservation_action}</div>
            <div>{rows}</div>
        </section>
        """,
        unsafe_allow_html=True,
    )

    saved = current_place_is_saved(place_id)
    save_button_background = "#f7b6c8" if saved else "#ff9f1c"
    save_button_color = "#49382f" if saved else "#ffffff"
    st.html(
        f"""
        <style>
        .st-key-detail_save_toggle button {{
            background:{save_button_background} !important;
            color:{save_button_color} !important;
        }}
        </style>
        """
    )
    st.button(
        "♥ 저장한 장소" if saved else "♡ 이 장소 저장하기",
        key="detail_save_toggle",
        type="primary",
        use_container_width=True,
        on_click=toggle_current_bookmark,
        args=(place_id,),
    )
    flash = st.session_state.pop("bookmark_flash", None)
    if flash:
        kind, message = flash
        toast_icons = {"success": "💖", "info": "💨", "error": "🚫"}
        st.toast(message, icon=toast_icons.get(kind, "🍊"))

    point_items = []
    if pd.notna(place.get("nursing_room")) and bool(place.get("nursing_room")):
        point_items.append("수유실을 이용할 수 있어요")
    if pd.notna(place.get("stroller_rental")) and bool(place.get("stroller_rental")):
        point_items.append("유모차를 대여할 수 있어요")
    if pd.notna(place.get("diaper_changing_table")) and bool(place.get("diaper_changing_table")):
        point_items.append("기저귀 교환대가 있어요")
    if clean_text(place.get("space_type"), "") == "실내":
        point_items.append("실내 공간이라 날씨 영향을 덜 받아요")
    if not point_items:
        point_items.append("등록된 아이 동반 편의시설 정보가 없어요")

    lower_columns = st.columns(3, gap="medium")
    with lower_columns[0]:
        with st.container(key="detail_points"):
            st.markdown("### ⭐ 아이랑 포인트")
            for item in point_items:
                st.markdown(f'<div class="detail-check">{escape(item)}</div>', unsafe_allow_html=True)
    with lower_columns[1]:
        with st.container(key="detail_visit"):
            st.markdown("### 💡 방문 전 확인해요")
            for item in [
                f"휴무일: {clean_text(place.get('closed_days'))}",
                f"전화: {clean_text(place.get('phone'))}",
                clean_text(place.get("review_summary"), "방문 전 운영 정보를 확인해 주세요"),
            ]:
                st.markdown(f'<div class="detail-check">{escape(item)}</div>', unsafe_allow_html=True)
    with lower_columns[2]:
        with st.container(key="detail_map"):
            st.markdown("### 📍 위치 안내")
            lat, lon = place.get("latitude"), place.get("longitude")
            if pd.notna(lat) and pd.notna(lon):
                st.map(
                    pd.DataFrame({"lat": [float(lat)], "lon": [float(lon)]}),
                    zoom=12,
                    width="stretch",
                    height=210,
                )
            else:
                st.info("위치 정보가 등록되지 않았습니다.")

    recommendations = detail_recommendations(places, place, limit=3)
    if not recommendations.empty:
        st.markdown(
            '<div class="result-heading detail-recommend-heading">'
            '<span>다음 일정으로 여기는 어떠세요?</span>'
            f'<b>{len(recommendations)}곳</b></div>',
            unsafe_allow_html=True,
        )
        render_place_grid(
            recommendations,
            f"detail_recommend_{place_id}",
            columns=3,
        )

    render_quiet_proposal_link(
        "✎ 장소 정보 수정 제안",
        get_place_update_form_url(place),
    )



def bookmark_category_text(value: object) -> str:
    if pd.isna(value):
        return ""
    return str(value).strip()


def bookmark_category_options(bookmarks: pd.DataFrame) -> list[str]:
    categories = sorted(
        {
            bookmark_category_text(value)
            for value in bookmarks["custom_category"]
            if bookmark_category_text(value)
        },
        key=str.casefold,
    )
    options = ["전체", *categories]
    if bookmarks["custom_category"].map(bookmark_category_text).eq("").any():
        options.append("미분류")
    return options


def filter_bookmarks_by_category(
    bookmarks: pd.DataFrame, selected_category: str
) -> pd.DataFrame:
    if selected_category == "미분류":
        return bookmarks[
            bookmarks["custom_category"].map(bookmark_category_text).eq("")
        ].copy()
    if selected_category and selected_category != "전체":
        return bookmarks[
            bookmarks["custom_category"]
            .map(bookmark_category_text)
            .eq(selected_category)
        ].copy()
    return bookmarks.copy()


def render_bookmarks(places: pd.DataFrame) -> None:
    st.markdown(
        """
        <div class="favorites-intro">
            <div><div class="page-title favorites-title">마음에 담아둔 제주</div>
            <p>아이와 함께 가고 싶은 장소를 한곳에서 편하게 확인하세요.</p></div>
        </div>
        """,
        unsafe_allow_html=True,
    )
    normalized = st.session_state.nickname.strip()
    google_sheet_enabled, _, _ = bookmark_sheet_settings()
    if not google_sheet_enabled:
        st.warning(
            "현재 즐겨찾기는 로컬 개발용 CSV에 저장됩니다. "
            "배포 전 Google Sheet Secrets 설정을 완료해 주세요."
        )
    if not normalized:
        st.info("시작 화면에서 닉네임과 비밀번호를 입력하면 즐겨찾기를 확인할 수 있어요.")
        st.button("시작 화면으로", type="primary", on_click=go_to, args=("home",))
        return

    flash = st.session_state.pop("favorites_flash", None)
    if flash:
        st.toast(flash[1], icon=flash[0])

    bookmarks = load_bookmarks()
    mine = bookmarks[bookmarks["nickname"].fillna("").str.strip() == normalized].copy()
    if mine.empty:
        st.info("아직 저장한 장소가 없어요. 장소 찾기에서 마음에 드는 곳을 저장해 보세요.")
        return
    mine["_created"] = pd.to_datetime(mine["created_at"], errors="coerce")
    mine = mine.sort_values("_created", ascending=False, na_position="last")
    category_options = bookmark_category_options(mine)
    if st.session_state.bookmark_category_filter not in category_options:
        st.session_state.bookmark_category_filter = "전체"

    with st.container(key="favorites_controls"):
        category_control, view_control = st.columns([2, 1], vertical_alignment="bottom")
        with category_control:
            st.markdown("**나만의 카테고리**")
            selected_category = st.pills(
                "나만의 카테고리",
                category_options,
                key="bookmark_category_filter",
                label_visibility="collapsed",
            )
        with view_control:
            st.session_state.bookmark_view_mode = st.radio(
                "보기 형식",
                ["갤러리 보기", "지도 보기"],
                key="bookmark_view_mode_control",
                horizontal=True,
            )

    selected_category = selected_category or "전체"
    filtered_mine = filter_bookmarks_by_category(mine, selected_category)
    safe_download_columns = [
        "bookmark_id",
        "nickname",
        "place_id",
        "created_at",
        "custom_category",
        "memo",
    ]
    joined = filtered_mine.merge(
        places, on="place_id", how="left", suffixes=("_bookmark", "")
    )
    st.markdown(
        f'<div class="result-heading favorites-result-heading"><span>{normalized}님의 즐겨찾기</span><b>{len(joined)}곳</b></div>',
        unsafe_allow_html=True,
    )
    st.download_button(
        "내 즐겨찾기 CSV 내려받기",
        data=mine[safe_download_columns].to_csv(index=False).encode("utf-8-sig"),
        file_name=f"{normalized}_bookmarks.csv",
        mime="text/csv",
    )

    if joined.empty:
        st.info("선택한 카테고리에 저장된 장소가 없어요.")
        return

    if st.session_state.bookmark_view_mode == "지도 보기":
        render_place_map(
            joined,
            chart_key="bookmarks_map",
            on_select=open_selected_bookmark_map_place,
        )
        st.caption("나만의 카테고리와 메모를 수정하려면 갤러리 보기로 전환해 주세요.")
        return

    for start in range(0, len(joined), 3):
        columns = st.columns(3)
        for offset, (_, place) in enumerate(joined.iloc[start : start + 3].iterrows()):
            with columns[offset]:
                photo_url = clean_text(place.get("photo_url"), "")
                if photo_url:
                    st.image(photo_url, use_container_width=True)
                else:
                    st.markdown('<div class="photo-placeholder">♥</div>', unsafe_allow_html=True)
                with st.container(key=f"favorite_card_{place['bookmark_id']}"):
                    st.markdown(f'<div>{display_tags(place)}</div>', unsafe_allow_html=True)
                    place_name = clean_text(place.get("place_name"), "삭제되었거나 찾을 수 없는 장소")
                    if pd.notna(place.get("place_name")):
                        st.button(
                            place_name,
                            key=f"favorite_name_{place['bookmark_id']}",
                            type="tertiary",
                            use_container_width=True,
                            on_click=go_to,
                            args=("detail", str(place["place_id"])),
                        )
                    else:
                        st.markdown(f"### {escape(place_name)}")
                    st.markdown(
                        f"""
                        <div class="place-card-copy">
                            <p>{escape(clean_text(place.get('description'), '아이와 함께 가고 싶은 제주 장소'))}</p>
                            <p class="saved-at">♡ 저장일시 · {escape(clean_text(place.get('created_at')))}</p>
                        </div>
                        """,
                        unsafe_allow_html=True,
                    )
                custom_category = st.text_input(
                    "나만의 카테고리",
                    value=bookmark_category_text(place.get("custom_category")),
                    key=f"bookmark_category_{place['bookmark_id']}",
                    max_chars=30,
                    placeholder="예: 비 오는 날 · 꼭 가볼 곳",
                )
                memo_value = st.text_area(
                    "나들이 메모",
                    value=clean_text(place.get("memo"), ""),
                    key=f"bookmark_memo_{place['bookmark_id']}",
                    max_chars=500,
                    placeholder="아이와 함께할 나들이 메모를 남겨보세요",
                )
                bookmark_id = str(place["bookmark_id"])
                delete_is_pending = st.session_state.bookmark_delete_pending == bookmark_id
                memo_action, delete_action = st.columns([1, .7])
                with memo_action:
                    if st.button(
                        "분류·메모 저장",
                        key=f"bookmark_memo_save_{place['bookmark_id']}",
                        use_container_width=True,
                    ):
                        category_value = custom_category.strip()
                        if category_value in {"전체", "미분류"}:
                            st.error("‘전체’와 ‘미분류’는 카테고리 이름으로 사용할 수 없습니다.")
                            continue
                        # Always update the complete source table by its unique ID.
                        updated = load_bookmarks()
                        target = (
                            updated["bookmark_id"].astype(str).eq(str(place["bookmark_id"]))
                            & nickname_mask(updated, normalized)
                        )
                        if target.sum() != 1:
                            st.error("수정할 북마크를 정확히 찾을 수 없습니다.")
                        else:
                            updated.loc[target, "memo"] = memo_value.strip()
                            updated.loc[target, "custom_category"] = category_value
                            if write_bookmarks(updated):
                                st.session_state.favorites_flash = (
                                    "💾",
                                    "나만의 카테고리와 메모를 저장했습니다.",
                                )
                                st.rerun()
                with delete_action:
                    if not delete_is_pending and st.button(
                        "삭제", key=f"bookmark_delete_{bookmark_id}", use_container_width=True
                    ):
                        st.session_state.bookmark_delete_pending = bookmark_id
                        st.rerun()

                if delete_is_pending:
                    st.warning("삭제하시겠습니까?")
                    confirm_delete, cancel_delete = st.columns(2)
                    with confirm_delete:
                        if st.button(
                            "네, 삭제할게요",
                            key=f"bookmark_delete_confirm_{bookmark_id}",
                            type="primary",
                            use_container_width=True,
                        ):
                            updated = load_bookmarks()
                            updated = updated[
                                ~(
                                    updated["bookmark_id"].astype(str).eq(bookmark_id)
                                    & nickname_mask(updated, normalized)
                                )
                            ]
                            if write_bookmarks(updated):
                                st.session_state.bookmark_delete_pending = None
                                st.rerun()
                    with cancel_delete:
                        if st.button(
                            "취소",
                            key=f"bookmark_delete_cancel_{bookmark_id}",
                            use_container_width=True,
                        ):
                            st.session_state.bookmark_delete_pending = None
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
