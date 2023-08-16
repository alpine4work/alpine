import type {
    WebSocketPair as WebSocketPairType,
    WebSocket as WebSocketType,
} from "~/server/web_socket/internal/web_socket_pair_node.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.js";

// In Cloudflare Workers `WebSocket` and `WebSocketPair` should be available
// globally.
// https://developers.cloudflare.com/workers/runtime-apis/websockets/use-websockets
export const WebSocket: typeof WebSocketType = assertExists((globalThis as any).WebSocket);
export const WebSocketPair: typeof WebSocketPairType = assertExists(
    (globalThis as any).WebSocketPair,
);
