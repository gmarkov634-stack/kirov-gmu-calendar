#!/usr/bin/env python3
from dataclasses import dataclass
from html.parser import HTMLParser
from urllib.error import HTTPError, URLError
from urllib.parse import urljoin, urlparse
from urllib.request import Request, urlopen


class OfficialScheduleDiscoveryError(RuntimeError):
    pass


@dataclass(frozen=True)
class ScheduleLink:
    label: str
    url: str


class _ScheduleLinkParser(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.links = []
        self._href = None
        self._text = []

    def handle_starttag(self, tag, attrs):
        if tag.lower() != "a" or self._href is not None:
            return
        href = dict(attrs).get("href")
        if href:
            self._href = href
            self._text = []

    def handle_data(self, data):
        if self._href is not None:
            self._text.append(data)

    def handle_endtag(self, tag):
        if tag.lower() != "a" or self._href is None:
            return
        label = " ".join("".join(self._text).split())
        self.links.append((self._href, label))
        self._href = None
        self._text = []


def _is_xlsx(url: str) -> bool:
    return urlparse(url).path.lower().endswith(".xlsx")


def parse_schedule_links(html_text: str, page_url: str):
    if not isinstance(html_text, str) or not html_text:
        raise OfficialScheduleDiscoveryError("official schedule page must contain HTML text")
    if not isinstance(page_url, str) or not page_url:
        raise OfficialScheduleDiscoveryError("official schedule page URL is required")

    parser = _ScheduleLinkParser()
    parser.feed(html_text)
    return [
        ScheduleLink(label=label, url=urljoin(page_url, href))
        for href, label in parser.links
        if _is_xlsx(urljoin(page_url, href))
    ]


def select_schedule_link(
    links,
    *,
    group_label: str,
    academic_year: str,
    semester_label: str,
):
    required = {
        "group_label": group_label,
        "academic_year": academic_year,
        "semester_label": semester_label,
    }
    for name, value in required.items():
        if not isinstance(value, str) or not value.strip():
            raise OfficialScheduleDiscoveryError(f"{name} must be a non-empty string")

    group_token = " ".join(group_label.split()).lower()
    year_token = " ".join(academic_year.split()).lower()
    semester_token = " ".join(semester_label.split()).lower()
    matches = []
    for link in links:
        normalized = " ".join(link.label.split()).lower()
        if group_token in normalized and year_token in normalized and semester_token in normalized:
            matches.append(link)

    if len(matches) != 1:
        candidates = [{"label": link.label, "url": link.url} for link in matches]
        raise OfficialScheduleDiscoveryError(
            "expected exactly one official XLSX link for "
            f"{group_label} / {academic_year} / {semester_label}, found {len(matches)}: {candidates}"
        )
    return matches[0]


def fetch_url_bytes(url: str, *, timeout: int = 30) -> bytes:
    request = Request(url, headers={"User-Agent": "medical-calendar-source-audit/1.0"})
    try:
        with urlopen(request, timeout=timeout) as response:
            return response.read()
    except (HTTPError, URLError, TimeoutError) as error:
        raise OfficialScheduleDiscoveryError(f"failed to fetch official URL {url}: {error}") from error


def discover_schedule_link(
    *,
    page_url: str,
    group_label: str,
    academic_year: str,
    semester_label: str,
    timeout: int = 30,
):
    page_bytes = fetch_url_bytes(page_url, timeout=timeout)
    try:
        html_text = page_bytes.decode("utf-8")
    except UnicodeDecodeError as error:
        raise OfficialScheduleDiscoveryError("official schedule page is not valid UTF-8") from error
    links = parse_schedule_links(html_text, page_url)
    return select_schedule_link(
        links,
        group_label=group_label,
        academic_year=academic_year,
        semester_label=semester_label,
    )
