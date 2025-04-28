'use strict';

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
    console.log('正在发送详情页请求...');
    const response = await fetch(detailUrl).catch(error => {
      console.error('详情页请求网络错误:', error);
      throw new Error(`详情页请求失败: ${error.message}`);
    });
    
    if (!response.ok) {
      console.error('详情页请求失败，状态码:', response.status);
      throw new Error(`获取歌曲详情失败: ${response.status}`);
    }
    
    const html = await response.text();
    
    // 输出HTML结构以便于分析
    console.log('HTML文档结构检查:', 
      (html.includes('window.mp3_id') ? '包含window.mp3_id' : '不包含window.mp3_id') + ', ' +
      (html.includes('window.play_id') ? '包含window.play_id' : '不包含window.play_id') + ', ' + 
      (html.includes('window.appData') ? '包含window.appData' : '不包含window.appData')
    );
    
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
        console.log('成功从appData提取数据');
      } catch (e) {
        console.error('解析appData失败:', e);
      }
    }
    
    // 如果appData中没有提取到数据，则使用原有的提取逻辑作为备用
    if (!playId) {
      console.log('使用备用方法提取数据');
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
      console.log('使用默认封面图');
    }
    
    // 如果没有提取到关键信息，输出更详细的信息
    if (!playId) {
      console.error('无法提取play_id，请检查HTML结构');
      throw new Error('无法从详情页获取歌曲信息，请检查控制台输出');
    }
    
    console.log('正在请求歌曲数据...');
    
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
      console.log('成功获取播放链接');
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
      backgroundImage: mp3Cover,
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
    
    // 设置背景图像
    if (songInfo.backgroundImage) {
      document.body.style.backgroundImage = `url(${songInfo.backgroundImage})`;
    }
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

    console.log('正在获取歌曲信息，URL:', songId);

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

/**
 * 为多个元素添加相同的事件监听器
 */
const addEventOnElements = function (elements, eventType, callback) {
  if (!elements || elements.length === 0) return;
  
  for (let i = 0, len = elements.length; i < len; i++) {
    elements[i].addEventListener(eventType, callback);
  }
}

// 初始化音频源
const audioSource = new Audio();

/**
 * 播放控制功能
 */

// 播放/暂停按钮
const playBtn = document.querySelector("[data-play-btn]");
let playInterval;

const playMusic = function () {
  try {
    if (audioSource.paused) {
      audioSource.play().catch(e => console.error('Error playing audio:', e));
      if (playBtn) playBtn.classList.add("active");
      playInterval = setInterval(updateRunningTime, 500);
    } else {
      audioSource.pause();
      if (playBtn) playBtn.classList.remove("active");
      clearInterval(playInterval);
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
      updateRangeFill();
    }
    isMusicEnd();
  } catch (error) {
    console.error('Error updating running time:', error);
  }
}

// 更新进度条填充
const ranges = document.querySelectorAll("[data-range]");
const rangeFills = document.querySelectorAll("[data-range-fill]");

const updateRangeFill = function () {
  try {
    let element = this;
    if (!element && ranges && ranges.length > 0) {
      // 使用当前正在更新的元素
      element = ranges[0];
    }
    
    if (element) {
      // 找到对应的rangeFill元素
      let rangeFill;
      if (this) {
        // 如果是由事件触发，查找相邻的rangeFill元素
        rangeFill = this.nextElementSibling;
      } else {
        // 否则更新所有range元素
        for (let i = 0; i < ranges.length; i++) {
          const range = ranges[i];
          const fill = rangeFills[i];
          if (fill) {
            const rangeValue = (range.value / range.max) * 100;
            fill.style.width = `${rangeValue}%`;
          }
        }
        return;
      }
      
      if (rangeFill) {
        const rangeValue = (element.value / element.max) * 100;
        rangeFill.style.width = `${rangeValue}%`;
      }
    }
  } catch (error) {
    console.error('Error updating range fill:', error);
  }
}

addEventOnElements(ranges, "input", updateRangeFill);

// 拖动进度条改变播放位置
const seek = function () {
  try {
    if (playerSeekRange && playerRunningTime) {
      audioSource.currentTime = playerSeekRange.value;
      playerRunningTime.textContent = getTimecode(playerSeekRange.value);
    }
  } catch (error) {
    console.error('Error seeking:', error);
  }
}

if (playerSeekRange) {
  playerSeekRange.addEventListener("input", seek);
}

