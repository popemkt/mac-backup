from __future__ import annotations

import copy
from pathlib import Path
import sys
import unittest
import xml.etree.ElementTree as ET

sys.path.insert(0, str(Path(__file__).parents[1]))

import reconcile_eset_orca_firewall as firewall


RULE_XML = """
<ESET>
  <PRODUCT>
    <ITEM NAME="Settings">
      <ITEM NAME="Firewall">
        <ITEM NAME="Rules" DELETE="1">
          <ITEM NAME="1">
            <NODE NAME="Uuid" TYPE="string" VALUE="ffffffff-ffff-ffff-ffff-ffff80000001" />
            <NODE NAME="Enabled" TYPE="number" VALUE="1" />
            <NODE NAME="DisplayName" TYPE="string" VALUE="Existing rule" />
            <NODE NAME="Description" TYPE="string" VALUE="" />
            <NODE NAME="Action" TYPE="number" VALUE="1" />
            <NODE NAME="NotifyUser" TYPE="number" VALUE="0" />
            <NODE NAME="ReportResponse" TYPE="number" VALUE="0" />
            <NODE NAME="ReportSeverity" TYPE="number" VALUE="0" />
            <ITEM NAME="Application">
              <NODE NAME="DisplayName" TYPE="string" VALUE="" />
              <NODE NAME="Icon" TYPE="string" VALUE="" />
              <NODE NAME="Path" TYPE="string" VALUE="" />
              <NODE NAME="Signature" TYPE="number" VALUE="0" />
              <NODE NAME="SignerName" TYPE="string" VALUE="" />
              <NODE NAME="PackageName" TYPE="string" VALUE="" />
            </ITEM>
            <NODE NAME="WindowsServiceName" TYPE="string" VALUE="" />
            <NODE NAME="MatchChildProcessess" TYPE="number" VALUE="0" />
            <NODE NAME="TargetOsFamily" TYPE="number" VALUE="3" />
            <NODE NAME="Direction" TYPE="number" VALUE="0" />
            <NODE NAME="NetworkProtocol" TYPE="number" VALUE="0" />
            <NODE NAME="NetworkProtocolNumber" TYPE="number" VALUE="0" />
            <NODE NAME="LocalPorts" TYPE="string" VALUE="" />
            <NODE NAME="RemotePorts" TYPE="string" VALUE="" />
            <NODE NAME="IcmpTypes" TYPE="string" VALUE="" />
            <NODE NAME="LocalIpAddresses" TYPE="string" VALUE="" />
            <ITEM NAME="LocalIpSetsUuids" DELETE="1" />
            <NODE NAME="RemoteIpAddresses" TYPE="string" VALUE="" />
            <ITEM NAME="RemoteIpSetsUuids" DELETE="1" />
            <ITEM NAME="ConnectionProfileUuids" DELETE="1" />
          </ITEM>
        </ITEM>
      </ITEM>
    </ITEM>
  </PRODUCT>
</ESET>
"""


class EnsureRuleTest(unittest.TestCase):
    def setUp(self) -> None:
        self.root = ET.fromstring(RULE_XML)
        self.arguments = {
            "application_path": "/Applications/Orca.app/Contents/MacOS/Orca",
            "local_address": "100.114.213.27",
            "remote_addresses": ["100.124.163.25", "100.70.17.62"],
        }

    def test_adds_narrow_inbound_rule_without_changing_existing_rule(self) -> None:
        rules = firewall.find_rules(self.root)
        existing = copy.deepcopy(rules[0])

        self.assertTrue(firewall.ensure_rule(self.root, **self.arguments))

        self.assertEqual(2, len(rules))
        self.assertEqual(ET.tostring(existing), ET.tostring(rules[0]))
        rule = firewall.find_rule(rules)
        self.assertIsNotNone(rule)
        assert rule is not None
        self.assertEqual("1", firewall.node_value(rule, "Enabled"))
        self.assertEqual("1", firewall.node_value(rule, "Action"))
        self.assertEqual("1", firewall.node_value(rule, "Direction"))
        self.assertEqual("6", firewall.node_value(rule, "NetworkProtocol"))
        self.assertEqual("", firewall.node_value(rule, "LocalPorts"))
        self.assertEqual("100.114.213.27", firewall.node_value(rule, "LocalIpAddresses"))
        self.assertEqual(
            "100.124.163.25,100.70.17.62",
            firewall.node_value(rule, "RemoteIpAddresses"),
        )
        self.assertEqual(
            "/Applications/Orca.app/Contents/MacOS/Orca",
            firewall.node_value(rule.find("./ITEM[@NAME='Application']"), "Path"),
        )

    def test_is_idempotent(self) -> None:
        self.assertTrue(firewall.ensure_rule(self.root, **self.arguments))
        first = ET.tostring(self.root)

        self.assertFalse(firewall.ensure_rule(self.root, **self.arguments))

        self.assertEqual(first, ET.tostring(self.root))

    def test_updates_existing_orca_rule_in_place(self) -> None:
        firewall.ensure_rule(self.root, **self.arguments)
        rules = firewall.find_rules(self.root)
        rule = firewall.find_rule(rules)
        assert rule is not None
        original_uuid = firewall.node_value(rule, "Uuid")
        firewall.set_node(rule, "RemoteIpAddresses", "100.64.0.1")

        self.assertTrue(firewall.ensure_rule(self.root, **self.arguments))

        self.assertEqual(2, len(rules))
        self.assertEqual(original_uuid, firewall.node_value(rule, "Uuid"))
        self.assertEqual(
            "100.124.163.25,100.70.17.62",
            firewall.node_value(rule, "RemoteIpAddresses"),
        )

    def test_rejects_missing_rule_schema(self) -> None:
        rules = firewall.find_rules(self.root)
        application = rules[0].find("./ITEM[@NAME='Application']")
        assert application is not None
        application.remove(application.find("./NODE[@NAME='Path']"))

        with self.assertRaisesRegex(ValueError, "Path"):
            firewall.ensure_rule(self.root, **self.arguments)


if __name__ == "__main__":
    unittest.main()
