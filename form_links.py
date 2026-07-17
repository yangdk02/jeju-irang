from __future__ import annotations

from collections.abc import Mapping
from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit


def build_update_form_url(
    settings: Mapping[str, str],
    place_name: str,
    location_hint: str,
) -> str:
    """Build a Google Form prefilled URL for an existing-place update."""
    base_url = str(settings.get("update_base_url", "")).strip()
    request_entry = str(settings.get("request_type_entry", "")).strip()
    place_entry = str(settings.get("target_place_name_entry", "")).strip()
    location_entry = str(settings.get("location_hint_entry", "")).strip()
    request_value = str(
        settings.get("update_request_value", "기존 장소 수정")
    ).strip()

    if not all((base_url, request_entry, place_entry, location_entry, place_name)):
        return ""
    if not base_url.startswith(("https://", "http://")):
        return ""
    if not all(
        entry.startswith("entry.")
        for entry in (request_entry, place_entry, location_entry)
    ):
        return ""

    parts = urlsplit(base_url)
    params = dict(parse_qsl(parts.query, keep_blank_values=True))
    params.update(
        {
            "usp": "pp_url",
            request_entry: request_value,
            place_entry: place_name.strip(),
            location_entry: location_hint.strip(),
        }
    )
    return urlunsplit(
        (parts.scheme, parts.netloc, parts.path, urlencode(params), parts.fragment)
    )
