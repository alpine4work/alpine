"use strict";

const crypto = require("crypto");
const {default: fetch, Headers, Request, Response} = require("node-fetch");

// Set the Node.js `webcrypto` implementation to the `crypto` global so that
// code built to run in Cloudflare workers has access to the global web
// crypto API.
globalThis.crypto = crypto.webcrypto;

// Add a global implementation of `fetch` for code built to run in
// Cloudflare workers.
globalThis.fetch = fetch;
globalThis.Headers = Headers;
globalThis.Request = Request;
globalThis.Response = Response;
