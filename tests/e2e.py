# -*- coding: utf-8 -*-
"""
YiClapOnline —— Firefox 端到端测试（CI 版）

设计目标：
  - 零侵入：不改站点任何文件，纯黑盒驱动浏览器
  - CI 友好：失败/通过分级退出码、JSON 报告、逐步截图
  - 可复用：本地一行命令即可跑同样的测试（见 tests/README.md）

环境变量：
  BASE_URL            站点地址           默认 http://127.0.0.1:8000
  OUT_DIR             截图/报告输出目录   默认 test-results
  HEADLESS            0 表示打开窗口调试   默认 1
  SKIP_NETWORK_TESTS  1 表示跳过依赖在线  默认 0
                      音乐 API 的用例（冒烟模式）

退出码：0 = 全部通过；1 = 存在失败项；2 = 测试框架本身异常
"""
import json
import os
import time
import sys
import traceback
from selenium import webdriver
from selenium.webdriver.firefox.options import Options
from selenium.webdriver.common.by import By
from selenium.webdriver.common.keys import Keys
from selenium.webdriver.support.ui import WebDriverWait

BASE = os.environ.get("BASE_URL", "http://127.0.0.1:8000").rstrip("/")
OUT = os.environ.get("OUT_DIR", "test-results")
HEADLESS = os.environ.get("HEADLESS", "1") != "0"
SKIP_NET = os.environ.get("SKIP_NETWORK_TESTS", "0") == "1"
os.makedirs(OUT, exist_ok=True)

report = []

def rec(name, ok, detail=""):
    report.append({"test": name, "ok": bool(ok), "detail": str(detail)})
    print(f"[{'PASS' if ok else 'FAIL'}] {name} :: {detail}", flush=True)

def skipped(name, why):
    report.append({"test": name, "ok": True, "detail": f"SKIP: {why}", "skipped": True})
    print(f"[SKIP] {name} :: {why}", flush=True)

def shot(driver, fname):
    driver.save_screenshot(os.path.join(OUT, fname))
    print(f"  -> {fname}", flush=True)

opts = Options()
if HEADLESS:
    opts.add_argument("--headless")
opts.set_preference("intl.accept_languages", "zh-CN, zh")
opts.set_preference("media.autoplay.default", 0)          # 测试环境允许自动播放
opts.set_preference("media.autoplay.blocking_policy", 0)
opts.set_preference("dom.disable_beforeunload", True)

try:
    b = webdriver.Firefox(options=opts)
except Exception as e:
    print(f"无法启动 Firefox：{e}", flush=True)
    sys.exit(2)

b.set_window_size(1366, 900)
wait = WebDriverWait(b, 25)


def step(name):
    """每个模块独立容错：单点异常不会拖垮后续模块"""
    def deco(fn):
        if SKIP_NET and getattr(fn, "needs_net", False):
            skipped(name, "SKIP_NETWORK_TESTS=1")
            return
        try:
            fn()
        except Exception as e:
            rec(name, False, f"步骤异常: {e} | {traceback.format_exc()[-400:]}")
            try:
                shot(b, "99-error.png")
            except Exception:
                pass
    return deco

def net(fn):
    fn.needs_net = True
    return fn

def poll_until(fn, timeout=30, interval=1.0):
    """轮询直到 fn() 返回真值，返回该值；超时返回最后一次结果"""
    deadline = time.time() + timeout
    last = None
    while True:
        last = fn()
        if last:
            return last
        if time.time() > deadline:
            return last
        time.sleep(interval)


