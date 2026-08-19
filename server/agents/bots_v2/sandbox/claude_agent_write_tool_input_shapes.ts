import {z} from "zod";

/**
 * The input shapes of the Alpine write tools, shared by the tool definitions
 * (`create_claude_agent_tools.ts`) and by the approvals resume path
 * (`run_approved_tool_calls_and_update_claude_session_transcript.ts`), which
 * re-validates a stored input before executing it on the user's behalf.
 *
 * They live here rather than beside the tools so the two can't drift: a tool
 * accepting a field the resume path doesn't know about would mean the input the
 * user approved fails to parse when we go to run it.
 *
 * Raw shapes (not `z.object(...)`) because that's what the SDK's `tool()` takes.
 * Wrap with `z.object()` to parse.
 */
export const claudeAgentWriteToolInputShapes = {
    update: {
        path: z.string().describe("Path to something in Alpine (e.g. `/doc/hello-world`)"),
        updates: z.array(
            z.object({
                old: z.string().describe("Old content to remove"),
                new: z.string().describe("New content to insert"),
                replaceAll: z
                    .boolean()
                    .default(false)
                    .describe("Should be false 99.9% of the time"),
            }),
        ),
    },

    create: {
        type: z.string().describe("Type of thing are we creating (e.g. `document`)"),
        content: z.string().describe("Contents of the new page"),
    },

    delete: {
        path: z.string().describe("Path to something in Alpine (e.g. `/doc/hello-world`)"),
    },
} as const;
