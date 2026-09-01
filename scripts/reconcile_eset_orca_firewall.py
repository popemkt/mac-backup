#!/usr/bin/env python3
"""Idempotently allow Orca Mobile traffic through ESET on the work Mac."""

from __future__ import annotations

import argparse
import copy
import ipaddress
import os
from pathlib import Path
import subprocess
import tempfile
import uuid
import xml.etree.ElementTree as ET

RULE_NAME = "Allow Orca Mobile over Tailscale"

RULE_FIELDS = {
    "Enabled": "1",
    "DisplayName": RULE_NAME,
    "Description": "Inbound Orca Mobile from approved tailnet devices",
    "Action": "1",
    "NotifyUser": "0",
    "ReportResponse": "0",
    "ReportSeverity": "0",
    "WindowsServiceName": "",
    "MatchChildProcessess": "0",
    "TargetOsFamily": "3",
    "Direction": "1",
    "NetworkProtocol": "6",
    "NetworkProtocolNumber": "0",
    "LocalPorts": "",
    "RemotePorts": "",
    "IcmpTypes": "",
}

APPLICATION_FIELDS = {
    "DisplayName": "Orca",
    "Icon": "",
    "Signature": "0",
    "SignerName": "",
    "PackageName": "",
}

EMPTY_COLLECTIONS = (
    "LocalIpSetsUuids",
    "RemoteIpSetsUuids",
    "ConnectionProfileUuids",
)


def node_value(item: ET.Element, name: str) -> str | None:
    node = item.find(f"./NODE[@NAME='{name}']")
    return None if node is None else node.get("VALUE")


def set_node(item: ET.Element, name: str, value: str) -> None:
    node = item.find(f"./NODE[@NAME='{name}']")
    if node is None:
        raise ValueError(f"ESET rule schema is missing {name!r}")
    node.set("VALUE", value)


def find_rules(root: ET.Element) -> ET.Element:
    for item in root.iter("ITEM"):
        if item.get("NAME") != "Firewall":
            continue
        rules = item.find("./ITEM[@NAME='Rules']")
        if rules is not None and list(rules):
            return rules
    raise ValueError("ESET firewall rule collection was not found")


def next_rule_slot(rules: ET.Element) -> str:
    try:
        return format(max(int(rule.get("NAME", ""), 16) for rule in rules) + 1, "X")
    except ValueError as error:
        raise ValueError("ESET firewall rule slot is not hexadecimal") from error


def find_rule(rules: ET.Element) -> ET.Element | None:
    matches = [rule for rule in rules if node_value(rule, "DisplayName") == RULE_NAME]
    if len(matches) > 1:
        raise ValueError(f"multiple ESET rules are named {RULE_NAME!r}")
    return matches[0] if matches else None


def ensure_rule(
    root: ET.Element,
    *,
    application_path: str,
    local_address: str,
    remote_addresses: list[str],
) -> bool:
    rules = find_rules(root)
    rule = find_rule(rules)
    before = ET.tostring(rule) if rule is not None else None

    if rule is None:
        rule = copy.deepcopy(rules[0])
        rule.set("NAME", next_rule_slot(rules))
        set_node(rule, "Uuid", str(uuid.uuid4()))
        rule.tail = rules[-1].tail
        rules.append(rule)

    for name, value in RULE_FIELDS.items():
        set_node(rule, name, value)
    set_node(rule, "LocalIpAddresses", local_address)
    set_node(rule, "RemoteIpAddresses", ",".join(remote_addresses))

    application = rule.find("./ITEM[@NAME='Application']")
    if application is None:
        raise ValueError("ESET rule schema is missing the Application item")
    for name, value in APPLICATION_FIELDS.items():
        set_node(application, name, value)
    set_node(application, "Path", application_path)

    for collection_name in EMPTY_COLLECTIONS:
        collection = rule.find(f"./ITEM[@NAME='{collection_name}']")
        if collection is None:
            raise ValueError(f"ESET rule schema is missing {collection_name!r}")
        for child in list(collection):
            collection.remove(child)

    return before != ET.tostring(rule)


def validate_addresses(local_address: str, remote_addresses: list[str]) -> None:
    ipaddress.ip_address(local_address)
    if not remote_addresses:
        raise ValueError("at least one remote address is required")
    for address in remote_addresses:
        ipaddress.ip_address(address)


def run_cfg(cfg: Path, operation: str, path: Path) -> None:
    subprocess.run([os.fspath(cfg), f"--{operation}-xml={path}"], check=True)


def reconcile(
    *,
    cfg: Path,
    application_path: str,
    local_address: str,
    remote_addresses: list[str],
) -> bool:
    validate_addresses(local_address, remote_addresses)

    with tempfile.TemporaryDirectory(prefix="eset-orca-firewall-") as directory:
        workdir = Path(directory)
        original_path = workdir / "original.xml"
        modified_path = workdir / "modified.xml"
        active_path = workdir / "active.xml"

        run_cfg(cfg, "export", original_path)
        tree = ET.parse(original_path)
        changed = ensure_rule(
            tree.getroot(),
            application_path=application_path,
            local_address=local_address,
            remote_addresses=remote_addresses,
        )
        if not changed:
            return False

        tree.write(modified_path, encoding="utf-8", xml_declaration=True)
        try:
            run_cfg(cfg, "import", modified_path)
            run_cfg(cfg, "export", active_path)
            active_tree = ET.parse(active_path)
            if ensure_rule(
                active_tree.getroot(),
                application_path=application_path,
                local_address=local_address,
                remote_addresses=remote_addresses,
            ):
                raise RuntimeError("ESET did not persist the Orca firewall rule")
        except Exception:
            run_cfg(cfg, "import", original_path)
            raise

    return True


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--cfg", type=Path, required=True, help="ESET cfg executable")
    parser.add_argument("--application", required=True, help="Orca executable path")
    parser.add_argument("--local-address", required=True, help="Work Mac Tailscale IPv4 address")
    parser.add_argument(
        "--remote-address",
        action="append",
        default=[],
        help="Approved Orca Mobile Tailscale IPv4 address; repeat for each device",
    )
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    changed = reconcile(
        cfg=args.cfg,
        application_path=args.application,
        local_address=args.local_address,
        remote_addresses=args.remote_address,
    )
    print("updated ESET Orca firewall rule" if changed else "ESET Orca firewall rule already current")


if __name__ == "__main__":
    main()
