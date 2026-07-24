from __future__ import annotations

import os
import subprocess
import tempfile
import unittest
from pathlib import Path


REPO_ROOT = Path(__file__).resolve().parents[1]
INSTALL_SCRIPT = REPO_ROOT / "server" / "install-caddy-blog.sh"


class InstallCaddyTests(unittest.TestCase):
    def run_installer(
        self, worker_secret: str, members_secret: str | None
    ) -> subprocess.CompletedProcess[str]:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            fake_bin = root / "bin"
            fake_bin.mkdir()
            config = root / "Caddyfile"
            snippet = root / "Caddyfile.snippet"
            config.write_text("blog.somnus.wiki {\n    respond 200\n}\n", encoding="utf-8")
            snippet.write_text("blog.somnus.wiki {\n    respond 200\n}\n", encoding="utf-8")

            docker = fake_bin / "docker"
            docker.write_text(
                "#!/bin/sh\n"
                "if [ \"$1\" = inspect ] && [ \"$2\" = --format ]; then\n"
                "    printf '%s\\n' \"WORKER_PROXY_SECRET=$TEST_WORKER_SECRET\"\n"
                "    if [ -n \"$TEST_MEMBERS_SECRET\" ]; then\n"
                "        printf '%s\\n' \"MEMBERS_PROXY_SECRET=$TEST_MEMBERS_SECRET\"\n"
                "    fi\n"
                "fi\n"
                "exit 0\n",
                encoding="utf-8",
            )
            docker.chmod(0o755)

            environment = os.environ.copy()
            environment["PATH"] = f"{fake_bin}:{environment['PATH']}"
            environment["TEST_WORKER_SECRET"] = worker_secret
            environment["TEST_MEMBERS_SECRET"] = members_secret or ""
            return subprocess.run(
                [
                    "bash",
                    str(INSTALL_SCRIPT),
                    str(config),
                    str(snippet),
                    "test-caddy",
                ],
                check=False,
                capture_output=True,
                text=True,
                env=environment,
            )

    def test_rejects_missing_members_proxy_secret(self) -> None:
        result = self.run_installer("w" * 32, None)

        self.assertNotEqual(result.returncode, 0)
        self.assertIn("without MEMBERS_PROXY_SECRET", result.stderr)

    def test_rejects_reused_proxy_secret(self) -> None:
        result = self.run_installer("s" * 32, "s" * 32)

        self.assertNotEqual(result.returncode, 0)
        self.assertIn("must use different values", result.stderr)


if __name__ == "__main__":
    unittest.main()
