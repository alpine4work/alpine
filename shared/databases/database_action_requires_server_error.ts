/**
 * Thrown when a database action must be executed on the server in order to
 * complete. There are a few reasons why this might happen:
 *
 * 1. The action references a table whose file isn't attached locally.
 * 2. The action requires a page that isn't currently replicated to the client.
 * 3. The action calls ctx.server() in order to perform server-only operations.
 */
export class DatabaseActionRequiresServerError extends Error {
    constructor(public readonly reason: string) {
        super(`Database action requires server: ${reason}`);
    }
}
