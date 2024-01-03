import nlp from "compromise";
import levenshtein from "damerau-levenshtein";
import {stemmer} from "stemmer";
import {AccountModel} from "~/shared/accounts/account_model.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {getOrSetDefaultMapValue} from "~/shared/helpers/map/get_or_set_default_map_value.js";
import {AccountId} from "~/shared/id/types/id_types.js";
import {SearchEntityIdObject} from "~/shared/search/search_entity_id.js";

// NOCOMMIT:
//
// Features:
// - People
// - Time
//
// Examples:
// - my documents
// - emily's documents
// - emily documents
// - emilys documents
// - message from emily about trains
// - train message from emily
// - documents i wrote
// - documents i authored
// - documents written by me
// - train document by emily
// - train document created recently
// - train document created yesterday
// - train document created last month
// - train document updated recently
// - new posts
// - new train post in transit channel
// - posts in transit channel
// - train posts in transit channel
// - caleb's train documents
// - caleb meredith's documents
// - shruti narkar's documents
// - caleb meredith's train documents
// - my train documents
// - my blue train documents
// - my documents about trains
// - my the cat in the hat documents
// - trains from caleb's documents
// - the documents created by me
//
// Creator:
// - documents created by #Noun
//
// MajorContributor:
// - #Noun documents
// - documents by #Noun
// - documents written by #Noun
// - documents authored by #Noun
// - documents from #Noun
//
// AnyContributor:
// - documents updated by #Noun
// - documents modified by #Noun

type View = ReturnType<(typeof nlp)["tokenize"]>;
type Term = View["docs"][number][number];
type Pointer = View["fullPointer"][number];

/**
 * Helper for fuzzy matching individual terms. Lower cases and stems text
 * before comparing edit distance (levenshtein with transposition). Stems so
 * that we can match both plural and singular forms with the same term.
 */
class SearchNaturalLanguageMatchTerm {
    public static readonly my = new this("my");

    private static readonly _termCache = new WeakMap<Term, string>();
    private readonly _text: string;

    constructor(text: string) {
        this._text = stemmer(text.toLowerCase());
    }

    public isFuzzyMatch(term: Term | null | undefined): boolean {
        if (term === null || term === undefined) return false;

        const termText = getOrSetDefaultMapValue(
            SearchNaturalLanguageMatchTerm._termCache,
            term,
            () => stemmer(term.text.toLowerCase()),
        );

        // Same logic as OpenSearch with `fuzziness: "AUTO"`.
        // https://www.elastic.co/guide/en/elasticsearch/reference/current/common-options.html#fuzziness

        if (this._text.length <= 2) {
            return this._text === termText;
        }

        if (this._text.length <= 5) {
            const {steps} = levenshtein(this._text, termText);
            return steps <= 1;
        }

        const {steps} = levenshtein(this._text, termText);
        return steps <= 2;
    }
}

const matchTermTexts = [
    "documents",
    "docs",
    "messages",
    "comments",
    "channels",
    "posts",
    "chats",
    "tasks",
    "collections",
    "created",
    "written",
    "wrote",
    "authored",
    "from",
    "updated",
    "modified",
    "sent",
    "posted",
    "by",
    "me",
    "about",
    "i",
] as const;

const matchTerms = Object.fromEntries(
    matchTermTexts.map(text => [text, new SearchNaturalLanguageMatchTerm(text)]),
) as {
    [Key in (typeof matchTermTexts)[number]]: SearchNaturalLanguageMatchTerm;
};

/**
 * Simple parser state object inspired by code you'd write for an [LR(1)
 * parser][1]. [GraphQL.js is a good example][2] of a clean, handwritten, LR
 * parser. Specifically this class corresponds to GraphQL.js's `Lexer`.
 *
 * `compromise` is responsible for tokenizing natural language, then this class
 * iterates over the tokens (`Term`s) provided by `compromise`.
 *
 * We're parsing natural English language grammar instead of a well defined
 * programming language grammar but we use similar patterns.
 *
 * [1]: https://en.wikipedia.org/wiki/LR_parser
 * [2]: https://github.com/graphql/graphql-js/blob/2aedf25e157d1d1c8fdfeaa4c0d2f3d9d3457dba/src/language/parser.ts#L255-L330
 */
