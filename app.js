'use strict';

// 常量定义
const PROXY_URL = 'https://proxy-any.92li.uk/';
const SEARCH_BASE_URL = 'https://www.gequbao.com/s/';

/**
 * 收藏功能 - 使用cookie保存收藏的歌曲
 */
const favoriteControl = {
  // 获取收藏列表
  getFavorites() {
    const favCookie = this.getCookie('li-favorites');
    if (!favCookie) return [];
    
    try {
      return JSON.parse(favCookie);
    } catch (error) {
      console.error('解析收藏列表失败:', error);
      return [];
    }
  },
  
  // 获取指定名称的cookie值
  getCookie(name) {
    const cookies = document.cookie.split(';');
    for (let i = 0; i < cookies.length; i++) {
      const cookie = cookies[i].trim();
      if (cookie.startsWith(name + '=')) {
        return decodeURIComponent(cookie.substring(name.length + 1));
      }
    }
    return null;
  },

  // 设置cookie
  setCookie(name, value, days = 365) {
    const date = new Date();
    date.setTime(date.getTime() + (days * 24 * 60 * 60 * 1000));
    const expires = "expires=" + date.toUTCString();
    const secure = location.protocol === 'https:' ? '; secure' : '';
    document.cookie = name + "=" + encodeURIComponent(value) + ";" + expires + ";path=/;SameSite=Lax" + secure;
  }
};

// DOM元素
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

/**
 * 主题控制 - 读取li-darkmode cookie并应用相应主题
 * 0: 浅色主题(默认), 1: 深色主题
 */
const themeControl = {
  // 获取指定名称的cookie值
  getCookie(name) {
    const cookies = document.cookie.split(';');
    for (let i = 0; i < cookies.length; i++) {
      const cookie = cookies[i].trim();
      if (cookie.startsWith(name + '=')) {
        return cookie.substring(name.length + 1);
      }
    }
    return null;
  },

  // 设置cookie
  setCookie(name, value, days = 365) {
    const date = new Date();
    date.setTime(date.getTime() + (days * 24 * 60 * 60 * 1000));
    const expires = "expires=" + date.toUTCString();
    const secure = location.protocol === 'https:' ? '; secure' : '';
    document.cookie = name + "=" + value + ";" + expires + ";path=/;SameSite=Lax" + secure;
  },

  // 切换主题
  toggleTheme() {
    const darkModeCookie = this.getCookie('li-darkmode');
    
    if (darkModeCookie === '1') {
      // 切换到浅色主题
      this.setCookie('li-darkmode', '0');
    } else {
      // 切换到深色主题
      this.setCookie('li-darkmode', '1');
    }
    
    this.applyTheme();
  },

  // 应用主题样式
  applyTheme() {
    const darkModeCookie = this.getCookie('li-darkmode');
    
    if (darkModeCookie === '1') {
      // 深色主题
      document.documentElement.classList.add('dark-theme');
      document.documentElement.classList.remove('light-theme');
    } else {
      // 浅色主题(默认)或cookie不存在
      document.documentElement.classList.remove('dark-theme');
      document.documentElement.classList.add('light-theme');
    }
    
    // 更新收藏按钮颜色
    const favoritesBtn = document.getElementById('favorites-btn');
    if (favoritesBtn) {
      const isDarkTheme = darkModeCookie === '1';
      favoritesBtn.style.backgroundColor = isDarkTheme ? 'rgba(30,30,30,0.8)' : 'rgba(255,255,255,0.8)';
      favoritesBtn.style.color = isDarkTheme ? '#E0E0E0' : '#333';
    }
  },

  // 初始化主题控制
  init() {
    // 添加默认的light-theme类
    document.documentElement.classList.add('light-theme');
    
    // 首次加载应用主题
    this.applyTheme();

    // 监听storage事件，响应同域下其他页面的cookie变化
    window.addEventListener('storage', (event) => {
      if (event.key === 'li-darkmode') {
        this.applyTheme();
      }
    });

    // 定期检查cookie变化（备用方案）
    setInterval(() => this.applyTheme(), 2000);
  }
};

