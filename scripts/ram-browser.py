#!/usr/bin/env python3
"""Open one task-owned RAM listing tab in the correct native Chrome profile.

This helper deliberately does not submit forms.  It opens a separate native
workspace, proves the profile lane is held, and leaves the exact cleanup command
in its JSON result.  See docs/ram-listing-playbook.md before revising a listing.
"""

from __future__ import annotations

import argparse
import json
import os
import re
import shutil
import shlex
import subprocess
import sys
import time
from dataclasses import dataclass
from typing import Any


CCL = os.path.expanduser("~/.local/bin/claude-chrome-local/ccl.py")
PROFILES = {"ebay": "yusuf", "reflexity": "reflexity"}
URLS = {
    ("ebay", "active"): "https://www.ebay.ca/sh/lst/active",
    ("ebay", "drafts"): "https://www.ebay.ca/sh/lst/drafts",
    ("ebay", "create"): "https://www.ebay.ca/sl/prelist/suggest?sr=shstart",
    ("reflexity", "admin-products"): "https://reflexityram.com/admin/products",
    # Source-verified query opens the Add modal directly.
    ("reflexity", "create"): "https://reflexityram.com/admin/products?new=1",
}
ITEM_ID = re.compile(r"^\d{12}$")
PRODUCT_ID = re.compile(r"^[0-9a-fA-F]{24}$")


@dataclass(frozen=True)
class Plan:
    service: str
    mode: str
    identifier: str | None
    profile: str
    url: str


def fail(message: str) -> None:
    print(f"ram-browser: {message}", file=sys.stderr)
    raise SystemExit(2)


def target_url(service: str, mode: str, identifier: str | None) -> str:
    if service == "ebay" and mode in {"item", "revise"}:
        if not identifier or not ITEM_ID.fullmatch(identifier):
            fail("eBay item IDs must be exactly 12 digits")
        if mode == "item":
            return f"https://www.ebay.ca/itm/{identifier}"
        # Verified by the 2026-10-08 revision artifacts.  eBay resolves this to
        # its current draft editor; never substitute a remembered draft ID.
        return f"https://www.ebay.ca/sl/list?mode=ReviseItem&itemId={identifier}"
    if service == "reflexity" and mode == "product":
        if not identifier or not PRODUCT_ID.fullmatch(identifier):
            fail("Reflexity product IDs must be 24 hexadecimal characters")
        return f"https://reflexityram.com/admin/products?edit={identifier}"
    if identifier is not None:
        fail(f"{service} {mode} does not accept an identifier")
    try:
        return URLS[(service, mode)]
    except KeyError:
        fail(f"unsupported target: {service} {mode}")


def command_output(command: list[str]) -> str:
    try:
        completed = subprocess.run(command, text=True, capture_output=True, check=True)
    except FileNotFoundError:
        fail(f"required command is unavailable: {command[0]}")
    except subprocess.CalledProcessError as exc:
        detail = (exc.stderr or exc.stdout or "no output").strip()
        fail(f"command failed ({' '.join(command[:2])}): {detail[-700:]}")
    return completed.stdout


def last_json_object(text: str) -> dict[str, Any]:
    """Accept a broker response with harmless log lines before its JSON result."""
    decoder = json.JSONDecoder()
    candidates: list[dict[str, Any]] = []
    for start in [m.start() for m in re.finditer(r"\{", text)]:
        try:
            value, _ = decoder.raw_decode(text[start:])
        except json.JSONDecodeError:
            continue
        if isinstance(value, dict):
            candidates.append(value)
    for value in reversed(candidates):
        if isinstance(value.get("alias"), str) and "when_done" in value:
            return value
    fail("seat-for did not return a readable binding; no browser action was taken")


def tab_id_from(text: str) -> int | None:
    """Read a tab id returned by the supported extension tools, not a guessed id."""
    values = re.findall(r'"tabId"\s*:\s*(\d+)', text)
    return int(values[-1]) if values else None


def tab_ids_from(text: str) -> set[int]:
    return {int(value) for value in re.findall(r'"tabId"\s*:\s*(\d+)', text)}