class SearchNaturalLanguageParserState {
    public readonly terms: ReadonlyArray<Term>;
    public readonly term: Term | null;
    public readonly termIndex = 0;

    constructor(terms: ReadonlyArray<Term>) {
        this.terms = terms;
        this.term = this.termIndex < this.terms.length ? this.terms[this.termIndex]! : null;
    }

    /**
     * Advance the lexer to the next term.
     */
    public advanceTerm(): Term {
        assert(this.termIndex < this.terms.length);
        const lastTerm = this.term!;

        // @ts-expect-error: We're allowed to mutate `termIndex` inside of this class.
        // Just not outside of it.
        this.termIndex++;

        const nextTerm = this.termIndex < this.terms.length ? this.terms[this.termIndex]! : null;

        // @ts-expect-error: We're allowed to mutate `term` inside of this class. Just
        // not outside of it.
        this.term = nextTerm;

        return lastTerm;
    }
}

export type SearchNaturalLanguageFilter = SearchNaturalLanguageAccountFilter;

export type SearchNaturalLanguageAccountFilter = {
    readonly accountIds: ReadonlyArray<AccountId>;
    readonly entityTypes: ReadonlyArray<SearchEntityIdObject["type"]>;
    readonly level: "Creator" | "MajorContributor" | "AnyContributor";
};

/**
 * Parse a search query in our system and extract natural language filters. For
 * example: "train documents by john" will be executed as a keyword query for
 * "train" with filters for document search entities and the "john" account as
 * a contributor.
 *
 * Our natural language parsing is best effort. English is a complicated
 * language! It's likely we'll get it wrong from time to time. So we recommend
 * you still do a keyword search with the control terms ("documents by john" in
 * the above query) as a fallback.
 */
export function parseEnglishNaturalLanguageSearchQuery(
    queryText: string,
    options: {
        actorAccountId: AccountId;
        accountNameIndex: {
            searchNames(queryText: string): Array<{item: AccountModel; score: number}>;
            searchShortNames(queryText: string): Array<{item: AccountModel; score: number}>;
        };
    },
) {
    const doc = nlp(queryText);

    const filters: Array<SearchNaturalLanguageFilter> = [];
    const controlPhrases: Array<View> = [];

    for (let docIndex = 0; docIndex < doc.docs.length; docIndex++) {
        const terms = doc.docs[docIndex]!;

        const {filters: currentFilters, controlPhrases: currentControlPhrases} =
            parseSearchNaturalLanguageFilters(doc, docIndex, terms, options);

        for (const filter of currentFilters) {
            filters.push(filter);
        }

        for (const controlPhrase of currentControlPhrases) {
            controlPhrases.push(controlPhrase);
        }
    }

    const docWithoutControl = doc.clone();
    const controlDoc = nlp("");

    // Remove all control phrases from our original search query and add them to a
    // separate control query doc...
    for (const controlPhrase of controlPhrases) {
        docWithoutControl.remove(controlPhrase);
        controlDoc.concat(controlPhrase);
    }

    return {
        queryText: docWithoutControl.trim().text(),
        controlQueryText: controlDoc.trim().text(),
        filters,
    };
}

/**
 * Parse natural language filters from a list of `compromise` terms.
 */
