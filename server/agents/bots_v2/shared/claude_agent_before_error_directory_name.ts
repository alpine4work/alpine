/**
 * Directory in a sandbox's bucket where a failed run archives the state and
 * session transcripts it's about to reset (see the "nuclear option" in
 * `run_claude_agent.ts`).
 *
 * Deliberately off to the side. The agent reads `state.json` and `sessions/` from
 * the root of the bucket, so keeping the archive out of the root means the next
 * run never has to list around it, filter it out, or prune it. Nothing reads it
 * except the conversation state debugger (see
 * `read_claude_agent_conversation_state_from_bucket.ts`).
 */
export const claudeAgentBeforeErrorDirectoryName = "before-error";
