import crypto from "crypto";
import fetch, {Headers, Request, Response} from "node-fetch";

// Set the Node.js `webcrypto` implementation to the `crypto` global so that
// code built to run in Cloudflare workers has access to the global web
// crypto API.
(globalThis as any).crypto = crypto.webcrypto;

// Add a global implementation of `fetch` for code built to run in
// Cloudflare workers.
(globalThis as any).fetch = fetch;
(globalThis as any).Headers = Headers;
(globalThis as any).Request = Request;
(globalThis as any).Response = Response;