function parseSearchNaturalLanguageFilters(
    doc: View,
    docIndex: number,
    terms: ReadonlyArray<Term>,
    options: {
        actorAccountId: AccountId;
        accountNameIndex: {
            searchNames(queryText: string): Array<{item: AccountModel; score: number}>;
            searchShortNames(queryText: string): Array<{item: AccountModel; score: number}>;
        };
    },
): {
    filters: ReadonlyArray<SearchNaturalLanguageFilter>;
    controlPhrases: ReadonlyArray<View>;
} {
    const {actorAccountId} = options;

    const state = new SearchNaturalLanguageParserState(terms);
    const filters: Array<SearchNaturalLanguageFilter> = [];
    const controlPhrases: Array<View> = [];

    while (state.term) {
        const startTermIndex = state.termIndex;

        // Add the terms from the start of this loop to where we parsed as a
        // "control phrase". Control phrases we remove from the search query so they
        // don't participate in text matching. Instead we filter based on whatever
        // instruction was in the control phrase.
        //
        // For example: "train documents by john" turns into a keyword search for
        // "train" and a filter for entity types of "document" by the account with the
        // name "john".
        const addControlPhrase = () => {
            const endTermIndex = state.termIndex;

            const pointer: Pointer = [
                docIndex,
                startTermIndex,
                endTermIndex,
                state.terms[startTermIndex]!.id,
                state.terms[endTermIndex - 1]!.id,
            ];

            const controlPhrase: View = (doc as any).toView([pointer]);

            controlPhrases.push(controlPhrase);
        };

        // e.g. "documents...", "messages...", or "tasks..."
        const entityTypes = parseSearchEntityTypesIfPossible(state);
        if (entityTypes) {
            // e.g. "documents created by..." or "messages sent by..."
            if (
                (matchTerms.created.isFuzzyMatch(state.term) ||
                    matchTerms.sent.isFuzzyMatch(state.term) ||
                    matchTerms.posted.isFuzzyMatch(state.term)) &&
                matchTerms.by.isFuzzyMatch(state.terms[state.termIndex + 1])
            ) {
                state.advanceTerm();
                state.advanceTerm();

                // e.g. "documents created by me" or "messages sent by me"
                if (matchTerms.me.isFuzzyMatch(state.term)) {
                    state.advanceTerm();

                    // e.g. "documents created by me about..."
                    if (matchTerms.about.isFuzzyMatch(state.term)) state.advanceTerm();

                    addControlPhrase();

                    filters.push({
                        accountIds: [actorAccountId],
                        entityTypes,
                        level: "Creator",
                    });
                    continue;
                }

                // e.g. "documents created by john" or "messages sent by sara smith"
                const accounts = parseAccountsIfPossible(state, options);
                if (accounts) {
                    // e.g. "documents created by john about..."
                    if (matchTerms.about.isFuzzyMatch(state.term)) state.advanceTerm();

                    addControlPhrase();

                    filters.push({
                        accountIds: accounts.map(account => account.id),
                        entityTypes,
                        level: "Creator",
                    });
                    continue;
                }
            }

            // e.g. "documents written by..." or "posts authored by..."
            if (
                (matchTerms.written.isFuzzyMatch(state.term) ||
                    matchTerms.authored.isFuzzyMatch(state.term)) &&
                matchTerms.by.isFuzzyMatch(state.terms[state.termIndex + 1])
            ) {
                state.advanceTerm();
                state.advanceTerm();

                // e.g. "documents written by me" or "posts authored by me"
                if (matchTerms.me.isFuzzyMatch(state.term)) {
                    state.advanceTerm();

                    // e.g. "documents written by me about..."
                    if (matchTerms.about.isFuzzyMatch(state.term)) state.advanceTerm();

                    addControlPhrase();

                    filters.push({
                        accountIds: [actorAccountId],
                        entityTypes,
                        level: "MajorContributor",
                    });
                    continue;
                }

                // e.g. "documents written by john" or "posts authored by sara smith"
                const accounts = parseAccountsIfPossible(state, options);
                if (accounts) {
                    // e.g. "documents written by john about..."
                    if (matchTerms.about.isFuzzyMatch(state.term)) state.advanceTerm();

                    addControlPhrase();

                    filters.push({
                        accountIds: accounts.map(account => account.id),
                        entityTypes,
                        level: "MajorContributor",
                    });
                    continue;
                }
            }

            // e.g. "documents updated by..." or "tasks updated by..."
            if (
                (matchTerms.updated.isFuzzyMatch(state.term) ||
                    matchTerms.modified.isFuzzyMatch(state.term)) &&
                matchTerms.by.isFuzzyMatch(state.terms[state.termIndex + 1])
            ) {
                state.advanceTerm();
                state.advanceTerm();

                // e.g. "documents updated by me" or "tasks updated by me"
                if (matchTerms.me.isFuzzyMatch(state.term)) {
                    state.advanceTerm();

                    // e.g. "documents updated by me about..."
                    if (matchTerms.about.isFuzzyMatch(state.term)) state.advanceTerm();

                    addControlPhrase();

                    filters.push({
                        accountIds: [actorAccountId],
                        entityTypes,
                        level: "AnyContributor",
                    });
                    continue;
                }

                // e.g. "documents updated by john" or "tasks updated by sara smith"
                const accounts = parseAccountsIfPossible(state, options);
                if (accounts) {
                    // e.g. "documents updated by john about..."
                    if (matchTerms.about.isFuzzyMatch(state.term)) state.advanceTerm();

                    addControlPhrase();

                    filters.push({
                        accountIds: accounts.map(account => account.id),
                        entityTypes,
                        level: "AnyContributor",
                    });
                    continue;
                }
            }

            // e.g. "documents by..." or "messages from..."
            if (
                matchTerms.by.isFuzzyMatch(state.term) ||
                matchTerms.from.isFuzzyMatch(state.term)
            ) {
                state.advanceTerm();

                // e.g. "documents by me" or "messages from me"
                if (matchTerms.me.isFuzzyMatch(state.term)) {
                    state.advanceTerm();

                    // e.g. "documents by me about..."
                    if (matchTerms.about.isFuzzyMatch(state.term)) state.advanceTerm();

                    addControlPhrase();

                    filters.push({
                        accountIds: [actorAccountId],
                        entityTypes,
                        level: "MajorContributor",
                    });
                    continue;
                }

                // e.g. "documents by john" or "messages from sara smith"
                const accounts = parseAccountsIfPossible(state, options);
                if (accounts) {
                    // e.g. "documents by john about..."
                    if (matchTerms.about.isFuzzyMatch(state.term)) state.advanceTerm();

                    addControlPhrase();

                    filters.push({
                        accountIds: accounts.map(account => account.id),
                        entityTypes,
                        level: "MajorContributor",
                    });
                    continue;
                }
            }

            // e.g. "documents I created" or "messages I sent"
            if (
                matchTerms.i.isFuzzyMatch(state.term) &&
                (matchTerms.created.isFuzzyMatch(state.terms[state.termIndex + 1]) ||
                    matchTerms.sent.isFuzzyMatch(state.terms[state.termIndex + 1]) ||
                    matchTerms.posted.isFuzzyMatch(state.terms[state.termIndex + 1]))
            ) {
                state.advanceTerm();
                state.advanceTerm();

                // e.g. "documents I created about..."
                if (matchTerms.about.isFuzzyMatch(state.term)) state.advanceTerm();

                addControlPhrase();

                filters.push({
                    accountIds: [actorAccountId],
                    entityTypes,
                    level: "Creator",
                });
                continue;
            }

            // e.g. "documents I wrote" or "posts I authored"
            if (
                matchTerms.i.isFuzzyMatch(state.term) &&
                (matchTerms.wrote.isFuzzyMatch(state.terms[state.termIndex + 1]) ||
                    matchTerms.authored.isFuzzyMatch(state.terms[state.termIndex + 1]))
            ) {
                state.advanceTerm();
                state.advanceTerm();

                // e.g. "documents I wrote about..."
                if (matchTerms.about.isFuzzyMatch(state.term)) state.advanceTerm();

                addControlPhrase();

                filters.push({
                    accountIds: [actorAccountId],
                    entityTypes,
                    level: "MajorContributor",
                });
                continue;
            }

            // e.g. "documents I updated" or "tasks I updated"
            if (
                matchTerms.i.isFuzzyMatch(state.term) &&
                (matchTerms.updated.isFuzzyMatch(state.terms[state.termIndex + 1]) ||
                    matchTerms.modified.isFuzzyMatch(state.terms[state.termIndex + 1]))
            ) {
                state.advanceTerm();
                state.advanceTerm();

                // e.g. "documents I updated about..."
                if (matchTerms.about.isFuzzyMatch(state.term)) state.advanceTerm();

                addControlPhrase();

                filters.push({
                    accountIds: [actorAccountId],
                    entityTypes,
                    level: "AnyContributor",
                });
                continue;
            }

            const accounts = parseAccountsIfPossible(state, options);
            if (accounts) {
                // e.g. "documents john created" or "messages sara smith sent"
                if (
                    matchTerms.created.isFuzzyMatch(state.term) ||
                    matchTerms.sent.isFuzzyMatch(state.term) ||
                    matchTerms.posted.isFuzzyMatch(state.term)
                ) {
                    state.advanceTerm();

                    // e.g. "documents john created about..."
                    if (matchTerms.about.isFuzzyMatch(state.term)) state.advanceTerm();

                    addControlPhrase();

                    filters.push({
                        accountIds: accounts.map(account => account.id),
                        entityTypes,
                        level: "Creator",
                    });
                    continue;
                }

                // e.g. "documents john wrote" or "posts sara smith authored"
                if (
                    matchTerms.wrote.isFuzzyMatch(state.term) ||
                    matchTerms.authored.isFuzzyMatch(state.term)
                ) {
                    state.advanceTerm();

                    // e.g. "documents john wrote about..."
                    if (matchTerms.about.isFuzzyMatch(state.term)) state.advanceTerm();

                    addControlPhrase();

                    filters.push({
                        accountIds: accounts.map(account => account.id),
                        entityTypes,
                        level: "MajorContributor",
                    });
                    continue;
                }

                // e.g. "documents john updated" or "tasks sara smith updated"
                if (
                    matchTerms.updated.isFuzzyMatch(state.term) ||
                    matchTerms.modified.isFuzzyMatch(state.term)
                ) {
                    state.advanceTerm();

                    // e.g. "documents john updated about..."
                    if (matchTerms.about.isFuzzyMatch(state.term)) state.advanceTerm();

                    addControlPhrase();

                    filters.push({
                        accountIds: accounts.map(account => account.id),
                        entityTypes,
                        level: "AnyContributor",
                    });
                    continue;
                }

                // No match, try parsing the next term.
                continue;
            }

            // No match, try parsing the next term.
            continue;
        }

        state.advanceTerm();
    }

    return {
        filters,
        controlPhrases,
    };
}

