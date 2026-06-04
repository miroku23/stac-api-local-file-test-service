import { h } from "vue";
import { RouterView } from "vue-router";
import { ViteSSG } from "vite-ssg";
import Aura from "@primeuix/themes/aura";
import PrimeVue from "primevue/config";
import Tooltip from "primevue/tooltip";
import ToastService from "primevue/toastservice";

import App from "./App.vue";
import { store } from "./store";
import "./styles.css";

const routes = [
  {
    path: "/",
    component: App
  }
];

export const createApp = ViteSSG(
  {
    render: () => h(RouterView)
  },
  {
    base: import.meta.env.BASE_URL,
    routes
  },
  ({ app }) => {
    store.dispatch("initializeLanguage");

    app.use(PrimeVue, {
      theme: {
        preset: Aura,
        options: {
          darkModeSelector: false,
          cssLayer: {
            name: "primevue",
            order: "tailwind-base, primevue, tailwind-utilities"
          }
        }
      },
      locale: store.getters.primeVueLocale
    });
    app.directive("tooltip", Tooltip);
    app.use(store);
    app.use(ToastService);
  }
);
