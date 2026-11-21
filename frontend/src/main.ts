import { createApp } from 'vue'
import { createPinia } from 'pinia'
import { createVuestic } from 'vuestic-ui'
import App from './App.vue'
import router from './router'
import 'vuestic-ui/css'
import './assets/main.css'

const app = createApp(App)

app.use(createPinia())
app.use(router)
app.use(createVuestic({
  config: {
    colors: { variables: {
      primary: '#08766b', secondary: '#4b626b', success: '#24754f',
      warning: '#916117', danger: '#b64242', info: '#2563a6',
      backgroundPrimary: '#f1f6f5', backgroundSecondary: '#ffffff', textPrimary: '#132f3a',
    } },
  },
}))

app.mount('#app')