/**
 * 版本检查和更新提示
 */
const updateControl = {
  // 获取本地保存的版本号
  getLocalVersion() {
    return themeControl.getCookie('li-version') || '0';
  },
  
  // 保存版本号到本地
  saveLocalVersion(version) {
    themeControl.setCookie('li-version', version, 365);
  },
  
  // 检查更新
  async checkForUpdate() {
    try {
      // 获取本地版本
      const localVersion = this.getLocalVersion();
      
      // 获取更新日志
      const response = await fetch('./update.json?' + new Date().getTime());
      if (!response.ok) {
        console.error('获取更新信息失败:', response.status);
        return;
      }
      
      const updateData = await response.json();
      const remoteVersion = updateData.version;
      
      console.log('版本检查 - 本地:', localVersion, '远程:', remoteVersion);
      
      // 如果远程版本比本地版本新，显示更新提示
      if (remoteVersion > localVersion) {
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
    
    // 更新内容
    updateTime.textContent = `更新时间: ${updateData.updateTime}`;
    updateList.innerHTML = '';
    
    updateData.changes.forEach(change => {
      const li = document.createElement('li');
      li.textContent = change;
      updateList.appendChild(li);
    });
    
    // 绑定刷新按钮事件
    refreshButton.onclick = () => {
      // 保存新版本号
      this.saveLocalVersion(updateData.version);
      
      // 清除缓存并刷新
      if ('caches' in window) {
        caches.keys().then(cacheNames => {
          cacheNames.forEach(cacheName => {
            caches.delete(cacheName);
          });
        });
      }
      
      // 强制刷新页面
      window.location.reload(true);
    };
    
    // 显示弹窗
    overlay.classList.add('active');
    modal.classList.add('active');
  },
  
  // 初始化版本检查
  init() {
    // 延迟1秒检查更新
    setTimeout(() => {
      this.checkForUpdate();
    }, 1000);
  }
};

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
    
    // 根据容器类型选择合适的显示方式
    let displayType = 'block';
    if (container === noResults) {
      displayType = 'flex';
    }
    
    container.style.opacity = '0';
    container.style.display = displayType;
    setTimeout(() => {
      container.classList.remove('fade-out');
      container.classList.add('fade-in');
      container.style.opacity = '1';
      if (callback) callback();
    }, 10);
  },
  
  // 隐藏所有容器
  hideAllContainers(exceptContainer, callback) {
    let containersToHide = 0;
    let containersHidden = 0;
    
    const checkComplete = () => {
      containersHidden++;
      if (containersHidden >= containersToHide && callback) {
        callback();
      }
    };
    
    // 计算需要隐藏的容器数量
    if (resultsContainer && resultsContainer.style.display !== 'none' && resultsContainer !== exceptContainer) containersToHide++;
    if (favoritesContainer && favoritesContainer.style.display !== 'none' && favoritesContainer !== exceptContainer) containersToHide++;
    if (noResults && noResults.style.display !== 'none' && noResults !== exceptContainer) containersToHide++;
    if (placeholder && placeholder.style.display !== 'none' && placeholder !== exceptContainer) containersToHide++;
    
    // 如果没有容器需要隐藏，直接执行回调
    if (containersToHide === 0) {
      if (callback) callback();
      return;
    }
    
    // 隐藏结果容器
    if (resultsContainer && resultsContainer.style.display !== 'none' && resultsContainer !== exceptContainer) {
      this.hideContainer(resultsContainer, checkComplete);
    }
    
    // 隐藏收藏列表
    if (favoritesContainer && favoritesContainer.style.display !== 'none' && favoritesContainer !== exceptContainer) {
      this.hideContainer(favoritesContainer, checkComplete);
    }
    
    // 隐藏无结果提示
    if (noResults && noResults.style.display !== 'none' && noResults !== exceptContainer) {
      this.hideContainer(noResults, checkComplete);
    }
    
    // 隐藏占位符
    if (placeholder && placeholder.style.display !== 'none' && placeholder !== exceptContainer) {
      this.hideContainer(placeholder, checkComplete);
    }
  }
};

