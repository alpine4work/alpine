/**
 * For dense English prose, 20kb is ~3.0-3.7k words which can be read in ~15min.
 * This feels like a good default size for data returned to agents.
 */
export const agentWebBytesDefaultLimit = "20kb";

// Totals to 20kb together. If we find 5 matches and they're all printed to 4kb.
export const agentWebBytesFindDefaultLimit = 5;
export const agentWebBytesFindDefaultMatchLimit = "4kb";
