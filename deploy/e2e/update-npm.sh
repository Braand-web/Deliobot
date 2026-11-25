#!/bin/bash
# Run as root in a disposable Linux systemd VM with Node 24, npm, curl and jq.
set -euo pipefail
[[ ${ODB_NPM_UPDATE_TEST_VM:-} == 1 && $EUID == 0 ]] ||
  { echo "Set ODB_NPM_UPDATE_TEST_VM=1 on a disposable systemd VM."; exit 1; }

updater=$(cd "$(dirname "$0")/.." && pwd)/update-npm.sh
fixture=/var/lib/odb-npm-update-fixture
unit_file=/etc/systemd/system/opendeliobot.service
journal=/var/lib/opendeliobot-npm-update/pending.json
account=ombupdate
home=/home/$account
npm_bin=$(command -v npm)
node_path=$(dirname "$(command -v node)")
for path in "$fixture" "$unit_file" "$home" "${journal%/*}" /usr/sbin/curl /usr/sbin/sleep; do
  [[ ! -e $path && ! -L $path ]] || { echo "Fixture path already exists: $path"; exit 1; }
done
if getent passwd "$account" >/dev/null || systemctl cat opendeliobot.service >/dev/null 2>&1; then
  echo "The fixture needs its own service and account."
  exit 1
fi
install -d -m 0755 "$fixture"
useradd --create-home --home-dir "$home" "$account"
as_account() { runuser -u "$account" -- env -C "$home" "HOME=$home" "PATH=$home/.local/bin:$node_path:/usr/bin:/bin" "$@"; }
as_account mkdir -p "$home/.local/bin" "$home/.opendeliobot"
as_account touch "$home/.opendeliobot/before-update"

mkdir "$fixture/dependency" "$fixture/package"
printf '%s\n' '{"name":"update-fixture-dependency","version":"1.0.0","main":"index.js"}' >"$fixture/dependency/package.json"
echo 'module.exports = 8799' >"$fixture/dependency/index.js"
"$npm_bin" pack --quiet --pack-destination "$fixture" "$fixture/dependency"
cat >"$fixture/package/cli.js" <<'JS'
#!/usr/bin/env node
const { fork } = require('node:child_process');
const { join } = require('node:path');
const { writeFileSync } = require('node:fs');
const { createServer } = require('node:http');
const port = require('update-fixture-dependency');
const { version } = require('./package.json');
if (!process.argv.includes('--http-child')) {
  const child = fork(__filename, ['--http-child'], {
    env: { ...process.env, ODB_DATA_DIR: join(process.env.HOME, '.opendeliobot'), ODB_PORT: String(port) },
  });
  child.on('exit', code => process.exit(code ?? 1));
} else {
  writeFileSync(join(process.env.ODB_DATA_DIR, version), 'fixture startup\n');
  createServer((req, res) => {
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify(req.url === '/api/health/engines'
      ? { app: 'opendeliobot', engines: ['0.1.3', '0.1.4', '0.1.5'].includes(version) ? 0 : 1 }
      : { app: 'opendeliobot', version, pid: process.pid }));
  }).listen(port, '127.0.0.1');
}
JS
chmod 755 "$fixture/package/cli.js"
for version in 0.1.1 0.1.2 0.1.3 0.1.4 0.1.5; do
  jq -n --arg version "$version" --arg dep "file:$fixture/update-fixture-dependency-1.0.0.tgz" \
    '{name:"opendeliobot", $version, bin:{opendeliobot:"cli.js"}, dependencies:{"update-fixture-dependency":$dep}}' >"$fixture/package/package.json"
  "$npm_bin" pack --quiet --pack-destination "$fixture" "$fixture/package"
