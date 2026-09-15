'use strict';

/**
 * YiClapOnline —— 主页(index.html)与播放器(player.html)共用的唯一脚本。
 *
 * 两个页面都加载本文件，靠 <body data-page="main|player"> 分流。
 * 因此不存在跨文件的加载顺序问题：任何页面拿到的一定是完整定义。
 *
 * 文件结构：
 *   1. 共享层     localStorage(主题/版本/收藏) + 旧 cookie 迁移清理
 *   2. 数据源层   musicSource —— 换源只需要改这一节
 *   3. 主页       搜索、结果列表、收藏列表
 *   4. 播放器     取歌、播放控制、音量
 *   5. 入口
 */

/* ==========================================================================
   1. 共享层
   ========================================================================== */

// 新的统一存储键（yiclape: 前缀）
const THEME_KEY = 'yiclape:darkmode';
const VERSION_KEY = 'yiclape:version';
const FAVORITES_KEY = 'yiclape:favorites';
const LEGACY_FAVORITES_KEYS = ['li-favorites'];   // 只删不读

// 遗留 cookie 名称（已迁移至 localStorage，保留此处仅用于迁移与清理）
const LEGACY_THEME_COOKIE = 'li-darkmode';
const LEGACY_VERSION_COOKIE = 'li-version';

/** 
 * cookie 读写 - 仅用于遗留数据迁移和清理
 * 新功能请直接使用 localStorage
 */
