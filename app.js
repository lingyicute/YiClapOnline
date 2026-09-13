'use strict';

/**
 * YiClapOnline —— 主页(index.html)与播放器(player.html)共用的唯一脚本。
 *
 * 两个页面都加载本文件，靠 <body data-page="main|player"> 分流。
 * 因此不存在跨文件的加载顺序问题：任何页面拿到的一定是完整定义。
 *
 * 文件结构：
 *   1. 共享层     cookie 读写 / 主题 / 收藏
 *   2. 数据源层   musicSource —— 换源只需要改这一节
 *   3. 主页       搜索、结果列表、收藏列表
 *   4. 播放器     取歌、播放控制、音量
 *   5. 入口
 */

/* ==========================================================================
   1. 共享层
   ========================================================================== */

/** cookie 读写 */
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
  }
};

/**
 * 主题控制 - 读取 li-darkmode cookie 并应用相应主题
 * '1': 深色主题, 其它/不存在: 浅色主题(默认)
 */
const themeControl = {
  isDark() {
    return cookieStore.get('li-darkmode') === '1';
  },

  toggleTheme() {
    cookieStore.set('li-darkmode', this.isDark() ? '0' : '1');
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

    let dark = this.isDark();

    // 主题存在 cookie 里，而 cookie 变更不会触发 storage 事件，
    // 所以主页与播放器 iframe 之间只能靠轮询同步。
    setInterval(() => {
      const nowDark = this.isDark();
      this.applyTheme();
      if (nowDark !== dark) {
        dark = nowDark;
        if (onChange) onChange(dark);
      }
    }, 2000);
  }
};

/** 收藏列表 - 保存在 li-favorites cookie 中，元素形如 { id, title, artist } */
const favoriteControl = {
  getFavorites() {
    const raw = cookieStore.get('li-favorites');
    if (!raw) return [];

    try {
      return JSON.parse(raw);
    } catch (error) {
      console.error('解析收藏列表失败:', error);
      return [];
    }
  },

  isFavorite(songId) {
    return !!songId && this.getFavorites().some(item => item.id === songId);
  },

  addFavorite(songId, title, artist) {
    if (!songId || this.isFavorite(songId)) return false;

    const favorites = this.getFavorites();
    favorites.push({ id: songId, title, artist });
    cookieStore.set('li-favorites', JSON.stringify(favorites));
    return true;
  },

  removeFavorite(songId) {
    const favorites = this.getFavorites();
    const remaining = favorites.filter(item => item.id !== songId);
    if (remaining.length === favorites.length) return false;

    cookieStore.set('li-favorites', JSON.stringify(remaining));
    return true;
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
     4. 全部为浏览器直连请求，不经过任何代理。若目标服务不返回 CORS 头，
        浏览器会拦下响应 —— 需要目标服务允许跨域，或自行在本节内改造请求方式。
   ========================================================================== */

const musicSource = {
  /** 数据源名称，仅用于日志与错误提示 */
  name: '未配置',

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
  noResults.textContent = message;
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
  containerControl.hideAllContainers(resultsContainer, () => {
    if (results.length === 0) {
      showNotice('未找到相关歌曲，请尝试其他关键词。');
      return;
    }

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
    const favorites = favoriteControl.getFavorites();

    if (favorites.length === 0) {
      showNotice('暂无收藏歌曲');
      return;
    }

    favoritesList.innerHTML = '';
    favorites.forEach(favorite => favoritesList.appendChild(buildSongRow(favorite, true)));
    setCount(favoritesContainer, `共有 ${favorites.length} 首收藏歌曲`);
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
 * 从收藏列表中移除歌曲
 * @param {string} id - 歌曲ID
 */
function removeFavorite(id) {
  favoriteControl.removeFavorite(id);
  const remaining = favoriteControl.getFavorites();

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
 * 版本检查和更新提示
 */
const updateControl = {
  async checkForUpdate() {
    try {
      const localVersion = cookieStore.get('li-version') || '0';

      const response = await fetch('./update.json?' + Date.now());
      if (!response.ok) {
        console.error('获取更新信息失败:', response.status);
        return;
      }

      const updateData = await response.json();
      if (updateData.version > localVersion) {
        this.showUpdateModal(updateData);
      }
    } catch (error) {
      console.error('检查更新出错:', error);
    }
  },

  showUpdateModal(updateData) {
    const modal = document.getElementById('updateModal');
    const overlay = document.getElementById('updateOverlay');
    const updateTime = document.getElementById('updateTime');
    const updateList = document.getElementById('updateList');
    const refreshButton = document.getElementById('refreshButton');

    if (!modal || !overlay || !updateTime || !updateList || !refreshButton) {
      console.error('找不到更新提示弹窗元素');
      return;
    }

    updateTime.textContent = `更新时间: ${updateData.updateTime}`;
    updateList.innerHTML = '';
    updateData.changes.forEach(change => {
      const li = document.createElement('li');
      li.textContent = change;
      updateList.appendChild(li);
    });

    refreshButton.onclick = () => {
      cookieStore.set('li-version', updateData.version);

      // 清除缓存后强制刷新
      if ('caches' in window) {
        caches.keys().then(names => names.forEach(name => caches.delete(name)));
      }
      window.location.reload();
    };

    overlay.classList.add('active');
    modal.classList.add('active');
  },

  // 延迟 1 秒检查，避免和首屏资源抢带宽
  init() {
    setTimeout(() => this.checkForUpdate(), 1000);
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
      removeFavorite(id);
    } else {
      playTrack(id);
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
let volumeRange = null, volumeBtn = null, muteState = false, playInterval;

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
 * 将秒转换为 m:ss 时间码
 */
function getTimecode(duration) {
  const minutes = Math.floor(duration / 60);
  const seconds = Math.ceil(duration - minutes * 60);
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
    audioSource.play().catch(error => console.error('Error playing audio:', error));
    playBtn?.classList.add('active');
    playInterval = setInterval(updateRunningTime, 500);
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
  setVolumeIcon();
}

function muteVolume() {
  if (!volumeRange || !volumeBtn) return;

  muteState = !muteState;
  audioSource.volume = muteState ? 0 : 1;
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
  slider.value = '1'; // 默认音量最大
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
  updateFavoriteButtonUI(favoriteControl.isFavorite(track.id));

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
    if (!window.currentSong?.id) {
      console.warn('无法收藏：当前没有播放歌曲或歌曲ID不可用');
      return;
    }

    const { id, title, artist } = window.currentSong;
    const nowFavorite = !favoriteControl.isFavorite(id);

    if (nowFavorite) {
      favoriteControl.addFavorite(id, title, artist);
    } else {
      favoriteControl.removeFavorite(id);
    }
    updateFavoriteButtonUI(nowFavorite);
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
  if (document.body.dataset.page === 'player') {
    initPlayerPage();
  } else {
    initMainPage();
  }
});
