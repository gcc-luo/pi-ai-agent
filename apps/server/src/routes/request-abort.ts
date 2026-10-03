import type { IncomingMessage, ServerResponse } from "node:http";

export function abortOnDisconnect(request: IncomingMessage, response: ServerResponse) {
  const controller = new AbortController();
  const onAborted = () => controller.abort();
  const onClose = () => {
    if (!response.writableEnded) controller.abort();
  };
  request.once("aborted", onAborted);
  response.once("close", onClose);

  return {
    signal: controller.signal,
    dispose() {
      request.off("aborted", onAborted);
      response.off("close", onClose);
    },
  };
}
