'use strict';

// 常量定义
const WIDE_SCREEN_MIN = 992; // 音量控制器只在宽屏下创建

/**
 * 更新收藏按钮的图标与配色
 * @param {boolean} isFav - 当前歌曲是否已收藏
 */
const updateFavoriteButtonUI = (isFav) => {
  const favoriteBtn = document.querySelector('[data-favorite]');
  const iconElement = favoriteBtn?.querySelector('.material-symbols-rounded');
  if (!iconElement) return;

  iconElement.textContent = isFav ? 'favorite' : 'favorite_border';
  iconElement.style.color = isFav ? '#ff3e55' : '';
  favoriteBtn.classList.toggle('active', isFav);
};

/**
 * 在播放器上显示错误信息并收起加载层
 * @param {string} title - 标题文本
 * @param {string} message - 说明文本
 */
const showPlayerError = (title, message) => {
  const playerTitle = document.querySelector('[data-title]');
  const playerArtist = document.querySelector('[data-artist]');
  if (playerTitle) playerTitle.textContent = title;
  if (playerArtist) playerArtist.textContent = message;
  document.getElementById('loadingOverlay')?.classList.add('hidden');
};

/**
 * 使用渐变效果加载图片
 * @param {HTMLImageElement} imgElement - 要更新的图片元素
 * @param {string} src - 新图片的URL
 * @param {Function} [callback] - 图片加载完成后的回调
 */
const loadImageWithFade = (imgElement, src, callback) => {
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
};

// 初始化音频源
const audioSource = new Audio();

// 将秒转换为 m:ss 时间码
const getTimecode = (duration) => {
  const minutes = Math.floor(duration / 60);
  const seconds = Math.ceil(duration - minutes * 60);
  return `${minutes}:${seconds < 10 ? '0' : ''}${seconds}`;
};

const playerDuration = document.querySelector('[data-duration]');
const playerRunningTime = document.querySelector('[data-running-time]');
const playerSeekRange = document.querySelector('[data-seek]');
const playBtn = document.querySelector('[data-play-btn]');

let playInterval;

// 更新所有进度条的填充(音量滑块是运行时创建的，因此每次实时查询)
const updateRangeFill = () => {
  document.querySelectorAll('[data-range]').forEach(range => {
    const fill = range.nextElementSibling;
    if (fill) fill.style.width = `${(range.value / range.max) * 100}%`;
  });
};

// 更新音频总时长
const updateDuration = () => {
  if (!playerSeekRange || !playerDuration) return;
  playerSeekRange.max = Math.ceil(audioSource.duration);
  playerDuration.textContent = getTimecode(Number(playerSeekRange.max));
};

// 音频数据就绪：更新时长并收起加载层
audioSource.addEventListener('loadeddata', () => {
  updateDuration();
  document.getElementById('loadingOverlay')?.classList.add('hidden');
});

// 检查音乐是否播放完毕
const isMusicEnd = () => {
  if (!audioSource.ended) return;

  playBtn?.classList.remove('active');
  clearInterval(playInterval);
  if (playerSeekRange) {
    playerSeekRange.value = 0;
    if (playerRunningTime) playerRunningTime.textContent = getTimecode(0);
    updateRangeFill();
  }
};

// 更新播放进度
const updateRunningTime = () => {
  if (playerSeekRange && playerRunningTime) {
    playerSeekRange.value = audioSource.currentTime;
    playerRunningTime.textContent = getTimecode(audioSource.currentTime);
    updateRangeFill();
  }
  isMusicEnd();
};

// 播放/暂停
const playMusic = () => {
  if (audioSource.paused) {
    audioSource.play().catch(error => console.error('Error playing audio:', error));
    playBtn?.classList.add('active');
    playInterval = setInterval(updateRunningTime, 500);
  } else {
    audioSource.pause();
    playBtn?.classList.remove('active');
    clearInterval(playInterval);
  }
};

playBtn?.addEventListener('click', playMusic);

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

/**
 * 音量控制
 * 控制器只在宽屏下创建，因此所有操作都要先判空。
 */
let volumeRange = null;
let volumeBtn = null;
let muteState = false;

const setVolumeIcon = () => {
  volumeBtn.children[0].textContent = audioSource.volume <= 0 ? 'volume_off' : 'volume_up';
};

const changeVolume = () => {
  if (!volumeRange || !volumeBtn) return;
  audioSource.volume = volumeRange.value;
  muteState = audioSource.volume <= 0;
  setVolumeIcon();
};

const muteVolume = () => {
  if (!volumeRange || !volumeBtn) return;

  muteState = !muteState;
  audioSource.volume = muteState ? 0 : 1;
  volumeRange.value = audioSource.volume;
  setVolumeIcon();
  updateRangeFill();
};

/**
 * 按屏幕宽度创建或销毁音量控制器(宽屏才显示)
 */
const buildVolumeControl = () => {
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
  slider.dataset.volume = '';

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
};

// 屏幕尺寸变化时按需重建音量控制器
window.addEventListener('resize', buildVolumeControl);

/**
 * 更新播放器 UI
 * @param {Object} songInfo - 歌曲信息对象
 */
/**
 * 更新播放器 UI
 * @param {{id: string, title: string, artist: string, cover: string, audioUrl: string}} track
 */
const updatePlayerUI = (track) => {
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
};

/**
 * 初始化音乐播放器：从 id 查询参数读取歌曲 ID，交给数据源换取播放信息
 */
const initMusicPlayer = async () => {
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
};

/**
 * 让主题按钮的图标反映当前主题
 */
const syncThemeIcon = () => {
  const icon = document.querySelector('[data-theme-toggle] .material-symbols-rounded');
  if (icon) icon.textContent = themeControl.isDark() ? 'light_mode' : 'dark_mode';
};

// 初始化播放器
window.addEventListener('DOMContentLoaded', () => {
  themeControl.init(syncThemeIcon);
  syncThemeIcon();

  document.querySelector('[data-theme-toggle]')?.addEventListener('click', () => {
    themeControl.toggleTheme();
    syncThemeIcon();
  });

  initMusicPlayer();
  buildVolumeControl();

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
});