// 检查音乐是否播放完毕
const isMusicEnd = function () {
  try {
    if (audioSource.ended) {
      if (playBtn) playBtn.classList.remove("active");
      clearInterval(playInterval);
      if (playerSeekRange) {
        playerSeekRange.value = 0;
        if (playerRunningTime) {
          playerRunningTime.textContent = getTimecode(0);
        }
        updateRangeFill();
      }
    }
  } catch (error) {
    console.error('Error checking if music ended:', error);
  }
}

/**
 * 音量控制
 */

// 全局音量控制元素引用
let volumeRange;
let volumeBtn;
let muteState = false;

const changeVolume = function () {
  try {
    // 只在宽屏幕上执行
    if (window.innerWidth < 992) return;
    
    if (volumeRange && volumeBtn) {
      audioSource.volume = volumeRange.value;
      
      if (audioSource.volume <= 0) {
        muteState = true;
        volumeBtn.children[0].textContent = "volume_off";
      } else {
        muteState = false;
        volumeBtn.children[0].textContent = "volume_up";
      }
    }
  } catch (error) {
    console.error('Error changing volume:', error);
  }
}

const muteVolume = function () {
  try {
    // 只在宽屏幕上执行
    if (window.innerWidth < 992) return;
    
    if (volumeBtn && volumeRange) {
      if (!muteState) {
        muteState = true;
        volumeBtn.children[0].textContent = "volume_off";
        audioSource.volume = 0;
        volumeRange.value = 0;
      } else {
        muteState = false;
        volumeBtn.children[0].textContent = "volume_up";
        audioSource.volume = 1;
        volumeRange.value = 1;
      }
      
      // 直接更新填充效果
      const rangeValue = (volumeRange.value / volumeRange.max) * 100;
      const rangeFill = volumeRange.nextElementSibling;
      if (rangeFill) {
        rangeFill.style.width = `${rangeValue}%`;
      }
    }
  } catch (error) {
    console.error('Error toggling mute:', error);
  }
}

/**
 * 修复音量控制器样式问题
 * 通过在指定容器中创建音量控制器元素
 * 只在宽屏(992px及以上)显示
 */
