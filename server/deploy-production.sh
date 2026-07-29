#!/usr/bin/env bash
set -euo pipefail

# This is intentionally the only command the ghost-deploy SSH account may run
# as ubuntu. Keep the bundle path fixed so sudoers cannot be used to execute
# arbitrary repository code or reference arbitrary local files.
install_dir="/home/ubuntu/ghost-blog"
bundle="/tmp/ghost-blog-main.bundle"

if [[ "${1:-$bundle}" != "$bundle" ]]; then
  echo "usage: deploy-production.sh [/tmp/ghost-blog-main.bundle]" >&2
  exit 2
fi
test -r "$bundle"

cd "$install_dir"
git fetch --force "$bundle" main:refs/remotes/origin/main
git checkout --detach --force origin/main
git reset --hard origin/main
bash server/bootstrap.sh
bash server/install-caddy-blog.sh /home/ubuntu/caddy/Caddyfile Caddyfile.snippet edge-caddy
bash server/deploy-routes.sh routes.yaml "$install_dir"
