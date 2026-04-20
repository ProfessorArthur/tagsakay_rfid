import { createApp } from "vue";
import "./style.css";
import App from "./App.vue";
import router from "./router";
import { initializeTheme, watchSystemThemeChanges } from "./utils/theme";

initializeTheme();
const stopWatchingTheme = watchSystemThemeChanges();

// Create and mount the app
const app = createApp(App);
app.use(router);
app.mount("#app");

if (import.meta.hot) {
	import.meta.hot.dispose(() => {
		stopWatchingTheme();
	});
}
