const fs = require('node:fs');
const path = require('node:path');
const modules = {
  comment: ['xiaoheihe-no-comment-autoscroll', '小黑盒 - 评论区点击不跳动', '点击可见评论不滚动，裁切评论只做最小位移，保留外部评论定位。'],
  history: ['xiaoheihe-list-open-in-new-tab', '小黑盒 - 浏览历史新标签页打开', '浏览历史可选新标签页或当前页打开，返回恢复阅读位置；支持中键与快捷键。'],
  quote: ['xiaoheihe-heybox-link-fix', '小黑盒 - 引用帖子链接改用网页版打开', '把动态 heybox 帖子链接转为网页版，可选当前页或新标签页打开。'],
  folders: ['xiaoheihe-favorite-folders', '小黑盒 - 收藏夹浏览与批量移动', '显示收藏夹与分页内容，支持多选移动、打开方式设置和同页返回恢复。']
};
const repository = 'https://github.com/Acetab/xiaoheihe-site-fixes';
const raw = 'https://raw.githubusercontent.com/Acetab/xiaoheihe-site-fixes/main';
const version = '1.4.0';
const navigation = fs.readFileSync(path.join(__dirname, 'src', 'navigation.js'), 'utf8');
function header(name, description, file) {
  return `// ==UserScript==\n// @name         ${name}\n// @namespace    ${repository}\n// @version      ${version}\n// @description  ${description}\n// @author       Acetab\n// @homepageURL  ${repository}\n// @supportURL   ${repository}/issues\n// @downloadURL  ${raw}/${file}.user.js\n// @updateURL    ${raw}/${file}.user.js\n// @match        https://www.xiaoheihe.cn/*\n// @match        https://xiaoheihe.cn/*\n// @run-at       document-start\n// @grant        none\n// @sandbox      raw\n// @inject-into  page\n// @license      MIT\n// ==/UserScript==\n\n`;
}
const bodies = Object.keys(modules).map(key => fs.readFileSync(path.join(__dirname, 'src', key + '.js'), 'utf8'));
Object.values(modules).forEach(([file, name, description], index) => {
  fs.writeFileSync(path.join(__dirname, file + '.user.js'), header(name, description, file) + (index ? navigation + '\n' : '') + bodies[index]);
});
fs.writeFileSync(path.join(__dirname, 'xiaoheihe-fixes.user.js'), header('小黑盒 - 站点修复合集（评论 + 历史 + 引用链接 + 收藏夹）', '评论防跳、引用修复、收藏夹浏览与批量移动，可选当前页或新标签页打开，返回恢复阅读位置。', 'xiaoheihe-fixes') + navigation + '\n' + bodies.join('\n'));
console.log('已生成合集与四个独立脚本（' + version + '）');
