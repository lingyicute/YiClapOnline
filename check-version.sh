#!/usr/bin/env bash
# 校验 update.json 的 version 与 app.js 的 APP_VERSION 一致。
# 不一致时用户会在每次打开页面时被弹"发现新版本"却永远刷不掉，所以这个检查必须过。

set -euo pipefail
cd "$(dirname "$0")"

json_ver="$(python3 - <<'EOF'
import json, pathlib, re, sys
try:
    data = json.loads(pathlib.Path('update.json').read_text(encoding='utf-8'))
except (OSError, json.JSONDecodeError) as e:
    sys.exit(f'✗ update.json 读取或解析失败: {e}')
ver = data.get('version') if isinstance(data, dict) else None
if not isinstance(ver, str) or not re.fullmatch(r'[0-9]+', ver):
    sys.exit('✗ update.json 中的 version 缺失或格式非法')
print(ver)
EOF
)"

if [[ ! -f app.js ]]; then
  echo "✗ 找不到 app.js" >&2
  exit 1
fi

js_matches="$(LC_ALL=C grep -oE "^const APP_VERSION = '[0-9]+';" app.js || true)"
js_count="$(printf '%s\n' "$js_matches" | grep -c . || true)"

if [[ "$js_count" -eq 0 ]]; then
  echo "✗ app.js 里找不到 APP_VERSION" >&2
  exit 1
fi

if [[ "$js_count" -ne 1 ]]; then
  echo "✗ app.js 中存在多处 APP_VERSION 定义($js_count 处)" >&2
  exit 1
fi

js_ver="$(printf '%s\n' "$js_matches" | grep -oE '[0-9]+')"

if [[ "$json_ver" != "$js_ver" ]]; then
  echo "✗ 版本不一致: update.json=$json_ver  app.js=$js_ver" >&2
  echo "  运行 ./bump.sh 同步，或手动改成一致" >&2
  exit 1
fi

echo "✓ 版本一致: $json_ver"
