# E2E 测试

[![Firefox E2E 测试](https://github.com/lingyicute/YiClapOnline/actions/workflows/firefox-e2e.yml/badge.svg)](https://github.com/lingyicute/YiClapOnline/actions/workflows/firefox-e2e.yml)
[![WebKit E2E 测试](https://github.com/lingyicute/YiClapOnline/actions/workflows/webkit-e2e.yml/badge.svg)](https://github.com/lingyicute/YiClapOnline/actions/workflows/webkit-e2e.yml)

用**真实浏览器引擎**对站点做端到端黑盒测试：搜索、播放（含音频流真实加载、进度、seek）、收藏、下载弹窗、主题、音质设置、移动端视口、容错等约 37 项断言。两个引擎的断言一一对应，方便对照：

| 引擎 | 驱动 | 说明 |
| --- | --- | --- |
| Firefox | Selenium + 官方构建 | `latest-esr` 与 `latest` 两个版本 |
| WebKit | Playwright 自带构建（与 Safari 同源内核） | Linux CI 上无 Safari/WebKit driver，这是唯一可跑的真实 WebKit |

## CI 行为

- 触发：每次 `push`、每个 `pull_request`，也可在 Actions 页手动 `workflow_dispatch`（可选“冒烟模式”，跳过依赖在线音乐 API 的用例）
- 产物：`Artifacts → firefox-e2e-<版本>` / `webkit-e2e` 里有逐步截图（PNG）与 `report.json`
- 失败时任务变红，提交记录旁出现 ❌（配合分支保护可阻止合并）

> 说明：播放断言依赖公开的音乐 API（`nextmusic.toubiec.cn`）。如果某天为外部 API 挂掉而误报，
> 手动重跑时勾选 **skip_network_tests** 即可只跑不依赖它的冒烟子集。

## 本地复现

### Firefox 版

```bash
pip install -r tests/requirements.txt

# 1. 起站点
python3 -m http.server 8000 &

# 2. 无 Linux 声卡的环境（容器/WSL/服务器）需要虚拟声卡，否则音频流无法启动
printf 'pcm.!default {\n  type null\n}\n' > ~/.asoundrc

# 3. 跑测试（headless）
python3 tests/e2e.py

# 冒烟模式 / 看窗口调试
SKIP_NETWORK_TESTS=1 python3 tests/e2e.py
HEADLESS=0 python3 tests/e2e.py
```

结果在 `test-results/`（截图 + `report.json`），退出码 0/1 对应全过/有失败。

### WebKit 版

```bash
pip install -r tests/requirements-webkit.txt

# 1. 装 WebKit 浏览器本体（含 GStreamer 等系统依赖；macOS 上去掉 --with-deps）
python3 -m playwright install --with-deps webkit

# 2. 起站点
python3 -m http.server 8000 &

# 3. 无 Linux 声卡的环境同样需要虚拟声卡（给 GStreamer 当音频槽）。
#    注意 null 设备不是实时阻塞的，播放时钟可能快于实时——断言只关心
#    “动没动/跳没跳”，快慢两种时钟下都成立。
printf 'pcm.!default {\n  type null\n}\n' > ~/.asoundrc

# 4. 跑测试（headless；OUT_DIR 换个名字可与 Firefox 版结果并存）
OUT_DIR=test-results-webkit python3 tests/e2e_webkit.py

# 冒烟模式 / 看窗口调试（Linux 有窗口模式需配合 xvfb-run -a）
SKIP_NETWORK_TESTS=1 OUT_DIR=test-results-webkit python3 tests/e2e_webkit.py
HEADLESS=0 OUT_DIR=test-results-webkit python3 tests/e2e_webkit.py
```

结果在 `OUT_DIR` 指定的目录（截图 + `report.json`），退出码 0/1/2 对应全过/有失败/框架异常。

## 文件

| 文件 | 说明 |
| --- | --- |
| `tests/e2e.py` | Selenium 测试套件（Firefox，黑盒，不改站点代码） |
| `tests/e2e_webkit.py` | Playwright 测试套件（WebKit，断言与 Firefox 版一一对应，另多一项引擎确认） |
| `tests/requirements.txt` | Firefox 版依赖（selenium） |
| `tests/requirements-webkit.txt` | WebKit 版依赖（playwright） |
| `.github/workflows/firefox-e2e.yml` | GitHub Actions 工作流（Firefox） |
| `.github/workflows/webkit-e2e.yml` | GitHub Actions 工作流（WebKit） |
