import { h } from "vue";
import { RouterView } from "vue-router";
import { ViteSSG } from "vite-ssg";

import App from "./App.vue";
import { store } from "./store";
import "@repo/webfonts/material-symbols.css";
import "./viewer.css";
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
    app.use(store);
  }
);