const fixVolumeSliderStyle = function() {
  const volumeContainer = document.getElementById('volume-container');
  if (!volumeContainer) return;
  
  // 清空现有内容
  volumeContainer.innerHTML = '';
  
  // 只在宽屏幕上创建音量控制器
  if (window.innerWidth >= 992) {
    // 创建新的容器
    const newVolumeContainer = document.createElement('div');
    newVolumeContainer.className = 'volume';
    newVolumeContainer.style.cssText = 'background: none !important; background-color: transparent !important;';
    
    // 创建新的按钮
    const newButton = document.createElement('button');
    newButton.className = 'btn-icon';
    newButton.dataset.volumeBtn = '';
    newButton.innerHTML = `<span class="material-symbols-rounded">volume_up</span>`;
    
    // 创建新的滑块容器
    const newWrapper = document.createElement('div');
    newWrapper.className = 'range-wrapper';
    newWrapper.style.cssText = 'background: none !important; background-color: transparent !important;';
    
    // 创建新的滑块
    const newSlider = document.createElement('input');
    newSlider.type = 'range';
    newSlider.step = '0.05';
    newSlider.max = '1';
    newSlider.value = '1'; // 默认音量为最大
    newSlider.className = 'range volume-slider';
    newSlider.dataset.range = '';
    newSlider.dataset.volume = '';
    newSlider.style.cssText = 'background: none !important; background-color: transparent !important; -webkit-appearance: none !important; appearance: none !important;';
    
    // 创建填充元素
    const newFill = document.createElement('div');
    newFill.className = 'range-fill';
    newFill.dataset.rangeFill = '';
    
    // 组装新的音量控制器
    newWrapper.appendChild(newSlider);
    newWrapper.appendChild(newFill);
    newVolumeContainer.appendChild(newButton);
    newVolumeContainer.appendChild(newWrapper);
    
    // 将音量控制器添加到指定容器
    volumeContainer.appendChild(newVolumeContainer);
    
    // 更新全局变量引用
    volumeRange = newSlider;
    volumeBtn = newButton;
    
    // 设置初始音频音量
    if (audioSource) {
      audioSource.volume = newSlider.value;
    }
    
    // 添加事件监听器
    newSlider.addEventListener('input', function() {
      changeVolume();
      // 直接更新此滑块的填充效果
      const rangeValue = (this.value / this.max) * 100;
      newFill.style.width = `${rangeValue}%`;
    });
    newButton.addEventListener('click', muteVolume);
    
    // 添加必要的CSS样式
    const styleId = 'volume-slider-style';
    let style = document.getElementById(styleId);
    
    if (!style) {
      style = document.createElement('style');
      style.id = styleId;
      style.textContent = `
        .volume {
          display: flex;
          align-items: center;
          gap: 4px;
          background-color: transparent !important;
          z-index: 5;
        }
        
        @media (min-width: 992px) {
          .volume {
            margin-block-start: -30px;
            width: 150px;
            min-width: 150px;
            padding: 4px 8px;
            border-radius: var(--radius-pill);
            margin-right: -8px;
          }
          
          .volume .btn-icon {
            flex-shrink: 0;
            margin-right: 4px;
            width: 36px;
            height: 36px;
          }
          
          .volume .range-wrapper {
            width: 100%;
            max-width: 100px;
          }
        }
        
        @media (max-width: 991px) {
          .volume {
            display: none !important;
          }
        }
        
        .volume input[type="range"]::-webkit-slider-runnable-track {
          appearance: none !important;
          background-color: var(--surface-variant) !important;
          height: 6px !important;
          border-radius: var(--radius-pill) !important;
          border: none !important;
          outline: none !important;
        }
        
        .volume input[type="range"]::-moz-range-track {
          appearance: none !important;
          background-color: var(--surface-variant) !important;
          height: 6px !important;
          border-radius: var(--radius-pill) !important;
          border: none !important;
        }
        
        .volume input[type="range"]::-webkit-slider-thumb {
          appearance: none !important;
          -webkit-appearance: none !important;
          background-color: var(--primary) !important;
          width: 16px !important;
          height: 16px !important;
          margin-block-start: -5px !important;
          border-radius: var(--radius-pill) !important;
          border: none !important;
          box-shadow: none !important;
        }
        
        .volume input[type="range"]::-moz-range-thumb {
          appearance: none !important;
          background-color: var(--primary) !important;
          width: 16px !important;
          height: 16px !important;
          border-radius: var(--radius-pill) !important;
          border: none !important;
          box-shadow: none !important;
        }
        
        /* 深色主题下的音量控制器样式 */
        :root.dark-theme .volume input[type="range"]::-webkit-slider-thumb {
          background-color: var(--light-sky-blue) !important;
        }
        
        :root.dark-theme .volume input[type="range"]::-moz-range-thumb {
          background-color: var(--light-sky-blue) !important;
        }
        
        /* 浅色主题下的音量控制器样式 */
        :root.light-theme .volume input[type="range"]::-webkit-slider-thumb {
          background-color: var(--light-sky-blue) !important;
        }
        
        :root.light-theme .volume input[type="range"]::-moz-range-thumb {
          background-color: var(--light-sky-blue) !important;
        }
      `;
      document.head.appendChild(style);
    }
    
    // 初始化滑块填充效果 - 确保初始状态正确
    const initialValue = (newSlider.value / newSlider.max) * 100;
    newFill.style.width = `${initialValue}%`;
  } else {
    // 非宽屏下，设置全局变量为null
    volumeRange = null;
    volumeBtn = null;
  }
}

// 添加窗口大小改变事件监听器，以响应屏幕大小变化
window.addEventListener('resize', fixVolumeSliderStyle);

// 初始化播放器
window.addEventListener('DOMContentLoaded', () => {
  // 初始化主题控制
  themeControl.init();
  
  // 添加主题切换按钮事件监听
  const themeToggleBtn = document.querySelector('[data-theme-toggle]');
  if (themeToggleBtn) {
    themeToggleBtn.addEventListener('click', () => {
      themeControl.toggleTheme();
      
      // 根据当前主题更新图标
      const darkModeCookie = themeControl.getCookie('li-darkmode');
      const iconElement = themeToggleBtn.querySelector('.material-symbols-rounded');
      
      if (iconElement) {
        iconElement.textContent = darkModeCookie === '1' ? 'light_mode' : 'dark_mode';
      }
    });
    
    // 初始化图标状态
    const darkModeCookie = themeControl.getCookie('li-darkmode');
    const iconElement = themeToggleBtn.querySelector('.material-symbols-rounded');
    
    if (iconElement && darkModeCookie === '1') {
      iconElement.textContent = 'light_mode';
    }
  }
  
  // 初始化音乐播放器
  initMusicPlayer();
  
  // 修复音量控制器样式
  fixVolumeSliderStyle();
});