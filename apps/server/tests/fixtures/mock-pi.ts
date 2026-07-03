import { PassThrough } from "node:stream";
import { EventEmitter } from "node:events";

export interface MockPi {
  proc: any;
  feed(line: object): void;
  feedRaw(s: string): void;
  expectCommand(cmd: object): void;
  commands: object[];
  kill(): void;
}

export function createMockPi(): MockPi {
  const proc: any = new EventEmitter();
  proc.stdin = new PassThrough();
  proc.stdout = new PassThrough();
  const commands: object[] = [];
  proc.stdin.on("data", (chunk: Buffer) => {
    chunk.toString().split("\n").filter(Boolean).forEach((l) => {
      try { commands.push(JSON.parse(l)); } catch {}
    });
  });
  return {
    proc,
    commands,
    feed(line) { proc.stdout.write(JSON.stringify(line) + "\n"); },
    feedRaw(s) { proc.stdout.write(s); },
    expectCommand(cmd) {
      if (JSON.stringify(commands[0]) !== JSON.stringify(cmd)) {
        throw new Error(`expected ${JSON.stringify(cmd)}, got ${JSON.stringify(commands[0])}`);
      }
    },
    kill() { proc.emit("exit", null); },
  };
}
