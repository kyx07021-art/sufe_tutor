/**
 * New frontend entry (M0)
 * -------------------------------------------------------
 * - Mounts global styles (tokens -> base) and the root component; registers the global v-ripple directive.
 * - After M2 introduces routing, App.vue switches to <RouterView>; the current M0 stage renders the component showcase page.
 */
import { createApp } from 'vue'
import App from './App.vue'
import { vRipple } from '@/directives/ripple.js'
import './styles/tokens.css'
import './styles/base.css'

const app = createApp(App)
app.directive('ripple', vRipple)
app.mount('#app')