/**
 * 执行搜索
 * @param {string} query - 搜索关键词
 */
async function performSearch(query) {
  try {
    if (!query) return;
    
    // 显示加载动画
    setLoading(true);
    
    // 构建搜索URL
    const encodedQuery = encodeURIComponent(query);
    const searchUrl = PROXY_URL + SEARCH_BASE_URL + encodedQuery;
    
    // 使用无预检请求的方式发送请求
    // 创建一个简单的请求 - 不设置额外的headers以避免触发预检请求
    const response = await fetch(searchUrl);
    
    if (!response.ok) {
      throw new Error(`搜索请求失败: ${response.status}`);
    }
    
    const html = await response.text();
    
    // 解析HTML获取搜索结果
    const results = parseSearchResults(html);
    
    // 显示搜索结果 - displaySearchResults 现在会处理所有容器的隐藏和显示
    displaySearchResults(results);
    
  } catch (error) {
    console.error('搜索出错:', error);
    displayError('搜索过程中发生错误，请稍后重试');
  } finally {
    // 隐藏加载动画
    setLoading(false);
  }
}

/**
 * 解析搜索结果HTML
 * @param {string} html - 搜索结果页面的HTML
 * @returns {Array} - 搜索结果数组
 */
function parseSearchResults(html) {
  const results = [];
  
  // 创建DOM解析器
  const parser = new DOMParser();
  const doc = parser.parseFromString(html, 'text/html');
  
  // 查找所有结果行
  const rows = doc.querySelectorAll('.card-text .row:not(:first-child)');
  
  if (!rows || rows.length === 0) {
    return results;
  }
  
  // 遍历结果
  rows.forEach(row => {
    try {
      const titleElement = row.querySelector('.col-8 .music-title span');
      const artistElement = row.querySelector('.col-8 .text-jade');
      const linkElement = row.querySelector('.col-8 a');
      
      if (titleElement && artistElement && linkElement) {
        const title = titleElement.textContent.trim();
        const artist = artistElement.textContent.trim();
        let url = linkElement.getAttribute('href');
        
        // 确保URL通过代理服务
        if (!url.startsWith(PROXY_URL)) {
          if (url.startsWith('https://')) {
            url = PROXY_URL + url;
          } else {
            url = PROXY_URL + 'https:' + url;
          }
        }
        
        results.push({
          title,
          artist,
          url
        });
      }
    } catch (error) {
      console.error('解析搜索结果项时出错:', error);
    }
  });
  
  return results;
}

/**
 * 显示搜索结果
 * @param {Array} results - 搜索结果数组
 */
function displaySearchResults(results) {
  // 先隐藏所有容器，然后显示搜索结果
  containerControl.hideAllContainers(resultsContainer, () => {
    // 清空结果列表
    resultsList.innerHTML = '';
    
    // 移除已有的结果计数元素
    const existingCount = resultsContainer.querySelector('.result-count');
    if (existingCount) {
      existingCount.remove();
    }
    
    if (results.length === 0) {
      // 显示无结果提示
      if (noResults) {
        noResults.textContent = '未找到相关歌曲，请尝试其他关键词。';
        containerControl.showContainer(noResults);
      }
      return;
    }
    
    // 添加结果项
    results.forEach(result => {
      const resultItem = document.createElement('div');
      resultItem.className = 'result-item';
      
      resultItem.innerHTML = `
        <div class="result-title">${result.title}</div>
        <div class="result-artist">${result.artist}</div>
        <div class="result-action">
          <button class="play-button" data-url="${result.url}">
            <span class="material-symbols-rounded">play_arrow</span>
          </button>
        </div>
      `;
      
      resultsList.appendChild(resultItem);
    });
    
    // 添加搜索结果统计
    const resultCount = document.createElement('div');
    resultCount.className = 'result-count';
    resultCount.textContent = `找到 ${results.length} 个结果`;
    resultsContainer.appendChild(resultCount);
    
    // 为播放按钮添加事件监听
    const playButtons = document.querySelectorAll('.play-button');
    playButtons.forEach(button => {
      button.addEventListener('click', () => {
        const url = button.getAttribute('data-url');
        if (url) {
          playMusic(url);
        }
      });
    });
    
    // 显示结果容器
    containerControl.showContainer(resultsContainer, () => {
      // 确保页面适应结果列表的高度
      document.body.style.minHeight = '100%';
      
      // 平滑滚动到结果开始位置
      setTimeout(() => {
        resultsContainer.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }, 100);
    });
  });
}

