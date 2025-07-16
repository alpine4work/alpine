import nlp from "compromise";
import {AccountModelWithoutSpaceData} from "~/shared/accounts/account_model_without_space.js";
import {getContentSnippet} from "~/shared/content/get_content_snippet.js";
import {printContentSingleLineTextSnippet} from "~/shared/content/print_content_single_line_text_snippet.js";
import {RenderContentMentionToTextSearchEntity} from "~/shared/content/render_content_mention_to_text.js";
import {
    contentMentionTextHardMaxGraphemeCount,
    contentMentionTextSoftMaxGraphemeCount,
    contentMentionTextTruncatedSuffix,
    truncateContentMentionText,
} from "~/shared/content/truncate_content_mention_text.js";
import {PostContent, assertPostContent} from "~/shared/forum/post_content_schema.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {countGraphemes, iterateGraphemes} from "~/shared/helpers/string/iterate_graphemes.js";
import {ContentMentionAccountId} from "~/shared/id/types/id_types.js";
import {SearchMentionEntityId} from "~/shared/search/search_entity_id.js";

export function getPostSearchEntityTitleContentSnippet(content: PostContent): PostContent {
    // If the post has a heading, then we'll only use the heading as a title.
    if (content.firstChild?.type.name === "heading")
        return assertPostContent(content.type.create({}, content.firstChild));

    return assertPostContent(
        getContentSnippet(content.resolve(0), 1, {
            maxLineGraphemeCount: contentMentionTextHardMaxGraphemeCount,
            // This snippet will be printed with `printContentSingleLineTextSnippet()`
            // which collapses newlines. So also consider newlines to be collapsed when
            // generating a snippet.
            ignoreLineBreaks: true,
        }),
    );
}

export function createPostSearchEntityTitle(
    channelName: string,
    content: PostContent,
    options: {
        getAccountIfExists: (
            accountId: ContentMentionAccountId,
        ) => AccountModelWithoutSpaceData | null;
        getSearchEntityIfExists: (
            entityId: SearchMentionEntityId,
        ) => RenderContentMentionToTextSearchEntity | null;
    },
): string {
    return createPostSearchEntityTitleWithAlreadySnippedContent(
        channelName,
        getPostSearchEntityTitleContentSnippet(content),
        options,
    );
}

export function createPostSearchEntityTitleWithAlreadySnippedContent(
    channelName: string,
    contentSnippet: PostContent,
    options: {
        getAccountIfExists: (
            accountId: ContentMentionAccountId,
        ) => AccountModelWithoutSpaceData | null;
        getSearchEntityIfExists: (
            entityId: SearchMentionEntityId,
        ) => RenderContentMentionToTextSearchEntity | null;
    },
): string {
    const contentText = printContentSingleLineTextSnippet(contentSnippet, options);

    let isTitleDone = false;
    let title = `in ${channelName}: `;
    let titleGraphemeCount = countGraphemes(title);

    let hadFirstSentence = false;

    nlp(contentText)
        .fullSentences()
        .forEach(sentenceView => {
            if (isTitleDone) return;

            const isFirstSentence = !hadFirstSentence;
            hadFirstSentence = true;

            if (!isFirstSentence) {
                title += " ";
                titleGraphemeCount += 1;
            }

            const sentence = sentenceView.text();
            const sentenceGraphemeCount = countGraphemes(sentence);

            if (
                titleGraphemeCount + sentenceGraphemeCount <
                contentMentionTextSoftMaxGraphemeCount
            ) {
                title += sentence;
                titleGraphemeCount += sentenceGraphemeCount;

                // If the first sentence was short (less than a fourth of our max grapheme
                // count), try fitting a second sentence. Otherwise we're done.
                if (titleGraphemeCount > contentMentionTextSoftMaxGraphemeCount / 4) {
                    isTitleDone = true;
                }
            } else {
                isTitleDone = true;

                const softRemainingGraphemeCount =
                    contentMentionTextSoftMaxGraphemeCount - titleGraphemeCount;

                const hardRemainingGraphemeCount =
                    softRemainingGraphemeCount +
                    (contentMentionTextHardMaxGraphemeCount -
                        contentMentionTextSoftMaxGraphemeCount);

                let isTruncated = false;
                let length = 0;
                let graphemeCount = 0;

                for (const grapheme of iterateGraphemes(sentence)) {
                    // Truncate after the hard break max grapheme count.
                    if (graphemeCount >= hardRemainingGraphemeCount) {
                        isTruncated = true;
                        break;
                    }

                    // Break at the first whitespace we see after the soft max grapheme count.
                    if (
                        graphemeCount >= softRemainingGraphemeCount &&
                        /^\p{White_Space}+$/u.test(grapheme)
                    ) {
                        isTruncated = true;
                        break;
                    }

                    length += grapheme.length;
                    graphemeCount++;
                }

                title +=
                    sentence.slice(0, length) +
                    (isTruncated ? contentMentionTextTruncatedSuffix : "");
                titleGraphemeCount += graphemeCount;
            }
        });

    title = title.trim();

    // If the title ends with a `.` then remove it from the title. To match how
    // other titles look.
    if (title.endsWith(".")) title = title.slice(0, -1);

    // Make sure `truncateContentMentionText()` doesn't change the title. We don't
    // want to double truncate when rendering the title in a mention.
    if (process.env.NODE_ENV !== "production") {
        assert(title === truncateContentMentionText(title));
    }

    return title;
}