done
as_account "$npm_bin" install --offline --global --prefix "$home/.local" "$fixture/opendeliobot-0.1.1.tgz"
ln -s "$npm_bin" "$fixture/npm"
cat >"$home/.local/bin/npm" <<'EOF'
#!/bin/bash
args=("$@")
release=${args[-1]#opendeliobot@}
unset 'args[-1]'
exec /var/lib/odb-npm-update-fixture/npm "${args[@]}" --offline "/var/lib/odb-npm-update-fixture/opendeliobot-$release.tgz"
EOF
chmod 755 "$home/.local/bin/npm"
chown "$account:$account" "$home/.local/bin/npm"
cat >/usr/sbin/curl <<'EOF'
#!/bin/bash
if [[ "${!#}" == https://raw.githubusercontent.com/Braand-web/Deliobot/channels/stable.json ]]; then
  cat /var/lib/odb-npm-update-fixture/stable.json
else
  exec /usr/bin/curl "$@"
fi
EOF
printf '%s\n' '#!/bin/sh' 'exec /usr/bin/sleep 0.08' >/usr/sbin/sleep
chmod 755 /usr/sbin/curl /usr/sbin/sleep

cat >"$unit_file" <<EOF
[Unit]
Description=OpenDeliobot npm update fixture

[Service]
User=$account
WorkingDirectory=$home
Environment=HOME=$home
Environment=PATH=$home/.local/bin:$node_path:/usr/bin:/bin
ExecStart=$home/.local/bin/opendeliobot serve --tunnel
Restart=always
RestartSec=5
EOF
systemctl daemon-reload
systemctl start opendeliobot.service

health() { /usr/bin/curl -fsS http://127.0.0.1:8799/api/health 2>/dev/null | jq -er ".$1"; }
wait_version() {
  for ((i = 0; i < 150; i++)); do
    [[ $(health version) == "$1" ]] && return 0
    /usr/bin/sleep 0.05
  done
  journalctl -u opendeliobot.service -n 15
  return 1
}
stable() { jq -n --arg version "$1" '{$version}' >"$fixture/stable.json"; }
expect_failure() {
  local message=$1 output
  shift
  if output=$("$updater" "$@" 2>&1); then
    printf 'Expected failure, got:\n%s\n' "$output"
    return 1
  fi
  printf '%s\n' "$output"
  [[ $output == *"$message"* ]]
}

wait_version 0.1.1
old_pid=$(health pid)
printf 'broken manifest\n' >"$fixture/stable.json"
expect_failure "Can't read the stable release"
[[ $(health pid) == "$old_pid" ]]
printf 'Verify stage failure preserves the existing service\n'
stable 0.1.9
expect_failure 'npm could not stage'
[[ $(health pid) == "$old_pid" ]]

stable 0.1.2
cp "$unit_file" "$fixture/original.service"
printf 'Environment=ODB_DATA_DIR=/non-default\n' >>"$unit_file"
systemctl daemon-reload
expect_failure 'additional environment settings'
[[ $(health pid) == "$old_pid" ]]
cp "$fixture/original.service" "$unit_file"
systemctl daemon-reload

"$updater"
[[ $(health version) == 0.1.2 && -f $home/.opendeliobot/before-update && ! -e $journal ]]
new_pid=$(health pid)
"$updater"
[[ $(health pid) == "$new_pid" ]]

stable 0.1.3
expect_failure 'OpenDeliobot 0.1.2 is running again'
[[ $(health version) == 0.1.2 && ! -e $home/.opendeliobot/0.1.3 && ! -e $journal ]]
compgen -G "$home/.opendeliobot-update.*/failed-data.*/data/0.1.3" >/dev/null

stable 0.1.4
"$updater" >"$fixture/interrupted.log" 2>&1 &
updating=$!
wait_version 0.1.4
expect_failure 'Another npm service update is running'
kill -KILL "$updating"
wait "$updating" 2>/dev/null || :
/usr/bin/sleep 0.2
expect_failure 'stopped at applying'
[[ $(health version) == 0.1.4 ]]
as_account touch "$home/.opendeliobot/after-interruption"
"$updater" --rollback
[[ $(health version) == 0.1.2 && ! -e $home/.opendeliobot/after-interruption && ! -e $journal ]]
compgen -G "$home/.opendeliobot-update.*/failed-data.*/data/after-interruption" >/dev/null

stable 0.1.5
"$updater" >"$fixture/interrupted-restore.log" 2>&1 &
updating=$!
wait_version 0.1.5
kill -KILL "$updating"
wait "$updating" 2>/dev/null || :
/usr/bin/sleep 0.2

# Recreate a reboot between preserving the failed workspace and moving the replacement into place.
run_id=$(jq -er .run "$journal")
workspace=$home/.opendeliobot-update.$run_id
modules=$home/.local/lib/node_modules
package=$modules/.opendeliobot-update.$run_id
systemctl stop opendeliobot.service
as_account mv -T "$modules/opendeliobot" "$package/failed"
as_account mv -T "$package/previous" "$modules/opendeliobot"
as_account cp -a "$workspace/snapshot" "$workspace/replacement"
inode=$(stat -c %i "$workspace/replacement")
jq --arg inode "$inode" '.phase = "restoring" | .restoreInode = $inode' "$journal" >"$journal.fixture"
mv "$journal.fixture" "$journal"
failed=$(as_account mktemp -d "$workspace/failed-data.XXXXXXXX")
as_account mv -T "$home/.opendeliobot" "$failed/data"
as_account mkdir "$home/.opendeliobot"
as_account touch "$home/.opendeliobot/new-after-reboot"
systemctl start opendeliobot.service
wait_version 0.1.2
"$updater" --rollback
[[ -f $home/.opendeliobot/before-update && ! -e $home/.opendeliobot/new-after-reboot && ! -e $journal ]]
[[ -f $failed/data/0.1.5 ]]
compgen -G "$workspace/failed-data.*/data/new-after-reboot" >/dev/null
printf 'Linux npm service update fixture passed.\n'