def open_playable_song(limit=8):
    """从当前结果列表里找到一首 loadTrack 成功的歌并停留在播放器 iframe 内。

    上游接口按账号/音质轮换，个别歌曲在部分音质下会 404（表现为
    播放器显示「获取歌曲失败」），把测试钉死在某一首歌上并不稳定，
    真实用户的正常行为也是换一首。
    返回该歌曲的元数据 dict；均失败时返回 None（并回到主页文档上下文）。
    """
    cands = b.execute_script(f"""
      return [...document.querySelectorAll('#results-list .result-item .play-button')]
        .slice(0, {limit}).map(x=>({{id:x.dataset.songId, title:x.dataset.title,
        artist:x.dataset.artist, vip:x.dataset.vip, cover:x.dataset.cover}}))""")
    b.switch_to.default_content()
    for cand in cands:
        b.execute_script(
            "document.querySelector('.play-button[data-song-id=\"%s\"]').click()" % cand["id"])
        wait.until(lambda d: d.execute_script(
            "return document.getElementById('player-container').classList.contains('active')"))
        src = b.execute_script("return document.getElementById('player-frame').src")
        b.switch_to.frame(b.find_element(By.ID, "player-frame"))
        try:
            wait.until(lambda d: d.execute_script(
                "var o=document.getElementById('loadingOverlay');"
                "return !o || o.classList.contains('hidden')"))
        except Exception:
            pass
        title = b.execute_script(
            "var t=document.querySelector('[data-title]'); return t ? t.textContent : ''")
        if '获取歌曲失败' not in title and '播放失败' not in title:
            cand["_src"] = src
            return cand
        b.switch_to.default_content()
        b.find_element(By.ID, "close-player").click()
        time.sleep(0.6)
    b.switch_to.default_content()
    return None


# ================= 1. 主页加载 + 首访音质弹窗 =================
@step("主页模块")
def _():
    b.get(BASE + "/index.html")
    wait.until(lambda d: d.execute_script("return !document.getElementById('main-loading-overlay')"))
    time.sleep(0.6)
    rec("主页加载且加载遮罩淡出", True)
    rec("页面标题", "YiClapOnline" in b.title, b.title)
    time.sleep(1.2)
    upd = b.execute_script("return document.getElementById('updateModal').classList.contains('active')")
    rec("版本与 update.json 一致（不弹更新框）", not upd, f"updateModal.active={upd}")
    shot(b, "01-main-light.png")
    q_auto = b.execute_script("return document.getElementById('qualityModal').classList.contains('active')")
    rec("首次访问自动弹出音质选择（设计行为）", q_auto, f"active={q_auto}")
    if q_auto:
        qopts = b.execute_script(
            "return [...document.querySelectorAll('.quality-option')].map(o=>o.textContent.trim())")
        rec("音质选项渲染", len(qopts) > 0, json.dumps(qopts, ensure_ascii=False))
        shot(b, "01b-first-visit-quality.png")
        b.execute_script("document.querySelectorAll('.quality-option')[0].click()")
        b.find_element(By.ID, "qualityConfirm").click()
        time.sleep(0.6)
        saved = b.execute_script("return localStorage.getItem('yiclape:audio-quality')")
        rec("保存首访音质设置", bool(saved), f"saved={saved}")


# ================= 2. 搜索 =================
@step("搜索模块")
@net
def _():
    b.find_element(By.ID, "search-input").send_keys("周杰伦")
    b.find_element(By.ID, "search-button").click()

    def has_result():
        n = b.execute_script("return document.querySelectorAll('#results-list .result-item').length")
        if n == 0:
            return False
        return n
    n = poll_until(has_result, timeout=30) or 0
    cnt = b.execute_script(
        "var c=document.querySelector('#results-container .result-count'); return c?c.textContent:''")
    top5 = b.execute_script("""
      return [...document.querySelectorAll('#results-list .result-item')].slice(0,5).map(r => ({
        title: r.querySelector('.title-text')?.textContent,
        artist: r.querySelector('.result-artist')?.textContent,
        vip: !!r.querySelector('.vip-badge')}))""")
    rec("搜索『周杰伦』返回结果", n > 0, f"{cnt}; 前5: {json.dumps(top5, ensure_ascii=False)}")
    rec("VIP 歌曲带标记", any(t["vip"] for t in top5), f"前5中VIP数={sum(t['vip'] for t in top5)}")
    shot(b, "02-search-results.png")


