from __future__ import annotations

import unittest
from urllib.parse import parse_qs, urlsplit

from form_links import build_update_form_url


class FormLinkTests(unittest.TestCase):
    def setUp(self) -> None:
        self.settings = {
            "update_base_url": "https://docs.google.com/forms/example/viewform",
            "request_type_entry": "entry.10",
            "target_place_name_entry": "entry.20",
            "location_hint_entry": "entry.30",
            "update_request_value": "기존 장소 수정",
        }

    def test_builds_prefilled_update_url(self) -> None:
        url = build_update_form_url(
            self.settings,
            "아쿠아플라넷 제주",
            "제주특별자치도 서귀포시 성산읍 섭지코지로 95",
        )
        query = parse_qs(urlsplit(url).query)

        self.assertEqual(query["usp"], ["pp_url"])
        self.assertEqual(query["entry.10"], ["기존 장소 수정"])
        self.assertEqual(query["entry.20"], ["아쿠아플라넷 제주"])
        self.assertEqual(
            query["entry.30"],
            ["제주특별자치도 서귀포시 성산읍 섭지코지로 95"],
        )

    def test_returns_blank_when_configuration_is_incomplete(self) -> None:
        settings = dict(self.settings)
        settings["location_hint_entry"] = ""
        self.assertEqual(build_update_form_url(settings, "장소", "제주시"), "")

    def test_rejects_non_entry_field_names(self) -> None:
        settings = dict(self.settings)
        settings["target_place_name_entry"] = "target_place_name"
        self.assertEqual(build_update_form_url(settings, "장소", "제주시"), "")


if __name__ == "__main__":
    unittest.main()