/**
 * 播放音乐
 * @param {string} url - 歌曲详情页URL
 */
function playMusic(url) {
  // 设置iframe的src
  playerFrame.src = `./player/index.html?url=${encodeURIComponent(url)}`;
  
  // 显示播放器
  playerContainer.classList.add('active');
}

/**
 * 显示错误信息
 * @param {string} message - 错误信息
 */
function displayError(message) {
  // 先隐藏所有容器，然后显示错误
  containerControl.hideAllContainers(noResults, () => {
    if (noResults) {
      noResults.textContent = message;
      containerControl.showContainer(noResults);
    }
  });
}

/**
 * 设置加载状态
 * @param {boolean} isLoading - 是否正在加载
 */
function setLoading(isLoading) {
  if (isLoading) {
    searchText.style.display = 'none';
    searchLoading.style.display = 'block';
    searchButton.disabled = true;
  } else {
    searchText.style.display = 'block';
    searchLoading.style.display = 'none';
    searchButton.disabled = false;
  }
}

/**
 * 设置页脚当前年份
 */
function setCurrentYear() {
  if (currentYearEl) {
    currentYearEl.textContent = new Date().getFullYear();
  }
}

/**
 * 显示收藏列表
 */
function displayFavorites() {
  // 先隐藏所有容器，然后处理收藏列表
  containerControl.hideAllContainers(null, () => {
    // 获取收藏列表
    const favorites = favoriteControl.getFavorites();
    
    if (favorites.length === 0) {
      // 显示无收藏提示
      if (noResults) {
        noResults.textContent = '暂无收藏歌曲';
        containerControl.showContainer(noResults);
      }
      return;
    }
    
    // 清空收藏列表
    if (favoritesList) {
      favoritesList.innerHTML = '';
    }
    
    // 添加收藏列表项
    favorites.forEach(favorite => {
      const resultItem = document.createElement('div');
      resultItem.className = 'result-item';
      
      resultItem.innerHTML = `
        <div class="result-title">${favorite.title}</div>
        <div class="result-artist">${favorite.artist}</div>
        <div class="result-action">
          <button class="play-button" data-favorite-id="${favorite.id}">
            <span class="material-symbols-rounded">play_arrow</span>
          </button>
          <button class="remove-button" data-favorite-id="${favorite.id}">
            <span class="material-symbols-rounded">delete</span>
          </button>
        </div>
      `;
      
      favoritesList.appendChild(resultItem);
    });
    
    // 移除已有的结果计数元素
    const existingCount = favoritesContainer.querySelector('.result-count');
    if (existingCount) {
      existingCount.remove();
    }
    
    // 添加收藏统计
    const favoriteCount = document.createElement('div');
    favoriteCount.className = 'result-count';
    favoriteCount.textContent = `共有 ${favorites.length} 首收藏歌曲`;
    favoritesContainer.appendChild(favoriteCount);
    
    // 为播放按钮添加事件监听
    const playButtons = document.querySelectorAll('#favorites-list .play-button');
    playButtons.forEach(button => {
      button.addEventListener('click', () => {
        const id = button.getAttribute('data-favorite-id');
        if (id) {
          playFavorite(id);
        }
      });
    });
    
    // 为删除按钮添加事件监听
    const removeButtons = document.querySelectorAll('#favorites-list .remove-button');
    removeButtons.forEach(button => {
      button.addEventListener('click', () => {
        const id = button.getAttribute('data-favorite-id');
        if (id) {
          removeFavorite(id);
        }
      });
    });
    
    // 显示收藏容器
    containerControl.showContainer(favoritesContainer, () => {
      // 确保页面适应收藏列表的高度
      document.body.style.minHeight = '100%';
      
      // 平滑滚动到结果开始位置
      setTimeout(() => {
        favoritesContainer.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }, 100);
    });
  });
}

