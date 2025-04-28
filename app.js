'use strict';

// 常量定义
const PROXY_URL = 'https://proxy-any.92li.uk/';
const SEARCH_BASE_URL = 'https://www.gequbao.com/s/';

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
    document.cookie = name + "=" + value + ";" + expires + ";path=/";
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
    
    // 显示搜索结果
    displaySearchResults(results);
    
    // 确保视图滚动到结果顶部
    if (results.length > 0) {
      resultsContainer.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
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
  // 清空结果列表
  resultsList.innerHTML = '';
  
  // 移除已有的结果计数元素
  const existingCount = document.querySelector('.result-count');
  if (existingCount) {
    existingCount.remove();
  }
  
  if (results.length === 0) {
    // 显示无结果提示
    resultsContainer.style.display = 'none';
    noResults.style.display = 'flex';
    placeholder.style.display = 'none';
    return;
  }
  
  // 显示结果容器
  resultsContainer.style.display = 'block';
  noResults.style.display = 'none';
  placeholder.style.display = 'none';
  
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
  
  // 添加搜索结果统计 - 将其正确添加到结果容器中而不是结果列表后
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
  
  // 确保页面适应结果列表的高度
  document.body.style.minHeight = '100%';
  
  // 平滑滚动到结果开始位置
  setTimeout(() => {
    resultsContainer.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, 100);
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
  resultsContainer.style.display = 'none';
  placeholder.style.display = 'none';
  
  noResults.textContent = message;
  noResults.style.display = 'flex';
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

// 事件监听器
document.addEventListener('DOMContentLoaded', () => {
  // 初始化主题控制
  themeControl.init();
  
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
  
  // 设置当前年份
  setCurrentYear();
  
  // 搜索按钮点击事件
  searchButton.addEventListener('click', () => {
    const query = searchInput.value.trim();
    if (query) {
      performSearch(query);
    }
  });
  
  // 搜索输入框回车事件
  searchInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') {
      const query = searchInput.value.trim();
      if (query) {
        performSearch(query);
      }
    }
  });
  
  // 关闭播放器按钮点击事件
  closePlayer.addEventListener('click', () => {
    // 立即更新主题按钮颜色，避免闪烁
    const themeToggleBtn = document.getElementById('new-theme-toggle');
    if (themeToggleBtn) {
      const darkModeCookie = themeControl.getCookie('li-darkmode');
      const isDarkTheme = darkModeCookie === '1';
      
      // 更新按钮背景色和文字颜色
      themeToggleBtn.style.backgroundColor = isDarkTheme ? 'rgba(30,30,30,0.8)' : 'rgba(255,255,255,0.8)';
      themeToggleBtn.style.color = isDarkTheme ? '#E0E0E0' : '#333';
      
      // 更新图标
      const iconElement = themeToggleBtn.querySelector('.material-symbols-rounded');
      if (iconElement) {
        iconElement.textContent = isDarkTheme ? 'light_mode' : 'dark_mode';
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