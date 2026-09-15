'use strict';

/**
 * 当前这份代码的版本号。必须与 update.json 里的 version 一致；发版时用 bump.sh 同步改。
 *
 * 更新检测就是拿它和线上 update.json 比：不一致 => 用户跑的是旧代码 => 提示刷新。
 */
const APP_VERSION = '202609152404';

/**
 * YiClapOnline —— 主页(index.html)与播放器(player.html)共用的唯一脚本。
 *
 * 两个页面都加载本文件，靠 <body data-page="main|player"> 分流。
 * 因此不存在跨文件的加载顺序问题：任何页面拿到的一定是完整定义。
 *
 * 文件结构：
 *   1. 共享层     localStorage(主题/版本) + 旧 cookie 迁移清理
 *   2. 数据源层   musicSource —— 换源只需要改这一节
 *   2.5 收藏      依赖 musicSource.id 做"换源即作废"，所以放在数据源之后
 *   3. 主页       搜索、结果列表、收藏列表
 *   4. 播放器     取歌、播放控制、音量
 *   5. 入口
 */

/* ==========================================================================
   1. 共享层
   ========================================================================== */

// 新的统一存储键（yiclape: 前缀）
const THEME_KEY = 'yiclape:darkmode';
const FAVORITES_KEY = 'yiclape:favorites';
// 只删不读：旧的收藏键，以及旧更新逻辑留下的版本簿记(现在用 APP_VERSION 直接比对，不再需要)
const LEGACY_STORAGE_KEYS = ['li-favorites', 'yiclape:version'];
const LEGACY_SESSION_KEYS = ['yiclape:updating'];

// 遗留 cookie 名称（主题已迁移至 localStorage；版本 cookie 直接删除）
const LEGACY_THEME_COOKIE = 'li-darkmode';
const LEGACY_VERSION_COOKIE = 'li-version';

/**
 * cookie 读写 - 仅用于遗留数据迁移和清理
 * 新功能请直接使用 localStorage
 *
 * 注意：不能叫 cookieStore —— 浏览器已经把 window.cookieStore 定义成了
 * Cookie Store API 的全局对象。顶层 const 会遮蔽它，在某些环境下报错。
 */
const legacyCookies = {
  get(name) {
    const prefix = name + '=';
    for (const part of document.cookie.split(';')) {
      const cookie = part.trim();
      if (cookie.startsWith(prefix)) {
        try {
          return decodeURIComponent(cookie.slice(prefix.length));
        } catch {
          // 老版本 cookie 里的中文可能没有 encode 过，decode 会抛 URIError；原样返回即可
          return cookie.slice(prefix.length);
        }
      }
    }
    return null;
  },

  remove(name) {
    // 只做删除。旧版本写 cookie 时用的就是 path=/ 且未指定 domain，这里保持一致才能真正删掉
    const secure = location.protocol === 'https:' ? '; secure' : '';
    document.cookie = `${name}=;expires=Thu, 01 Jan 1970 00:00:00 GMT;path=/;SameSite=Lax${secure}`;
  }
};

/**
 * 将旧 cookie 迁移到 localStorage，成功后删除原 cookie
 * 策略：
 *  - 如果 localStorage 已有值，说明已迁移过，直接清理 cookie
 *  - 如果 cookie 有值而 localStorage 无值，则迁移并删除 cookie
 *  - 如果 localStorage 写入失败（被禁用/配额满），保留 cookie 不删，避免数据丢失
 * @param {string} cookieName
 * @param {string} storageKey
 * @returns {string|null} 迁移后的值或已存在的值
 */
function migrateCookieToLocalStorage(cookieName, storageKey) {
  try {
    let existing = null;
    try {
      existing = localStorage.getItem(storageKey);
    } catch (e) {
      console.warn(`[迁移] 读取 localStorage 失败 ${storageKey}:`, e);
      return null;
    }

    if (existing !== null) {
      // 已迁移，只需清理遗留 cookie
      try {
        if (legacyCookies.get(cookieName) !== null) {
          legacyCookies.remove(cookieName);
          console.log(`[迁移] 清理已迁移的遗留 cookie: ${cookieName}`);
        }
      } catch (e) {
        console.warn(`[迁移] 清理 cookie 失败 ${cookieName}:`, e);
      }
      return existing;
    }

    const cookieVal = legacyCookies.get(cookieName);
    if (cookieVal !== null) {
      try {
        localStorage.setItem(storageKey, cookieVal);
      } catch (e) {
        console.warn(`[迁移] 写入 localStorage 失败 ${storageKey}，保留 cookie:`, e);
        return null;
      }
      // 写入成功后再删 cookie
      try {
        legacyCookies.remove(cookieName);
        console.log(`[迁移] 已将 ${cookieName} -> ${storageKey}: ${cookieVal}，并删除原 cookie`);
      } catch (e) {
        console.warn(`[迁移] 删除 cookie 失败 ${cookieName}:`, e);
      }
      return cookieVal;
    }
  } catch (e) {
    console.warn(`[迁移] ${cookieName} -> ${storageKey} 失败:`, e);
  }
  return null;
}

function runLegacyMigrations() {
  migrateCookieToLocalStorage(LEGACY_THEME_COOKIE, THEME_KEY);
}

// 页面加载时立即尝试迁移，避免主题闪烁
try {
  runLegacyMigrations();
} catch (e) {
  console.warn('[迁移] 初始化迁移失败:', e);
}

/**
 * 把任意 id 统一成非空字符串（null/undefined -> ''）。
 * 数据源若返回数字 id，之前 add() 会原样存进去、read() 又只认字符串，
 * 结果是"收藏成功但列表里永远看不到"。所有入口统一走这里即可。
 */
function normalizeId(value) {
  return value === undefined || value === null ? '' : String(value);
}

/* ==========================================================================
 * 音质档位（在线收听 / 下载共用）
 * 后端 getSongUrl 的 level 支持以下种类；用户选择存进独立的 localStorage 键。
 * ========================================================================== */

const QUALITY_LEVELS = [
  { level: 'standard', label: '标准音质' },
  { level: 'exhigh',   label: '极高音质' },
  { level: 'lossless', label: '无损音质', warn: '无损音质每首歌可能有 30MB 以上' },
  { level: 'hires',    label: 'Hi-Res 音质', warn: 'Hi-Res 音质每首歌可能有 50MB 以上' },
  { level: 'jyeffect', label: '高清环绕声', warn: '高清环绕声每首歌可能有 80MB 以上' },
  { level: 'jymaster', label: '超清母带', warn: '超清母带每首歌可能有 150MB 以上' },
];

// 独立的存储键，不与主题 / 收藏等已有键混用
const QUALITY_KEY = 'yiclape:audio-quality';
const DEFAULT_QUALITY = 'standard';

/** 读取用户选择的音质（未选择时退回默认 standard） */
function getQuality() {
  try {
    const v = localStorage.getItem(QUALITY_KEY);
    return QUALITY_LEVELS.some(q => q.level === v) ? v : DEFAULT_QUALITY;
  } catch {
    return DEFAULT_QUALITY;
  }
}

/** 保存用户选择的音质 */
function setQuality(level) {
  try { localStorage.setItem(QUALITY_KEY, level); } catch { /* 存储不可用时静默 */ }
}

/**
 * 主题控制 - 读取 localStorage['yiclape:darkmode'] 并应用相应主题
 * '1': 深色主题, 其它/不存在: 浅色主题(默认)
 * 已从 cookie 迁移至 localStorage，旧 cookie 会在迁移后自动删除
 */
const themeControl = {
  /**
   * 内存态兜底：localStorage 被禁用时 isDark() 永远是 false，
   * 原来的 toggleTheme() 就变成"点了没反应"。现在至少当前页面内可以切换。
   */
  _dark: null,

  isDark() {
    try {
      const stored = localStorage.getItem(THEME_KEY);
      if (stored !== null) return stored === '1';
    } catch {
      /* 读不到就用内存态 */
    }
    return this._dark === true;
  },

  toggleTheme() {
    const next = !this.isDark();
    this._dark = next;
    try {
      localStorage.setItem(THEME_KEY, next ? '1' : '0');
    } catch (e) {
      console.error('[主题] 保存失败(浏览器可能禁用了 localStorage 或空间已满):', e);
    }
    this.applyTheme();
  },

  applyTheme() {
    const dark = this.isDark();
    document.documentElement.classList.toggle('dark-theme', dark);
    document.documentElement.classList.toggle('light-theme', !dark);
  },

  /**
   * @param {Function} [onChange] - 主题变化时的回调(参数为 isDark)
   */
  init(onChange) {
    this.applyTheme();

    // 使用 storage 事件实现跨标签/iframe 同步。
    // key === null 表示对方调用了 localStorage.clear()，同样需要重新应用
    window.addEventListener('storage', (event) => {
      if (event.storageArea !== localStorage) return;
      if (event.key === THEME_KEY || event.key === null) {
        this._dark = null;
        this.applyTheme();
        if (onChange) onChange(this.isDark());
      }
    });
  }
};

// 脚本一解析就先把主题类挂到 <html> 上，不等 DOMContentLoaded，减少浅色->深色的闪烁
themeControl.applyTheme();