/**
 * 播放收藏的歌曲
 * @param {string} id - 歌曲ID
 */
function playFavorite(id) {
  const url = `${PROXY_URL}https://www.gequbao.com/music/${id}`;
  playMusic(url);
}

/**
 * 从收藏列表中移除歌曲
 * @param {string} id - 歌曲ID
 */
function removeFavorite(id) {
  // 获取当前收藏列表
  const favorites = favoriteControl.getFavorites();
  
  // 查找并移除
  const newFavorites = favorites.filter(item => item.id !== id);
  
  // 保存到cookie
  favoriteControl.setCookie('li-favorites', JSON.stringify(newFavorites));
  
  // 找到对应的DOM元素
  const resultItem = document.querySelector(`#favorites-list .remove-button[data-favorite-id="${id}"]`).closest('.result-item');
  
  if (resultItem) {
    // 添加淡出动画
    resultItem.style.transition = 'opacity 0.3s, height 0.3s, margin 0.3s, padding 0.3s';
    resultItem.style.opacity = '0';
    resultItem.style.height = '0';
    resultItem.style.margin = '0';
    resultItem.style.padding = '0';
    resultItem.style.overflow = 'hidden';
    
    // 动画结束后移除元素
    setTimeout(() => {
      resultItem.remove();
      
      // 如果列表为空，显示"暂无收藏歌曲"
      if (newFavorites.length === 0) {
        // 先完全移除被删除的元素
        if (favoritesList) {
          favoritesList.innerHTML = '';
        }
        
        // 淡出收藏列表
        if (favoritesContainer) {
          containerControl.hideContainer(favoritesContainer, () => {
            // 显示暂无收藏提示
            if (noResults) {
              noResults.textContent = '暂无收藏歌曲';
              containerControl.showContainer(noResults);
            }
          });
        }
      } else {
        // 更新统计信息
        const favoriteCount = favoritesContainer.querySelector('.result-count');
        if (favoriteCount) {
          favoriteCount.textContent = `共有 ${newFavorites.length} 首收藏歌曲`;
          
          // 添加更新动画效果
          favoriteCount.style.transition = 'transform 0.3s, background-color 0.3s';
          favoriteCount.style.transform = 'scale(1.05)';
          favoriteCount.style.backgroundColor = 'rgba(66, 133, 244, 0.1)';
          
          setTimeout(() => {
            favoriteCount.style.transform = 'scale(1)';
            favoriteCount.style.backgroundColor = '';
          }, 300);
        }
      }
    }, 300);
  } else {
    // 如果找不到DOM元素，重新加载整个列表（备用方案）
    displayFavorites();
  }
}

/**
 * 预加载播放器资源，以避免首次播放时的加载延迟
 */
function preloadPlayerResources() {
  // 创建一个隐藏的iframe元素
  const preloadFrame = document.createElement('iframe');
  preloadFrame.style.width = '0';
  preloadFrame.style.height = '0';
  preloadFrame.style.border = 'none';
  preloadFrame.style.position = 'absolute';
  preloadFrame.style.left = '-9999px';
  preloadFrame.style.top = '-9999px';
  preloadFrame.onload = () => {
    console.log('播放器资源预加载完成');
    // 加载完成后一段时间移除预加载框架，释放资源
    setTimeout(() => {
      if (preloadFrame && preloadFrame.parentNode) {
        preloadFrame.parentNode.removeChild(preloadFrame);
      }
    }, 5000);
  };
  
  // 将iframe加载到页面中
  preloadFrame.src = './player/index.html';
  document.body.appendChild(preloadFrame);
}

