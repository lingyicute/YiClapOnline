#!/usr/bin/env bash
# 发版脚本：把新版本号同步写进 update.json 和 app.js 的 APP_VERSION。
#
# 版本号格式: YYYYMMDD + 4 位顺序号，例如 202609152400、202609152401 ...
#   - 与上一版不是同一天  -> 日期换成今天，顺序号从 2400 开始
#     (2400 大于任何 HHMM 时间值，所以比历史上按"时间"生成的版本号都大，
#      同一天内也不会和旧格式撞车)
#   - 与上一版是同一天    -> 顺序号 +1 (2400 -> 2401 -> 2402 ...)
#
# 用法:
#   ./bump.sh                      # 自动算下一个版本号
#   ./bump.sh 202609152405         # 指定版本号(12 位数字即可，跳过自动计算)
#
# 改动说明请直接编辑 update.json 里的 changes 数组，脚本不碰它。
# 提交前会跑 check-version.sh 确认两处版本一致。

set -euo pipefail
cd "$(dirname "$0")"

TODAY="$(date +%Y%m%d)"
CURRENT="$(python3 -c "import json;print(json.load(open('update.json',encoding='utf-8'))['version'])")"

if [[ $# -ge 1 ]]; then
  VERSION="$1"
  if ! [[ "$VERSION" =~ ^[0-9]{12}$ ]]; then
    echo "版本号必须是 12 位数字(YYYYMMDD + 4 位顺序号)，收到: $VERSION" >&2
    exit 1
  fi
else
  if ! [[ "$CURRENT" =~ ^[0-9]{12}$ ]]; then
    echo "update.json 里的版本号格式不对(应为 12 位数字): $CURRENT" >&2
    exit 1
  fi
  CUR_DATE="${CURRENT:0:8}"
  CUR_SEQ="${CURRENT:8:4}"

  if [[ "$CUR_DATE" == "$TODAY" ]]; then
    # 同一天：顺序号 +1。10# 前缀防止 "0800" 这种被 bash 当成八进制
    if (( 10#$CUR_SEQ < 2400 )); then
      SEQ=2400            # 今天之前用的还是旧的 HHMM 格式，直接切到顺序号
    else
      SEQ=$(( 10#$CUR_SEQ + 1 ))
    fi
    if (( SEQ > 9999 )); then
      echo "今天的顺序号已用完($CUR_SEQ)，明天再发或手动指定版本号" >&2
      exit 1
    fi
  elif (( 10#$CUR_DATE > 10#$TODAY )); then
    # 上一版的日期比今天还晚：多半是系统时钟或时区不对。新版本号会比旧的小，先拦住
    echo "上一版日期($CUR_DATE)晚于今天($TODAY)，请检查系统时间；确实要发请手动指定版本号" >&2
    exit 1
  else
    SEQ=2400
  fi
  VERSION="${TODAY}${SEQ}"
fi

if [[ "$VERSION" == "$CURRENT" ]]; then
  echo "版本号没变($VERSION)，什么都不做" >&2
  exit 1
fi

# 中文日期，和 update.json 现有格式一致；按版本号里的日期而不是今天，手动指定时两者才一致
V_YEAR="${VERSION:0:4}"; V_MONTH="$((10#${VERSION:4:2}))"; V_DAY="$((10#${VERSION:6:2}))"
UPDATE_TIME="${V_YEAR}年${V_MONTH}月${V_DAY}日"

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
EOF

echo "version    $CURRENT -> $VERSION"
echo "updateTime -> $UPDATE_TIME"
./check-version.sh
