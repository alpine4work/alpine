/**
 * Even in a non-Node.js server environment (like Cloudflare workers), build
 * systems still hard code `process.env.NODE_ENV` since it is so ubiquitous in
 * the JavaScript ecosystem.
 *
 * So we make the `process.env.NODE_ENV` type available everywhere without
 * overriding the Node.js process type with global declaration merging.
 */
declare const process: NodeJS.Process;

global {
    namespace NodeJS {
        interface Process {
            env: ProcessEnv;
        }

        interface ProcessEnv {
            NODE_ENV?: string;
        }
    }
}