/* ==========================================================================
   2. 数据源层 —— 全站唯一与外部音乐服务打交道的地方

   换源只需要改这一节：实现 search() 和 getTrack()，保证返回结构一致，
   下面的主页与播放器代码都不需要改动。

   约定：
     1. 两个方法都是 async。失败时 throw Error —— 调用方会捕获并把
        error.message 显示到界面上，所以请写用户看得懂的中文。
     2. search() 无结果时返回空数组，不要 throw（空结果是正常情况，不是错误）。
     3. id 对应用层是不透明字符串，由数据源自己定义格式。除了「输入
        c<id> 直接播放」这个输入约定外，应用层不会解析或拼接它。
     4. musicSource.id 是"这批收藏属于哪个源"的标识：换源时改它，
        旧收藏会整体作废(旧 id 到新源上本来就播不了)。
   ========================================================================== */

const musicSource = {
  /** 数据源名称，仅用于日志与错误提示(可随时改，不影响已存的收藏) */
  name: 'sxq1',

  /**
   * 数据源稳定标识，写进收藏数据里用于"换源即作废"。
   * 换数据源时改这个值，老收藏即被整体丢弃；
   * 留空则退化成用 name。
   */
  id: 'sxq1',

  /** 数据源后端基地址 */
  _baseUrl: 'https://nextmusic.toubiec.cn/api',

  /**
   * 在 112.114.x.x ~ 112.117.x.x 之间随机生成一个 ip，供接口反爬校验使用
   */
  _randomIp() {
    const second = 114 + Math.floor(Math.random() * 4); // 114..117
    const third = Math.floor(Math.random() * 256);
    const fourth = Math.floor(Math.random() * 256);
    return `112.${second}.${third}.${fourth}`;
  },

  /**
   * 统一封装对数据源后端的 POST 请求：自动加随机 ip、处理网络/HTTP/业务码错误。
   *
   * @returns {Promise<any>} 接口返回的 data 字段
   */
  async _request(path, body) {
    let lastError;
    // 最多两次：第一次失败（账号轮换导致的偶发 404 等）就重试一次
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        let res;
        try {
          res = await fetch(`${this._baseUrl}/${path}`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'User-Agent': this._ua,
            },
            body: JSON.stringify({ ...body, ip: this._randomIp() }),
          });
        } catch {
          // 网络层失败：通常是临时的，可重试
          throw Object.assign(new Error('网络请求失败，请检查网络连接后重试'), { retryable: true });
        }
        if (!res.ok) throw Object.assign(new Error(`请求失败：HTTP ${res.status}`), { retryable: true });
        let data;
        try {
          data = await res.json();
        } catch {
          throw Object.assign(new Error('接口返回的数据无法解析，请稍后重试'), { retryable: true });
        }
        if (!data || data.code !== 200) {
          // 业务码 404（账号轮换）可重试；其它业务错误视为明确错误，不再重试
          const retryable = data && data.code === 404;
          throw Object.assign(
            new Error(data?.message ? `获取失败：${data.message}` : '接口返回异常，请稍后重试'),
            { retryable }
          );
        }
        return data.data;
      } catch (error) {
        lastError = error;
        // 非可重试错误，或已经是第二次尝试：直接抛出
        if (!error.retryable || attempt === 1) throw error;
      }
    }
    throw lastError;
  },

  /**
   * 按关键词搜索歌曲。
   *
   * @param {string} keyword - 用户输入的关键词（已 trim，保证非空）
   * @returns {Promise<Array<{id: string, title: string, artist: string, vip: boolean, cover: string}>>}
   *          按相关度排序的结果列表；无结果时返回 []
   * @throws {Error} 网络失败、状态码异常或响应结构不符
   */
  async search(keyword) {
    const data = await this._request('search', {
      keyword,
      type: 1,
      limit: 100,
      offset: 0,
    });
    // 后端偶发返回结构异常时按空结果处理，避免上层直接报 TypeError
    if (!data || !Array.isArray(data.songs)) return [];
    return data.songs.map(song => ({
      id: String(song.id),
      title: song.name || '未知歌曲',
      artist: song.singer || '未知歌手',
      cover: song.picimg || '',
      vip: song.free === false,
    }));
  },

  /**
   * 按 ID 换取可直接播放的音频直链。
   *
   * 注意：后端 getSongUrl 只返回音频直链，不返回标题/歌手/封面等元数据，
   * 这些字段由播放页从搜索结果带入的 URL 参数补齐（见 loadTrack）。
   *
   * @param {string} id - search() 返回的 id
   * @returns {Promise<{id: string, title: string, artist: string, cover: string, audioUrl: string}>}
   * @throws {Error} 歌曲不存在、无版权、或音频地址换取失败
   */
  async getTrack(id) {
    const data = await this._request('getSongUrl', {
      id,
      level: getQuality(),
    });
    if (!data || !data.url) throw new Error('该歌曲暂时无法播放');
    return {
      id,
      title: '',
      artist: '',
      cover: '',
      audioUrl: data.url,
    };
  },

  /**
   * 按 ID + 指定音质换取音频直链与大小（用于下载弹窗逐档解析）。
   * @param {string} id
   * @param {string} level - 见 QUALITY_LEVELS
   * @returns {Promise<{url: string, size: number, br: number}>}
   */
  async getTrackUrl(id, level) {
    const data = await this._request('getSongUrl', { id, level });
    if (!data || !data.url) throw new Error('该音质暂不可用');
    return { url: data.url, size: data.size || 0, br: data.br || 0 };
  }
};

/**
 * 收藏 —— 只用 localStorage
 *
 * 存储结构：localStorage['yiclape:favorites'] = JSON.stringify({ source, items })
 *   items: [{ id, title, artist }]   // id 是当前数据源给的不透明字符串
 *
 * source 字段就是"作废开关"：收藏里的 id 只在当前数据源内有效，换源之后必然全是死链，
 * 所以读取时拿 sourceTag()(musicSource.id，退回 name)比对，不一致就当没有收藏并清掉旧数据。
 * 历史上的 li-favorites cookie / li-favorites localStorage 均已废弃，一律不读，见到就删。
 */
const favorites = {
  /**
   * 当前数据源标识。优先用 musicSource.id(稳定标识)，没有才退回 name。
   * name 按约定只用于展示，改个显示名不该把收藏清空；两者都没有时退化成空串。
   */
  sourceTag() {
    return musicSource.id || musicSource.name || '';
  },

  /** 收藏列表；脏数据 / 存储不可用一律退化成 []，绝不向外抛 */
  read() {
    try {
      const raw = localStorage.getItem(FAVORITES_KEY);
      if (raw === null) return [];

      const data = JSON.parse(raw);
      if (!data || !Array.isArray(data.items)) return [];
      if (data.source !== this.sourceTag()) {
        this.clear();          // 换数据源了，旧收藏整体作废
        return [];
      }

      // 数字 id 也接受(旧数据可能存的是数字)，统一转成字符串再比对
      const seen = new Set();
      const items = [];
      for (const item of data.items) {
        if (!item) continue;
        const id = normalizeId(item.id);
        if (!id || seen.has(id)) continue;   // 顺手去重，避免脏数据导致同一首歌出现两行
        seen.add(id);
        items.push({
          id,
          title: typeof item.title === 'string' ? item.title : '',
          artist: typeof item.artist === 'string' ? item.artist : '',
          vip: item.vip === true,
          cover: typeof item.cover === 'string' ? item.cover : '',
        });
      }
      return items;
    } catch (error) {
      console.error('[收藏] 读取失败，按空列表处理:', error);
      return [];
    }
  },

  /** 整体写回；浏览器禁用存储或配额满时返回 false，由调用方提示 */
  write(items) {
    try {
      localStorage.setItem(FAVORITES_KEY, JSON.stringify({ source: this.sourceTag(), items }));
      return true;
    } catch (error) {
      console.error('[收藏] 保存失败(浏览器可能禁用了 localStorage 或空间已满):', error);
      return false;
    }
  },

  clear() {
    try {
      localStorage.removeItem(FAVORITES_KEY);
    } catch (error) {
      console.error('[收藏] 清除失败:', error);
    }
  },

  has(songId) {
    const id = normalizeId(songId);
    return !!id && this.read().some(item => item.id === id);
  },

  add({ id, title, artist, vip, cover } = {}) {
    id = normalizeId(id);
    if (!id) return false;

    const items = this.read();
    if (items.some(item => item.id === id)) return false;   // 只读一次，不再 has()+read() 读两遍

    items.push({
      id,
      title: typeof title === 'string' ? title : '',
      artist: typeof artist === 'string' ? artist : '',
      // vip / cover 仅用于展示与传给播放页；旧收藏没有这两个字段时退化成 false / ''
      vip: vip === true,
      cover: typeof cover === 'string' ? cover : '',
    });
    return this.write(items);
  },

  remove(songId) {
    const id = normalizeId(songId);
    if (!id) return false;

    const items = this.read();
    const remaining = items.filter(item => item.id !== id);
    if (remaining.length === items.length) return false;

    return this.write(remaining);
  },

  /**
   * 收藏/取消收藏一次搞定。
   * @returns {boolean} 操作完成后这首歌的真实收藏状态(以存储为准，写失败会退回原状)
   */
  toggle({ id, title, artist, vip, cover } = {}) {
    id = normalizeId(id);
    if (!id) return false;

    if (this.has(id)) {
      this.remove(id);
    } else {
      this.add({ id, title, artist, vip, cover });
    }
    return this.has(id);
  },

  /** 启动清理：历史遗留的 cookie / localStorage / sessionStorage 键，只删不读 */
  purgeLegacy() {
    for (const key of LEGACY_STORAGE_KEYS) {
      try { localStorage.removeItem(key); } catch {}
      // 历史上这些 key 一律写在 path=/ 下，所以一次过期删除即可覆盖
      try { legacyCookies.remove(key); } catch {}
    }
    for (const key of LEGACY_SESSION_KEYS) {
      try { sessionStorage.removeItem(key); } catch {}
    }
    try { legacyCookies.remove(LEGACY_VERSION_COOKIE); } catch {}

    // 防御性清理：主题的旧 cookie 理应在 runLegacyMigrations 中已删，此处再次确保不残留
    try {
      if (localStorage.getItem(THEME_KEY) !== null) legacyCookies.remove(LEGACY_THEME_COOKIE);
    } catch {}
  }
};