/**
 * 检查是否是ID直接播放格式 (c+数字格式)
 * @param {string} query - 用户输入的查询字符串
 * @returns {string|null} - 如果是有效的ID格式，返回ID，否则返回null
 */
function checkDirectPlayId(query) {
  // 检查格式是否为"c+数字"
  const match = /^c(\d+)$/.exec(query);
  if (match && match[1]) {
    return match[1]; // 返回数字部分（歌曲ID）
  }
  return null;
}

/**
 * 直接通过ID播放歌曲
 * @param {string} id - 歌曲ID
 */
function playMusicById(id) {
  // 构建歌曲详情页URL
  const url = `${PROXY_URL}https://www.gequbao.com/music/${id}`;
  playMusic(url);
}

// 事件监听器
document.addEventListener('DOMContentLoaded', () => {
  // 初始化主题控制
  themeControl.init();
  
  // 预加载播放器资源
  preloadPlayerResources();
  
  // 初始化淡入淡出效果
  if (resultsContainer) resultsContainer.classList.add('fade-in');
  if (noResults) noResults.classList.add('fade-in');
  if (favoritesContainer) favoritesContainer.classList.add('fade-in');
  if (placeholder) placeholder.classList.add('fade-in');
  
  // 初始化版本检查
  updateControl.init();
  
  // 添加主题切换按钮事件监听 - 使用新按钮ID
  const themeToggleBtn = document.getElementById('new-theme-toggle');
  if (themeToggleBtn) {
    // 简化：单个点击事件处理程序
    themeToggleBtn.addEventListener('click', function() {
      themeControl.toggleTheme();
      
      // 根据当前主题更新图标
      const darkModeCookie = themeControl.getCookie('li-darkmode');
      const iconElement = this.querySelector('.material-symbols-rounded');
      
      if (iconElement) {
        iconElement.textContent = darkModeCookie === '1' ? 'light_mode' : 'dark_mode';
      }
      
      // 更新按钮背景色（根据主题）
      const isDarkTheme = darkModeCookie === '1';
      this.style.backgroundColor = isDarkTheme ? 'rgba(30,30,30,0.8)' : 'rgba(255,255,255,0.8)';
      this.style.color = isDarkTheme ? '#E0E0E0' : '#333';
      
      // 更新收藏按钮颜色
      const favoritesBtn = document.getElementById('favorites-btn');
      if (favoritesBtn) {
        favoritesBtn.style.backgroundColor = isDarkTheme ? 'rgba(30,30,30,0.8)' : 'rgba(255,255,255,0.8)';
        favoritesBtn.style.color = isDarkTheme ? '#E0E0E0' : '#333';
      }
    });
    
    // 初始化图标状态和按钮背景
    const darkModeCookie = themeControl.getCookie('li-darkmode');
    const iconElement = themeToggleBtn.querySelector('.material-symbols-rounded');
    
    if (iconElement && darkModeCookie === '1') {
      iconElement.textContent = 'light_mode';
      themeToggleBtn.style.backgroundColor = 'rgba(30,30,30,0.8)';
      themeToggleBtn.style.color = '#E0E0E0';
    } else {
      themeToggleBtn.style.backgroundColor = 'rgba(255,255,255,0.8)';
      themeToggleBtn.style.color = '#333';
    }
  }
  
  // 收藏按钮事件监听
  if (favoritesBtn) {
    favoritesBtn.addEventListener('click', function() {
      // 根据当前主题设置按钮样式
      const darkModeCookie = themeControl.getCookie('li-darkmode');
      const isDarkTheme = darkModeCookie === '1';
      
      // 判断当前显示的是否为收藏列表
      const isShowingFavorites = favoritesContainer && favoritesContainer.style.display === 'block';
      
      if (isShowingFavorites) {
        // 如果当前显示的是收藏列表，先隐藏
        containerControl.hideContainer(favoritesContainer, () => {
          // 尝试恢复之前的界面状态
          if (resultsContainer && resultsContainer.querySelector('.result-count')) {
            // 有搜索结果，显示搜索结果
            containerControl.showContainer(resultsContainer);
          } else {
            // 无搜索结果，显示占位符
            containerControl.showContainer(placeholder);
          }
        });
      } else {
        // 显示收藏列表
        displayFavorites();
      }
    });
    
    // 初始化收藏按钮样式
    const darkModeCookie = themeControl.getCookie('li-darkmode');
    const isDarkTheme = darkModeCookie === '1';
    
    favoritesBtn.style.backgroundColor = isDarkTheme ? 'rgba(30,30,30,0.8)' : 'rgba(255,255,255,0.8)';
    favoritesBtn.style.color = isDarkTheme ? '#E0E0E0' : '#333';
  }
  
  // 设置当前年份
  setCurrentYear();
  
  // 搜索输入框输入事件 - 用于检测ID直接播放格式并更改按钮文本
  searchInput.addEventListener('input', () => {
    const query = searchInput.value.trim();
    const directPlayId = checkDirectPlayId(query);
    
    // 更新按钮文本
    if (directPlayId) {
      searchText.textContent = '播放';
    } else {
      searchText.textContent = '搜索';
    }
  });
  
  // 搜索按钮点击事件
  searchButton.addEventListener('click', () => {
    const query = searchInput.value.trim();
    if (!query) return;
    
    // 检查是否为ID直接播放格式
    const directPlayId = checkDirectPlayId(query);
    if (directPlayId) {
      playMusicById(directPlayId);
    } else {
      performSearch(query);
    }
  });
  
  // 搜索输入框回车事件
  searchInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') {
      const query = searchInput.value.trim();
      if (!query) return;
      
      // 检查是否为ID直接播放格式
      const directPlayId = checkDirectPlayId(query);
      if (directPlayId) {
        playMusicById(directPlayId);
      } else {
        performSearch(query);
      }
    }
  });
  
  // 关闭播放器按钮点击事件
  closePlayer.addEventListener('click', () => {
    // 立即更新主题按钮颜色，避免闪烁
    const themeToggleBtn = document.getElementById('new-theme-toggle');
    const favoritesBtn = document.getElementById('favorites-btn');
    
    if (themeToggleBtn || favoritesBtn) {
      const darkModeCookie = themeControl.getCookie('li-darkmode');
      const isDarkTheme = darkModeCookie === '1';
      
      // 更新主题按钮背景色和文字颜色
      if (themeToggleBtn) {
      themeToggleBtn.style.backgroundColor = isDarkTheme ? 'rgba(30,30,30,0.8)' : 'rgba(255,255,255,0.8)';
      themeToggleBtn.style.color = isDarkTheme ? '#E0E0E0' : '#333';
      
      // 更新图标
      const iconElement = themeToggleBtn.querySelector('.material-symbols-rounded');
      if (iconElement) {
        iconElement.textContent = isDarkTheme ? 'light_mode' : 'dark_mode';
        }
      }
      
      // 更新收藏按钮背景色和文字颜色
      if (favoritesBtn) {
        favoritesBtn.style.backgroundColor = isDarkTheme ? 'rgba(30,30,30,0.8)' : 'rgba(255,255,255,0.8)';
        favoritesBtn.style.color = isDarkTheme ? '#E0E0E0' : '#333';
      }
    }
    
    // 移除播放器激活状态
    playerContainer.classList.remove('active');
    
    // 延迟一段时间后清空iframe内容，避免音乐继续播放
    setTimeout(() => {
      playerFrame.src = '';
    }, 300);
  });
}); 