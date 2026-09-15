#!/usr/bin/env bash
# 发版脚本：把新版本号同步写进 update.json 和 app.js 的 APP_VERSION。
#
# 用法:
#   ./bump.sh                      # 版本号 = 当前时间 YYYYMMDDHHMM，updateTime = 今天
#   ./bump.sh 202609151830         # 指定版本号
#
# 改动说明请直接编辑 update.json 里的 changes 数组，脚本不碰它。
# 提交前会跑 check-version.sh 确认两处版本一致。

set -euo pipefail
cd "$(dirname "$0")"

VERSION="${1:-$(date +%Y%m%d%H%M)}"
if ! [[ "$VERSION" =~ ^[0-9]{12}$ ]]; then
  echo "版本号必须是 12 位数字(YYYYMMDDHHMM)，收到: $VERSION" >&2
  exit 1
fi

# 中文日期，和 update.json 现有格式一致
UPDATE_TIME="$(date +%Y年%-m月%-d日)"

python3 - "$VERSION" "$UPDATE_TIME" <<'EOF'
import json, re, sys, pathlib
version, update_time = sys.argv[1], sys.argv[2]

# update.json：只改 version / updateTime，保留 changes 与缩进格式
p = pathlib.Path('update.json')
data = json.loads(p.read_text(encoding='utf-8'))
data['version'] = version
data['updateTime'] = update_time
p.write_text(json.dumps(data, ensure_ascii=False, indent=4) + '\n', encoding='utf-8')

# app.js：替换 APP_VERSION 常量
p = pathlib.Path('app.js')
src = p.read_text(encoding='utf-8')
new, n = re.subn(r"^const APP_VERSION = '\d+';", f"const APP_VERSION = '{version}';", src, count=1, flags=re.M)
if n != 1:
    sys.exit('app.js 里找不到 APP_VERSION 常量')
p.write_text(new, encoding='utf-8')
print(f'version  -> {version}')
print(f'updateTime -> {update_time}')
EOF

./check-version.sh
