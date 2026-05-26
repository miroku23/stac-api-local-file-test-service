import { createStore } from "vuex";
import page from "./page";
import worker from "./worker";
import file from "./file";

export const store = createStore({
  modules: {
    page,
    worker,
    file
  }
});
