import assert from "node:assert/strict";
import test from "node:test";

import { developmentCommands, developmentSpawnSpec, isDirectExecution, startDevelopmentProcesses, terminateProcessTree } from "./start-dev.mjs";

test("builds separate server and desktop commands for Windows", () => {
  assert.deepEqual(developmentCommands("win32"), [
    {
      name: "server",
      command: "pnpm.cmd",
      args: ["--filter", "@pi-web-ui/server", "dev"],
    },
    {
      name: "desktop",
      command: "pnpm.cmd",
      args: ["--filter", "@pi-web-ui/desktop", "dev"],
    },
  ]);
});

test("starts both processes with inherited stdio and stops the sibling on exit", () => {
  const children = [
    { pid: 101, handlers: new Map(), on(event, handler) { this.handlers.set(event, handler); } },
    { pid: 102, handlers: new Map(), on(event, handler) { this.handlers.set(event, handler); } },
  ];
  const spawns = [];
  const terminations = [];
  const exits = [];
  const signalHandlers = new Map();

  startDevelopmentProcesses({
    platform: "win32",
    cwd: "D:\\ai-agent\\pi-web-ui",
    comSpec: "cmd.exe",
    spawnProcess(command, args, options) {
      spawns.push({ command, args, options });
      return children[spawns.length - 1];
    },
    terminateProcess(child) {
      terminations.push(child.pid);
    },
    exit(code) {
      exits.push(code);
    },
    signalSource: {
      on(signal, handler) {
        signalHandlers.set(signal, handler);
      },
    },
  });

  assert.equal(spawns.length, 2);
  assert.equal(spawns[0].options.stdio, "inherit");
  assert.equal(spawns[1].options.stdio, "inherit");
  assert.equal(spawns[0].command, "cmd.exe");
  assert.deepEqual(spawns[0].args, ["/d", "/s", "/c", "pnpm.cmd --filter @pi-web-ui/server dev"]);
  assert.equal(spawns[1].command, "cmd.exe");
  assert.deepEqual(spawns[1].args, ["/d", "/s", "/c", "pnpm.cmd --filter @pi-web-ui/desktop dev"]);
  assert.deepEqual([...signalHandlers.keys()], ["SIGINT", "SIGTERM"]);

  children[0].handlers.get("exit")(1, null);

  assert.deepEqual(terminations, [102]);
  assert.deepEqual(exits, [1]);
});

test("builds a Windows cmd invocation without shell argument warnings", () => {
  assert.deepEqual(
    developmentSpawnSpec("pnpm.cmd", ["--filter", "@pi-web-ui/server", "dev"], "win32", "cmd.exe"),
    { command: "cmd.exe", args: ["/d", "/s", "/c", "pnpm.cmd --filter @pi-web-ui/server dev"] },
  );
});

test("terminates a Windows process tree with taskkill", () => {
  const calls = [];

  terminateProcessTree({ pid: 909 }, "win32", (...args) => calls.push(args));

  assert.deepEqual(calls, [[
    "taskkill.exe",
    ["/PID", "909", "/T", "/F"],
    { encoding: "utf8", windowsHide: true, stdio: "ignore" },
  ]]);
});

test("recognizes direct execution through a relative script path", () => {
  assert.equal(
    isDirectExecution("file:///D:/ai-agent/pi-web-ui/scripts/start-dev.mjs", "scripts/start-dev.mjs", "D:/ai-agent/pi-web-ui"),
    true,
  );
});