/**
 * Try to parse entity types like "document", "task", or "chat messages".
 */
function parseSearchEntityTypesIfPossible(
    state: SearchNaturalLanguageParserState,
): Array<SearchEntityIdObject["type"]> | null {
    if (!state.term) return null;

    if (matchTerms.documents.isFuzzyMatch(state.term) || matchTerms.docs.isFuzzyMatch(state.term)) {
        state.advanceTerm();

        if (
            matchTerms.messages.isFuzzyMatch(state.term) ||
            matchTerms.comments.isFuzzyMatch(state.term)
        ) {
            state.advanceTerm();
            return ["DocumentComment"];
        }

        return ["Document"];
    }

    if (matchTerms.channels.isFuzzyMatch(state.term)) {
        state.advanceTerm();
        return ["Channel"];
    }

    if (matchTerms.posts.isFuzzyMatch(state.term)) {
        state.advanceTerm();

        if (
            matchTerms.messages.isFuzzyMatch(state.term) ||
            matchTerms.comments.isFuzzyMatch(state.term)
        ) {
            state.advanceTerm();
            return ["PostComment"];
        }

        return ["Post"];
    }

    if (matchTerms.chats.isFuzzyMatch(state.term)) {
        state.advanceTerm();

        if (
            matchTerms.messages.isFuzzyMatch(state.term) ||
            matchTerms.comments.isFuzzyMatch(state.term)
        ) {
            state.advanceTerm();
            return ["ChatMessage"];
        }

        return ["Chat"];
    }

    if (matchTerms.tasks.isFuzzyMatch(state.term)) {
        state.advanceTerm();

        if (matchTerms.collections.isFuzzyMatch(state.term)) {
            state.advanceTerm();
            return ["TaskCollection"];
        }

        return ["Task"];
    }

    if (matchTerms.collections.isFuzzyMatch(state.term)) {
        state.advanceTerm();
        return ["TaskCollection"];
    }

    if (
        matchTerms.messages.isFuzzyMatch(state.term) ||
        matchTerms.comments.isFuzzyMatch(state.term)
    ) {
        state.advanceTerm();

        return ["ChatMessage", "DocumentComment", "PostComment"];
    }

    return null;
}