# ================= 3. 播放链路 =================
@step("播放模块")
@net
def _():
    first = open_playable_song()
    rec("从结果中找到可播放歌曲（接口按账号/音质轮换，钉死一首歌不稳定）",
        bool(first), json.dumps(first, ensure_ascii=False) if first else "前几首尝试均失败")
    if not first:
        raise Exception("搜索前若干首全部 404/不可用，疑似上游接口或网络环境整体异常")
    # 此时已位于播放器 iframe 内
    src = first["_src"]
    rec("播放器 iframe 指向 player.html", "player.html" in src, src[:120])
    t = b.execute_script("return document.querySelector('[data-title]')?.textContent")
    a = b.execute_script("return document.querySelector('[data-artist]')?.textContent")
    vip_b = b.execute_script("var x=document.querySelector('[data-vip-banner]'); return x && !x.hidden")
    rec("播放器加载元数据且无错误", bool(t) and "失败" not in t, f"标题={t} / 歌手={a}")
    rec("VIP 解析横幅显示", bool(vip_b) if first and first.get("vip") == "1" else True, f"vip_banner={vip_b}")

    if first.get("cover"):
        cover = poll_until(lambda: b.execute_script(
            "var c=document.querySelector('[data-player-banner]')?.src||'';"
            "return (c && c.indexOf('none.webp')<0) ? c : false"), timeout=15) or ""
        rec("封面异步换为歌曲封面", cover.startswith("http"), cover[:100])

    auto = b.execute_script("return document.querySelector('[data-play-btn]').classList.contains('active')")
    rec("播放器默认不自动播放（等待用户操作）", not auto, f"active={auto}")

    time.sleep(0.9)  # 等加载遮罩的 visibility 过渡结束，避免点击被透明遮罩挡住
    b.find_element(By.CSS_SELECTOR, "[data-play-btn]").click()
    playing = poll_until(lambda: b.execute_script(
        "return document.querySelector('[data-play-btn]').classList.contains('active')"), timeout=30)
    rec("点击播放成功（播放事件驱动 UI）", bool(playing), f"active={playing}")

    rt = "return document.querySelector('[data-running-time]').textContent"
    advanced = poll_until(lambda: (lambda v: v if v != "0:00" else False)(b.execute_script(rt)), timeout=30)
    rec("播放进度前进", advanced not in (None, False, "0:00"), f"0:00 -> {advanced}")

    seek_before = b.execute_script(rt)
    b.execute_script("""var r=document.querySelector('[data-seek]');
        r.value = Math.min(30, parseFloat(r.max));
        r.dispatchEvent(new Event('change',{bubbles:true}));""")
    after = poll_until(lambda: (lambda v: v if (v != seek_before and v != "0:00") else False)(b.execute_script(rt)), timeout=15)
    rec("拖动进度条（seek）生效", bool(after), f"seek前={seek_before} 当前={after}")

    vol = b.execute_script(
        "return !!document.querySelector('#volume-container input[type=range], #volume-container .range, #volume-container button')")
    rec("音量控件已生成", vol)
    loop = b.execute_script("var x=document.querySelector('[data-loop]'); x.click(); return x.getAttribute('aria-pressed')")
    rec("单曲循环切换", loop == "true", f"aria-pressed={loop}")
    shot(b, "03-player-playing.png")

    # 进度条/音量条几何对齐回归（修复过 Firefox 下 fill 悬于轨道上方的错位）
    def range_geo(sel):
        return b.execute_script(f"""var r=document.querySelector('{sel}');
            if(!r) return null;
            var f=r.nextElementSibling;
            var ri=r.getBoundingClientRect(), rf=f.getBoundingClientRect();
            var ratio = parseFloat(r.max) > 0 ? parseFloat(r.value)/parseFloat(r.max) : 0;
            return {{ dy: Math.abs((rf.top+rf.bottom)/2 - (ri.top+ri.bottom)/2),
                     dw: Math.abs(rf.width - ratio*ri.width),
                     h: ri.height }};""")
    geo = range_geo("[data-seek]")
    rec("进度条几何对齐（fill 与轨道同线、宽度成比例）",
        geo and geo["dy"] <= 2 and geo["dw"] <= 3, json.dumps(geo))
    gv = range_geo(".volume-slider")
    rec("音量条几何对齐", gv and gv["dy"] <= 2 and gv["dw"] <= 3, json.dumps(gv))

    b.find_element(By.CSS_SELECTOR, "[data-favorite]").click()
    time.sleep(0.5)
    favs = b.execute_script("return localStorage.getItem('yiclape:favorites')")
    rec("播放器内收藏成功", bool(favs and favs != "[]"), (favs or "")[:160])
    b.switch_to.default_content()
    shot(b, "04-player-overlay.png")


