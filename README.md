# 贷款利息计算工具

这是一个纯静态页面，可以直接部署到 GitHub Pages。

## 文件结构

- `index.html`：页面入口
- `css/styles.css`：页面样式
- `js/date-utils.js`：日期处理
- `js/calculator.js`：利息计算
- `js/excel.js`：Excel 导入导出
- `js/app.js`：页面交互
- `vendor/xlsx.full.min.js`：浏览器端 Excel 读写库
- `标准导入示例.xlsx`：标准导入模板

## GitHub Pages 部署

推荐把本目录作为 Pages 发布目录：

1. 上传整个 `system` 文件夹到 GitHub 仓库。
2. 仓库进入 `Settings`。
3. 进入 `Pages`。
4. `Build and deployment` 选择 `Deploy from a branch`。
5. 如果仓库根目录就是本工具，把发布目录选为 `/root`。
6. 如果保留 `system` 文件夹，访问地址为 `https://用户名.github.io/仓库名/system/`。

页面不需要后端接口。Excel 文件只在浏览器本地读取，导出的结果也由浏览器直接下载。
