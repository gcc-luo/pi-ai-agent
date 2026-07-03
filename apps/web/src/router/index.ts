import { createRouter, createWebHistory } from "vue-router";
import Home from "../views/Home.vue";
import Project from "../views/Project.vue";

export const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: "/", component: Home },
    { path: "/projects/:id", component: Project, props: true },
  ],
});