const cookieStore = {
  get(name) {
    const prefix = name + '=';
    for (const part of document.cookie.split(';')) {
      const cookie = part.trim();
      if (cookie.startsWith(prefix)) {
        return decodeURIComponent(cookie.slice(prefix.length));
      }
    }
    return null;
  },

  set(name, value, days = 365) {
    const expires = new Date(Date.now() + days * 24 * 60 * 60 * 1000).toUTCString();
    const secure = location.protocol === 'https:' ? '; secure' : '';
    document.cookie = `${name}=${encodeURIComponent(value)};expires=${expires};path=/;SameSite=Lax${secure}`;
  },

  remove(name) {
    this.set(name, '', -1);
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
        if (cookieStore.get(cookieName) !== null) {
          cookieStore.remove(cookieName);
          console.log(`[迁移] 清理已迁移的遗留 cookie: ${cookieName}`);
        }
      } catch (e) {
        console.warn(`[迁移] 清理 cookie 失败 ${cookieName}:`, e);
      }
      return existing;
    }

    const cookieVal = cookieStore.get(cookieName);
    if (cookieVal !== null) {
      try {
        localStorage.setItem(storageKey, cookieVal);
      } catch (e) {
        console.warn(`[迁移] 写入 localStorage 失败 ${storageKey}，保留 cookie:`, e);
        return null;
      }
      // 写入成功后再删 cookie
      try {
        cookieStore.remove(cookieName);
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
  migrateCookieToLocalStorage(LEGACY_VERSION_COOKIE, VERSION_KEY);
}

// 页面加载时立即尝试迁移，避免主题闪烁
try {
  runLegacyMigrations();
} catch (e) {
  console.warn('[迁移] 初始化迁移失败:', e);
}

/**
 * 主题控制 - 读取 localStorage['yiclape:darkmode'] 并应用相应主题
 * '1': 深色主题, 其它/不存在: 浅色主题(默认)
 * 已从 cookie 迁移至 localStorage，旧 cookie 会在迁移后自动删除
 */
const themeControl = {
  isDark() {
    try {
      return localStorage.getItem(THEME_KEY) === '1';
    } catch {
      return false;
    }
  },

  toggleTheme() {
    try {
      localStorage.setItem(THEME_KEY, this.isDark() ? '0' : '1');
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

    // 使用 storage 事件实现跨标签/iframe 同步，替代旧的轮询方案
    // localStorage 变更会触发 storage 事件，比轮询更高效、实时
    window.addEventListener('storage', (event) => {
      if (event.key === THEME_KEY) {
        this.applyTheme();
        if (onChange) onChange(this.isDark());
      }
    });
  }
};

/**
 * 收藏 —— 只用 localStorage
 *
 * 存储结构：localStorage['yiclape:favorites'] = JSON.stringify({ source, items })
 *   items: [{ id, title, artist }]   // id 是当前数据源给的不透明字符串
 *
 * source 字段就是"作废开关"：收藏里的 id 只在当前数据源内有效，换源之后必然全是死链，
 * 所以读取时拿 musicSource.name 比对，不一致就当没有收藏并清掉旧数据。
 * 历史上的 li-favorites cookie / li-favorites localStorage 均已废弃，一律不读，见到就删。
 */
const favorites = {
  /**
   * 当前数据源标识。优先用 musicSource.id(稳定标识)，没有才退回 name。
   * name 按约定只用于展示，改个显示名不该把收藏清空；两者都没有时退化成空串。
   */
  sourceTag() {
    return (musicSource && (musicSource.id || musicSource.name)) || '';
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

      return data.items
        .filter(item => item && typeof item.id === 'string' && item.id)
        .map(({ id, title, artist }) => ({
          id,
          title: typeof title === 'string' ? title : '',
          artist: typeof artist === 'string' ? artist : '',
        }));
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
    return !!songId && this.read().some(item => item.id === songId);
  },

  add({ id, title, artist } = {}) {
    if (!id || this.has(id)) return false;

    const items = this.read();
    items.push({ id, title: title || '', artist: artist || '' });
    return this.write(items);
  },

  remove(songId) {
    if (!songId) return false;

    const items = this.read();
    const remaining = items.filter(item => item.id !== songId);
    if (remaining.length === items.length) return false;

    return this.write(remaining);
  },

  /**
   * 收藏/取消收藏一次搞定，避免"读-判断-写"两步之间的竞态。
   * @returns {boolean} 操作完成后这首歌的真实收藏状态(以存储为准，写失败会退回原状)
   */
  toggle({ id, title, artist } = {}) {
    if (!id) return false;

    this.has(id) ? this.remove(id) : this.add({ id, title, artist });
    return this.has(id);
  },

  /** 启动清理：历史遗留的收藏 cookie 与旧 localStorage 键，只删不读 */
  purgeLegacy() {
    for (const key of LEGACY_FAVORITES_KEYS) {
      try {
        localStorage.removeItem(key);
      } catch (error) {
        console.warn('[收藏] 旧 localStorage 键清除失败:', error);
      }

      // 历史上这些 key 一律写在 path=/ 下，所以一次过期删除即可覆盖
      try {
        cookieStore.remove(key);
      } catch (e) {
        console.warn('[收藏] 旧 cookie 清除失败:', e);
      }
    }

    // 防御性清理：主题和版本的旧 cookie 理应在 runLegacyMigrations 中已删，
    // 此处再次确保旧 cookie 不会残留
    try {
      if (localStorage.getItem(THEME_KEY) !== null) {
        cookieStore.remove(LEGACY_THEME_COOKIE);
      }
    } catch {}
    try {
      if (localStorage.getItem(VERSION_KEY) !== null) {
        cookieStore.remove(LEGACY_VERSION_COOKIE);
      }
    } catch {}
  }
};

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
  name: '未配置',

  /**
   * 数据源稳定标识，写进收藏数据里用于"换源即作废"。
   * 换数据源时请改这个值(如 'gequbao' -> 'newapi')，老收藏会被整体丢弃；
   * 留空则退化成用 name。
   */
  id: '',

  /**
   * 按关键词搜索歌曲。
   *
   * @param {string} keyword - 用户输入的关键词（已 trim，保证非空）
   * @returns {Promise<Array<{id: string, title: string, artist: string}>>}
   *          按相关度排序的结果列表；无结果时返回 []
   * @throws {Error} 网络失败、状态码异常或响应结构不符
   *
   * @example
   * async search(keyword) {
   *   const url = `https://api.example.com/search?q=${encodeURIComponent(keyword)}`;
   *   const res = await fetch(url);
   *   if (!res.ok) throw new Error(`搜索失败：HTTP ${res.status}`);
   *
   *   const data = await res.json();
   *   return data.items.map(item => ({
   *     id: String(item.songId),
   *     title: item.name,
   *     artist: item.singer
   *   }));
   * }
   */
  async search(keyword) {
    throw new Error(`musicSource.search() 尚未实现（当前数据源：${this.name}）`);
  },

  /**
   * 按 ID 取单曲信息与可直接播放的音频地址。
   *
   * @param {string} id - search() 返回的 id
   * @returns {Promise<{
   *   id: string,        // 原样回传，用于收藏状态比对
   *   title: string,
   *   artist: string,
   *   cover: string,     // 封面图 URL；留空则播放器沿用内置默认封面
   *   audioUrl: string   // 音频直链，直接交给 <audio> 播放
   * }>}
   * @throws {Error} 歌曲不存在、无版权、或音频地址换取失败
   *
   * @example
   * async getTrack(id) {
   *   const res = await fetch(`https://api.example.com/song/${encodeURIComponent(id)}`);
   *   if (!res.ok) throw new Error(`获取歌曲失败：HTTP ${res.status}`);
   *
   *   const data = await res.json();
   *   if (!data.playUrl) throw new Error('该歌曲暂时无法播放');
   *
   *   return {
   *     id,
   *     title: data.name,
   *     artist: data.singer,
   *     cover: data.cover ?? '',
   *     audioUrl: data.playUrl
   *   };
   * }
   */
  async getTrack(id) {
    throw new Error(`musicSource.getTrack() 尚未实现（当前数据源：${this.name}）`);
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

/**
 * 通用容器控制 - 管理容器的显示和隐藏
 */
const containerControl = {
  hideContainer(container, callback) {
    if (!container || container.style.display === 'none') {
      if (callback) callback();
      return;
    }

    container.classList.remove('fade-in');
    container.classList.add('fade-out');
    setTimeout(() => {
      container.style.display = 'none';
      if (callback) callback();
    }, 500);
  },

  showContainer(container, callback) {
    if (!container) {
      if (callback) callback();
      return;
    }

    container.style.opacity = '0';
    container.style.display = container === noResults ? 'flex' : 'block';
    setTimeout(() => {
      container.classList.remove('fade-out');
      container.classList.add('fade-in');
      container.style.opacity = '1';
      if (callback) callback();
    }, 10);
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
 * @param {Object} dataset - 要写入的 data-* 属性(camelCase)
 * @returns {HTMLButtonElement}
 */
function iconButton(className, icon, dataset) {
  const button = document.createElement('button');
  button.className = className;
  Object.assign(button.dataset, dataset);

  const span = document.createElement('span');
  span.className = 'material-symbols-rounded';
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
function buildSongRow({ id, title, artist }, removable) {
  const row = document.createElement('div');
  row.className = 'result-item';

  const titleEl = document.createElement('div');
  titleEl.className = 'result-title';
  titleEl.textContent = title;

  const artistEl = document.createElement('div');
  artistEl.className = 'result-artist';
  artistEl.textContent = artist;

  const actionEl = document.createElement('div');
  actionEl.className = 'result-action';
  actionEl.appendChild(iconButton('play-button', 'play_arrow', { songId: id }));
  if (removable) {
    actionEl.appendChild(iconButton('remove-button', 'delete', { songId: id }));
  }

  row.append(titleEl, artistEl, actionEl);
  return row;
}

/**
 * 执行搜索
 * @param {string} query - 搜索关键词
 */
async function performSearch(query) {
  try {
    if (!query) return;

    setLoading(true);
    displaySearchResults(await musicSource.search(query));
  } catch (error) {
    console.error('搜索出错:', error);
    displayError(error.message || '搜索过程中发生错误，请稍后重试');
  } finally {
    setLoading(false);
  }
}

/**
 * 显示搜索结果
 * @param {Array} results - 搜索结果数组
 */
function displaySearchResults(results) {
  // 空结果时不能把 resultsContainer 当作 hideAllContainers 的例外容器，
  // 否则上一次的搜索结果会残留在页面上、与提示同时显示。
  // 复用 displayError：先隐藏全部容器（含旧结果列表），再显示提示。
  if (results.length === 0) {
    displayError('未找到相关歌曲，请尝试其他关键词。');
    return;
  }

  containerControl.hideAllContainers(resultsContainer, () => {
    resultsList.innerHTML = '';
    results.forEach(result => resultsList.appendChild(buildSongRow(result)));
    setCount(resultsContainer, `找到 ${results.length} 个结果`);
    reveal(resultsContainer);
  });
}

/**
 * 显示收藏列表
 */
function displayFavorites() {
  containerControl.hideAllContainers(null, () => {
    const items = favorites.read();

    if (items.length === 0) {
      showNotice('暂无收藏歌曲');
      return;
    }

    favoritesList.innerHTML = '';
    items.forEach(item => favoritesList.appendChild(buildSongRow(item, true)));
    setCount(favoritesContainer, `共有 ${items.length} 首收藏歌曲`);
    reveal(favoritesContainer);
  });
}

/**
 * 打开播放器播放指定歌曲
 * @param {string} id - 数据源歌曲 ID
 */
function playTrack(id) {
  playerFrame.src = `./player.html?id=${encodeURIComponent(id)}`;
  playerContainer.classList.add('active');
}

/**
 * 从收藏列表里删掉一行（存储层删除 + 淡出动画 + 计数更新）
 * @param {string} id - 歌曲ID
 */
function removeFavoriteRow(id) {
  favorites.remove(id);
  const remaining = favorites.read();

  // 用属性比对而非拼选择器，避免 id 中的特殊字符破坏选择器
  const button = [...favoritesList.querySelectorAll('.remove-button')]
    .find(el => el.dataset.songId === id);
  const row = button?.closest('.result-item');

  if (!row) {
    displayFavorites(); // 找不到对应行时整表重绘兜底
    return;
  }

  // 淡出并收起该行
  row.style.transition = 'opacity 0.3s, height 0.3s, margin 0.3s, padding 0.3s';
  Object.assign(row.style, { opacity: '0', height: '0', margin: '0', padding: '0', overflow: 'hidden' });

  setTimeout(() => {
    row.remove();

    if (remaining.length === 0) {
      favoritesList.innerHTML = '';
      containerControl.hideContainer(favoritesContainer, () => showNotice('暂无收藏歌曲'));
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
  searchText.style.display = isLoading ? 'none' : 'block';
  searchLoading.style.display = isLoading ? 'block' : 'none';
  searchButton.disabled = isLoading;
}

/**
 * 预加载播放器资源，以避免首次播放时的加载延迟
 */
function preloadPlayer() {
  const frame = document.createElement('iframe');
  Object.assign(frame.style, {
    width: '0', height: '0', border: 'none',
    position: 'absolute', left: '-9999px', top: '-9999px'
  });

  // 加载完成后一段时间移除，释放资源
  frame.onload = () => setTimeout(() => frame.remove(), 5000);

  frame.src = './player.html';
  document.body.appendChild(frame);
}

/**
 * 检查是否是 ID 直接播放格式(c+数字)。ID 会原样交给数据源，不做二次加工。
 * @param {string} query - 用户输入的查询字符串
 * @returns {string|null} - 有效的 ID，否则 null
 */
function checkDirectPlayId(query) {
  const match = /^c(\d+)$/.exec(query);
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
  const icon = themeToggleBtn?.querySelector('.material-symbols-rounded');
  if (icon) icon.textContent = themeControl.isDark() ? 'light_mode' : 'dark_mode';
}

/**
 * 版本检查和更新提示 - 已迁移至 localStorage
 * 上游 version 为时间戳，直接数值比较即可
 */
const UPDATE_PENDING_KEY = 'yiclape:updating';

const updateControl = {
  async clearAllCaches() {
    try {
      if ('caches' in window) {
        const keys = await caches.keys();
        await Promise.all(keys.map(k => caches.delete(k)));
      }
    } catch {}
    try {
      if ('serviceWorker' in navigator) {
        const regs = await navigator.serviceWorker.getRegistrations();
        await Promise.all(regs.map(r => r.unregister()));
      }
    } catch {}
  },

  async checkForUpdate() {
    try {
      // 上次点击刷新后 reload 回来，提交版本号
      try {
        const pending = sessionStorage.getItem(UPDATE_PENDING_KEY);
        if (pending) {
          localStorage.setItem(VERSION_KEY, pending);
          sessionStorage.removeItem(UPDATE_PENDING_KEY);
          try { cookieStore.remove(LEGACY_VERSION_COOKIE); } catch {}
          return;
        }
      } catch {}

      let localVersion = '0';
      try { localVersion = localStorage.getItem(VERSION_KEY) || '0'; } catch {}

      const res = await fetch('./update.json?' + Date.now(), { cache: 'no-store' });
      if (!res.ok) return;
      const data = await res.json();
      if (!data || !data.version) return;
      if (Number(data.version) > Number(localVersion)) {
        this.showUpdateModal(data);
      }
    } catch (e) {
      console.error('检查更新出错:', e);
    }
  },

  showUpdateModal(data) {
    const modal = document.getElementById('updateModal');
    const overlay = document.getElementById('updateOverlay');
    const updateTime = document.getElementById('updateTime');
    const updateList = document.getElementById('updateList');
    const refreshButton = document.getElementById('refreshButton');
    if (!modal || !overlay || !updateTime || !updateList || !refreshButton) return;

    updateTime.textContent = `更新时间: ${data.updateTime}`;
    updateList.innerHTML = '';
    (data.changes || []).forEach(c => {
      const li = document.createElement('li');
      li.textContent = c;
      updateList.appendChild(li);
    });

    const newBtn = refreshButton.cloneNode(true);
    refreshButton.parentNode.replaceChild(newBtn, refreshButton);
    const btn = document.getElementById('refreshButton');

    btn.onclick = async () => {
      btn.disabled = true;
      btn.textContent = '更新中...';
      try {
        try { sessionStorage.setItem(UPDATE_PENDING_KEY, data.version); } catch {}
        try { cookieStore.remove(LEGACY_VERSION_COOKIE); } catch {}
        await this.clearAllCaches();
        // 加时间戳击穿 HTTP 缓存
        const url = new URL(location.href);
        url.searchParams.set('__v', Date.now().toString());
        location.href = url.toString();
        setTimeout(() => location.reload(), 1000);
      } catch {
        btn.disabled = false;
        btn.textContent = '刷新';
        try { sessionStorage.removeItem(UPDATE_PENDING_KEY); } catch {}
      }
    };

    overlay.classList.add('active');
    modal.classList.add('active');
    overlay.onclick = () => {
      overlay.classList.remove('active');
      modal.classList.remove('active');
    };
  },

  init() {
    setTimeout(() => this.checkForUpdate(), 1000);
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') this.checkForUpdate();
    });
    setInterval(() => this.checkForUpdate(), 30 * 60 * 1000);
  }
};

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

  document.getElementById('current-year').textContent = new Date().getFullYear();

  // 初始化容器的淡入淡出状态
  [resultsContainer, noResults, favoritesContainer, placeholder]
    .forEach(el => el?.classList.add('fade-in'));

  // 主题切换
  themeToggleBtn?.addEventListener('click', () => {
    themeControl.toggleTheme();
    syncThemeIcon();
  });

  // 收藏按钮：在收藏列表与之前的界面之间切换
  document.getElementById('favorites-btn')?.addEventListener('click', () => {
    if (favoritesContainer.style.display === 'block') {
      containerControl.hideContainer(favoritesContainer, () => {
        const target = resultsContainer.querySelector('.result-count') ? resultsContainer : placeholder;
        containerControl.showContainer(target);
      });
    } else {
      displayFavorites();
    }
  });

  // 列表内的按钮统一用事件委托，避免每次渲染重复绑定监听器
  resultsList.addEventListener('click', e => {
    const id = e.target.closest('.play-button')?.dataset.songId;
    if (id) playTrack(id);
  });

  favoritesList.addEventListener('click', e => {
    const button = e.target.closest('button');
    const id = button?.dataset.songId;
    if (!id) return;

    if (button.classList.contains('remove-button')) {
      removeFavoriteRow(id);
    } else {
      playTrack(id);
    }
  });

  // 播放器 iframe 里点爱心增删收藏/切换主题时，若对应界面正开着就跟着刷新
  // 已迁移至 localStorage，storage 事件可跨 iframe 实时同步
  window.addEventListener('storage', event => {
    if (event.key === FAVORITES_KEY && favoritesContainer.style.display === 'block') {
      displayFavorites();
    }
  });

  // 输入 "c12345" 时按钮文案切换为"播放"
  searchInput.addEventListener('input', () => {
    searchText.textContent = checkDirectPlayId(searchInput.value.trim()) ? '播放' : '搜索';
  });

  searchButton.addEventListener('click', submitQuery);
  searchInput.addEventListener('keypress', e => {
    if (e.key === 'Enter') submitQuery();
  });

  document.getElementById('close-player').addEventListener('click', () => {
    playerContainer.classList.remove('active');
    // 延迟清空 iframe，避免音乐继续播放
    setTimeout(() => { playerFrame.src = ''; }, 300);
  });
}

/* ==========================================================================
   4. 播放器
   ========================================================================== */

const WIDE_SCREEN_MIN = 992; // 音量控制器只在宽屏下创建

// 播放器 DOM 元素与状态（在 initPlayerPage 中赋值）
let audioSource, playBtn, playerSeekRange, playerRunningTime, playerDuration;
// savedVolume: 记住用户设定的音量（非静音值），用于取消静音时恢复、
// 以及音量控件因跨越宽屏断点被销毁重建后回填，避免被重置为最大值
let volumeRange = null, volumeBtn = null, muteState = false, savedVolume = 1, playInterval;

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
  document.getElementById('loadingOverlay')?.classList.add('hidden');
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
    imgElement.style.opacity = 0;

    // 等淡出动画结束后再换源
    setTimeout(() => {
      imgElement.src = src;
      imgElement.style.opacity = 1;
      if (callback) callback();
    }, 300);
  };

  newImg.onerror = error => {
    console.error('图片加载失败:', error);
    imgElement.style.opacity = 1;
  };

  newImg.src = src;
}

/**
 * 将秒转换为 m:ss 时间码。
 * 先整体向下取整再拆分分秒：浮点余秒若用 Math.ceil 会进位出 60，
 * 导致播放中显示 "0:60"/"1:60"，且整分钟 "x:00" 被跳过。
 */
function getTimecode(duration) {
  const total = Math.max(0, Math.floor(duration));
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
    if (fill) fill.style.width = `${(range.value / range.max) * 100}%`;
  });
}

/**
 * 更新音频总时长
 */
function updateDuration() {
  if (!playerSeekRange || !playerDuration) return;
  playerSeekRange.max = Math.ceil(audioSource.duration);
  playerDuration.textContent = getTimecode(Number(playerSeekRange.max));
}

/**
 * 检查音乐是否播放完毕
 */
function isMusicEnd() {
  if (!audioSource.ended) return;

  playBtn?.classList.remove('active');
  clearInterval(playInterval);
  if (playerSeekRange) {
    playerSeekRange.value = 0;
    if (playerRunningTime) playerRunningTime.textContent = getTimecode(0);
    updateRangeFill();
  }
}

/**
 * 更新播放进度
 */
function updateRunningTime() {
  if (playerSeekRange && playerRunningTime) {
    playerSeekRange.value = audioSource.currentTime;
    playerRunningTime.textContent = getTimecode(audioSource.currentTime);
    updateRangeFill();
  }
  isMusicEnd();
}

/**
 * 播放/暂停
 */
function togglePlay() {
  if (audioSource.paused) {
    // play() 真正成功后才进入「播放中」UI 状态，
    // 避免加载失败/被自动播放策略拒绝时按钮误显示为播放中
    audioSource.play().then(() => {
      if (audioSource.paused) return; // play() 生效前用户又点了暂停
      playBtn?.classList.add('active');
      clearInterval(playInterval); // 防御：避免重复计时器
      playInterval = setInterval(updateRunningTime, 500);
    }).catch(error => console.error('Error playing audio:', error));
  } else {
    audioSource.pause();
    playBtn?.classList.remove('active');
    clearInterval(playInterval);
  }
}

function setVolumeIcon() {
  volumeBtn.children[0].textContent = audioSource.volume <= 0 ? 'volume_off' : 'volume_up';
}

function changeVolume() {
  if (!volumeRange || !volumeBtn) return;
  audioSource.volume = volumeRange.value;
  muteState = audioSource.volume <= 0;
  if (!muteState) savedVolume = audioSource.volume;
  setVolumeIcon();
}

function muteVolume() {
  if (!volumeRange || !volumeBtn) return;

  muteState = !muteState;
  audioSource.volume = muteState ? 0 : savedVolume; // 取消静音恢复之前的音量，而非直接跳到最大
  volumeRange.value = audioSource.volume;
  setVolumeIcon();
  updateRangeFill();
}

/**
 * 按屏幕宽度创建或销毁音量控制器(宽屏才显示)
 */
function buildVolumeControl() {
  const volumeContainer = document.getElementById('volume-container');
  if (!volumeContainer) return;

  const shouldBuild = window.innerWidth >= WIDE_SCREEN_MIN;
  if (shouldBuild === Boolean(volumeRange)) return; // 没有跨越断点，无需重建

  volumeContainer.innerHTML = '';
  volumeRange = null;
  volumeBtn = null;
  if (!shouldBuild) return;

  const volume = document.createElement('div');
  volume.className = 'volume';

  const button = document.createElement('button');
  button.className = 'btn-icon';
  button.innerHTML = '<span class="material-symbols-rounded">volume_up</span>';

  const wrapper = document.createElement('div');
  wrapper.className = 'range-wrapper';

  const slider = document.createElement('input');
  slider.type = 'range';
  slider.step = '0.05';
  slider.max = '1';
  slider.value = String(muteState ? 0 : savedVolume); // 恢复跨断点前的音量/静音状态（默认最大）
  slider.className = 'range volume-slider';
  slider.dataset.range = '';

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
 * 更新播放器 UI
 * @param {{id: string, title: string, artist: string, cover: string, audioUrl: string}} track
 */
function updatePlayerUI(track) {
  const playerBanner = document.querySelector('[data-player-banner]');
  const playerTitle = document.querySelector('[data-title]');
  const playerArtist = document.querySelector('[data-artist]');

  document.getElementById('loadingOverlay')?.classList.remove('hidden');

  if (playerTitle) playerTitle.textContent = track.title;
  if (playerArtist) playerArtist.textContent = track.artist;

  audioSource.src = track.audioUrl;

  // 供收藏功能读取当前歌曲
  window.currentSong = { id: track.id, title: track.title, artist: track.artist };
  updateFavoriteButtonUI(favorites.has(track.id));

  // 数据源没给封面时，沿用 HTML 里的默认封面
  if (playerBanner && track.cover) {
    loadImageWithFade(playerBanner, track.cover, () => {
      playerBanner.setAttribute('alt', `${track.title} 专辑封面`);
    });
    document.body.style.backgroundImage = `url(${track.cover})`;
  }
}

/**
 * 从 id 查询参数读取歌曲 ID，交给数据源换取播放信息
 */
async function loadTrack() {
  const songId = new URLSearchParams(window.location.search).get('id');

  if (!songId) {
    showPlayerError('未提供歌曲 ID', '请从主页选择要播放的歌曲');
    return;
  }

  try {
    updatePlayerUI(await musicSource.getTrack(songId));
  } catch (error) {
    console.error('获取歌曲信息失败:', error);
    showPlayerError('获取歌曲失败', error.message || '请稍后重试');
  }
}

/**
 * 让主题按钮的图标反映当前主题
 */
function syncPlayerThemeIcon() {
  const icon = document.querySelector('[data-theme-toggle] .material-symbols-rounded');
  if (icon) icon.textContent = themeControl.isDark() ? 'light_mode' : 'dark_mode';
}

/**
 * 播放器入口
 */
function initPlayerPage() {
  audioSource = new Audio();
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

  // 音频数据就绪：更新时长并收起加载层
  audioSource.addEventListener('loadeddata', () => {
    updateDuration();
    document.getElementById('loadingOverlay')?.classList.add('hidden');
  });

  // 音频加载失败（直链过期、403 防盗链等）：收起加载层并给出提示，
  // 否则加载层会永远停留在转圈状态
  audioSource.addEventListener('error', () => {
    clearInterval(playInterval);
    playBtn?.classList.remove('active');
    const title = document.querySelector('[data-title]')?.textContent || '播放失败';
    showPlayerError(title, '音频加载失败，链接可能已失效');
  });

  playBtn?.addEventListener('click', togglePlay);

  // 进度条：更新填充并跳转播放位置
  playerSeekRange?.addEventListener('input', () => {
    updateRangeFill();
    audioSource.currentTime = playerSeekRange.value;
    if (playerRunningTime) {
      playerRunningTime.textContent = getTimecode(playerSeekRange.value);
    }
  });

  // 下载按钮
  document.querySelector('[data-download]')?.addEventListener('click', () => {
    const link = document.createElement('a');
    link.href = audioSource.src;
    link.download = (document.querySelector('[data-title]')?.textContent || 'music') + '.mp3';
    document.body.appendChild(link);
    link.click();
    link.remove();
  });

  // 循环播放按钮
  const loopBtn = document.querySelector('[data-loop]');
  loopBtn?.addEventListener('click', () => {
    audioSource.loop = !audioSource.loop;
    loopBtn.classList.toggle('active', audioSource.loop);
  });

  // 收藏按钮
  document.querySelector('[data-favorite]')?.addEventListener('click', () => {
    const song = window.currentSong;
    if (!song?.id) {
      console.warn('无法收藏：当前没有播放歌曲或歌曲ID不可用');
      return;
    }

    // toggle 返回落盘后的真实状态：浏览器拒绝写 localStorage 时按钮不会被点成"已收藏"
    updateFavoriteButtonUI(favorites.toggle(song));
  });

  // 屏幕尺寸变化时按需重建音量控制器
  window.addEventListener('resize', buildVolumeControl);
  buildVolumeControl();

  loadTrack();
}

/* ==========================================================================
   5. 入口
   ========================================================================== */

document.addEventListener('DOMContentLoaded', () => {
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
});