/* ==========================================================================
   3. 主页
   ========================================================================== */

// 主页 DOM 元素（在 initMainPage 中赋值）
let searchInput, searchButton, searchText, searchLoading;
let resultsContainer, resultsList, noResults, placeholder;
let playerContainer, playerFrame, favoritesContainer, favoritesList;
let themeToggleBtn;

// 收藏面板是否处于打开状态。之前用 favoritesContainer.style.display 判断，
// 但收藏为空时显示的是 noResults 提示而不是 favoritesContainer，
// 于是"打开了收藏 -> 列表为空 -> 再点一次收藏按钮"会被当成"没打开"而重复打开。
let favoritesOpen = false;

// 打开收藏面板前正在显示的容器，关闭时回到它(而不是靠 .result-count 是否存在来猜)
let viewBeforeFavorites = null;

// 搜索请求序号：用户快速连按两次回车时，只接受最后一次请求的结果，避免旧结果覆盖新结果
let searchSeq = 0;

// 关闭播放器时延迟清空 iframe 的定时器；再次播放时要取消，否则新歌会被这个迟到的定时器清掉
let closePlayerTimer = null;

/**
 * 通用容器控制 - 管理容器的显示和隐藏
 *
 * 淡入淡出全部交给 .fade-in / .fade-out 两个类，不再往元素上写 inline opacity：
 * 之前 showContainer 写了 style.opacity = '1'，内联样式优先级高于 .fade-out 的 opacity: 0，
 * 结果是淡出动画从第二次开始就永远不生效（只剩 visibility 在 0.5s 后瞬间切换）。
 */
const containerControl = {
  /** 每个容器最近一次 hide 的定时器，show 时取消，避免"先隐藏后显示"被迟到的 hide 回调又藏起来 */
  _pendingHide: new WeakMap(),

  /** 容器是否处于可见状态(display 不为 none 且不在淡出过程中) */
  isVisible(container) {
    return !!container
      && container.style.display !== 'none'
      && !container.classList.contains('fade-out');
  },

  hideContainer(container, callback) {
    if (!container || container.style.display === 'none') {
      if (callback) callback();
      return;
    }

    // 已经在淡出中：不重复起定时器，直接回调即可
    if (this._pendingHide.has(container)) {
      if (callback) callback();
      return;
    }

    container.classList.remove('fade-in');
    container.classList.add('fade-out');
    const timer = setTimeout(() => {
      this._pendingHide.delete(container);
      container.style.display = 'none';
      if (callback) callback();
    }, 500);
    this._pendingHide.set(container, timer);
  },

  showContainer(container, callback) {
    if (!container) {
      if (callback) callback();
      return;
    }

    // 若正处于淡出中，取消那次隐藏，否则 500ms 后会把刚显示的容器又藏掉
    const pending = this._pendingHide.get(container);
    if (pending !== undefined) {
      clearTimeout(pending);
      this._pendingHide.delete(container);
    }

    // .no-results / .placeholder 在 CSS 里都是 flex 布局，不能一律写成 block
    const useFlex = container === noResults || container === placeholder;

    // 先以"透明"状态摆进布局，下一帧再切到 fade-in，浏览器才会播放过渡
    container.classList.remove('fade-in');
    container.classList.add('fade-out');
    container.style.display = useFlex ? 'flex' : 'block';
    void container.offsetWidth; // 强制回流，确保 fade-out 状态已经生效

    requestAnimationFrame(() => {
      container.classList.remove('fade-out');
      container.classList.add('fade-in');
      if (callback) callback();
    });
  },

  // 隐藏除 exceptContainer 之外的所有容器，全部隐藏完成后执行 callback
  hideAllContainers(exceptContainer, callback) {
    const targets = [resultsContainer, favoritesContainer, noResults, placeholder]
      .filter(el => el && el !== exceptContainer && el.style.display !== 'none');

    if (targets.length === 0) {
      if (callback) callback();
      return;
    }

    let hidden = 0;
    targets.forEach(el => {
      this.hideContainer(el, () => {
        hidden++;
        if (hidden === targets.length && callback) callback();
      });
    });
  }
};

/**
 * 替换容器底部的统计条
 * @param {HTMLElement} container - 结果容器
 * @param {string} text - 统计文本
 */
function setCount(container, text) {
  container.querySelector('.result-count')?.remove();

  const count = document.createElement('div');
  count.className = 'result-count';
  count.textContent = text;
  container.appendChild(count);
}

/**
 * 显示容器并平滑滚动过去
 * @param {HTMLElement} container - 要显示的容器
 */
function reveal(container) {
  containerControl.showContainer(container, () => {
    setTimeout(() => container.scrollIntoView({ behavior: 'smooth', block: 'start' }), 100);
  });
}

/**
 * 显示一条居中提示(复用无结果提示区)
 * @param {string} message - 提示文本
 */
function showNotice(message) {
  // 只替换 <p> 的文本、保留节点结构；
  // 若直接对容器用 textContent 会销毁 <p>，.no-results p 的样式将永不生效
  const p = noResults.querySelector('p') || noResults.appendChild(document.createElement('p'));
  p.textContent = message;
  containerControl.showContainer(noResults);
}

/**
 * 创建带图标的圆形按钮
 * @param {string} className - 按钮 class
 * @param {string} icon - Material Symbols 图标名
 * @param {string} label - 无障碍标签(aria-label / title)
 * @param {Object} dataset - 要写入的 data-* 属性(camelCase)
 * @returns {HTMLButtonElement}
 */
function iconButton(className, icon, label, dataset) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = className;
  button.setAttribute('aria-label', label);
  button.title = label;
  Object.assign(button.dataset, dataset);

  const span = document.createElement('span');
  span.className = 'material-symbols-rounded';
  span.setAttribute('aria-hidden', 'true');
  span.textContent = icon;
  button.appendChild(span);

  return button;
}

/**
 * 创建一行列表项
 * @param {{id: string, title: string, artist: string}} song
 * @param {boolean} [removable] - 是否显示删除按钮(仅收藏列表需要)
 * @returns {HTMLDivElement}
 */
function buildSongRow({ id, title, artist, vip, cover }, removable) {
  const row = document.createElement('div');
  row.className = 'result-item';

  const titleEl = document.createElement('div');
  titleEl.className = 'result-title';
  const titleText = document.createElement('span');
  titleText.className = 'title-text';
  titleText.textContent = title || '未知歌曲';
  titleText.title = title || '';
  titleEl.appendChild(titleText);
  // VIP 歌曲：在标题旁打上标记
  if (vip) {
    const badge = document.createElement('span');
    badge.className = 'vip-badge';
    badge.textContent = 'VIP';
    badge.title = 'VIP 歌曲';
    titleEl.appendChild(badge);
  }

  const artistEl = document.createElement('div');
  artistEl.className = 'result-artist';
  artistEl.textContent = artist || '未知歌手';
  artistEl.title = artist || '';

  const actionEl = document.createElement('div');
  actionEl.className = 'result-action';
  actionEl.appendChild(iconButton('play-button', 'play_arrow', '播放', {
    songId: id,
    vip: vip ? '1' : '',
    title: title || '',
    artist: artist || '',
    cover: cover || '',
  }));
  if (removable) {
    actionEl.appendChild(iconButton('remove-button', 'delete', '取消收藏', { songId: id }));
  }

  row.append(titleEl, artistEl, actionEl);
  return row;
}

/**
 * 执行搜索
 * @param {string} query - 搜索关键词
 */
async function performSearch(query) {
  if (!query) return;

  favoritesOpen = false; // 一旦发起新搜索，收藏面板视为已关闭(无论后续是结果、空还是出错)
  const seq = ++searchSeq;
  setLoading(true);
  try {
    const results = await musicSource.search(query);
    if (seq !== searchSeq) return; // 期间又发起了新搜索，丢弃这次的过期结果
    displaySearchResults(results);
  } catch (error) {
    if (seq !== searchSeq) return;
    console.error('搜索出错:', error);
    displayError(error?.message || '搜索过程中发生错误，请稍后重试');
  } finally {
    if (seq === searchSeq) setLoading(false);
  }
}

/**
 * 显示搜索结果
 * @param {Array} results - 搜索结果数组
 */
