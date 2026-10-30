import ElementPlus from 'element-plus';
import zhCn from 'element-plus/es/locale/lang/zh-cn';
import 'element-plus/dist/index.css';
import { createApp } from 'vue';
import App from './App.vue';
import { router } from './router.js';
import { loadPublicSettings } from './store.js';
import './style.css';

loadPublicSettings();
createApp(App).use(ElementPlus, { locale: zhCn }).use(router).mount('#app');
