from __future__ import annotations

import json
import os
import subprocess
import tempfile
import unittest
from pathlib import Path


REPO_ROOT = Path(__file__).resolve().parents[1]
TOKENS_SCRIPT = REPO_ROOT / "tinybird" / "getTokens.sh"


class TinybirdTokenTests(unittest.TestCase):
    def run_script(self, token_names: tuple[str, ...]) -> subprocess.CompletedProcess[str]:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            fake_bin = root / "bin"
            fake_bin.mkdir()
            (root / ".tinyb").write_text(
                json.dumps(
                    {
                        "token": "user-token",
                        "host": "https://api.example.tinybird.co",
                        "id": "workspace-id",
                    }
                ),
                encoding="utf-8",
            )
            response = {
                "tokens": [
                    {"name": name, "token": f"{name}-value"} for name in token_names
                ]
            }
            curl = fake_bin / "curl"
            curl.write_text(
                "#!/bin/sh\nprintf '%s\\n' \"$TINYBIRD_TEST_RESPONSE\"\n",
                encoding="utf-8",
            )
            curl.chmod(0o755)
            environment = os.environ.copy()
            environment["PATH"] = f"{fake_bin}:{environment['PATH']}"
            environment["TINYBIRD_TEST_RESPONSE"] = json.dumps(response)
            return subprocess.run(
                ["bash", str(TOKENS_SCRIPT)],
                cwd=root,
                check=False,
                capture_output=True,
                text=True,
                env=environment,
            )

    def test_outputs_stats_page_token(self) -> None:
        result = self.run_script(("workspace admin token", "tracker", "stats_page"))

        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("TINYBIRD_STATS_TOKEN=stats_page-value", result.stdout)

    def test_fails_when_stats_page_token_is_missing(self) -> None:
        result = self.run_script(("workspace admin token", "tracker"))

        self.assertNotEqual(result.returncode, 0)
        self.assertIn("Tinybird token is missing: STATS_TOKEN", result.stderr)
        self.assertNotIn("TINYBIRD_ADMIN_TOKEN=", result.stdout)


if __name__ == "__main__":
    unittest.main()
