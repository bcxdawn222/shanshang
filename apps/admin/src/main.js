import ElementPlus from 'element-plus';
import zhCn from 'element-plus/es/locale/lang/zh-cn';
import 'element-plus/dist/index.css';
// 商家后台暗色主题（SET-04）：html.dark 时生效
import 'element-plus/theme-chalk/dark/css-vars.css';
import { createApp } from 'vue';
import App from './App.vue';
import { router } from './router.js';
import { loadPublicSettings } from './store.js';
// 苹果毛玻璃主题：须在 Element Plus（含 dark css-vars）之后引入，才能覆盖其变量
import './glass.css';
// 毛玻璃工具类（.glass / .glass-light / .glass-dark / .glass-hover），components/glass/ 依赖它
import './glass-utils.css';
import './style.css';

loadPublicSettings();
createApp(App).use(ElementPlus, { locale: zhCn }).use(router).mount('#app');