# ================= 4. 收藏列表 =================
@step("收藏模块")
@net
def _():
    b.switch_to.default_content()
    b.find_element(By.ID, "close-player").click()
    time.sleep(1)
    rec("关闭播放器", b.execute_script(
        "return !document.getElementById('player-container').classList.contains('active')"))
    b.find_element(By.ID, "favorites-btn").click()
    wait.until(lambda d: d.execute_script(
        "var c=document.getElementById('favorites-container'); return c && c.style.display!=='none'"))
    n = b.execute_script("return document.querySelectorAll('#favorites-list .result-item').length")
    rec("收藏列表含刚收藏的歌", n > 0, f"收藏数={n}")
    shot(b, "05-favorites.png")
    b.execute_script("var x=document.querySelector('#favorites-list .remove-button'); if(x){x.click();}")
    time.sleep(1.2)  # 删除有淡出动画，之后才移除 DOM
    rm = b.execute_script("return document.querySelectorAll('#favorites-list .result-item').length")
    rec("收藏列表删除功能", rm == n - 1, f"删除后={rm}")


# ================= 5. 深色主题 =================
@step("主题模块")
def _():
    before = b.execute_script("return document.documentElement.classList.contains('dark-theme')")
    b.find_element(By.ID, "new-theme-toggle").click()
    time.sleep(0.9)
    after = b.execute_script("return document.documentElement.classList.contains('dark-theme')")
    ls = b.execute_script("return localStorage.getItem('yiclape:darkmode')")
    rec("深色主题切换", after != before and ((after and ls == "1") or (not after and ls == "0")),
        f"{before}->{after}, storage={ls}")
    shot(b, "06-dark-theme.png")
    b.find_element(By.ID, "new-theme-toggle").click()
    time.sleep(0.5)


# ================= 6. 音质弹窗（再次打开） =================
@step("音质模块")
def _():
    b.find_element(By.ID, "quality-btn").click()
    wait.until(lambda d: d.execute_script(
        "return document.getElementById('qualityModal').classList.contains('active')"))
    qopts = b.execute_script(
        "return [...document.querySelectorAll('.quality-option')].map(o=>o.textContent.trim())")
    shot(b, "07-quality-modal.png")
    rec("音质弹窗打开并列出选项", len(qopts) > 0, f"{len(qopts)} 个选项")
    b.execute_script("document.querySelectorAll('.quality-option')[1].click()")
    b.find_element(By.ID, "qualityConfirm").click()
    time.sleep(0.5)
    saved = b.execute_script("return localStorage.getItem('yiclape:audio-quality')")
    closed = b.execute_script("return !document.getElementById('qualityModal').classList.contains('active')")
    rec("切换音质并保存", closed and saved is not None, f"saved={saved}")
    b.execute_script("localStorage.setItem('yiclape:audio-quality','standard')")


# ================= 7. 二次搜索 =================
@step("二搜模块")
@net
def _():
    inp = b.find_element(By.ID, "search-input")
    inp.clear()
    inp.send_keys("青花瓷")
    b.find_element(By.ID, "search-button").click()

    def settled():
        spinner = b.execute_script(
            "var s=document.querySelector('.search-loading'); return s && s.style.display!=='none'")
        if spinner:
            return False
        n = b.execute_script("return document.querySelectorAll('#results-list .result-item').length")
        vis = b.execute_script(
            "var c=document.getElementById('results-container'); return c && c.style.display!=='none'")
        nores = b.execute_script(
            "var n=document.getElementById('no-results'); return n.style.display!=='none' ? n.querySelector('p').textContent : ''")
        if (vis and n > 0) or ("未找到" in nores):
            return f"返回 {n} 条结果" if n > 0 else f"提示={nores}"
        return False
    done = poll_until(settled, timeout=30)
    rec("二搜正常完成", bool(done), str(done))
    shot(b, "08-second-search.png")


# ================= 8. c<ID> 直达播放 =================
@step("直达播放模块")
@net
def _():
    inp = b.find_element(By.ID, "search-input")
    inp.clear()
    inp.send_keys("c509781655")
    time.sleep(0.5)
    txt = b.execute_script("return document.querySelector('.search-text').textContent")
    rec("输入 c<ID> 按钮变为『播放』", txt == "播放", f"按钮={txt}")
    b.find_element(By.ID, "search-button").click()
    wait.until(lambda d: d.execute_script(
        "return document.getElementById('player-container').classList.contains('active')"))
    src = b.execute_script("return document.getElementById('player-frame').src")
    rec("c<ID> 直接打开播放器", "id=509781655" in src, src[:110])
    b.find_element(By.ID, "close-player").click()
    time.sleep(0.8)