function displaySearchResults(results) {
  // 数据源实现不规范(返回 null / 对象)时按空结果处理，别让页面直接报 TypeError
  const list = Array.isArray(results)
    ? results.filter(r => r && normalizeId(r.id))
    : [];

  // 空结果时不能把 resultsContainer 当作 hideAllContainers 的例外容器，
  // 否则上一次的搜索结果会残留在页面上、与提示同时显示。
  if (list.length === 0) {
    resultsList.innerHTML = '';
    resultsContainer.querySelector('.result-count')?.remove();
    displayError('未找到相关歌曲，请尝试其他关键词。');
    return;
  }

  containerControl.hideAllContainers(resultsContainer, () => {
    resultsList.innerHTML = '';
    const fragment = document.createDocumentFragment();
    list.forEach(result => fragment.appendChild(buildSongRow({
      id: normalizeId(result.id),
      title: result.title,
      artist: result.artist,
      vip: result.vip,
      cover: result.cover,
    })));
    resultsList.appendChild(fragment);
    setCount(resultsContainer, `找到 ${list.length} 个结果`);
    reveal(resultsContainer);
  });
}

/**
 * 只重绘收藏列表的内容，不做容器切换动画
 * @returns {number} 收藏数量
 */
function renderFavoritesList() {
  const items = favorites.read();
  favoritesList.innerHTML = '';
  const fragment = document.createDocumentFragment();
  items.forEach(item => fragment.appendChild(buildSongRow(item, true)));
  favoritesList.appendChild(fragment);
  setCount(favoritesContainer, `共有 ${items.length} 首收藏歌曲`);
  return items.length;
}

/**
 * 显示收藏列表
 */
function displayFavorites() {
  favoritesOpen = true;

  // 收藏列表已经开着(例如播放器里点了爱心触发的刷新)：原地重绘即可，不要整个面板淡出再淡入
  if (containerControl.isVisible(favoritesContainer)) {
    if (renderFavoritesList() === 0) {
      containerControl.hideContainer(favoritesContainer, () => showNotice('暂无收藏歌曲'));
    }
    return;
  }

  containerControl.hideAllContainers(null, () => {
    if (renderFavoritesList() === 0) {
      showNotice('暂无收藏歌曲');
      return;
    }
    reveal(favoritesContainer);
  });
}

/**
 * 关闭收藏面板，回到打开前的界面
 */
function closeFavorites() {
  favoritesOpen = false;

  // 回到之前的界面；若之前的界面已不存在(如结果被清空)，退回占位区
  let target = viewBeforeFavorites;
  if (target === resultsContainer && resultsList.children.length === 0) target = placeholder;
  // noResults 的文案可能已被“暂无收藏歌曲”覆盖，回去会显示错误提示，一律退回占位区
  if (!target || target === favoritesContainer || target === noResults) target = placeholder;
  viewBeforeFavorites = null;

  containerControl.hideAllContainers(target, () => {
    if (!containerControl.isVisible(target)) containerControl.showContainer(target);
  });
}

/**
 * 打开播放器播放指定歌曲
 * @param {string} id - 数据源歌曲 ID
 */
function playTrack(id, meta) {
  id = normalizeId(id);
  if (!id) return;

  // 取消"关闭播放器后延迟清空 iframe"的定时器，否则 300ms 内再次播放会被它清掉
  if (closePlayerTimer !== null) {
    clearTimeout(closePlayerTimer);
    closePlayerTimer = null;
  }

  // getSongUrl 只返回音频直链、不返回标题/歌手/封面/是否 VIP，
  // 所以把搜索结果里拿到的这些元数据通过 URL 带给播放页（见 loadTrack 补齐）
  const params = new URLSearchParams();
  params.set('id', id);
  if (meta) {
    if (meta.title) params.set('title', meta.title);
    if (meta.artist) params.set('artist', meta.artist);
    if (meta.cover) params.set('cover', meta.cover);
    if (meta.vip) params.set('vip', '1');
  }

  playerFrame.src = `./player.html?${params.toString()}`;
  // 收起/展开时的可访问性由 CSS 的 visibility 负责(隐藏时自动移出 Tab 顺序与无障碍树)
  playerContainer.classList.add('active');
}

/**
 * 关闭播放器
 */
function closePlayer() {
  playerContainer.classList.remove('active');

  // 等滑出动画结束再卸载 iframe，音乐随之停止
  if (closePlayerTimer !== null) clearTimeout(closePlayerTimer);
  closePlayerTimer = setTimeout(() => {
    closePlayerTimer = null;
    playerFrame.src = 'about:blank';
  }, 300);
}

/**
 * 从收藏列表里删掉一行（存储层删除 + 淡出动画 + 计数更新）
 * @param {string} id - 歌曲ID
 */
function removeFavoriteRow(id) {
  // 用属性比对而非拼选择器，避免 id 中的特殊字符破坏选择器
  const button = [...favoritesList.querySelectorAll('.remove-button')]
    .find(el => el.dataset.songId === id);
  const row = button?.closest('.result-item');

  // 连点两次同一个删除按钮：第二次直接忽略，动画正在进行
  if (row?.dataset.removing) return;

  if (!favorites.remove(id)) {
    displayFavorites(); // 存储写失败或该项已不存在：以存储为准整表重绘，避免 UI 与数据不一致
    return;
  }
  const remaining = favorites.read();

  if (!row) {
    displayFavorites(); // 找不到对应行时整表重绘兜底
    return;
  }

  row.dataset.removing = '1';
  button.disabled = true;

  // 淡出并收起该行。height 从 auto 到 0 不会有过渡，先固定成当前像素高度再压到 0
  row.style.height = `${row.offsetHeight}px`;
  row.style.overflow = 'hidden';
  void row.offsetHeight; // 强制回流，让上面的高度先生效
  row.style.transition = 'opacity 0.3s, height 0.3s, margin 0.3s, padding 0.3s';
  Object.assign(row.style, { opacity: '0', height: '0', margin: '0', padding: '0' });

  setTimeout(() => {
    row.remove();

    if (remaining.length === 0) {
      favoritesList.innerHTML = '';
      containerControl.hideContainer(favoritesContainer, () => {
        if (favoritesOpen) showNotice('暂无收藏歌曲');
      });
      return;
    }

    const count = favoritesContainer.querySelector('.result-count');
    if (!count) return;

    count.textContent = `共有 ${remaining.length} 首收藏歌曲`;
    count.style.transition = 'transform 0.3s, background-color 0.3s';
    count.style.transform = 'scale(1.05)';
    count.style.backgroundColor = 'rgba(66, 133, 244, 0.1)';
    setTimeout(() => {
      count.style.transform = 'scale(1)';
      count.style.backgroundColor = '';
    }, 300);
  }, 300);
}

/**
 * 显示错误信息
 * @param {string} message - 错误信息
 */
function displayError(message) {
  containerControl.hideAllContainers(noResults, () => showNotice(message));
}

/**
 * 设置搜索按钮的加载状态
 * @param {boolean} isLoading - 是否正在加载
 */
function setLoading(isLoading) {
  searchText.style.display = isLoading ? 'none' : '';
  searchLoading.style.display = isLoading ? 'block' : 'none';
  searchButton.disabled = isLoading;
  searchButton.setAttribute('aria-busy', String(isLoading));
}

/**
 * 预加载播放器资源，以避免首次播放时的加载延迟
 */
function preloadPlayer() {
  const frame = document.createElement('iframe');
  frame.setAttribute('aria-hidden', 'true');
  frame.tabIndex = -1;
  Object.assign(frame.style, {
    width: '0', height: '0', border: 'none',
    position: 'absolute', left: '-9999px', top: '-9999px'
  });

  // 加载完成后一段时间移除，释放资源；即便 load 事件没触发也兜底移除，避免残留一个隐藏 iframe
  let removed = false;
  const remove = () => {
    if (removed) return;
    removed = true;
    frame.remove();
  };
  frame.onload = () => setTimeout(remove, 5000);
  setTimeout(remove, 30000);

  frame.src = './player.html';
  document.body.appendChild(frame);
}

/**
 * 检查是否是 ID 直接播放格式(c+数字，大小写不敏感)。ID 会原样交给数据源，不做二次加工。
 * @param {string} query - 用户输入的查询字符串
 * @returns {string|null} - 有效的 ID，否则 null
 */
function checkDirectPlayId(query) {
  const match = /^c(\d+)$/i.exec(query);
  return match ? match[1] : null;
}

/**
 * 根据输入框内容执行搜索或直接播放
 */
function submitQuery() {
  const query = searchInput.value.trim();
  if (!query) return;

  const directPlayId = checkDirectPlayId(query);
  if (directPlayId) {
    playTrack(directPlayId);
  } else {
    performSearch(query);
  }
}

/**
 * 让主题按钮的图标反映当前主题
 */
function syncThemeIcon() {
  const dark = themeControl.isDark();
  const icon = themeToggleBtn?.querySelector('.material-symbols-rounded');
  if (icon) icon.textContent = dark ? 'light_mode' : 'dark_mode';
  themeToggleBtn?.setAttribute('aria-label', dark ? '切换到浅色主题' : '切换到深色主题');
}

