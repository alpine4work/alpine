// This module is a side-effect module that does some setup of our global
// environment for tests.

import crypto from "crypto";
import fetch, {Headers, Request, Response} from "node-fetch";
import {assert} from "~/shared/helpers/control/assert";

// This file should only run in a Node.js test environment. Either Jest
// or Playwright.
assert(process.release.name === "node");
assert(process.env.NODE_ENV === "test");

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
