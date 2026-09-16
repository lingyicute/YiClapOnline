# Firefox E2E 测试

[![Firefox E2E 测试](https://github.com/lingyicute/YiClapOnline/actions/workflows/firefox-e2e.yml/badge.svg)](https://github.com/lingyicute/YiClapOnline/actions/workflows/firefox-e2e.yml)

用 **真实 Firefox** 对站点做端到端黑盒测试：搜索、播放（含音频流真实加载、进度、seek）、收藏、下载弹窗、主题、音质设置、移动端视口、容错等约 37 项断言。

## CI 行为

- 触发：每次 `push`、每个 `pull_request`，也可在 Actions 页手动 `workflow_dispatch`（可选“冒烟模式”，跳过依赖在线音乐 API 的用例）
- 矩阵：`latest-esr` 与 `latest` 两个 Firefox 官方构建
- 产物：`Artifacts → firefox-e2e-<版本>` 里有逐步截图（PNG）与 `report.json`
- 失败时任务变红，提交记录旁出现 ❌（配合分支保护可阻止合并）

> 说明：播放断言依赖公开的音乐 API（`nextmusic.toubiec.cn`）。如果某天为外部 API 挂掉而误报，
> 手动重跑时勾选 **skip_network_tests** 即可只跑不依赖它的冒烟子集。

## 本地复现

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

## 文件

| 文件 | 说明 |
| --- | --- |
| `tests/e2e.py` | Selenium 测试套件（黑盒，不改站点代码） |
| `tests/requirements.txt` | 依赖（selenium） |
| `.github/workflows/firefox-e2e.yml` | GitHub Actions 工作流 |