/**
 * 版本检查和更新提示
 *
 * 原理：index.html 的 loader 按 update.json 里的 version 拼出 app.js?v=xxx 来加载本文件，
 * 所以"正常情况下"用户拿到的 app.js 的 APP_VERSION 就等于 update.json 的 version。
 * 什么时候会不等？
 *   - 用户把标签页一直开着，期间你发了新版本(这是这个弹窗真正要解决的场景)；
 *   - loader 拿 update.json 超时、退回了无版本号 URL、命中了旧缓存。
 * 两种情况下都只需要重新导航一次：新 index.html(no-cache) -> 新 update.json(no-store)
 * -> 新的 ?v= -> 新 app.js。不需要也不再可能"清缓存"。
 *
 * 判定依据是 APP_VERSION(代码里写死的)而非 localStorage：只要用户还在跑旧代码就会一直
 * 被提醒；一旦真的拿到新代码，APP_VERSION 自然就对上了。不存在"记了已更新但其实没更新"。
 */
const UPDATE_DISMISSED_KEY = 'yiclape:update-dismissed';   // sessionStorage，本会话关过的"请刷新"弹窗版本

/**
 * localStorage，用户最近一次看过更新日志的版本号。
 * 注意它和早先删掉的 yiclape:version 语义完全不同：那个曾用来决定"要不要提示刷新"，
 * 会造成"记了已更新其实没更新"的锁死；这个只决定"日志看没看过"，不参与任何更新判断。
 */
const CHANGELOG_SEEN_KEY = 'yiclape:changelog-seen';

const updateControl = {
  _checking: false,

  /**
   * 拉取线上版本信息。
   * @returns {Promise<{version: string, updateTime?: string, changes?: string[]}|null>}
   */
  async fetchRemote() {
    // no-store + 时间戳双保险：即便某层代理无视 Cache-Control 也拿不到旧 json
    const res = await fetch('./update.json?_=' + Date.now(), { cache: 'no-store' });
    if (!res.ok) return null;
    const data = await res.json();
    if (!data || data.version === undefined || data.version === null) return null;
    return { ...data, version: String(data.version) };
  },

  async checkForUpdate() {
    if (this._checking) return; // visibilitychange 与定时器可能同时触发
    this._checking = true;
    try {
      const remote = await this.fetchRemote();
      if (!remote) return;

      // 严格按"不相等"判断而不是"大于"：万一需要回滚到旧版本，用户同样应该被切过去
      if (remote.version === APP_VERSION) return;

      // 用户本次会话里已经关掉过这个版本的弹窗，切回标签页时就别再弹了
      try {
        if (sessionStorage.getItem(UPDATE_DISMISSED_KEY) === remote.version) return;
      } catch {}

      this.showUpdateModal(remote);
    } catch (e) {
      console.error('检查更新出错:', e);
    } finally {
      this._checking = false;
    }
  },

  /**
   * 重新加载页面以获取新版本。
   * index.html / update.json 都是 no-cache / no-store，普通导航就够了，
   * 带个一次性参数只是为了绕过极个别无视缓存头的中间代理。
   */
  reloadForUpdate() {
    const url = new URL(location.href);
    url.searchParams.set('_r', Date.now().toString(36));
    location.replace(url.toString());
  },

  /** 把上面加的一次性参数从地址栏去掉 */
  stripReloadParam() {
    try {
      const url = new URL(location.href);
      if (!url.searchParams.has('_r') && !url.searchParams.has('__v')) return; // __v 是旧版本留下的
      url.searchParams.delete('_r');
      url.searchParams.delete('__v');
      history.replaceState(history.state, '', url.toString());
    } catch {}
  },

  /**
   * @param {{version: string, updateTime?: string, changes?: string[]}} data
   * @param {{mode?: 'refresh'|'changelog', onClose?: Function}} [options]
   *   refresh   (默认) 线上有新版本，按钮为"刷新"
   *   changelog 升级后首次打开，按钮为"知道了"，关闭时回调 onClose
   */
  showUpdateModal(data, { mode = 'refresh', onClose } = {}) {
    const modal = document.getElementById('updateModal');
    const overlay = document.getElementById('updateOverlay');
    const title = document.getElementById('updateModalTitle');
    const updateTime = document.getElementById('updateTime');
    const updateList = document.getElementById('updateList');
    const refreshButton = document.getElementById('refreshButton');
    if (!modal || !overlay || !updateTime || !updateList || !refreshButton) return;
    if (modal.classList.contains('active')) return; // 已经在显示了

    const isChangelog = mode === 'changelog';
    if (title) title.textContent = isChangelog ? '更新内容' : '发现新版本';
    updateTime.textContent = data.updateTime ? `更新时间: ${data.updateTime}` : '';
    updateList.innerHTML = '';
    (Array.isArray(data.changes) ? data.changes : []).forEach(c => {
      const li = document.createElement('li');
      li.textContent = String(c);
      updateList.appendChild(li);
    });

    // Esc 与点击遮罩等价；关闭时把监听器一并摘掉，避免每次弹窗都多挂一个
    let onKeydown = null;
    const hide = () => {
      overlay.classList.remove('active');
      modal.classList.remove('active');
      if (onKeydown) document.removeEventListener('keydown', onKeydown);
    };
    const bindEscape = dismiss => {
      onKeydown = e => { if (e.key === 'Escape') dismiss(); };
      document.addEventListener('keydown', onKeydown);
    };

    refreshButton.disabled = false;
    if (isChangelog) {
      refreshButton.textContent = '知道了';
      const close = () => { hide(); if (onClose) onClose(); };
      refreshButton.onclick = close;
      overlay.onclick = close;
      bindEscape(close);
    } else {
      refreshButton.textContent = '刷新';
      refreshButton.onclick = () => {
        refreshButton.disabled = true;
        refreshButton.textContent = '更新中...';
        this.reloadForUpdate();
      };
      const dismiss = () => {
        hide();
        try { sessionStorage.setItem(UPDATE_DISMISSED_KEY, data.version); } catch {}
      };
      overlay.onclick = dismiss;
      bindEscape(dismiss);
    }

    overlay.classList.add('active');
    modal.classList.add('active');
    refreshButton.focus(); // 对话框弹出后焦点进去，键盘用户才能操作
  },

  /**
   * 升级后首次打开：展示本版本的更新日志(同一个弹窗，按钮换成"知道了"，不刷新)。
   *
   * 为什么需要这个：loader 已经保证新打开的页面总是最新代码，所以"请刷新"弹窗
   * 只有标签页一直开着的用户才会遇到——绝大多数人再也看不到更新日志。这里补上。
   * 只在 APP_VERSION 与"上次看过的版本"不同时弹一次；首次访问的新用户没有"更新"可言，
   * 静默记录当前版本即可。
   */
  async showChangelogIfUpgraded() {
    let seen = null;
    try { seen = localStorage.getItem(CHANGELOG_SEEN_KEY); } catch { return; }

    const markSeen = () => { try { localStorage.setItem(CHANGELOG_SEEN_KEY, APP_VERSION); } catch {} };

    if (seen === null) { markSeen(); return; }       // 新用户
    if (seen === APP_VERSION) return;                 // 已看过

    try {
      const remote = await this.fetchRemote();
      // 只展示与当前代码同版本的日志；若线上已经又发了新版，交给 checkForUpdate 提示刷新即可
      if (!remote || remote.version !== APP_VERSION) return;
      this.showUpdateModal(remote, { mode: 'changelog', onClose: markSeen });
    } catch (e) {
      console.error('读取更新日志出错:', e);
    }
  },

  init() {
    this.stripReloadParam();
    // 先看有没有该展示的更新日志，再开始例行的新版本检查(两者互斥，见 showUpdateModal)
    setTimeout(() => this.showChangelogIfUpgraded().finally(() => this.checkForUpdate()), 800);
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') this.checkForUpdate();
    });
    setInterval(() => this.checkForUpdate(), 30 * 60 * 1000);
  }
};

/**
 * 打开音质选择弹窗（在线收听音质）。
 * 首次访问且尚未选择过会自动弹出；也可通过右上角按钮随时重新打开。
 * 选择写入独立 localStorage 键 yiclape:audio-quality。
 */
function openQualityModal() {
  const modal = document.getElementById('qualityModal');
  const overlay = document.getElementById('qualityOverlay');
  const list = document.getElementById('qualityList');
  if (!modal || !overlay || !list) return;
  if (modal.classList.contains('active')) return;

  list.innerHTML = '';
  let selected = getQuality();

  QUALITY_LEVELS.forEach(q => {
    const item = document.createElement('button');
    item.type = 'button';
    item.className = 'quality-option' + (q.level === selected ? ' active' : '');
    item.dataset.level = q.level;

    const label = document.createElement('span');
    label.className = 'quality-label';
    label.textContent = q.label;
    item.appendChild(label);

    if (q.warn) {
      const warn = document.createElement('span');
      warn.className = 'quality-warn';
      warn.textContent = q.warn;
      item.appendChild(warn);
    }

    item.addEventListener('click', () => {
      selected = q.level;
      list.querySelectorAll('.quality-option').forEach(o => o.classList.toggle('active', o.dataset.level === selected));
    });
    list.appendChild(item);
  });

  const confirmBtn = document.getElementById('qualityConfirm');
  const close = () => {
    // 无论点“保存”还是点遮罩/Esc 关闭，都记下当前选择（默认 standard），避免首次访问被反复弹窗
    setQuality(selected);
    overlay.classList.remove('active');
    modal.classList.remove('active');
    document.removeEventListener('keydown', onKeydown);
  };
  const onKeydown = e => { if (e.key === 'Escape') close(); };
  confirmBtn.onclick = close;
  overlay.onclick = close;
  document.addEventListener('keydown', onKeydown);

  overlay.classList.add('active');
  modal.classList.add('active');
}

