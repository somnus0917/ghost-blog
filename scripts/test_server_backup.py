from __future__ import annotations

import os
import subprocess
import tempfile
import unittest
from pathlib import Path


REPO_ROOT = Path(__file__).resolve().parents[1]
BACKUP_SCRIPT = REPO_ROOT / "server" / "backup.sh"


class ServerBackupTests(unittest.TestCase):
    def test_keeps_valid_local_backup_when_restic_is_unavailable(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            install_dir = root / "ghost-blog"
            fake_bin = root / "bin"
            (install_dir / "content" / "images").mkdir(parents=True)
            fake_bin.mkdir()
            (install_dir / "content" / "images" / "cover.txt").write_text(
                "backup fixture\n", encoding="utf-8"
            )
            (install_dir / ".env").write_text(
                "\n".join(
                    (
                        "MYSQL_USER=ghost",
                        "MYSQL_PASSWORD=test-password",
                        "MYSQL_DATABASE=ghost",
                        "RESTIC_REPOSITORY=s3:test-bucket",
                        f"RESTIC_PASSWORD_FILE={root / 'restic-password'}",
                        "",
                    )
                ),
                encoding="utf-8",
            )
            (root / "restic-password").write_text("test\n", encoding="utf-8")

            docker = fake_bin / "docker"
            docker.write_text(
                "#!/bin/sh\n"
                "printf '%s\\n' 'CREATE TABLE posts (id varchar(24));'\n",
                encoding="utf-8",
            )
            docker.chmod(0o755)
            restic = fake_bin / "restic"
            restic.write_text("#!/bin/sh\nexit 1\n", encoding="utf-8")
            restic.chmod(0o755)

            environment = os.environ.copy()
            environment["PATH"] = f"{fake_bin}:{environment['PATH']}"
            result = subprocess.run(
                ["bash", str(BACKUP_SCRIPT), str(install_dir)],
                check=False,
                capture_output=True,
                text=True,
                env=environment,
            )

            self.assertNotEqual(result.returncode, 0)
            self.assertIn("restic repository is unavailable", result.stderr)
            backups = sorted((install_dir / "backups").glob("ghost-*"))
            self.assertEqual(len(backups), 2)
            self.assertTrue(any(path.name.endswith(".sql.gz") for path in backups))
            self.assertTrue(any(path.name.endswith(".tar.gz") for path in backups))


if __name__ == "__main__":
    unittest.main()
