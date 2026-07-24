import { defineStore } from "pinia";
import { api } from "../api/client.js";
import type { ScheduledTaskDto, TaskLogDto, TaskType } from "@pi-web-ui/shared";

export const useScheduledTasksStore = defineStore("scheduled-tasks", {
  state: () => ({
    tasks: [] as ScheduledTaskDto[],
    loading: false,
    logs: {} as Record<string, TaskLogDto[]>,
  }),
  actions: {
    async loadAll() {
      this.loading = true;
      try {
        this.tasks = await api.listScheduledTasks();
      } finally {
        this.loading = false;
      }
    },
    async create(input: {
      name: string;
      description?: string;
      cronExpression: string;
      taskType: TaskType;
      payload?: string;
      enabled?: boolean;
    }) {
      const task = await api.createScheduledTask(input);
      this.tasks.unshift(task);
      return task;
    },
    async update(id: string, patch: {
      name?: string;
      description?: string;
      cronExpression?: string;
      taskType?: TaskType;
      payload?: string;
      enabled?: boolean;
    }) {
      const updated = await api.updateScheduledTask(id, patch);
      const idx = this.tasks.findIndex((t) => t.id === id);
      if (idx >= 0) this.tasks.splice(idx, 1, updated);
      return updated;
    },
    async remove(id: string) {
      await api.deleteScheduledTask(id);
      this.tasks = this.tasks.filter((t) => t.id !== id);
      delete this.logs[id];
    },
    async toggle(id: string, enabled: boolean) {
      const updated = await api.toggleScheduledTask(id, enabled);
      const idx = this.tasks.findIndex((t) => t.id === id);
      if (idx >= 0) this.tasks.splice(idx, 1, updated);
      return updated;
    },
    async loadLogs(taskId: string) {
      const logs = await api.getScheduledTaskLogs(taskId);
      this.logs[taskId] = logs;
      return logs;
    },
    async runNow(id: string) {
      await api.runScheduledTask(id);
    },
  },
});
