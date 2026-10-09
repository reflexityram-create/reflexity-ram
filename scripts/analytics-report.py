#!/usr/bin/env python3
"""Read-only aggregate GA4 report for Reflexity RAM.

The report deliberately keeps visitor scope (the exact production host) separate
from purchases. Historic server-side purchases can have hostname "(not set)".
"""
from __future__ import annotations

import argparse
import datetime as dt
import json
import os
import sys
from pathlib import Path
from zoneinfo import ZoneInfo

PROPERTY_DEFAULT = "546945877"
PRODUCTION_HOST = "reflexityram.com"
API_ROOT = "https://analyticsdata.googleapis.com/v1beta"
MAX_ROWS = 1000
MAX_LIMIT = 1000


def date_window(args: argparse.Namespace) -> tuple[str, str]:
    if args.start or args.end:
        if not (args.start and args.end):
            raise ValueError("--start and --end must be supplied together")
        start = dt.date.fromisoformat(args.start)
        end = dt.date.fromisoformat(args.end)
    else:
        # GA4 property 546945877 is configured for America/Los_Angeles. Use
        # that zone so a late-evening local run never includes a partial day.
        end = dt.datetime.now(ZoneInfo("America/Los_Angeles")).date() - dt.timedelta(days=1)
        start = end - dt.timedelta(days=27)
    if start > end:
        raise ValueError("start date must be on or before end date")
    if (end - start).days > 365:
        raise ValueError("date range is capped at 366 days")
    return start.isoformat(), end.isoformat()


def metric(name: str) -> dict:
    return {"name": name}


def exact_host_filter() -> dict:
    return {"filter": {"fieldName": "hostName", "stringFilter": {"matchType": "EXACT", "value": PRODUCTION_HOST}}}


def event_filter(event_name: str, host: bool = True) -> dict:
    expressions = [{"filter": {"fieldName": "eventName", "stringFilter": {"matchType": "EXACT", "value": event_name}}}]
    if host:
        expressions.append(exact_host_filter())
    return {"andGroup": {"expressions": expressions}}


def rows(response: dict) -> list[dict]:
    dimensions = [h.get("name") for h in response.get("dimensionHeaders", [])]
    metrics = [h.get("name") for h in response.get("metricHeaders", [])]
    output = []
    for row in response.get("rows", [])[:MAX_ROWS]:
        item = {name: value.get("value") for name, value in zip(dimensions, row.get("dimensionValues", []))}
        item.update({name: value.get("value") for name, value in zip(metrics, row.get("metricValues", []))})
        output.append(item)
    return output


def safe_error(response: object) -> str:
    if isinstance(response, dict):
        message = response.get("error", {}).get("message")
        if isinstance(message, str) and message:
            return message[:240]
    return "Google Analytics Data API request failed"


class AnalyticsClient:
    def __init__(self, property_id: str, credentials_path: Path):
        try:
            from google.auth.transport.requests import AuthorizedSession
            from google.oauth2 import service_account
        except ImportError as exc:
            raise RuntimeError("Python package google-auth is required") from exc
        if not credentials_path.is_file():
            raise RuntimeError("Google service-account credential file is unavailable")
        credentials = service_account.Credentials.from_service_account_file(
            str(credentials_path), scopes=["https://www.googleapis.com/auth/analytics.readonly"]
        )
        self.session = AuthorizedSession(credentials)
        self.base = f"{API_ROOT}/properties/{property_id}"

    def post(self, path: str, payload: dict) -> dict:
        response = self.session.post(f"{self.base}:{path}", json=payload, timeout=30)
        try:
            body = response.json()
        except ValueError:
            body = {}
        if response.status_code >= 400:
            raise RuntimeError(safe_error(body))
        return body

    def get(self, path: str) -> dict:
        response = self.session.get(f"{self.base}/{path}", timeout=30)
        try:
            body = response.json()
        except ValueError:
            body = {}
        if response.status_code >= 400:
            raise RuntimeError(safe_error(body))
        return body