/**
 * 主页入口
 */
function initMainPage() {
  searchInput = document.getElementById('search-input');
  searchButton = document.getElementById('search-button');
  searchText = document.querySelector('.search-text');
  searchLoading = document.querySelector('.search-loading');
  resultsContainer = document.getElementById('results-container');
  resultsList = document.getElementById('results-list');
  noResults = document.getElementById('no-results');
  placeholder = document.getElementById('placeholder');
  playerContainer = document.getElementById('player-container');
  playerFrame = document.getElementById('player-frame');
  favoritesContainer = document.getElementById('favorites-container');
  favoritesList = document.getElementById('favorites-list');
  themeToggleBtn = document.getElementById('new-theme-toggle');

  themeControl.init(syncThemeIcon);
  updateControl.init();
  syncThemeIcon();
  preloadPlayer();

  const yearEl = document.getElementById('current-year');
  if (yearEl) yearEl.textContent = String(new Date().getFullYear());

  // 初始化容器的淡入淡出状态
  [resultsContainer, noResults, favoritesContainer, placeholder]
    .forEach(el => el?.classList.add('fade-in'));

  // 主题切换
  themeToggleBtn?.addEventListener('click', () => {
    themeControl.toggleTheme();
    syncThemeIcon();
  });

  // 音质设置：右上角按钮随时打开；首次访问且未选择过则自动弹出（等加载遮罩淡出后再弹，避免遮挡）
  document.getElementById('quality-btn')?.addEventListener('click', openQualityModal);
  try {
    if (localStorage.getItem(QUALITY_KEY) === null) {
      setTimeout(openQualityModal, 700);
    }
  } catch {}

  // 收藏按钮：在收藏列表与之前的界面之间切换
  document.getElementById('favorites-btn')?.addEventListener('click', () => {
    if (favoritesOpen) {
      closeFavorites();
      return;
    }
    viewBeforeFavorites = [resultsContainer, noResults, placeholder]
      .find(el => containerControl.isVisible(el)) || placeholder;
    displayFavorites();
  });

  // 列表内的按钮统一用事件委托，避免每次渲染重复绑定监听器
  resultsList.addEventListener('click', e => {
    const button = e.target.closest('.play-button');
    if (!button) return;
    playTrack(button.dataset.songId, {
      vip: button.dataset.vip === '1',
      title: button.dataset.title,
      artist: button.dataset.artist,
      cover: button.dataset.cover,
    });
  });

  favoritesList.addEventListener('click', e => {
    const button = e.target.closest('button');
    const id = button?.dataset.songId;
    if (!id) return;

    if (button.classList.contains('remove-button')) {
      removeFavoriteRow(id);
    } else {
      playTrack(id, {
        vip: button.dataset.vip === '1',
        title: button.dataset.title,
        artist: button.dataset.artist,
        cover: button.dataset.cover,
      });
    }
  });

  // 播放器 iframe 里点爱心增删收藏时，若收藏面板正开着就跟着刷新
  // (storage 事件只在"其它"文档里触发，所以主页自己的增删不会走到这里，也不需要)
  window.addEventListener('storage', event => {
    if (event.storageArea !== localStorage) return;
    if ((event.key === FAVORITES_KEY || event.key === null) && favoritesOpen) {
      displayFavorites();
    }
  });

  // 输入 "c12345" 时按钮文案切换为"播放"
  searchInput.addEventListener('input', () => {
    searchText.textContent = checkDirectPlayId(searchInput.value.trim()) ? '播放' : '搜索';
  });

  searchButton.addEventListener('click', submitQuery);

  // keypress 已废弃，改用 keydown；同时忽略中文输入法组词过程中的回车(那是在选字，不是提交)
  searchInput.addEventListener('keydown', e => {
    if (e.key !== 'Enter') return;
    if (e.isComposing || e.keyCode === 229) return;
    if (searchButton.disabled) return; // 搜索进行中，与按钮保持一致
    e.preventDefault();
    submitQuery();
  });

  document.getElementById('close-player')?.addEventListener('click', closePlayer);

  // Esc 关闭播放器
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && playerContainer.classList.contains('active')) closePlayer();
  });
}

/* ==========================================================================
   4. 播放器
   ========================================================================== */

// 音量控制器只在宽屏下创建。用 matchMedia 与 player.css 里的 @media (min-width: 992px) 精确对齐
const WIDE_SCREEN_QUERY = '(min-width: 992px)';

// 播放器 DOM 元素与状态（在 initPlayerPage 中赋值）
let audioSource, playBtn, playerSeekRange, playerRunningTime, playerDuration;
// savedVolume: 记住用户设定的音量（非静音值），用于取消静音时恢复、
// 以及音量控件因跨越宽屏断点被销毁重建后回填，避免被重置为最大值
let volumeRange = null, volumeBtn = null, muteState = false, savedVolume = 1;
// 用户正在拖动进度条时，不让 timeupdate 把滑块拉回去
let isSeeking = false;
// 当前歌曲(供收藏按钮读取)。之前挂在 window.currentSong 上，没必要暴露成全局变量
let currentSong = null;

/**
 * 更新收藏按钮的图标与配色
 * @param {boolean} isFav - 当前歌曲是否已收藏
 */
function updateFavoriteButtonUI(isFav) {
  const favoriteBtn = document.querySelector('[data-favorite]');
  const iconElement = favoriteBtn?.querySelector('.material-symbols-rounded');
  if (!iconElement) return;

  iconElement.textContent = isFav ? 'favorite' : 'favorite_border';
  iconElement.style.color = isFav ? '#ff3e55' : '';
  favoriteBtn.classList.toggle('active', isFav);
  favoriteBtn.setAttribute('aria-pressed', String(isFav));
  favoriteBtn.setAttribute('aria-label', isFav ? '取消收藏' : '收藏');
}

/**
 * 收起加载层
 */
function hidePlayerLoading() {
  document.getElementById('loadingOverlay')?.classList.add('hidden');
}

/**
 * 在播放器上显示错误信息并收起加载层
 * @param {string} title - 标题文本
 * @param {string} message - 说明文本
 */
function showPlayerError(title, message) {
  const playerTitle = document.querySelector('[data-title]');
  const playerArtist = document.querySelector('[data-artist]');
  if (playerTitle) playerTitle.textContent = title;
  if (playerArtist) playerArtist.textContent = message;
  hidePlayerLoading();
}

/**
 * 使用渐变效果加载图片
 * @param {HTMLImageElement} imgElement - 要更新的图片元素
 * @param {string} src - 新图片的URL
 * @param {Function} [callback] - 图片加载完成后的回调
 */
function loadImageWithFade(imgElement, src, callback) {
  const newImg = new Image();

  newImg.onload = () => {
    imgElement.style.opacity = '0';

    // 等淡出动画结束后再换源
    setTimeout(() => {
      imgElement.src = src;
      imgElement.style.opacity = '1';
      if (callback) callback();
    }, 300);
  };

  newImg.onerror = () => {
    console.error('封面加载失败:', src);
    imgElement.style.opacity = '1';
  };

  newImg.src = src;
}

/**
 * 将秒转换为 m:ss 时间码。
 * 先整体向下取整再拆分分秒：浮点余秒若用 Math.ceil 会进位出 60，
 * 导致播放中显示 "0:60"/"1:60"，且整分钟 "x:00" 被跳过。
 * NaN / Infinity(时长未知、直播流)一律显示 0:00，Math.max(0, NaN) 会得到 NaN。
 */
function getTimecode(duration) {
  const n = Number(duration);
  const total = Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return `${minutes}:${seconds < 10 ? '0' : ''}${seconds}`;
}

/**
 * 更新所有进度条的填充(音量滑块是运行时创建的，因此每次实时查询)
 */
function updateRangeFill() {
  document.querySelectorAll('[data-range]').forEach(range => {
    const fill = range.nextElementSibling;
    if (!fill) return;
    const max = Number(range.max) || 0;
    const ratio = max > 0 ? Math.min(1, Math.max(0, Number(range.value) / max)) : 0;
    fill.style.width = `${ratio * 100}%`;
  });
}

/**
 * 更新音频总时长
 */
function updateDuration() {
  if (!playerSeekRange || !playerDuration) return;

  const duration = audioSource.duration;
  // 元数据未就绪时是 NaN，直播流是 Infinity；写进 max 会变成 "NaN"/"Infinity" 这种无效值
  if (!Number.isFinite(duration) || duration <= 0) {
    playerDuration.textContent = getTimecode(0);
    return;
  }

  playerSeekRange.max = String(Math.ceil(duration));
  playerDuration.textContent = getTimecode(duration);
  updateRangeFill();
}

/**
 * 更新播放进度(由 audio 的 timeupdate 事件驱动，不再用 setInterval 轮询)
 */
function updateRunningTime() {
  if (isSeeking || !playerSeekRange || !playerRunningTime) return;
  playerSeekRange.value = String(audioSource.currentTime);
  playerRunningTime.textContent = getTimecode(audioSource.currentTime);
  updateRangeFill();
}

/**
 * 播放/暂停
 */
