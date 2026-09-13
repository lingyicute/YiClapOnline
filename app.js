'use strict';

// DOM 元素
const searchInput = document.getElementById('search-input');
const searchButton = document.getElementById('search-button');
const searchText = document.querySelector('.search-text');
const searchLoading = document.querySelector('.search-loading');
const resultsContainer = document.getElementById('results-container');
const resultsList = document.getElementById('results-list');
const noResults = document.getElementById('no-results');
const placeholder = document.getElementById('placeholder');
const playerContainer = document.getElementById('player-container');
const playerFrame = document.getElementById('player-frame');
const closePlayer = document.getElementById('close-player');
const currentYearEl = document.getElementById('current-year');
const favoritesBtn = document.getElementById('favorites-btn');
const favoritesContainer = document.getElementById('favorites-container');
const favoritesList = document.getElementById('favorites-list');
const themeToggleBtn = document.getElementById('new-theme-toggle');

/**
 * 通用容器控制 - 管理容器的显示和隐藏
 */
const containerControl = {
  // 隐藏指定容器
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

  // 显示指定容器
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
  playerFrame.src = `./player/index.html?id=${encodeURIComponent(id)}`;
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
 * 设置页脚当前年份
 */
function setCurrentYear() {
  currentYearEl.textContent = new Date().getFullYear();
}

/**
 * 预加载播放器资源，以避免首次播放时的加载延迟
 */
function preloadPlayerResources() {
  const preloadFrame = document.createElement('iframe');
  Object.assign(preloadFrame.style, {
    width: '0',
    height: '0',
    border: 'none',
    position: 'absolute',
    left: '-9999px',
    top: '-9999px'
  });

  // 加载完成后一段时间移除，释放资源
  preloadFrame.onload = () => {
    setTimeout(() => preloadFrame.remove(), 5000);
  };

  preloadFrame.src = './player/index.html';
  document.body.appendChild(preloadFrame);
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
  // 检查更新
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

  // 显示更新提示弹窗
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

  // 初始化版本检查(延迟 1 秒，避免和首屏资源抢带宽)
  init() {
    setTimeout(() => this.checkForUpdate(), 1000);
  }
};

// 事件监听器
document.addEventListener('DOMContentLoaded', () => {
  themeControl.init(syncThemeIcon);
  updateControl.init();
  setCurrentYear();
  preloadPlayerResources();
  syncThemeIcon();

  // 初始化容器的淡入淡出状态
  [resultsContainer, noResults, favoritesContainer, placeholder]
    .forEach(el => el?.classList.add('fade-in'));

  // 主题切换
  themeToggleBtn?.addEventListener('click', () => {
    themeControl.toggleTheme();
    syncThemeIcon();
  });

  // 收藏按钮：在收藏列表与之前的界面之间切换
  favoritesBtn?.addEventListener('click', () => {
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

  closePlayer.addEventListener('click', () => {
    playerContainer.classList.remove('active');
    // 延迟清空 iframe，避免音乐继续播放
    setTimeout(() => { playerFrame.src = ''; }, 300);
  });
});
