'use strict';

/** Cookie 读写工具 */
const cookieStore = {
  get(name) {
    const prefix = `${name}=`;
    const cookie = document.cookie
      .split(';')
      .map(item => item.trim())
      .find(item => item.startsWith(prefix));
    return cookie ? decodeURIComponent(cookie.slice(prefix.length)) : null;
  },

  set(name, value, days = 365) {
    const expires = new Date(Date.now() + days * 86400000).toUTCString();
    const secure = location.protocol === 'https:' ? ';Secure' : '';
    document.cookie = `${name}=${encodeURIComponent(value)};expires=${expires};path=/;SameSite=Lax${secure}`;
  },

  remove(name) {
    this.set(name, '', -1);
  }
};

/** 收藏功能；首次读取时自动迁移旧 Cookie。 */
const FAVORITES_KEY = 'li-favorites';
const favoriteControl = {
  getFavorites() {
    try {
      const storedFavorites = localStorage.getItem(FAVORITES_KEY);
      if (storedFavorites !== null) {
        const favorites = JSON.parse(storedFavorites);
        return Array.isArray(favorites) ? favorites : [];
      }

      const legacyFavorites = cookieStore.get(FAVORITES_KEY);
      if (legacyFavorites === null) return [];

      const favorites = JSON.parse(legacyFavorites);
      if (!Array.isArray(favorites)) return [];

      localStorage.setItem(FAVORITES_KEY, JSON.stringify(favorites));
      cookieStore.remove(FAVORITES_KEY);
      return favorites;
    } catch (error) {
      console.error('读取收藏列表失败:', error);
      return [];
    }
  },

  saveFavorites(favorites) {
    localStorage.setItem(FAVORITES_KEY, JSON.stringify(favorites));
  },
  
  // 添加收藏
  addFavorite(songId, title, artist) {
    if (!songId) return false;
    
    const favorites = this.getFavorites();
    
    // 检查是否已经收藏
    const existingIndex = favorites.findIndex(item => item.id === songId);
    if (existingIndex !== -1) return false;
    
    // 添加到收藏列表
    favorites.push({ id: songId, title, artist });
    
    this.saveFavorites(favorites);
    return true;
  },
  
  // 移除收藏
  removeFavorite(songId) {
    if (!songId) return false;
    
    const favorites = this.getFavorites();
    
    // 查找并移除
    const existingIndex = favorites.findIndex(item => item.id === songId);
    if (existingIndex === -1) return false;
    
    favorites.splice(existingIndex, 1);
    
    this.saveFavorites(favorites);
    return true;
  },
  
  // 检查是否已收藏
  isFavorite(songId) {
    if (!songId) return false;
    
    const favorites = this.getFavorites();
    return favorites.some(item => item.id === songId);
  },
  
  // 更新收藏按钮UI
  updateFavoriteButtonUI(isFav) {
    const favoriteBtn = document.querySelector("[data-favorite]");
    if (!favoriteBtn) return;
    
    const iconElement = favoriteBtn.querySelector(".material-symbols-rounded");
    if (!iconElement) return;
    
    if (isFav) {
      iconElement.textContent = "favorite";
      iconElement.style.color = "#ff3e55";
      favoriteBtn.classList.add("active");
    } else {
      iconElement.textContent = "favorite_border";
      iconElement.style.color = "";
      favoriteBtn.classList.remove("active");
    }
  }
};

/** 主题控制 */
const themeControl = {
  isDark() {
    return cookieStore.get('li-darkmode') === '1';
  },

  toggleTheme() {
    cookieStore.set('li-darkmode', this.isDark() ? '0' : '1');
    this.applyTheme();
  },

  applyTheme() {
    const isDark = this.isDark();
    document.documentElement.classList.toggle('dark-theme', isDark);
    document.documentElement.classList.toggle('light-theme', !isDark);

    const icon = document.querySelector('[data-theme-toggle] .material-symbols-rounded');
    if (icon) icon.textContent = isDark ? 'light_mode' : 'dark_mode';
  },

  init() {
    this.applyTheme();
  }
};

/**
 * 音乐播放器API接口
 * 根据歌曲详情页URL获取歌曲信息
 * @param {string} songId - 歌曲ID(详情页URL)
 * @returns {Promise<Object>} - 返回歌曲信息对象
 */
