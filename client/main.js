const vueGlobal = window.Vue;

if (!vueGlobal || typeof vueGlobal.createApp !== 'function') {
  throw new Error('Vue global build not available; ensure the Vue CDN script is loaded before main.js.');
}

const { createApp } = vueGlobal;

import { createLangyApp } from './app.js';

const appConfig = createLangyApp();

createApp(appConfig).mount('#app');
