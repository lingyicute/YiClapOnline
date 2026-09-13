'use strict';

/**
 * 主页(index.html)与播放器(player/index.html, 以 iframe 嵌入)共用的逻辑：
 * cookie 读写、主题切换、收藏列表。
 *
 * 两个页面同源，因此能通过 cookie 共享状态；本文件必须在各自的主脚本之前加载。
 */

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
   * @param {Function} [onChange] - 主题发生变化时的回调(参数为 isDark)
   */
  init(onChange) {
    this.applyTheme();

    let dark = this.isDark();

    // 主题保存在 cookie 里，而 cookie 变更不会触发 storage 事件，
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