function togglePlay() {
  if (!audioSource.src || audioSource.error) return; // 没有可播的音频

  if (audioSource.paused) {
    // 按钮状态由 audio 的 play/pause 事件统一驱动，这里只负责发起
    audioSource.play().catch(error => console.error('播放失败:', error));
  } else {
    audioSource.pause();
  }
}

function setVolumeIcon() {
  const icon = volumeBtn?.querySelector('.material-symbols-rounded');
  if (!icon) return;
  const muted = audioSource.volume <= 0;
  icon.textContent = muted ? 'volume_off' : 'volume_up';
  volumeBtn.setAttribute('aria-label', muted ? '取消静音' : '静音');
}

function changeVolume() {
  if (!volumeRange || !volumeBtn) return;
  audioSource.volume = Number(volumeRange.value);
  muteState = audioSource.volume <= 0;
  if (!muteState) savedVolume = audioSource.volume;
  setVolumeIcon();
}

function muteVolume() {
  if (!volumeRange || !volumeBtn) return;

  muteState = !muteState;
  // 取消静音恢复之前的音量，而非直接跳到最大；若之前保存的就是 0，则恢复到最大
  audioSource.volume = muteState ? 0 : (savedVolume > 0 ? savedVolume : 1);
  volumeRange.value = String(audioSource.volume);
  setVolumeIcon();
  updateRangeFill();
}

/**
 * 按屏幕宽度创建或销毁音量控制器(宽屏才显示)
 * @param {boolean} shouldBuild - 是否应该存在音量控制器
 */
function buildVolumeControl(shouldBuild) {
  const volumeContainer = document.getElementById('volume-container');
  if (!volumeContainer) return;

  if (shouldBuild === Boolean(volumeRange)) return; // 没有跨越断点，无需重建

  volumeContainer.innerHTML = '';
  volumeRange = null;
  volumeBtn = null;

  if (!shouldBuild) {
    // 窄屏下没有任何 UI 能取消静音，别让声音悄悄卡在 0；恢复到用户上次的音量
    if (muteState) {
      muteState = false;
      audioSource.volume = savedVolume > 0 ? savedVolume : 1;
    }
    return;
  }

  const volume = document.createElement('div');
  volume.className = 'volume';

  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'btn-icon';
  button.innerHTML = '<span class="material-symbols-rounded" aria-hidden="true">volume_up</span>';

  const wrapper = document.createElement('div');
  wrapper.className = 'range-wrapper';

  const slider = document.createElement('input');
  slider.type = 'range';
  slider.min = '0';
  slider.max = '1';
  slider.step = '0.05';
  slider.value = String(muteState ? 0 : savedVolume); // 恢复跨断点前的音量/静音状态（默认最大）
  slider.className = 'range volume-slider';
  slider.dataset.range = '';
  slider.setAttribute('aria-label', '音量');

  const fill = document.createElement('div');
  fill.className = 'range-fill';

  wrapper.append(slider, fill);
  volume.append(button, wrapper);
  volumeContainer.appendChild(volume);

  volumeRange = slider;
  volumeBtn = button;
  audioSource.volume = Number(slider.value);
  setVolumeIcon(); // 让图标与恢复后的音量一致（如静音状态下显示 volume_off）

  slider.addEventListener('input', () => {
    changeVolume();
    updateRangeFill();
  });
  button.addEventListener('click', muteVolume);

  updateRangeFill();
}

/**
 * 把 URL 放进 CSS url() 时转义引号和反斜杠，避免封面地址里的特殊字符破坏样式
 */
function cssUrl(url) {
  return `url("${String(url).replace(/["\\\n]/g, ch => '\\' + ch)}")`;
}

/**
 * 更新播放器 UI
 * @param {{id: string, title: string, artist: string, cover: string, audioUrl: string}} track
 */
function updatePlayerUI(track) {
  const playerBanner = document.querySelector('[data-player-banner]');
  const playerTitle = document.querySelector('[data-title]');
  const playerArtist = document.querySelector('[data-artist]');

  const title = track.title || '未知歌曲';
  const artist = track.artist || '未知歌手';

  if (playerTitle) playerTitle.textContent = title;
  if (playerArtist) playerArtist.textContent = artist;
  document.title = `${title} - ${artist} | YiClapOnline`;

  // 供收藏功能读取当前歌曲（连同 vip / cover 一并记下，收藏后从收藏列表播放也能带上）
  currentSong = {
    id: normalizeId(track.id),
    title,
    artist,
    vip: track.vip === true,
    cover: track.cover || '',
  };
  updateFavoriteButtonUI(favorites.has(currentSong.id));

  // VIP 歌曲：在播放器合适位置展示"独家解析"提示
  const vipBanner = document.querySelector('[data-vip-banner]');
  if (vipBanner) vipBanner.hidden = !(track.vip === true);

  // 数据源没给封面时，沿用 HTML 里的默认封面
  if (playerBanner && track.cover) {
    loadImageWithFade(playerBanner, track.cover, () => {
      playerBanner.setAttribute('alt', `${title} 专辑封面`);
      // 图片确认能加载再拿去做背景，避免背景先闪一下 broken 图
      document.body.style.backgroundImage = cssUrl(track.cover);
    });
  }

  // 系统媒体控制(锁屏 / 耳机按键 / 通知栏)显示歌曲信息
  if ('mediaSession' in navigator) {
    try {
      navigator.mediaSession.metadata = new MediaMetadata({
        title,
        artist,
        artwork: track.cover ? [{ src: track.cover }] : [],
      });
    } catch {}
  }

  audioSource.src = track.audioUrl;

  // 歌曲信息已经拿到就可以收起加载层了。之前等 loadeddata 才收：
  // iOS Safari 在用户没有交互前根本不会预加载音频，加载层会永远转圈。
  hidePlayerLoading();
}

/**
 * 从 id 查询参数读取歌曲 ID，交给数据源换取播放信息
 */
async function loadTrack() {
  const params = new URLSearchParams(window.location.search);
  const songId = params.get('id');

  if (!songId) {
    showPlayerError('未提供歌曲 ID', '请从主页选择要播放的歌曲');
    return;
  }

  // getSongUrl 不返回元数据，主页在打开播放器时已把标题/歌手/封面/是否 VIP 通过 URL 带过来
  const meta = {
    title: params.get('title') || '',
    artist: params.get('artist') || '',
    cover: params.get('cover') || '',
    vip: params.get('vip') === '1',
  };

  try {
    const track = await musicSource.getTrack(songId);
    if (!track || !track.audioUrl) {
      throw new Error('该歌曲暂时无法播放');
    }
    // 数据源忘了回传 id 时用请求的 id 兜底，否则收藏对不上号
    if (!normalizeId(track.id)) track.id = songId;
    // 用主页传来的元数据补齐（getSongUrl 只给出音频直链）
    track.title = track.title || meta.title;
    track.artist = track.artist || meta.artist;
    track.cover = track.cover || meta.cover;
    track.vip = track.vip || meta.vip;
    updatePlayerUI(track);
  } catch (error) {
    console.error('获取歌曲信息失败:', error);
    showPlayerError('获取歌曲失败', error?.message || '请稍后重试');
  }
}

/**
 * 让主题按钮的图标反映当前主题
 */
function syncPlayerThemeIcon() {
  const dark = themeControl.isDark();
  const btn = document.querySelector('[data-theme-toggle]');
  const icon = btn?.querySelector('.material-symbols-rounded');
  if (icon) icon.textContent = dark ? 'light_mode' : 'dark_mode';
  btn?.setAttribute('aria-label', dark ? '切换到浅色主题' : '切换到深色主题');
}

/**
 * 把字节数格式化成 MB / GB（下载弹窗展示用）
 * @param {number} bytes
 * @returns {string}
 */
function formatSize(bytes) {
  const n = Number(bytes);
  if (!Number.isFinite(n) || n <= 0) return '';
  const mb = n / (1024 * 1024);
  if (mb >= 1024) return (mb / 1024).toFixed(2) + ' GB';
  return mb.toFixed(1) + ' MB';
}

/**
 * 无感唤起下载：fetch 音频为 Blob 后通过 <a download> 在当前页触发下载，不打开新页面/新标签页。
 * 依赖音频 CDN 的 CORS（已确认返回 Access-Control-Allow-Origin: *）。
 * @param {string} url
 * @param {string} filename
 */
async function seamlessDownload(url, filename) {
  try {
    const resp = await fetch(url);
    if (!resp.ok) throw new Error('HTTP ' + resp.status);
    const blob = await resp.blob();
    const objUrl = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = objUrl;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(objUrl), 60000);
  } catch (e) {
    console.warn('下载失败（可能为跨域或网络限制）:', e);
  }
}

