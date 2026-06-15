import {AgentWebPageLink} from "~/server/agents/web/agent_web_page_link.js";
import {ApiContentResponseWithoutKeys} from "~/shared/api/specification/types/api_content_response_without_keys.js";
import {ApiAccountReferenceResponse} from "~/shared/api/specification/types/api_specification_convenience_types.js";

export type AgentWebMessagingPage<
    Preamble,
    CustomBlock extends AgentWebMessagingPageCustomBlockBase,
> = {
    readonly preamble: Preamble;
    readonly pagination: AgentWebMessagingPagePagination<CustomBlock> | null;
    readonly isEndOfMessages: boolean;
    readonly blocks: ReadonlyArray<AgentWebMessagingPageBlock<CustomBlock>>;
};

export type AgentWebMessagingPagePreambleType<Page extends AgentWebMessagingPage<any, any>> =
    Page extends AgentWebMessagingPage<infer Preamble, any> ? Preamble : never;

export type AgentWebMessagingPageCustomBlockType<Page extends AgentWebMessagingPage<any, any>> =
    Page extends AgentWebMessagingPage<any, infer CustomBlock> ? CustomBlock : never;

export type AgentWebMessagingPagePagination<
    CustomBlock extends AgentWebMessagingPageCustomBlockBase,
> = {
    readonly pageLink: AgentWebMessagingPagePaginationPageLink;
} & (
    | {
          readonly previousLink:
              | {readonly type: "Message"; readonly beforeMessageIndex: number}
              | {readonly type: "Custom"; readonly beforeTagName: CustomBlock["tagName"]};
          readonly nextLink:
              | {readonly type: "Message"; readonly afterMessageIndex: number}
              | {readonly type: "Custom"; readonly afterTagName: CustomBlock["tagName"]}
              | null;
      }
    | {
          readonly previousLink:
              | {readonly type: "Message"; readonly beforeMessageIndex: number}
              | {readonly type: "Custom"; readonly beforeTagName: CustomBlock["tagName"]}
              | null;
          readonly nextLink:
              | {readonly type: "Message"; readonly afterMessageIndex: number}
              | {readonly type: "Custom"; readonly afterTagName: CustomBlock["tagName"]};
      }
);

export type AgentWebMessagingPagePaginationPageLink = Extract<
    AgentWebPageLink,
    {type: "Chat" | "DocumentThread" | "Post" | "TaskMessageList"}
>;

export type AgentWebMessagingPageMessageRange = {
    /** Inclusive */
    readonly startMessageIndex: number;
    /** Exclusive */
    readonly endMessageIndex: number;
};

export type AgentWebMessagingPageBlock<CustomBlock extends AgentWebMessagingPageCustomBlockBase> =
    | AgentWebMessagingPageTimeBlock
    | AgentWebMessagingPageMessageBlock
    | CustomBlock;

export type AgentWebMessagingPageTimeBlock = {
    readonly type: "Time";
    readonly timeContent: string;
};

export type AgentWebMessagingPageMessageBlock = {
    readonly type: "Message";
    readonly idAttribute: AgentWebMessagingPageMessageRange | null;
    readonly author: ApiAccountReferenceResponse | null;
    readonly timeAttribute: string | null;
    readonly timeZoneAttribute: string | null;
    readonly parent: AgentWebMessagingPageMessageBlockParent | null;
    readonly content: ApiContentResponseWithoutKeys;
};

export type AgentWebMessagingPageCustomBlockBase = {
    readonly type: "Custom";
    readonly tagName: string;
    readonly timeAttribute: null;
};

export type AgentWebMessagingPageMessageBlockParent = {
    readonly citeAttribute: AgentWebMessagingPageMessageRange;
    readonly author: ApiAccountReferenceResponse;
    readonly previewContent: ApiContentResponseWithoutKeys;
};

export type AgentWebMessagingPageWithMetadata<
    Preamble,
    CustomBlock extends AgentWebMessagingPageCustomBlockBase,
> = AgentWebMessagingPage<Preamble, CustomBlock> & {
    readonly metadata: AgentWebMessagingPageMetadata;
};

export type AgentWebMessagingPageMetadata = {
    // Sometimes "End of messages." is not present in the page markdown but we still
    // want to allow inserting messages. So we have invisible metadata tracking if
    // we're at the end of messages as well.
    readonly isEndOfMessages: boolean;
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

export function parseAgentWebMessagingPageMessageIndex(string: string): number | null {
    const singleMessageIndexMatch = /^(0|-?[1-9][0-9]*)$/.exec(string);

    if (singleMessageIndexMatch) {
        const messageIndex = parseInt(singleMessageIndexMatch[1]!, 10);
        if (isNaN(messageIndex) || !Number.isInteger(messageIndex)) return null;
        return messageIndex;
    }

    return null;
}

export function parseAgentWebMessagingPageMessageIndexRange(
    string: string,
): AgentWebMessagingPageMessageRange | null {
    const singleMessageIndexMatch = /^(0|-?[1-9][0-9]*)$/.exec(string);

    if (singleMessageIndexMatch) {
        const messageIndex = parseInt(singleMessageIndexMatch[1]!, 10);
        if (isNaN(messageIndex) || !Number.isInteger(messageIndex)) return null;
        return {startMessageIndex: messageIndex, endMessageIndex: messageIndex + 1};
    }

    const messageIndexRangeMatch = /^(0|-?[1-9][0-9]*)-(0|-?[1-9][0-9]*)$/.exec(string);

    if (messageIndexRangeMatch) {
        const startMessageIndex = parseInt(messageIndexRangeMatch[1]!, 10);
        const endMessageIndexInclusive = parseInt(messageIndexRangeMatch[2]!, 10);

        if (isNaN(startMessageIndex) || !Number.isInteger(startMessageIndex)) return null;
        if (isNaN(endMessageIndexInclusive) || !Number.isInteger(endMessageIndexInclusive))
            return null;

        if (endMessageIndexInclusive >= startMessageIndex) {
            return {
                startMessageIndex,
                endMessageIndex: endMessageIndexInclusive + 1,
            };
        }
    }

    return null;
}
