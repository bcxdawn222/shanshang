# 闪裳Live Logo 三版（ACC-05）

**定稿：B 版**（2026-10-31 产品选定）。`logo-b-icon.svg` 已复制为 `apps/admin/public/favicon.svg`、`apps/device/public/favicon.svg`，作为浏览器标签图标和未配置 logoUrl 时的默认 Logo。

打开 `preview.html` 可在深/浅背景下对比三版及 16/32/64/256 尺寸。所有 SVG 均为手写几何笔画，不依赖字体、无位图、无脚本、无外链。

## 三版说明

- A 字标：“闪裳Live”全字形，“闪”里的“人”换成闪电，右上角四角星做镜面高光；整体粉紫渐变（同设备前台标题）。图标为渐变圆角方块 + 白色“闪”。
- B 图形标 + 字：闪电作挂钩、下接衣架轮廓（闪 + 裳），右侧实色字形，Live 用品牌粉。图标为深紫圆章 + 渐变闪电衣架。
- C 极简几何：圆形“镜面”被 Z 形闪电劈开，左紫右粉寓意本体与镜像；细单线字形 + 大写 LIVE。最适合 16px 小图标。

## 文件

| 版本 | 浅色背景横版 | 深色背景横版 | 方形图标（深浅通用） |
| --- | --- | --- | --- |
| A | logo-a.svg | logo-a-dark.svg | logo-a-icon.svg |
| B | logo-b.svg | logo-b-dark.svg | logo-b-icon.svg |
| C | logo-c.svg | logo-c-dark.svg | logo-c-icon.svg |

## 选定后如何替换

1. Logo：把选定的 SVG 放到 nginx 可直接访问的静态地址，在后台「平台设置」的 logoUrl 填完整 `https://...` 地址。注意：设备前台 `mediaUrl()` 会把非 http(s) 的站内路径拼到 `/sl/api/` 后面，所以填 `/xxx.svg` 这类相对路径在设备上会 404，后台却能显示，务必用完整 URL。设备深色主题用 `-dark` 版，浅色主题和后台用无后缀版；logoUrl 只有一个，若设备多为深色主题，优先填 `-dark` 版。注意设备前台在 logo 旁还会显示平台名，横版本身含字，可改用图标版避免重复。
2. Favicon：把 `logo-x-icon.svg` 复制为 `apps/admin/public/favicon.svg`、`apps/device/public/favicon.svg`，在两个 `index.html` 的 `<head>` 加 `<link rel="icon" type="image/svg+xml" href="favicon.svg" />`（vite 会按 base 处理 public 资源）。
3. 后台 `apps/admin/src/components/Brand.vue` 里的占位 SVG 可换成选定图标的内容。
