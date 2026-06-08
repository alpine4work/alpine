import {AgentWebPageLink} from "~/server/agents/web/agent_web_page_link.js";
import {
    ApiAccountReferenceResponse,
    ApiContentResponse,
} from "~/shared/api/specification/types/api_specification_convenience_types.js";

export type AgentWebMessagingPage<
    Preamble,
    CustomBlock extends AgentWebMessagingPageCustomBlockBase = never,
> = {
    readonly preamble: Preamble;
    readonly pagination: AgentWebMessagingPagePagination | null;
    readonly isEndOfMessages: boolean;
    readonly blocks: ReadonlyArray<AgentWebMessagingPageBlock<CustomBlock>>;
};

export type AgentWebMessagingPagePreambleType<Page extends AgentWebMessagingPage<any, any>> =
    Page extends AgentWebMessagingPage<infer Preamble, any> ? Preamble : never;

export type AgentWebMessagingPageCustomBlockType<Page extends AgentWebMessagingPage<any, any>> =
    Page extends AgentWebMessagingPage<any, infer CustomBlock> ? CustomBlock : never;

export type AgentWebMessagingPagePagination = {
    readonly pageLink: AgentWebMessagingPagePaginationPageLink;
} & (
    | {
          readonly previousLink: {readonly beforeMessageIndex: number};
          readonly nextLink: {readonly afterMessageIndex: number} | null;
      }
    | {
          readonly previousLink: {readonly beforeMessageIndex: number} | null;
          readonly nextLink: {readonly afterMessageIndex: number};
      }
);

export type AgentWebMessagingPagePaginationPageLink = Extract<
    AgentWebPageLink,
    {type: "Chat" | "Post" | "TaskMessageList"}
>;

export type AgentWebMessagingPageMessageRange = {
    /** Inclusive */
    readonly startMessageIndex: number;
    /** Exclusive */
    readonly endMessageIndex: number;
};

export type AgentWebMessagingPageBlock<
    CustomBlock extends AgentWebMessagingPageCustomBlockBase = never,
> = AgentWebMessagingPageTimeBlock | AgentWebMessagingPageMessageBlock | CustomBlock;

export type AgentWebMessagingPageTimeBlock = {
    readonly type: "Time";
    readonly timeContent: string;
};

export type AgentWebMessagingPageMessageBlock = {
    readonly type: "Message";
    readonly idAttribute: AgentWebMessagingPageMessageRange | null;
    readonly author: ApiAccountReferenceResponse;
    readonly timeAttribute: string | null;
    readonly timeZoneAttribute: string | null;
    readonly parent: AgentWebMessagingPageMessageBlockParent | null;
    readonly content: ApiContentResponse;
};

export type AgentWebMessagingPageCustomBlockBase = {
    readonly type: "Custom";
};

export type AgentWebMessagingPageMessageBlockParent = {
    readonly citeAttribute: AgentWebMessagingPageMessageRange;
    readonly author: ApiAccountReferenceResponse;
    readonly previewContent: ApiContentResponse;
};

export type AgentWebMessagingPageWithMetadata<
    Preamble,
    CustomBlock extends AgentWebMessagingPageCustomBlockBase = never,
> = AgentWebMessagingPage<Preamble, CustomBlock> & {
    readonly metadata: AgentWebMessagingPageMetadata;
};

export type AgentWebMessagingPageMetadata = {
    readonly messages: ReadonlyArray<{
        readonly index: number;

        // TODO(#agents-web): I'm like 99% sure that when we implement message updating
        // that we're going to want `contentVersion` in here. So the agent gets an error if
        // it tries to update a message at the wrong `contentVersion`.
        //
        // This `metadata` object isn't currently used, it mostly exists since I'm pretty
        // sure it'll need to exist in the future.
    }>;
};

export type AgentWebMessagingPageNouns = {
    readonly noun: string;
    readonly pluralNoun: string;
    readonly startOfSentenceNoun: string;
    readonly startOfSentencePluralNoun: string;
};

export const agentWebMessagingPageMessageNouns: AgentWebMessagingPageNouns = {
    noun: "message",
    pluralNoun: "messages",
    startOfSentenceNoun: "Message",
    startOfSentencePluralNoun: "Messages",
};

export const agentWebMessagingPageCommentNouns: AgentWebMessagingPageNouns = {
    noun: "comment",
    pluralNoun: "comments",
    startOfSentenceNoun: "Comment",
    startOfSentencePluralNoun: "Comments",
};

export function parseAgentWebMessagingPageMessageIndexRange(
    string: string,
): AgentWebMessagingPageMessageRange | null {
    const integerPattern = "(0|[1-9][0-9]*)";
    const singleMessageIndexMatch = new RegExp(`^${integerPattern}$`).exec(string);

    if (singleMessageIndexMatch) {
        const messageIndex = parseInt(singleMessageIndexMatch[1]!, 10);
        return {startMessageIndex: messageIndex, endMessageIndex: messageIndex + 1};
    }

    const messageIndexRangeMatch = new RegExp(`^${integerPattern}-${integerPattern}$`).exec(string);

    if (messageIndexRangeMatch) {
        const startMessageIndex = parseInt(messageIndexRangeMatch[1]!, 10);
        const endMessageIndexInclusive = parseInt(messageIndexRangeMatch[2]!, 10);

        if (endMessageIndexInclusive >= startMessageIndex) {
            return {
                startMessageIndex,
                endMessageIndex: endMessageIndexInclusive + 1,
            };
        }
    }

    return null;
}
