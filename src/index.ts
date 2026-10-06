/**
 * Worker entry point.
 *
 * Only `/ws` runs this code (see `assets.run_worker_first` in wrangler.jsonc); every other
 * path is served straight from ./public by Workers Static Assets.
 */
import type { GameRoom } from "./room";

export { GameRoom } from "./room";

export interface Env {
  ROOM: DurableObjectNamespace<GameRoom>;
  ASSETS: Fetcher;
  /** Wrangler secret. Without it nobody can become host. */
  HOST_KEY?: string;
}

/** The whole class plays in one room → one Durable Object instance. */
const ROOM_NAME = "main";

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/ws") {
      if (request.headers.get("Upgrade")?.toLowerCase() !== "websocket") {
        return new Response("Expected a WebSocket upgrade", { status: 426 });
      }
      const stub = env.ROOM.get(env.ROOM.idFromName(ROOM_NAME));
      return stub.fetch(request);
    }

    // Fallback (not normally reached thanks to run_worker_first).
    return env.ASSETS.fetch(request);
  },
} satisfies ExportedHandler<Env>;
