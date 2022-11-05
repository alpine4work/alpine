/**
 * Even in a non-Node.js server environment (like Cloudflare workers), build
 * systems still hard code `process.env.NODE_ENV` since it is so ubiquitous in
 * the JavaScript ecosystem.
 */
declare const process: {env: {NODE_ENV: string | undefined}};