/**
 * If we have a Fuse.js score below this when parsing a name then we consider
 * the name a match.
 */
export const accountNameFuseScoreMatchCutoff = 0.3;

/**
 * Try parsing a matching account name from our current location in the parser
 * state. First we see if there's a full name match (2-3 words). If there's no
 * match then we see if there's a short name match.
 */
function parseAccountsIfPossible(
    state: SearchNaturalLanguageParserState,
    {
        accountNameIndex,
    }: {
        accountNameIndex: {
            searchNames(queryText: string): Array<{item: AccountModel; score: number}>;
            searchShortNames(queryText: string): Array<{item: AccountModel; score: number}>;
        };
    },
): ReadonlyArray<AccountModel> | null {
    if (!state.term?.tags?.has("Noun")) return null;

    const name1 = state.term.text;

    const name2 = state.terms[state.termIndex + 1]?.tags?.has("Noun")
        ? `${name1} ${state.terms[state.termIndex + 1]!.text}`
        : null;

    const name3 =
        name2 !== null && state.terms[state.termIndex + 2]?.tags?.has("Noun")
            ? `${name2} ${state.terms[state.termIndex + 2]!.text}`
            : null;

    // Try searching the most specific name first. So we search "Emily Lin"
    // not "Emily".
    if (name3 !== null) {
        const results = accountNameIndex
            .searchNames(name3)
            .filter(result => result.score < accountNameFuseScoreMatchCutoff);

        if (results.length > 0) {
            state.advanceTerm();
            state.advanceTerm();
            state.advanceTerm();

            return results.map(({item}) => item);
        }
    }

    if (name2 !== null) {
        const results = accountNameIndex
            .searchNames(name2)
            .filter(result => result.score < accountNameFuseScoreMatchCutoff);

        if (results.length > 0) {
            state.advanceTerm();
            state.advanceTerm();

            return results.map(({item}) => item);
        }
    }

    {
        const results = accountNameIndex
            .searchNames(name1)
            .filter(result => result.score < accountNameFuseScoreMatchCutoff);

        if (results.length > 0) {
            state.advanceTerm();

            return results.map(({item}) => item);
        }
    }

    // Try searching short names if we didn't find a full name match.
    {
        const results = accountNameIndex
            .searchShortNames(name1)
            .filter(result => result.score < accountNameFuseScoreMatchCutoff);

        if (results.length > 0) {
            state.advanceTerm();

            return results.map(({item}) => item);
        }
    }

    return null;
}
