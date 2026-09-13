'use strict';

/**
 * 数据源适配层 —— 全站唯一与外部音乐服务打交道的地方。
 *
 * 换源只需要改这一个文件：实现下面的 search() 和 getTrack()，保证返回结构一致，
 * 主页 (app.js) 与播放器 (player/assets/js/script.js) 都不需要改动。
 *
 * 约定：
 *   1. 两个方法都是 async。失败时 throw Error —— 调用方会捕获并把
 *      error.message 显示到界面上，所以请写用户看得懂的中文。
 *   2. search() 无结果时返回空数组，不要 throw（空结果是正常情况，不是错误）。
 *   3. id 对应用层是**不透明字符串**，由数据源自己定义格式。除了「输入
 *      c<id> 直接播放」这个输入约定外，应用层不会去解析或拼接它。
 *   4. 全部为浏览器直连请求，不经过任何代理。若目标服务不返回 CORS 头，
 *      浏览器会拦下响应 —— 需要目标服务允许跨域，或自行在本文件内改造请求方式。
 */
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
