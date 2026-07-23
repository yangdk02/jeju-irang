from __future__ import annotations

import pandas as pd


PLACE_TEXT_COLUMNS = [
    "place_id",
    "place_name",
    "category",
    "city_name",
    "legal_dong_name",
    "region_group",
    "road_address",
    "phone",
    "website_url",
    "closed_days",
    "opening_hours",
    "parking",
    "admission_fee_detail",
    "age_limit_detail",
    "space_type",
    "reservation_url",
    "photo_url",
    "description",
    "review_summary",
]

PLACE_NUMBER_COLUMNS = ["latitude", "longitude"]

PLACE_BOOLEAN_COLUMNS = [
    "has_admission_fee",
    "has_age_limit",
    "nursing_room",
    "stroller_rental",
    "resident_discount",
    "diaper_changing_table",
]

PLACE_COLUMNS = [
    "place_id",
    "place_name",
    "category",
    "city_name",
    "legal_dong_name",
    "region_group",
    "road_address",
    "latitude",
    "longitude",
    "phone",
    "website_url",
    "closed_days",
    "opening_hours",
    "parking",
    "has_admission_fee",
    "admission_fee_detail",
    "has_age_limit",
    "age_limit_detail",
    "nursing_room",
    "stroller_rental",
    "space_type",
    "reservation_url",
    "resident_discount",
    "diaper_changing_table",
    "photo_url",
    "description",
    "review_summary",
]


def parse_boolean(value: object) -> object:
    """Normalize common CSV boolean spellings and preserve unknown values as NA."""
    if pd.isna(value):
        return pd.NA
    normalized = str(value).strip().lower()
    if normalized in {"true", "1", "yes", "y", "예"}:
        return True
    if normalized in {"false", "0", "no", "n", "아니오"}:
        return False
    return pd.NA


def empty_places_frame() -> pd.DataFrame:
    """Return an empty places frame that still satisfies the complete app schema."""
    frame, _ = normalize_places_frame(pd.DataFrame(columns=PLACE_COLUMNS))
    return frame


def normalize_places_frame(frame: pd.DataFrame) -> tuple[pd.DataFrame, list[str]]:
    """Add missing place columns and normalize types without rejecting partial CSVs."""
    normalized = frame.copy()
    normalized.columns = [str(column).strip() for column in normalized.columns]
    normalized = normalized.loc[:, ~normalized.columns.duplicated(keep="first")]
    original_columns = set(normalized.columns)
    missing_columns = [column for column in PLACE_COLUMNS if column not in original_columns]

    for column in PLACE_TEXT_COLUMNS:
        if column not in normalized.columns:
            normalized[column] = pd.Series(pd.NA, index=normalized.index, dtype="string")
        else:
            normalized[column] = normalized[column].astype("string")

    for column in PLACE_NUMBER_COLUMNS:
        if column not in normalized.columns:
            normalized[column] = pd.Series(pd.NA, index=normalized.index, dtype="Float64")
        else:
            normalized[column] = pd.to_numeric(normalized[column], errors="coerce").astype(
                "Float64"
            )

    for column in PLACE_BOOLEAN_COLUMNS:
        if column not in normalized.columns:
            normalized[column] = pd.Series(pd.NA, index=normalized.index, dtype="boolean")
        else:
            normalized[column] = normalized[column].map(parse_boolean).astype("boolean")

    # A deleted or partially empty place_id column must not create duplicate Streamlit keys.
    missing_id_mask = normalized["place_id"].fillna("").str.strip().eq("")
    if missing_id_mask.any():
        generated_ids = pd.Series(
            [f"AUTO-{position + 1:06d}" for position in range(len(normalized))],
            index=normalized.index,
            dtype="string",
        )
        normalized.loc[missing_id_mask, "place_id"] = generated_ids[missing_id_mask]

    normalized = normalized[PLACE_COLUMNS]
    normalized["_data_order"] = range(len(normalized))
    normalized.attrs["missing_columns"] = missing_columns
    return normalized, missing_columns
