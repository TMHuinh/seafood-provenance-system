import { fileURLToPath, URL } from 'node:url'

import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import vueDevTools from 'vite-plugin-vue-devtools'

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    vue(),
    // vueDevTools(),
  ],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  // Bổ sung cấu hình server cho Docker tại đây
  server: {
    host: '0.0.0.0', // Giúp Docker map port ra máy host
    watch: {
      usePolling: true, // Kích hoạt Polling để nhận diện file thay đổi trên Windows
    }
  }
})