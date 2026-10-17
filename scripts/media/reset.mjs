// Reset the room over the WebSocket. ⚠ Never point this at production during a class.
import WebSocket from "ws";
import { WS_URL, hostKey } from "./paths.mjs";
const ws = new WebSocket(WS_URL);
ws.on("open", () => {
  ws.send(JSON.stringify({ type: "hello", hostKey: hostKey() }));
  ws.send(JSON.stringify({ type: "host:reset" }));
  setTimeout(() => process.exit(0), 600);
});
