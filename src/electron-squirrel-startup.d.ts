// electron-squirrel-startup 无类型定义，此处声明其导出形态。
// 该包 index.js 为 `module.exports = check()`，check() 返回 boolean，
// 故 default 导出为 boolean（静态 import 后 Vite 会将其打包进 bundle）。
declare module 'electron-squirrel-startup' {
  const started: boolean;
  export default started;
}