def ccl(lane: str, session: str, bridge_id: str, tool: str, args: dict[str, Any]) -> str:
    return command_output([
        sys.executable, CCL, "--lane", lane, "--session", session,
        bridge_id, tool, json.dumps(args, separators=(",", ":")),
    ])


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Open a task-owned eBay or Reflexity RAM listing workspace.",
        epilog=(
            "Examples: ram-browser ebay revise 800789256171 ; "
            "ram-browser reflexity product 6acd9f590fc6347f1eec8efd"
        ),
    )
    parser.add_argument("--dry-run", action="store_true", help="Print the exact route without opening Chrome or a lease.")
    parser.add_argument("service", choices=sorted(PROFILES))
    parser.add_argument("mode", help="eBay: active, drafts, create, item, revise. Reflexity: admin-products, create, product.")
    parser.add_argument("identifier", nargs="?", help="Required for eBay item/revise and Reflexity product.")
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    url = target_url(args.service, args.mode, args.identifier)
    plan = Plan(args.service, args.mode, args.identifier, PROFILES[args.service], url)
    if args.dry_run:
        print(json.dumps({"dry_run": True, **plan.__dict__}, indent=2))
        return
    if not os.path.isfile(CCL):
        fail(f"supported browser bridge is missing: {CCL}")
    for tool in ("seat-for", "ai-navigation"):
        if not shutil.which(tool):
            fail(f"required command is unavailable: {tool}")

    suffix = f"{int(time.time())}-{os.getpid()}"
    session = f"ram-{plan.service}-{plan.mode}-{suffix}"
    task = session
    os.environ.setdefault("DISPLAY", ":0")
    seat = command_output([
        "seat-for", plan.profile, "--or-copy", "--task", task, "--session", session,
    ])
    binding = last_json_object(seat)
    lane = binding.get("alias")
    bridge_id = binding.get("bridge_id")
    when_done = binding.get("when_done")
    if not isinstance(lane, str) or not isinstance(bridge_id, str) or not bridge_id:
        fail("seat-for returned no exact lane or bridge id; run the returned cleanup command if one was supplied")

    # These are separate calls so every action gets the lane check and an error
    # cannot cause a stale batch to continue.  The created tab is task-owned.
    try:
        command_output(["ai-navigation", "check", "--lane", lane, "--session", session])
        before = ccl(lane, session, bridge_id, "tabs_context_mcp", {"createIfEmpty": False})
        # seat-for supplies one unique task-owned starter. Reuse it so startup
        # requires no extra tab creation or second context round trip.
        context = None
        for line in before.splitlines():
            if line.startswith("{"):
                try:
                    candidate = json.loads(line)
                    if "availableTabs" in candidate:
                        context = candidate
                        break
                except json.JSONDecodeError:
                    pass
        starters = [tab for tab in (context or {}).get("availableTabs", [])
                    if tab.get("title", "").startswith(f"Agent Workspace - {task} - ")]
        if len(starters) != 1:
            fail("expected exactly one task-owned starter tab; no other tab will be touched")
        tab_id = starters[0]["tabId"]
        command_output(["ai-navigation", "check", "--lane", lane, "--session", session])
        navigation = ccl(lane, session, bridge_id, "navigate", {"url": url, "tabId": tab_id})
        close_tab = shlex.join([sys.executable, CCL, "--lane", lane, "--session", session,
                               bridge_id, "tabs_close_mcp", json.dumps({"tabId": tab_id})])
        when_done = close_tab + " ; " + when_done
    except SystemExit:
        print(json.dumps({
            "opened": False,
            **plan.__dict__,
            "task": task,
            "session": session,
            "lane": lane,
            "when_done": when_done,
            "next_step": "Run when_done to release the owned browser workspace after inspecting any partial state.",
        }, indent=2), file=sys.stderr)
        raise
    print(json.dumps({
        "opened": True,
        **plan.__dict__,
        "task": task,
        "session": session,
        "lane": lane,
        "bridge_id": bridge_id,
        "tab_id": tab_id,
        "when_done": when_done,
        "navigation_readback": navigation[-1200:],
    }, indent=2))


if __name__ == "__main__":
    main()