const fetchSongInfo = async (songId) => {
  try {
    if (!songId) return null;
    
    if (!songId.includes('/music/')) {
      console.warn('详情页URL格式可能有误，不包含/music/路径');
    }
    
    // 存储完整的详情页URL
    const detailUrl = songId;
    
    // 获取歌曲详情页 - 使用简单请求避免CORS预检
    const response = await fetch(detailUrl).catch(error => {
      console.error('详情页请求网络错误:', error);
      throw new Error(`详情页请求失败: ${error.message}`);
    });
    
    if (!response.ok) {
      console.error('详情页请求失败，状态码:', response.status);
      throw new Error(`获取歌曲详情失败: ${response.status}`);
    }
    
    const html = await response.text();
    
    // 从HTML中提取关键信息
    let mp3Id = '', playId = '', mp3Title = '', mp3Author = '', mp3Cover = '';

    // 首先尝试从appData中提取数据（新格式）
    const appDataMatch = html.match(/window\.appData\s*=\s*(\{.*?\});/s);
    if (appDataMatch && appDataMatch[1]) {
      try {
        const appData = JSON.parse(appDataMatch[1]);
        mp3Id = appData.mp3_id?.toString() || '';
        playId = appData.play_id || '';
        mp3Title = appData.mp3_title || '';
        mp3Author = appData.mp3_author || '';
        mp3Cover = appData.mp3_cover || '';
      } catch (e) {
        console.error('解析appData失败:', e);
      }
    }
    
    // 如果appData中没有提取到数据，则使用原有的提取逻辑作为备用
    if (!playId) {
      // 尝试多种正则匹配mp3_id
      const mp3IdMatch = html.match(/window\.mp3_id\s*=\s*['"]([^'"]+)['"]/);
      // 尝试替代模式
      const mp3IdAltMatch = html.match(/mp3_id\s*=\s*['"]([^'"]+)['"]/);
      if (mp3IdMatch && mp3IdMatch[1]) {
        mp3Id = mp3IdMatch[1];
      } else if (mp3IdAltMatch && mp3IdAltMatch[1]) {
        mp3Id = mp3IdAltMatch[1];
      }
      
      // 尝试多种正则匹配play_id
      const playIdMatch = html.match(/window\.play_id\s*=\s*['"]([^'"]+)['"]/);
      // 尝试替代模式
      const playIdAltMatch = html.match(/play_id\s*=\s*['"]([^'"]+)['"]/);
      const playIdAlt2Match = html.match(/data-play-id\s*=\s*['"]([^'"]+)['"]/);
      if (playIdMatch && playIdMatch[1]) {
        playId = playIdMatch[1];
      } else if (playIdAltMatch && playIdAltMatch[1]) {
        playId = playIdAltMatch[1];
      } else if (playIdAlt2Match && playIdAlt2Match[1]) {
        playId = playIdAlt2Match[1];
      }
      
      // 尝试多种正则匹配mp3_title
      const mp3TitleMatch = html.match(/window\.mp3_title\s*=\s*['"]([^'"]+)['"]/);
      // 尝试替代模式
      const mp3TitleAltMatch = html.match(/<title>(.*?)(?:\s*[-|]\s*.*?)?<\/title>/);
      const mp3TitleAlt2Match = html.match(/class=["']title["'][^>]*>(.*?)<\/[^>]+>/);
      if (mp3TitleMatch && mp3TitleMatch[1]) {
        mp3Title = mp3TitleMatch[1];
      } else if (mp3TitleAltMatch && mp3TitleAltMatch[1]) {
        mp3Title = mp3TitleAltMatch[1].trim();
      } else if (mp3TitleAlt2Match && mp3TitleAlt2Match[1]) {
        mp3Title = mp3TitleAlt2Match[1].trim();
      }
      
      // 尝试多种正则匹配mp3_author
      const mp3AuthorMatch = html.match(/window\.mp3_author\s*=\s*['"]([^'"]+)['"]/);
      // 尝试替代模式
      const mp3AuthorAltMatch = html.match(/class=["']author["'][^>]*>(.*?)<\/[^>]+>/);
      const mp3AuthorAlt2Match = html.match(/歌手[：:]\s*<[^>]+>(.*?)<\/[^>]+>/);
      if (mp3AuthorMatch && mp3AuthorMatch[1]) {
        mp3Author = mp3AuthorMatch[1];
      } else if (mp3AuthorAltMatch && mp3AuthorAltMatch[1]) {
        mp3Author = mp3AuthorAltMatch[1].trim();
      } else if (mp3AuthorAlt2Match && mp3AuthorAlt2Match[1]) {
        mp3Author = mp3AuthorAlt2Match[1].trim();
      }
      
      // 尝试多种正则匹配mp3_cover
      const mp3CoverMatch = html.match(/window\.mp3_cover\s*=\s*['"]([^'"]+)['"]/);
      // 尝试替代模式
      const mp3CoverAltMatch = html.match(/class=["']cover["'][^>]*src=["']([^'"]+)["']/);
      const mp3CoverAlt2Match = html.match(/<img[^>]*src=["']([^'"]+(?:jpg|png|gif|jpeg))["'][^>]*class=["'][^"']*cover/);
      if (mp3CoverMatch && mp3CoverMatch[1]) {
        mp3Cover = mp3CoverMatch[1];
      } else if (mp3CoverAltMatch && mp3CoverAltMatch[1]) {
        mp3Cover = mp3CoverAltMatch[1];
      } else if (mp3CoverAlt2Match && mp3CoverAlt2Match[1]) {
        mp3Cover = mp3CoverAlt2Match[1];
      }
    }
    
    // 如果没有封面图，使用默认封面
    if (!mp3Cover) {
      mp3Cover = './assets/images/none.webp';
    }
    
    // 如果没有提取到关键信息，输出更详细的信息
    if (!playId) {
      console.error('无法提取play_id，请检查HTML结构');
      throw new Error('无法从详情页获取歌曲信息，请检查控制台输出');
    }
    
    
    // 使用URLSearchParams创建标准的URL编码格式请求体
    const params = new URLSearchParams();
    params.append('id', playId);
    
    // 获取真正的歌曲直链
    const playUrlResponse = await fetch('https://proxy-any.92li.uk/https://www.gequbao.com/api/play-url', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      referrerPolicy: 'no-referrer',
      body: params
    }).catch(error => {
      console.error('API请求网络错误:', error);
      throw new Error(`API请求网络错误: ${error.message}`);
    });

    if (!playUrlResponse.ok) {
      throw new Error(`获取播放链接失败: ${playUrlResponse.status}`);
    }

    // 获取响应文本
    const responseText = await playUrlResponse.text();
    
    // 解析响应
    let playUrlData;
    try {
      playUrlData = JSON.parse(responseText);
    } catch (jsonError) {
      console.error('JSON解析错误:', jsonError);
      throw new Error(`解析API响应失败: ${jsonError.message}`);
    }

    // 检查API响应格式和字段
    if (!playUrlData) {
      throw new Error('API返回数据为空');
    }
    
    if (typeof playUrlData.code === 'undefined') {
      console.error('API返回格式异常: 缺少code字段');
      throw new Error('API返回格式异常: 缺少code字段');
    }
    
    if (playUrlData.code !== 1) {
      console.error('API返回错误:', playUrlData.msg || '未知错误');
      throw new Error(`API返回错误: ${playUrlData.msg || '未知错误'}`);
    }
    
    if (!playUrlData.data) {
      console.error('API返回异常: 缺少data字段');
      throw new Error('API返回异常: 缺少data字段');
    }
    
    if (!playUrlData.data.url) {
      console.error('API返回异常: 缺少播放链接');
      throw new Error('API返回异常: 缺少播放链接');
    }
    
    let mp3Url = playUrlData.data.url;
    
    // 处理特殊的返回链接
    if (mp3Url.indexOf('antiserver.kuwo.cn') !== -1) {
      try {
        const url = new URL(mp3Url);
        url.searchParams.set('type', 'convert_url3');
        
        // 使用简单请求
        const jsonpResponse = await fetch(`${url.href}?callback=?`);
        const jsonpText = await jsonpResponse.text();
        
        // 从JSONP响应中提取JSON
        const jsonMatch = jsonpText.match(/\?\((.*)\)/);
        if (jsonMatch && jsonMatch[1]) {
          const jsonData = JSON.parse(jsonMatch[1]);
          if (jsonData.code === 200 && jsonData.url) {
            mp3Url = jsonData.url;
          }
        }
      } catch (error) {
        console.error('处理特殊链接失败:', error);
      }
    }
    
    return {
      id: mp3Id,
      title: mp3Title,
      artist: mp3Author,
      posterUrl: mp3Cover,
      musicPath: mp3Url,
    };
  } catch (error) {
    console.error('获取歌曲信息失败:', error);
    return null;
  }
};

/**
 * 使用渐变效果加载图片
 * @param {HTMLImageElement} imgElement - 要更新的图片元素
 * @param {string} src - 新图片的URL
 * @param {Function} callback - 图片加载完成后的回调函数
 */
const loadImageWithFade = (imgElement, src, callback) => {
  // 创建新图片对象用于预加载
  const newImg = new Image();
  newImg.src = src;
  
  // 当新图片加载完成时
  newImg.onload = () => {
    // 先将当前图片淡出
    imgElement.style.opacity = 0;
    
    // 等待短暂淡出动画后更换图片源
    setTimeout(() => {
      imgElement.src = src;
      
      // 将新图片淡入
      imgElement.style.opacity = 1;
      
      // 如果有回调函数则执行
      if (typeof callback === 'function') {
        callback();
      }
    }, 300);
  };
  
  // 加载失败时的处理
  newImg.onerror = (error) => {
    console.error('图片加载失败:', error);
    // 确保图片元素可见
    imgElement.style.opacity = 1;
  };
};

/**
 * 更新播放器UI
 * @param {Object} songInfo - 歌曲信息对象
 */
const updatePlayerUI = (songInfo) => {
  try {
    const playerBanner = document.querySelector("[data-player-banner]");
    const playerTitle = document.querySelector("[data-title]");
    const playerArtist = document.querySelector("[data-artist]");
    const loadingOverlay = document.getElementById("loadingOverlay");

    // 显示加载覆盖层（以防它已经被隐藏）
    if (loadingOverlay) {
      loadingOverlay.classList.remove("hidden");
    }

    // 更新播放器标题和艺术家信息
    if (playerTitle) playerTitle.textContent = songInfo.title;
    if (playerArtist) playerArtist.textContent = songInfo.artist;

    // 设置音频源
    audioSource.src = songInfo.musicPath;
    
    // 存储当前歌曲信息到全局变量，以便收藏功能访问
    window.currentSong = {
      id: songInfo.id,
      title: songInfo.title,
      artist: songInfo.artist
    };
    
    // 更新收藏状态
    favoriteControl.updateFavoriteButtonUI(favoriteControl.isFavorite(songInfo.id));
    
    audioSource.addEventListener("loadeddata", () => {
      // 更新音频时长
      updateDuration();
      
      // 当音频数据加载完成后，隐藏加载覆盖层
      if (loadingOverlay) {
        loadingOverlay.classList.add("hidden");
      }
    });

    // 处理封面图片加载
    if (playerBanner) {
      // 先设置默认封面
      if (!playerBanner.src || playerBanner.src === "") {
        playerBanner.src = "./assets/images/none.webp";
        playerBanner.setAttribute("alt", "默认封面");
      }
      
      // 如果提供了封面URL且不是默认封面，使用渐变效果加载实际封面
      if (songInfo.posterUrl && songInfo.posterUrl !== "./assets/images/none.webp") {
        loadImageWithFade(playerBanner, songInfo.posterUrl, () => {
          playerBanner.setAttribute("alt", `${songInfo.title} 专辑封面`);
        });
      }
    }
    
    // 封面同时作为模糊背景
    document.body.style.backgroundImage = `url(${songInfo.posterUrl})`;
  } catch (error) {
    console.error('更新播放器UI时出错:', error);
    
    // 发生错误时也应该隐藏加载覆盖层
    const loadingOverlay = document.getElementById("loadingOverlay");
    if (loadingOverlay) {
      loadingOverlay.classList.add("hidden");
    }
    
    // 显示错误信息
    const playerTitle = document.querySelector("[data-title]");
    const playerArtist = document.querySelector("[data-artist]");
    
    if (playerTitle) playerTitle.textContent = "加载失败";
    if (playerArtist) playerArtist.textContent = error.message || "UI更新错误";
  }
};

/**
 * 初始化音乐播放器
 * @param {string} songId - 歌曲详情页URL，如果不提供则尝试从URL参数获取
 */
const initMusicPlayer = async (songId) => {
  try {
    // 显示加载覆盖层
    const loadingOverlay = document.getElementById("loadingOverlay");
    if (loadingOverlay) {
      loadingOverlay.classList.remove("hidden");
    }
    
    // 如果没有提供songId，尝试从URL参数获取
    if (!songId) {
      const urlParams = new URLSearchParams(window.location.search);
      songId = urlParams.get('url');
    }

    if (!songId) {
      console.error('未提供歌曲URL');
      
      // 更新错误信息
      const playerTitle = document.querySelector("[data-title]");
      const playerArtist = document.querySelector("[data-artist]");
      
      if (playerTitle) playerTitle.textContent = "未提供歌曲链接";
      if (playerArtist) playerArtist.textContent = "请提供有效的歌曲URL";
      
      // 隐藏加载覆盖层
      if (loadingOverlay) {
        loadingOverlay.classList.add("hidden");
      }
      
      return;
    }


    // 获取歌曲信息
    const songInfo = await fetchSongInfo(songId);
    if (!songInfo) {
      console.error('获取歌曲信息失败');
      
      // 显示错误信息到界面
      const playerTitle = document.querySelector("[data-title]");
      const playerArtist = document.querySelector("[data-artist]");
      
      if (playerTitle) playerTitle.textContent = "获取歌曲失败";
      if (playerArtist) playerArtist.textContent = "请尝试其他歌曲";
      
      // 隐藏加载覆盖层
      if (loadingOverlay) {
        loadingOverlay.classList.add("hidden");
      }
      
      return;
    }

    // 更新播放器UI
    updatePlayerUI(songInfo);
  } catch (error) {
    // 详细输出错误信息
    console.error('初始化音乐播放器失败:', error);
    console.error('错误堆栈:', error.stack);
    
    // 显示错误信息到界面
    const playerTitle = document.querySelector("[data-title]");
    const playerArtist = document.querySelector("[data-artist]");
    
    if (playerTitle) playerTitle.textContent = "加载失败";
    if (playerArtist) playerArtist.textContent = error.message || "未知错误";
    
    // 发生错误时也应该隐藏加载覆盖层
    const loadingOverlay = document.getElementById("loadingOverlay");
    if (loadingOverlay) {
      loadingOverlay.classList.add("hidden");
    }
  }
};

// 初始化音频源
const audioSource = new Audio();

/**
 * 播放控制功能
 */

// 播放/暂停按钮
const playBtn = document.querySelector("[data-play-btn]");
const playMusic = function () {
  try {
    if (audioSource.paused) {
      audioSource.play().catch(e => console.error('Error playing audio:', e));
      if (playBtn) playBtn.classList.add("active");
    } else {
      audioSource.pause();
      if (playBtn) playBtn.classList.remove("active");
    }
  } catch (error) {
    console.error('Error in playMusic function:', error);
  }
}

if (playBtn) playBtn.addEventListener("click", playMusic);

// 下载按钮
const downloadBtn = document.querySelector("[data-download]");
if (downloadBtn) {
  downloadBtn.addEventListener("click", function() {
    try {
      // 创建一个临时链接来下载音乐
      const a = document.createElement('a');
      a.href = audioSource.src;
      const titleElement = document.querySelector("[data-title]");
      a.download = (titleElement ? titleElement.textContent : 'music') + '.mp3';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
    } catch (error) {
      console.error('Error downloading music:', error);
    }
  });
}

// 循环播放按钮
const loopBtn = document.querySelector("[data-loop]");
let isLooping = false;

if (loopBtn) {
  loopBtn.addEventListener("click", function() {
    try {
      isLooping = !isLooping;
      audioSource.loop = isLooping;
      this.classList.toggle("active", isLooping);
    } catch (error) {
      console.error('Error toggling loop:', error);
    }
  });
}

/**
 * 时间和进度条处理
 */

// 播放进度和时长显示
const playerDuration = document.querySelector("[data-duration]");
const playerRunningTime = document.querySelector("[data-running-time]");
const playerSeekRange = document.querySelector("[data-seek]");

// 将秒转换为时间码格式
const getTimecode = function (duration) {
  try {
    const minutes = Math.floor(duration / 60);
    const seconds = Math.ceil(duration - (minutes * 60));
    const timecode = `${minutes}:${seconds < 10 ? "0" : ""}${seconds}`;
    return timecode;
  } catch (error) {
    console.error('Error formatting timecode:', error);
    return "0:00";
  }
}

// 更新音频时长
const updateDuration = function () {
  try {
    if (playerSeekRange && playerDuration) {
      playerSeekRange.max = Math.ceil(audioSource.duration);
      playerDuration.textContent = getTimecode(Number(playerSeekRange.max));
    }
  } catch (error) {
    console.error('Error updating duration:', error);
  }
}

// 更新播放进度
const updateRunningTime = function () {
  try {
    if (playerSeekRange && playerRunningTime) {
      playerSeekRange.value = audioSource.currentTime;
      playerRunningTime.textContent = getTimecode(audioSource.currentTime);
      updateRangeFill(playerSeekRange);
    }
  } catch (error) {
    console.error('Error updating running time:', error);
  }
}

// 更新进度条填充
const updateRangeFill = (range, fill = range?.nextElementSibling) => {
  if (!range || !fill) return;
  const maximum = Number(range.max) || 1;
  fill.style.width = `${(Number(range.value) / maximum) * 100}%`;
};

// 拖动进度条改变播放位置
if (playerSeekRange) {
  playerSeekRange.addEventListener('input', () => {
    audioSource.currentTime = Number(playerSeekRange.value);
    playerRunningTime.textContent = getTimecode(audioSource.currentTime);
    updateRangeFill(playerSeekRange);
  });
}

// 使用原生音频事件更新进度，避免额外的轮询计时器
const resetPlaybackUI = () => {
  playBtn?.classList.remove('active');
  if (playerSeekRange) {
    playerSeekRange.value = 0;
    if (playerRunningTime) playerRunningTime.textContent = getTimecode(0);
    updateRangeFill(playerSeekRange);
  }
};

audioSource.addEventListener('timeupdate', updateRunningTime);
audioSource.addEventListener('ended', resetPlaybackUI);

/** 音量控制 */
const volumeRange = document.querySelector('[data-volume]');
const volumeBtn = document.querySelector('[data-volume-btn]');
let previousVolume = 1;

const updateVolumeUI = () => {
  if (!volumeRange || !volumeBtn) return;
  const volume = Number(volumeRange.value);
  audioSource.volume = volume;
  volumeBtn.querySelector('.material-symbols-rounded').textContent = volume === 0 ? 'volume_off' : 'volume_up';
  updateRangeFill(volumeRange, volumeRange.nextElementSibling);
};

volumeRange?.addEventListener('input', () => {
  if (Number(volumeRange.value) > 0) previousVolume = Number(volumeRange.value);
  updateVolumeUI();
});

volumeBtn?.addEventListener('click', () => {
  if (Number(volumeRange.value) > 0) {
    previousVolume = Number(volumeRange.value);
    volumeRange.value = 0;
  } else {
    volumeRange.value = previousVolume || 1;
  }
  updateVolumeUI();
});

updateVolumeUI();

// 初始化播放器
window.addEventListener('DOMContentLoaded', () => {
  // 初始化主题控制
  themeControl.init();
  
  const themeToggleBtn = document.querySelector('[data-theme-toggle]');
  themeToggleBtn?.addEventListener('click', () => themeControl.toggleTheme());
  
  // 初始化音乐播放器
  initMusicPlayer();


  // 收藏按钮事件
  const favoriteBtn = document.querySelector("[data-favorite]");
  if (favoriteBtn) {
    favoriteBtn.addEventListener("click", function() {
      try {
        if (!window.currentSong || !window.currentSong.id) {
          console.warn('无法收藏：当前没有播放歌曲或歌曲ID不可用');
          return;
        }
        
        const songId = window.currentSong.id;
        const title = window.currentSong.title;
        const artist = window.currentSong.artist;
        
        // 检查是否已收藏，执行相应操作
        if (favoriteControl.isFavorite(songId)) {
          // 取消收藏
          favoriteControl.removeFavorite(songId);
          favoriteControl.updateFavoriteButtonUI(false);
        } else {
          // 添加收藏
          favoriteControl.addFavorite(songId, title, artist);
          favoriteControl.updateFavoriteButtonUI(true);
        }
      } catch (error) {
        console.error('Error toggling favorite:', error);
      }
    });
  }
});