/** 在下载弹窗里追加一行（某音质 + 大小 + 下载按钮） */
function renderDownloadRow(list, item, safeTitle) {
  const row = document.createElement('div');
  row.className = 'download-row';

  const label = document.createElement('span');
  label.className = 'download-label';
  label.textContent = item.label;
  row.appendChild(label);

  if (item.size) {
    const size = document.createElement('span');
    size.className = 'download-size';
    size.textContent = formatSize(item.size);
    row.appendChild(size);
  }

  if (item.warn) {
    const warn = document.createElement('span');
    warn.className = 'download-warn';
    warn.textContent = item.warn;
    row.appendChild(warn);
  }

  const dlBtn = document.createElement('button');
  dlBtn.type = 'button';
  dlBtn.className = 'download-row-btn';
  dlBtn.textContent = '下载';
  dlBtn.addEventListener('click', () => {
    // 用直链后缀决定文件扩展名（无损类为 flac，标准/极高类为 mp3）
    const ext = (item.url.split('?')[0].match(/\.(\w+)$/) || [, 'mp3'])[1];
    seamlessDownload(item.url, `${safeTitle} (${item.label}).${ext}`);
  });
  row.appendChild(dlBtn);

  list.appendChild(row);
}

/**
 * 下载弹窗：先展示标准音质及其大小，并提供“继续解析 VIP 和 SVIP 音质”按钮；
 * 点击后逐个解析更高音质并呈现大小，每行可无感下载。
 */
async function openDownloadModal() {
  const modal = document.getElementById('downloadModal');
  const overlay = document.getElementById('downloadOverlay');
  const list = document.getElementById('downloadList');
  if (!modal || !overlay || !list || !currentSong?.id) return;
  if (modal.classList.contains('active')) return;

  const safeTitle = (currentSong.title || 'music').replace(/[\\/:*?"<>|]+/g, '_').trim() || 'music';
  list.innerHTML = '<div class="download-loading">正在解析标准音质…</div>';

  const close = () => {
    overlay.classList.remove('active');
    modal.classList.remove('active');
    document.removeEventListener('keydown', onKeydown);
  };
  const onKeydown = e => { if (e.key === 'Escape') close(); };
  document.getElementById('downloadClose').onclick = close;
  overlay.onclick = close;
  document.addEventListener('keydown', onKeydown);
  overlay.classList.add('active');
  modal.classList.add('active');

  // 先解析并展示标准音质
  try {
    const std = await musicSource.getTrackUrl(currentSong.id, 'standard');
    list.querySelector('.download-loading')?.remove();
    renderDownloadRow(list, { label: '标准音质', url: std.url, size: std.size }, safeTitle);
  } catch (e) {
    list.querySelector('.download-loading')?.remove();
    const err = document.createElement('div');
    err.className = 'download-error';
    err.textContent = '标准音质解析失败：' + (e.message || '请稍后重试');
    list.appendChild(err);
  }

  // “继续解析 VIP 和 SVIP 音质”按钮
  const moreBtn = document.createElement('button');
  moreBtn.type = 'button';
  moreBtn.className = 'download-more-btn';
  moreBtn.textContent = '继续解析 VIP 和 SVIP 音质';
  moreBtn.addEventListener('click', async () => {
    moreBtn.disabled = true;
    moreBtn.textContent = '正在解析更高音质…';
    for (const q of QUALITY_LEVELS.filter(q => q.level !== 'standard')) {
      try {
        const r = await musicSource.getTrackUrl(currentSong.id, q.level);
        renderDownloadRow(list, { label: q.label, url: r.url, size: r.size, warn: q.warn }, safeTitle);
      } catch {
        const row = document.createElement('div');
        row.className = 'download-row download-row--error';
        const label = document.createElement('span');
        label.className = 'download-label';
        label.textContent = q.label;
        const warn = document.createElement('span');
        warn.className = 'download-warn';
        warn.textContent = '解析失败';
        row.append(label, warn);
        list.appendChild(row);
      }
    }
    moreBtn.remove();
  });
  list.appendChild(moreBtn);
}

/**
 * 播放器入口
 */
function initPlayerPage() {
  audioSource = new Audio();
  audioSource.preload = 'metadata';
  playBtn = document.querySelector('[data-play-btn]');
  playerSeekRange = document.querySelector('[data-seek]');
  playerRunningTime = document.querySelector('[data-running-time]');
  playerDuration = document.querySelector('[data-duration]');

  themeControl.init(syncPlayerThemeIcon);
  syncPlayerThemeIcon();

  document.querySelector('[data-theme-toggle]')?.addEventListener('click', () => {
    themeControl.toggleTheme();
    syncPlayerThemeIcon();
  });

  // ---- 播放状态全部由 audio 事件驱动 ----
  // 这样用系统媒体键 / 锁屏控件 / 耳机按钮暂停时，按钮和进度条也能跟着变。
  // 之前用 setInterval 轮询 + 在 togglePlay 里手动切 class，外部暂停后 UI 会一直停在"播放中"。
  const setPlayingUI = playing => {
    playBtn?.classList.toggle('active', playing);
    playBtn?.setAttribute('aria-label', playing ? '暂停' : '播放');
  };

  audioSource.addEventListener('play', () => setPlayingUI(true));
  audioSource.addEventListener('pause', () => setPlayingUI(false));
  audioSource.addEventListener('timeupdate', updateRunningTime);
  audioSource.addEventListener('loadedmetadata', updateDuration);
  audioSource.addEventListener('durationchange', updateDuration); // 流式 MP3 的时长可能后续才修正
  audioSource.addEventListener('ended', () => {
    // loop 开着时不会触发 ended。播完后进度归零，按钮回到"播放"
    setPlayingUI(false);
    if (playerSeekRange) playerSeekRange.value = '0';
    if (playerRunningTime) playerRunningTime.textContent = getTimecode(0);
    updateRangeFill();
  });

  // 音频加载失败（直链过期、403 防盗链等）：给出提示
  audioSource.addEventListener('error', () => {
    if (!audioSource.src || audioSource.src === location.href) return; // src 为空时的误报
    setPlayingUI(false);
    const title = document.querySelector('[data-title]')?.textContent || '播放失败';
    showPlayerError(title, '音频加载失败，链接可能已失效');
  });

  playBtn?.addEventListener('click', togglePlay);

  // 进度条：拖动过程中只更新显示，松手(change)时才真正跳转，避免拖动时反复触发 seek 与 timeupdate 打架
  playerSeekRange?.addEventListener('input', () => {
    isSeeking = true;
    updateRangeFill();
    if (playerRunningTime) {
      playerRunningTime.textContent = getTimecode(playerSeekRange.value);
    }
  });
  playerSeekRange?.addEventListener('change', () => {
    isSeeking = false;
    const target = Number(playerSeekRange.value);
    if (Number.isFinite(target) && Number.isFinite(audioSource.duration)) {
      audioSource.currentTime = target;
    }
  });

  // 下载按钮：打开下载弹窗（音质选择 + 无感下载，不打开新页面）
  document.querySelector('[data-download]')?.addEventListener('click', openDownloadModal);

  // 循环播放按钮
  const loopBtn = document.querySelector('[data-loop]');
  loopBtn?.addEventListener('click', () => {
    audioSource.loop = !audioSource.loop;
    loopBtn.classList.toggle('active', audioSource.loop);
    loopBtn.setAttribute('aria-pressed', String(audioSource.loop));
  });

  // 收藏按钮
  document.querySelector('[data-favorite]')?.addEventListener('click', () => {
    if (!currentSong?.id) {
      console.warn('无法收藏：当前没有播放歌曲或歌曲ID不可用');
      return;
    }

    // toggle 返回落盘后的真实状态：浏览器拒绝写 localStorage 时按钮不会被点成"已收藏"
    updateFavoriteButtonUI(favorites.toggle(currentSong));
  });

  // 主页在收藏列表里删掉了正在播放的这首歌时，爱心要跟着灭掉
  window.addEventListener('storage', event => {
    if (event.storageArea !== localStorage) return;
    if ((event.key === FAVORITES_KEY || event.key === null) && currentSong?.id) {
      updateFavoriteButtonUI(favorites.has(currentSong.id));
    }
  });

  // 系统媒体键
  if ('mediaSession' in navigator) {
    try {
      navigator.mediaSession.setActionHandler('play', () => audioSource.play().catch(() => {}));
      navigator.mediaSession.setActionHandler('pause', () => audioSource.pause());
    } catch {}
  }

  // 屏幕尺寸跨越宽屏断点时按需重建音量控制器
  const wideScreen = window.matchMedia(WIDE_SCREEN_QUERY);
  const onBreakpoint = () => buildVolumeControl(wideScreen.matches);
  if (typeof wideScreen.addEventListener === 'function') {
    wideScreen.addEventListener('change', onBreakpoint);
  } else {
    wideScreen.addListener(onBreakpoint); // 旧 Safari
  }
  onBreakpoint();

  loadTrack();
}

/* ==========================================================================
   5. 入口
   ========================================================================== */

function bootstrap() {
  // 再次尝试迁移（防御性，初始化时可能 localStorage 暂不可用）
  try {
    runLegacyMigrations();
  } catch (e) {
    console.warn('[迁移] DOMContentLoaded 迁移失败:', e);
  }

  favorites.purgeLegacy();   // 旧 cookie 与旧 localStorage 键：一进页面就删，不读不迁

  if (document.body.dataset.page === 'player') {
    initPlayerPage();
  } else {
    initMainPage();
  }
}

// 本文件由 <head> 里的 loader 在拿到 update.json 之后动态插入，属于异步脚本：
// 它执行时 DOMContentLoaded 很可能已经触发过了，再去 addEventListener 只会永远等不到。
// 所以要先看 readyState：DOM 已就绪就立刻初始化，否则才挂事件。
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', bootstrap, { once: true });
} else {
  bootstrap();
}