def report(client: AnalyticsClient, start: str, end: str, dimensions: list[str], metrics: list[str], *, dimension_filter: dict | None = None) -> list[dict]:
    payload = {
        "dateRanges": [{"startDate": start, "endDate": end}],
        "dimensions": [{"name": name} for name in dimensions],
        "metrics": [metric(name) for name in metrics],
        "currencyCode": "CAD",
        "limit": MAX_LIMIT,
        "keepEmptyRows": False,
    }
    if dimension_filter:
        payload["dimensionFilter"] = dimension_filter
    return rows(client.post("runReport", payload))


def custom_dimensions(client: AnalyticsClient) -> list[dict]:
    metadata = client.get("metadata")
    names = []
    for item in metadata.get("dimensions", []):
        if item.get("customDefinition") is not True:
            continue
        api_name = item.get("apiName")
        display = item.get("uiName")
        if isinstance(api_name, str) and api_name.startswith("customEvent:"):
            names.append({"apiName": api_name, "displayName": str(display or "")[:100]})
    return names[:100]


def build_report(client: AnalyticsClient, start: str, end: str) -> dict:
    visitors = {
        "scope": {"host": PRODUCTION_HOST, "note": "Exact production host only; operator visits may remain unless opted out."},
        "totals": report(client, start, end, [], ["sessions", "totalUsers", "engagedSessions"], dimension_filter=exact_host_filter()),
        "channels": report(client, start, end, ["sessionDefaultChannelGroup"], ["sessions", "totalUsers"], dimension_filter=exact_host_filter()),
        "events": report(client, start, end, ["eventName"], ["eventCount", "totalUsers"], dimension_filter=exact_host_filter()),
        "exit_pages": report(client, start, end, ["pagePath", "eventName"], ["eventCount", "totalUsers"], dimension_filter=event_filter("page_exit")),
    }
    # Purchases are intentionally all-host: server Measurement Protocol history can have no hostname.
    purchases = {
        "scope": {"host": "all", "note": "Includes server-side purchases whose hostname is (not set); do not compare with visitor totals as a funnel."},
        "rows": report(client, start, end, ["eventName"], ["eventCount", "totalUsers", "purchaseRevenue"], dimension_filter=event_filter("purchase", host=False)),
    }
    try:
        dimensions = custom_dimensions(client)
        error_dimensions = [item["apiName"] for item in dimensions if item["apiName"] == "customEvent:reason"]
        if error_dimensions:
            checkout = {
                "status": "available",
                "registered_dimensions": dimensions,
                "rows": report(client, start, end, ["eventName", error_dimensions[0]], ["eventCount", "totalUsers"], dimension_filter=event_filter("checkout_error")),
            }
        else:
            checkout = {"status": "pending", "reason": "No registered checkout-error dimension was found; event parameters were not queried.", "registered_dimensions": dimensions}
    except RuntimeError as exc:
        checkout = {"status": "pending", "reason": "GA4 metadata could not be read; no custom checkout dimensions queried.", "error": str(exc)[:160]}
    return {"visitor_report": visitors, "purchase_report": purchases, "checkout_errors": checkout}


def main() -> int:
    parser = argparse.ArgumentParser(description="Read-only aggregate GA4 report for Reflexity RAM")
    parser.add_argument("--start", help="inclusive YYYY-MM-DD; pair with --end")
    parser.add_argument("--end", help="inclusive YYYY-MM-DD; pair with --start")
    parser.add_argument("--property", default=os.environ.get("GA4_PROPERTY_ID", PROPERTY_DEFAULT), help="GA4 property number")
    args = parser.parse_args()
    try:
        if not str(args.property).isdigit():
            raise ValueError("property must be a numeric GA4 property id")
        start, end = date_window(args)
        credential = Path(os.environ.get("GOOGLE_APPLICATION_CREDENTIALS", "~/.config/ga-mcp/key.json")).expanduser()
        client = AnalyticsClient(str(args.property), credential)
        result = build_report(client, start, end)
        result.update({"ok": True, "property": str(args.property), "currency": "CAD", "start": start, "end": end, "anonymous": True, "funnels_are_separate_counts": True})
        print(json.dumps(result, indent=2, sort_keys=True))
        return 0
    except (ValueError, RuntimeError, OSError) as exc:
        print(json.dumps({"ok": False, "error": {"message": str(exc)[:240]}, "anonymous": True}, indent=2), file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
