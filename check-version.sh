#!/usr/bin/env bash
# 校验 update.json 的 version 与 app.js 的 APP_VERSION 一致。
# 不一致时用户会在每次打开页面时被弹"发现新版本"却永远刷不掉，所以这个检查必须过。

set -euo pipefail
cd "$(dirname "$0")"

json_ver="$(python3 -c "import json;print(json.load(open('update.json',encoding='utf-8'))['version'])")"
js_ver="$(grep -oE "^const APP_VERSION = '[0-9]+';" app.js | grep -oE '[0-9]+')"

if [[ -z "$js_ver" ]]; then
  echo "✗ app.js 里找不到 APP_VERSION" >&2
  exit 1
fi

if [[ "$json_ver" != "$js_ver" ]]; then
  echo "✗ 版本不一致: update.json=$json_ver  app.js=$js_ver" >&2
  echo "  运行 ./bump.sh 同步，或手动改成一致" >&2
  exit 1
fi

echo "✓ 版本一致: $json_ver"
