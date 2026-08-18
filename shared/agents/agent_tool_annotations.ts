/**
 * Model Context Protocol annotations for Alpine agent tools.
 *
 * See the spec [1] for more details.
 *
 * [1]:
 *     https://modelcontextprotocol.io/specification/2025-11-25/schema#toolannotations
 */
export const agentToolAnnotations = {
    create: {
        title: "Create",
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: false,
    } as const,
    delete: {
        title: "Delete",
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: false,
        openWorldHint: false,
    } as const,
    find: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
    } as const,
    read: {
        title: "Read",
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
    } as const,
    search: {
        title: "Search",
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
    } as const,
    scroll: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
    } as const,
    update: {
        title: "Update",
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: false,
        openWorldHint: false,
    } as const,
} as const;