# ================= 9. 播放/暂停往返 + 下载弹窗 =================
@step("暂停与下载模块")
@net
def _():
    if b.execute_script("return document.querySelectorAll('#results-list .result-item').length") == 0:
        b.find_element(By.ID, "search-input").send_keys("陈奕迅")
        b.find_element(By.ID, "search-input").send_keys(Keys.ENTER)
        poll_until(lambda: b.execute_script(
            "return document.querySelectorAll('#results-list .result-item').length>0"), timeout=30)
    song = open_playable_song()
    rec("找到可播放歌曲（用于暂停/下载断言）", bool(song), json.dumps(song, ensure_ascii=False) if song else "前几首尝试均失败")
    if not song:
        raise Exception("无可播放歌曲，暂停/下载断言无法进行")
    time.sleep(1.0)
    b.find_element(By.CSS_SELECTOR, "[data-play-btn]").click()
    playing = poll_until(lambda: b.execute_script(
        "return document.querySelector('[data-play-btn]').classList.contains('active')"), timeout=30)
    rec("播放开始", bool(playing))
    b.find_element(By.CSS_SELECTOR, "[data-play-btn]").click()
    time.sleep(0.6)
    paused = b.execute_script("return !document.querySelector('[data-play-btn]').classList.contains('active')")
    label = b.execute_script("return document.querySelector('[data-play-btn]').getAttribute('aria-label')")
    rec("再点击暂停且文案回『播放』", paused and label == "播放", f"paused={paused} label={label}")

    b.find_element(By.CSS_SELECTOR, "[data-download]").click()
    wait.until(lambda d: d.execute_script(
        "return document.getElementById('downloadModal').classList.contains('active')"))
    items = poll_until(lambda: b.execute_script(
        "var l=document.getElementById('downloadList'); return l && l.children.length>0 ? l.children.length : false"), timeout=15)
    shot(b, "10-download-modal.png")
    rec("下载弹窗打开并逐档解析", bool(items), f"解析项数={items}")
    b.switch_to.default_content()


# ================= 10. 移动端视口 =================
@step("移动端模块")
def _():
    b.set_window_size(390, 844)
    b.get(BASE + "/index.html")
    wait.until(lambda d: d.execute_script("return !document.getElementById('main-loading-overlay')"))
    time.sleep(1.2)
    if b.execute_script("return document.getElementById('qualityModal').classList.contains('active')"):
        b.find_element(By.ID, "qualityConfirm").click()
        time.sleep(0.6)
    shot(b, "11-mobile-main.png")
    fs = b.execute_script("return getComputedStyle(document.getElementById('search-input')).fontSize")
    rec("移动端搜索框字号 >=16px（防 iOS 自动放大）", float(fs.replace("px", "")) >= 16, fs)
    b.set_window_size(1366, 900)


# ================= 11. player.html 无参数容错 =================
@step("player直接访问容错")
def _():
    b.switch_to.default_content()
    b.get(BASE + "/player.html")
    time.sleep(4)
    text = b.execute_script("return document.querySelector('.loading-text')?.textContent || document.body.innerText")
    shot(b, "09-player-direct.png")
    rec("直接访问 player.html 有友好提示（不卡死）", len(text.strip()) > 0, text.strip()[:120])


try:
    b.switch_to.default_content()
except Exception:
    pass
b.quit()

ok_n = sum(1 for r in report if r["ok"] and not r.get("skipped"))
fail_n = sum(1 for r in report if not r["ok"])
skip_n = sum(1 for r in report if r.get("skipped"))

with open(os.path.join(OUT, "report.json"), "w", encoding="utf-8") as f:
    json.dump({"base": BASE, "pass": ok_n, "fail": fail_n, "skip": skip_n, "results": report},
              f, ensure_ascii=False, indent=2)

print(f"\n===== 汇总: {ok_n} 通过 / {fail_n} 失败 / {skip_n} 跳过 =====", flush=True)
sys.exit(1 if fail_n > 0 else 0)
