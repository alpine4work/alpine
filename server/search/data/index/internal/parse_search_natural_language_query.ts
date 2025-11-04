import nlp from "compromise";
import nlpDatePlugin from "compromise-dates";
import levenshtein from "damerau-levenshtein";
import {stemmer} from "stemmer";
import {SpaceAccountNameSearchIndex} from "~/server/spaces/spaces_actions.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.js";
import {DateString} from "~/shared/helpers/date/date_string.js";
import {TimeZone} from "~/shared/helpers/intl/time_zone.js";
import {getOrSetDefaultMapValue} from "~/shared/helpers/map/get_or_set_default_map_value.js";
import {AccountId} from "~/shared/id/types/id_types.js";
import {SearchDynamicEntityIdObject} from "~/shared/search/search_entity_id.js";
import {AccountModel} from "~/shared/spaces/account_model.js";

nlp.plugin(nlpDatePlugin);

type View = ReturnType<(typeof nlp)["tokenize"]>;
type Term = View["docs"][number][number];
type Pointer = View["fullPointer"][number];

function createView(doc: View, startTerm: Term, endTerm: Term): View {
    assert(startTerm.index && endTerm.index);
    assert(startTerm.index[0] === endTerm.index[0]);

    const pointer: Pointer = [
        startTerm.index[0],
        startTerm.index[1],
        endTerm.index[1]! + 1,
        startTerm.id,
        endTerm.id,
    ];

    return (doc as any).toView([pointer]);
}

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

        // Don't consider fuzzy matches for "chat". "Cat" and "hat" would be considered
        // matches which are both common words in their own right.
        if (this._text === "chat") {
            return this._text === termText;
        }

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
    "my",
    "last",
    "before",
    "after",
    "and",
    "that",
    "were",
    "recently",
    "all",
    "of",
    "person",
    "people",
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
    public readonly doc: View;
    public readonly terms: ReadonlyArray<Term>;
    public readonly term: Term | null;
    public readonly termIndex = 0;

    constructor(doc: View, terms: ReadonlyArray<Term>) {
        this.doc = doc;
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

class SearchNaturalLanguageParserResult {
    private readonly _filters: Array<SearchNaturalLanguageFilter> = [];
    public isLowConfidence = true;

    public addFilter(filter: SearchNaturalLanguageFilter) {
        // We have low confidence the user wants natural language filters if every
        // filter we parsed only filters on `entityTypes`. These are queries like
        // "train documents" or simply "channels".
        //
        // When we have low confidence natural language filters, we still apply the
        // filters but we don't rank them as highly.
        this.isLowConfidence &&= filter.account === null && filter.time === null;

        this._filters.push(filter);
    }

    public getFilters(): ReadonlyArray<SearchNaturalLanguageFilter> {
        return this._filters;
    }
}

/**
 * The machine representation of a filter described in natural language.
 * For example "messages sent by sara recently" or "my documents".
 *
 * The way it works is we `AND` together each top-level key. So
 * `entityTypes AND accounts AND time`. We `OR` together individual values
 * within each. So one of the `accounts.ids` fields should match, not all of
 * them.
 *
 * If we parse multiple filters from a query string then all the filters are
 * `OR`d together.
 */
export type SearchNaturalLanguageFilter = {
    readonly entityTypes: ReadonlyArray<SearchDynamicEntityIdObject["type"]>;
    readonly account: {
        readonly field: "Creator" | "MajorContributor" | "AnyContributor";
        readonly accounts: ReadonlyArray<{readonly id: AccountId; readonly name: string}>;
    } | null;
    readonly time: {
        readonly field: "Created" | "LastUpdated";
        readonly range:
            | {readonly inclusiveUpperBoundDate: Date; readonly inclusiveLowerBoundDate: Date}
            | {readonly inclusiveUpperBoundDate: Date; readonly inclusiveLowerBoundDate: null}
            | {readonly inclusiveUpperBoundDate: null; readonly inclusiveLowerBoundDate: Date};
    } | null;
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
 *
 * Right now, English is the only supported language.
 */
export function parseSearchNaturalLanguageQuery(
    queryText: string,
    options: {
        timeZone: TimeZone;
        currentTime: Date;
        // NOTE(ifitzsimmons, #2025-10-10): A null account ID will disable *all* natural
        // language parsing of "my" search queries that reference the actor.
        // `actorAccountId` should always be null for Bots, since "ChatGPT's docs" or
        // "ChatGPT's tasks" doesn't really make sense.
        actorAccount: {id: AccountId; name: string} | null;
        accountNameIndex: SpaceAccountNameSearchIndex;
    },
): {
    queryTexts: ReadonlyArray<string>;
    controlQueryTexts: ReadonlyArray<string>;
    filters: ReadonlyArray<SearchNaturalLanguageFilter>;
    isLowConfidence: boolean;
} {
    const doc = nlp(queryText);

    let isLowConfidence = true;
    const filters: Array<SearchNaturalLanguageFilter> = [];
    const controlPhrases: Array<View> = [];

    // Iterate through each clause independently.
    for (const terms of doc.clauses().docs) {
        const {
            isLowConfidence: currentIsLowConfidence,
            filters: currentFilters,
            controlPhrases: currentControlPhrases,
        } = parseSearchNaturalLanguageFilters(doc, terms, options);

        isLowConfidence &&= currentIsLowConfidence;

        for (const filter of currentFilters) {
            filters.push(filter);
        }

        for (const controlPhrase of currentControlPhrases) {
            controlPhrases.push(controlPhrase);
        }
    }

    const queryTexts: Array<string> = [];
    const controlQueryTexts: Array<string> = [];

    // Remove all control phrases from our original search query. We remove control
    // phrases in reverse so we don't move indexes in a way that makes it hard to
    // remove the next phrase.
    for (const controlPhrase of [...controlPhrases].reverse()) {
        const controlPhraseAndAfter = controlPhrase.growRight("*");

        controlQueryTexts.push(controlPhrase.text().trim());

        const queryText = controlPhraseAndAfter.clone().remove(controlPhrase).text().trim();
        if (queryText.length > 0) queryTexts.push(queryText);

        doc.remove(controlPhraseAndAfter);
    }

    const lastQueryText = doc.text().trim();
    if (lastQueryText.length > 0) queryTexts.push(lastQueryText);

    queryTexts.reverse();
    controlQueryTexts.reverse();

    return {
        queryTexts,
        controlQueryTexts,
        filters,
        isLowConfidence: filters.length > 0 ? isLowConfidence : false,
    };
}

/**
 * Parse natural language filters from a list of `compromise` terms.
 */
function parseSearchNaturalLanguageFilters(
    doc: View,
    terms: ReadonlyArray<Term>,
    options: {
        timeZone: TimeZone;
        currentTime: Date;
        actorAccount: {readonly id: AccountId; readonly name: string} | null;
        accountNameIndex: SpaceAccountNameSearchIndex;
    },
): {
    filters: ReadonlyArray<SearchNaturalLanguageFilter>;
    controlPhrases: ReadonlyArray<View>;
    isLowConfidence: boolean;
} {
    const {actorAccount} = options;

    const state = new SearchNaturalLanguageParserState(doc, terms);
    const result = new SearchNaturalLanguageParserResult();
    const controlPhrases: Array<View> = [];

    while (state.term) {
        const startTerm = state.term;

        // Add the terms from the start of this loop to where we parsed as a
        // "control phrase". Control phrases we remove from the search query so they
        // don't participate in text matching. Instead we filter based on whatever
        // instruction was in the control phrase.
        //
        // For example: "train documents by john" turns into a keyword search for
        // "train" and a filter for entity types of "document" by the account with the
        // name "john".
        const addControlPhrase = (startTerm: Term, endTerm: Term) => {
            controlPhrases.push(createView(doc, startTerm, endTerm));
        };

        // e.g. "documents...", "messages...", or "tasks..."
        const entityTypes = parseSearchEntityTypesIfPossible(state);
        if (entityTypes) {
            const lastEntityTypesTerm = assertExists(state.terms[state.termIndex - 1]);

            const {filterStartTerm, filterEndTerm, filter} =
                parseSearchNaturalLanguageFilterModifiers(
                    state,
                    {
                        filterStartTerm: startTerm,
                        filterEndTerm: lastEntityTypesTerm,
                        filter: {
                            entityTypes,
                            account: null,
                            time: null,
                        },
                        allowAccount: true,
                        allowTime: true,
                        isFirstModifier: true,
                    },
                    options,
                );

            let actualFilterEndTerm = filterEndTerm;

            // e.g. "documents about" or "messages from sara last week about"
            if (
                filterEndTerm === state.terms[state.termIndex - 1] &&
                matchTerms.about.isFuzzyMatch(state.term)
            ) {
                actualFilterEndTerm = state.advanceTerm();
            }

            addControlPhrase(filterStartTerm, actualFilterEndTerm);

            result.addFilter(filter);
            continue;
        }

        const advanceNounChunkAttemptingToParseEntityTypes = (
            partialFilter: Omit<SearchNaturalLanguageFilter, "entityTypes">,
        ): {hasAddedFilter: boolean} => {
            const lastTerm = state.terms[state.termIndex - 1];

            if (
                !lastTerm ||
                (lastTerm.chunk !== "Noun" &&
                    // "all" is part of the adjective chunk. If "all" is followed by a noun chunk
                    // then we're happy.
                    !matchTerms.all.isFuzzyMatch(lastTerm))
            ) {
                return {hasAddedFilter: false};
            }

            // e.g. "my ... documents" or "john's ... documents"
            //
            // We allow this form to support queries like "john's train documents" or
            // "sara's closed tasks" which sound very natural. The way this works is we
            // allow any terms between the account name and entity type as long as
            // they're all part of the same `Noun` chunk (as determined by `compromise`).
            //
            // [Chunks represents parts of a sentence][1] (e.g. noun phrase and
            // verb phrase).
            //
            // [1]: https://github.com/spencermountain/compromise/blob/4ef66b3e5798c63f3f0f3b7935ffae1597b6dd3b/src/3-three/chunker/api/chunks.js#L1
            while (state.term) {
                const firstEntityTypesTerm = state.term;

                const entityTypes = parseSearchEntityTypesIfPossible(state);
                if (entityTypes) {
                    const {filterStartTerm, filterEndTerm, filter} =
                        parseSearchNaturalLanguageFilterModifiers(
                            state,
                            {
                                filterStartTerm: firstEntityTypesTerm,
                                filterEndTerm: assertExists(state.terms[state.termIndex - 1]),
                                filter: {
                                    ...partialFilter,
                                    entityTypes,
                                },
                                allowAccount: partialFilter.account === null,
                                allowTime: partialFilter.time === null,
                                isFirstModifier: true,
                            },
                            options,
                        );

                    let actualFilterEndTerm = filterEndTerm;

                    // e.g. "john's documents about"
                    if (
                        filterEndTerm === state.terms[state.termIndex - 1] &&
                        matchTerms.about.isFuzzyMatch(state.term)
                    ) {
                        actualFilterEndTerm = state.advanceTerm();
                    }

                    addControlPhrase(startTerm, lastTerm);
                    addControlPhrase(filterStartTerm, actualFilterEndTerm);

                    result.addFilter(filter);
                    return {hasAddedFilter: true};
                }

                if (state.term.chunk === "Noun") {
                    state.advanceTerm();
                } else {
                    break;
                }
            }

            return {hasAddedFilter: false};
        };

        // e.g. "all..."
        if (matchTerms.all.isFuzzyMatch(state.term)) {
            state.advanceTerm();

            // e.g. "all of..."
            if (matchTerms.of.isFuzzyMatch(state.term)) {
                state.advanceTerm();

                // Intentionally fallthrough! So we can parse "all of my..." or "all of
                // john's..."
            } else {
                // e.g. "all documents" or "all messages"
                const entityTypes = parseSearchEntityTypesIfPossible(state);
                if (entityTypes) {
                    const {filterStartTerm, filterEndTerm, filter} =
                        parseSearchNaturalLanguageFilterModifiers(
                            state,
                            {
                                filterStartTerm: startTerm,
                                filterEndTerm: assertExists(state.terms[state.termIndex - 1]),
                                filter: {
                                    entityTypes,
                                    account: null,
                                    time: null,
                                },
                                allowAccount: true,
                                allowTime: true,
                                isFirstModifier: true,
                            },
                            options,
                        );

                    let actualFilterEndTerm = filterEndTerm;

                    // e.g. "my messages about"
                    if (
                        filterEndTerm === state.terms[state.termIndex - 1] &&
                        matchTerms.about.isFuzzyMatch(state.term)
                    ) {
                        actualFilterEndTerm = state.advanceTerm();
                    }

                    addControlPhrase(filterStartTerm, actualFilterEndTerm);

                    result.addFilter(filter);

                    // If we got a filter starting with "all" like "all documents" then we're
                    // confident the user wanted a natural language filter.
                    result.isLowConfidence = false;
                    continue;
                }

                const {hasAddedFilter} = advanceNounChunkAttemptingToParseEntityTypes({
                    account: null,
                    time: null,
                });
                if (hasAddedFilter) {
                    // If we got a filter starting with "all" like "all documents" then we're
                    // confident the user wanted a natural language filter.
                    result.isLowConfidence = false;
                }
                continue;
            }
        }

        // e.g. "my..."
        if (matchTerms.my.isFuzzyMatch(state.term)) {
            state.advanceTerm();
            if (!actorAccount) {
                // If we don't have an actor account then we can't parse a "my" query.
                // This is because we don't know who the user is. However, it's possible
                // that a Bot queries something like "Documents containing text my weekend
                // plans". In this case, we should just continue so the bot can search for
                // documents containing the text "my weekend plans".
                // In other words, we should no treat the term "my" as control text.
                continue;
            }

            // e.g. "my documents" or "my messages"
            const entityTypes = parseSearchEntityTypesIfPossible(state);
            if (entityTypes) {
                const {filterStartTerm, filterEndTerm, filter} =
                    parseSearchNaturalLanguageFilterModifiers(
                        state,
                        {
                            filterStartTerm: startTerm,
                            filterEndTerm: assertExists(state.terms[state.termIndex - 1]),
                            filter: {
                                entityTypes,
                                account: {
                                    field: "MajorContributor",
                                    accounts: [{id: actorAccount.id, name: actorAccount.name}],
                                },
                                time: null,
                            },
                            allowAccount: false,
                            allowTime: true,
                            isFirstModifier: true,
                        },
                        options,
                    );

                let actualFilterEndTerm = filterEndTerm;

                // e.g. "my messages about"
                if (
                    filterEndTerm === state.terms[state.termIndex - 1] &&
                    matchTerms.about.isFuzzyMatch(state.term)
                ) {
                    actualFilterEndTerm = state.advanceTerm();
                }

                addControlPhrase(filterStartTerm, actualFilterEndTerm);

                result.addFilter(filter);
                continue;
            }

            advanceNounChunkAttemptingToParseEntityTypes({
                account: {
                    field: "MajorContributor",
                    accounts: [{id: actorAccount.id, name: actorAccount.name}],
                },
                time: null,
            });
            continue;
        }

        // e.g. "john's..." or "sara smith's..."
        const accounts = parseAccountsByNameIfPossible(state, options);
        if (accounts) {
            // e.g. "john's documents" or "sara smith's messages"
            const entityTypes = parseSearchEntityTypesIfPossible(state);
            if (entityTypes) {
                const {filterStartTerm, filterEndTerm, filter} =
                    parseSearchNaturalLanguageFilterModifiers(
                        state,
                        {
                            filterStartTerm: startTerm,
                            filterEndTerm: assertExists(state.terms[state.termIndex - 1]),
                            filter: {
                                entityTypes,
                                account: {
                                    field: "MajorContributor",
                                    accounts: accounts.map(account => ({
                                        id: account.id,
                                        name: account.initialData.name,
                                    })),
                                },
                                time: null,
                            },
                            allowAccount: false,
                            allowTime: true,
                            isFirstModifier: true,
                        },
                        options,
                    );

                let actualFilterEndTerm = filterEndTerm;

                // e.g. "john's documents about"
                if (
                    filterEndTerm === state.terms[state.termIndex - 1] &&
                    matchTerms.about.isFuzzyMatch(state.term)
                ) {
                    actualFilterEndTerm = state.advanceTerm();
                }

                addControlPhrase(filterStartTerm, actualFilterEndTerm);

                result.addFilter(filter);
                continue;
            }

            advanceNounChunkAttemptingToParseEntityTypes({
                account: {
                    field: "MajorContributor",
                    accounts: accounts.map(account => ({
                        id: account.id,
                        name: account.initialData.name,
                    })),
                },
                time: null,
            });
            continue;
        }

        state.advanceTerm();
    }

    return {
        filters: result.getFilters(),
        controlPhrases,
        isLowConfidence: result.isLowConfidence,
    };
}

/**
 * Try to parse entity types like "document", "task", or "chat messages".
 */
function parseSearchEntityTypesIfPossible(
    state: SearchNaturalLanguageParserState,
): Array<SearchDynamicEntityIdObject["type"]> | null {
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

        // A search like "mobile tasks" should return the mobile task collection. Same
        // with something like "my onboarding tasks".
        return ["Task", "TaskCollection"];
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

    if (matchTerms.person.isFuzzyMatch(state.term) || matchTerms.people.isFuzzyMatch(state.term)) {
        state.advanceTerm();
        return ["Account"];
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
function parseAccountsByNameIfPossible(
    state: SearchNaturalLanguageParserState,
    {
        accountNameIndex,
    }: {
        accountNameIndex: SpaceAccountNameSearchIndex;
    },
): ReadonlyArray<AccountModel> | null {
    if (!state.term?.tags?.has("Noun")) return null;

    const name1 = stemEnglishPossessive(state.term.text);

    const name2 = state.terms[state.termIndex + 1]?.tags?.has("Noun")
        ? stemEnglishPossessive(`${name1} ${state.terms[state.termIndex + 1]!.text}`)
        : null;

    const name3 =
        name2 !== null && state.terms[state.termIndex + 2]?.tags?.has("Noun")
            ? stemEnglishPossessive(`${name2} ${state.terms[state.termIndex + 2]!.text}`)
            : null;

    // Try searching the most specific name first. So we search "Emily Lin"
    // not "Emily".
    if (name3 !== null) {
        const accounts = accountNameIndex.searchNames(name3);
        if (accounts.length > 0) {
            state.advanceTerm();
            state.advanceTerm();
            state.advanceTerm();

            return accounts;
        }
    }

    if (name2 !== null) {
        const accounts = accountNameIndex.searchNames(name2);

        if (accounts.length > 0) {
            state.advanceTerm();
            state.advanceTerm();

            return accounts;
        }
    }

    {
        const accounts = accountNameIndex.searchNames(name1);

        if (accounts.length > 0) {
            state.advanceTerm();

            return accounts;
        }
    }

    // Try searching short names if we didn't find a full name match.
    {
        const accounts = accountNameIndex.searchShortNames(name1);

        if (accounts.length > 0) {
            state.advanceTerm();

            return accounts;
        }
    }

    return null;
}

/**
 * Parse modifiers after parsing search entity nouns. For example
 * "documents..." or "messages...". Recursive since we may have multiple
 * modifiers. For example "documents created by me and updated last week".
 */
function parseSearchNaturalLanguageFilterModifiers(
    state: SearchNaturalLanguageParserState,
    {
        filterStartTerm,
        filterEndTerm,
        filter,
        allowAccount,
        allowTime,
        isFirstModifier,
    }: {
        filterStartTerm: Term;
        filterEndTerm: Term;
        filter: SearchNaturalLanguageFilter;
        allowAccount: boolean;
        allowTime: boolean;
        isFirstModifier: boolean;
    },
    options: {
        timeZone: TimeZone;
        currentTime: Date;
        actorAccount: {readonly id: AccountId; readonly name: string} | null;
        accountNameIndex: SpaceAccountNameSearchIndex;
    },
): {
    filterStartTerm: Term;
    filterEndTerm: Term;
    filter: SearchNaturalLanguageFilter;
} {
    if (!allowAccount && !allowTime) {
        return {filterStartTerm, filterEndTerm, filter};
    }

    const {actorAccount} = options;

    // e.g. "documents created by me and updated last month"
    if (!isFirstModifier && matchTerms.and.isFuzzyMatch(state.term)) {
        state.advanceTerm();

        // e.g. "documents created last year and were updated by me"
        if (matchTerms.were.isFuzzyMatch(state.term)) state.advanceTerm();
    }

    // e.g. "documents created last year that I updated"
    if (!isFirstModifier && matchTerms.that.isFuzzyMatch(state.term)) {
        state.advanceTerm();

        // e.g. "documents created last year that were updated by me"
        if (matchTerms.were.isFuzzyMatch(state.term)) state.advanceTerm();
    }

    // e.g. "documents created..." or "messages sent..."
    if (
        matchTerms.created.isFuzzyMatch(state.term) ||
        matchTerms.sent.isFuzzyMatch(state.term) ||
        matchTerms.posted.isFuzzyMatch(state.term)
    ) {
        state.advanceTerm();

        // e.g. "documents created by..." or "messages sent by..."
        if (allowAccount && matchTerms.by.isFuzzyMatch(state.term)) {
            state.advanceTerm();

            // e.g. "documents created by me" or "messages sent by me"
            if (matchTerms.me.isFuzzyMatch(state.term)) {
                if (!actorAccount) {
                    // If we don't have an actor account then we can't parse a "my" query.
                    // This is because we don't know who the user is. However, it's possible
                    // that a Bot queries something like "Documents containing text my weekend
                    // plans". In this case, we should just continue so the bot can search for
                    // documents containing the text "my weekend plans".
                    // In other words, we should no treat the term "my" as control text.
                    return {filterStartTerm, filterEndTerm, filter};
                }
                const endTerm = state.advanceTerm();

                return maybeContinueParseSearchNaturalLanguageFilterDateModifier(
                    state,
                    {
                        filterStartTerm,
                        filterEndTerm: endTerm,
                        filter: {
                            ...filter,
                            account: {
                                field: "Creator",
                                accounts: [{id: actorAccount.id, name: actorAccount.name}],
                            },
                        },
                        allowAccount: false,
                        allowTime,
                        field: "Created",
                    },
                    options,
                );
            }

            // e.g. "documents created by john" or "messages sent by sara smith"
            const accounts = parseAccountsByNameIfPossible(state, options);
            if (accounts) {
                return maybeContinueParseSearchNaturalLanguageFilterDateModifier(
                    state,
                    {
                        filterStartTerm,
                        filterEndTerm: assertExists(state.terms[state.termIndex - 1]),
                        filter: {
                            ...filter,
                            account: {
                                field: "Creator",
                                accounts: accounts.map(account => ({
                                    id: account.id,
                                    name: account.initialData.name,
                                })),
                            },
                        },
                        allowAccount: false,
                        allowTime,
                        field: "Created",
                    },
                    options,
                );
            }

            return {filterStartTerm, filterEndTerm, filter};
        }

        // e.g. "documents created before last week" or "messages sent yesterday"
        if (allowTime) {
            return continueParseSearchNaturalLanguageFilterDateModifier(
                state,
                {
                    filterStartTerm,
                    filterEndTerm,
                    filter,
                    allowAccount,
                    field: "Created",
                },
                options,
            );
        }

        return {filterStartTerm, filterEndTerm, filter};
    }

    // e.g. "documents written..." or "posts authored..."
    if (
        matchTerms.written.isFuzzyMatch(state.term) ||
        matchTerms.authored.isFuzzyMatch(state.term)
    ) {
        state.advanceTerm();

        // e.g. "documents written by..." or "posts authored by..."
        if (allowAccount && matchTerms.by.isFuzzyMatch(state.term)) {
            state.advanceTerm();

            // e.g. "documents written by me" or "posts authored by me"
            if (matchTerms.me.isFuzzyMatch(state.term)) {
                if (!actorAccount) {
                    // If we don't have an actor account then we can't parse a "my" query.
                    // This is because we don't know who the user is. However, it's possible
                    // that a Bot queries something like "Documents containing text my weekend
                    // plans". In this case, we should just continue so the bot can search for
                    // documents containing the text "my weekend plans".
                    // In other words, we should no treat the term "my" as control text.
                    return {filterStartTerm, filterEndTerm, filter};
                }
                const endTerm = state.advanceTerm();

                return maybeContinueParseSearchNaturalLanguageFilterDateModifier(
                    state,
                    {
                        filterStartTerm,
                        filterEndTerm: endTerm,
                        filter: {
                            ...filter,
                            account: {
                                field: "MajorContributor",
                                accounts: [{id: actorAccount.id, name: actorAccount.name}],
                            },
                        },
                        allowAccount: false,
                        allowTime,
                        field: "Created",
                    },
                    options,
                );
            }

            // e.g. "documents written by john" or "posts authored by sara smith"
            const accounts = parseAccountsByNameIfPossible(state, options);
            if (accounts) {
                return maybeContinueParseSearchNaturalLanguageFilterDateModifier(
                    state,
                    {
                        filterStartTerm,
                        filterEndTerm: assertExists(state.terms[state.termIndex - 1]),
                        filter: {
                            ...filter,
                            account: {
                                field: "MajorContributor",
                                accounts: accounts.map(account => ({
                                    id: account.id,
                                    name: account.initialData.name,
                                })),
                            },
                        },
                        allowAccount: false,
                        allowTime,
                        field: "Created",
                    },
                    options,
                );
            }

            return {filterStartTerm, filterEndTerm, filter};
        }

        // e.g. "documents written before last week" or "posts authored yesterday"
        if (allowTime) {
            return continueParseSearchNaturalLanguageFilterDateModifier(
                state,
                {
                    filterStartTerm,
                    filterEndTerm,
                    filter,
                    allowAccount,
                    field: "Created",
                },
                options,
            );
        }

        return {filterStartTerm, filterEndTerm, filter};
    }

    const isLastFuzzyMatch = matchTerms.last.isFuzzyMatch(state.term);

    // e.g. "documents updated..." or "tasks updated..."
    if (
        matchTerms.updated.isFuzzyMatch(state.term) ||
        matchTerms.modified.isFuzzyMatch(state.term) ||
        (isLastFuzzyMatch &&
            (matchTerms.updated.isFuzzyMatch(state.terms[state.termIndex + 1]) ||
                matchTerms.modified.isFuzzyMatch(state.terms[state.termIndex + 1])))
    ) {
        if (isLastFuzzyMatch) state.advanceTerm();
        state.advanceTerm();

        // e.g. "documents updated by..." or "tasks updated by..."
        if (allowAccount && matchTerms.by.isFuzzyMatch(state.term)) {
            state.advanceTerm();

            // e.g. "documents updated by me" or "tasks updated by me"
            if (matchTerms.me.isFuzzyMatch(state.term)) {
                if (!actorAccount) {
                    // If we don't have an actor account then we can't parse a "my" query.
                    // This is because we don't know who the user is. However, it's possible
                    // that a Bot queries something like "Documents containing text my weekend
                    // plans". In this case, we should just continue so the bot can search for
                    // documents containing the text "my weekend plans".
                    // In other words, we should no treat the term "my" as control text.
                    return {filterStartTerm, filterEndTerm, filter};
                }
                const endTerm = state.advanceTerm();

                return maybeContinueParseSearchNaturalLanguageFilterDateModifier(
                    state,
                    {
                        filterStartTerm,
                        filterEndTerm: endTerm,
                        filter: {
                            ...filter,
                            account: {
                                field: "AnyContributor",
                                accounts: [{id: actorAccount.id, name: actorAccount.name}],
                            },
                        },
                        allowAccount: false,
                        allowTime,
                        field: "LastUpdated",
                    },
                    options,
                );
            }

            // e.g. "documents updated by john" or "tasks updated by sara smith"
            const accounts = parseAccountsByNameIfPossible(state, options);
            if (accounts) {
                return maybeContinueParseSearchNaturalLanguageFilterDateModifier(
                    state,
                    {
                        filterStartTerm,
                        filterEndTerm: assertExists(state.terms[state.termIndex - 1]),
                        filter: {
                            ...filter,
                            account: {
                                field: "AnyContributor",
                                accounts: accounts.map(account => ({
                                    id: account.id,
                                    name: account.initialData.name,
                                })),
                            },
                        },
                        allowAccount: false,
                        allowTime,
                        field: "LastUpdated",
                    },
                    options,
                );
            }

            return {filterStartTerm, filterEndTerm, filter};
        }

        // e.g. "documents updated before last week" or "tasks updated yesterday"
        if (allowTime) {
            return continueParseSearchNaturalLanguageFilterDateModifier(
                state,
                {
                    filterStartTerm,
                    filterEndTerm,
                    filter,
                    allowAccount,
                    field: "LastUpdated",
                },
                options,
            );
        }

        return {filterStartTerm, filterEndTerm, filter};
    }

    const isFromFuzzyMatch = matchTerms.from.isFuzzyMatch(state.term);

    // e.g. "documents by..." or "messages from..."
    if (matchTerms.by.isFuzzyMatch(state.term) || isFromFuzzyMatch) {
        state.advanceTerm();

        // e.g. "documents by me" or "messages by me"
        if (allowAccount && matchTerms.me.isFuzzyMatch(state.term)) {
            if (!actorAccount) {
                // If we don't have an actor account then we can't parse a "my" query.
                // This is because we don't know who the user is. However, it's possible
                // that a Bot queries something like "Documents containing text my weekend
                // plans". In this case, we should just continue so the bot can search for
                // documents containing the text "my weekend plans".
                // In other words, we should no treat the term "my" as control text.
                return {filterStartTerm, filterEndTerm, filter};
            }
            state.advanceTerm();

            return maybeContinueParseSearchNaturalLanguageFilterDateModifier(
                state,
                {
                    filterStartTerm,
                    filterEndTerm: assertExists(state.terms[state.termIndex - 1]),
                    filter: {
                        ...filter,
                        account: {
                            field: "MajorContributor",
                            accounts: [{id: actorAccount.id, name: actorAccount.name}],
                        },
                    },
                    allowAccount: false,
                    allowTime,
                    field: "Created",
                },
                options,
            );
        }

        if (allowAccount) {
            // e.g. "documents by john" or "messages by sara smith"
            const accounts = parseAccountsByNameIfPossible(state, options);
            if (accounts) {
                return maybeContinueParseSearchNaturalLanguageFilterDateModifier(
                    state,
                    {
                        filterStartTerm,
                        filterEndTerm: assertExists(state.terms[state.termIndex - 1]),
                        filter: {
                            ...filter,
                            account: {
                                field: "MajorContributor",
                                accounts: accounts.map(account => ({
                                    id: account.id,
                                    name: account.initialData.name,
                                })),
                            },
                        },
                        allowAccount: false,
                        allowTime,
                        field: "Created",
                    },
                    options,
                );
            }
        }

        if (allowTime && isFromFuzzyMatch) {
            return continueParseSearchNaturalLanguageFilterDateModifier(
                state,
                {
                    filterStartTerm,
                    filterEndTerm,
                    filter,
                    allowAccount,
                    field: "Created",
                },
                options,
            );
        }

        return {filterStartTerm, filterEndTerm, filter};
    }

    // e.g. "documents I created" or "messages I sent"
    if (
        allowAccount &&
        matchTerms.i.isFuzzyMatch(state.term) &&
        (matchTerms.created.isFuzzyMatch(state.terms[state.termIndex + 1]) ||
            matchTerms.sent.isFuzzyMatch(state.terms[state.termIndex + 1]) ||
            matchTerms.posted.isFuzzyMatch(state.terms[state.termIndex + 1]))
    ) {
        if (!actorAccount) {
            // If we don't have an actor account then we can't parse a "my" query.
            // This is because we don't know who the user is. However, it's possible
            // that a Bot queries something like "Documents containing text my weekend
            // plans". In this case, we should just continue so the bot can search for
            // documents containing the text "my weekend plans".
            // In other words, we should no treat the term "my" as control text.
            return {filterStartTerm, filterEndTerm, filter};
        }
        state.advanceTerm();
        state.advanceTerm();

        return maybeContinueParseSearchNaturalLanguageFilterDateModifier(
            state,
            {
                filterStartTerm,
                filterEndTerm: assertExists(state.terms[state.termIndex - 1]),
                filter: {
                    ...filter,
                    account: {
                        field: "Creator",
                        accounts: [{id: actorAccount.id, name: actorAccount.name}],
                    },
                },
                allowAccount: false,
                allowTime,
                field: "Created",
            },
            options,
        );
    }

    // e.g. "documents I wrote" or "messages I authored"
    if (
        allowAccount &&
        matchTerms.i.isFuzzyMatch(state.term) &&
        (matchTerms.wrote.isFuzzyMatch(state.terms[state.termIndex + 1]) ||
            matchTerms.authored.isFuzzyMatch(state.terms[state.termIndex + 1]))
    ) {
        if (!actorAccount) {
            // If we don't have an actor account then we can't parse a "my" query.
            // This is because we don't know who the user is. However, it's possible
            // that a Bot queries something like "Documents containing text my weekend
            // plans". In this case, we should just continue so the bot can search for
            // documents containing the text "my weekend plans".
            // In other words, we should no treat the term "my" as control text.
            return {filterStartTerm, filterEndTerm, filter};
        }
        state.advanceTerm();
        state.advanceTerm();

        return maybeContinueParseSearchNaturalLanguageFilterDateModifier(
            state,
            {
                filterStartTerm,
                filterEndTerm: assertExists(state.terms[state.termIndex - 1]),
                filter: {
                    ...filter,
                    account: {
                        field: "MajorContributor",
                        accounts: [{id: actorAccount.id, name: actorAccount.name}],
                    },
                },
                allowAccount: false,
                allowTime,
                field: "Created",
            },
            options,
        );
    }

    // e.g. "documents I updated" or "tasks I updated"
    if (
        allowAccount &&
        matchTerms.i.isFuzzyMatch(state.term) &&
        (matchTerms.updated.isFuzzyMatch(state.terms[state.termIndex + 1]) ||
            matchTerms.modified.isFuzzyMatch(state.terms[state.termIndex + 1]))
    ) {
        if (!actorAccount) {
            // If we don't have an actor account then we can't parse a "my" query.
            // This is because we don't know who the user is. However, it's possible
            // that a Bot queries something like "Documents containing text my weekend
            // plans". In this case, we should just continue so the bot can search for
            // documents containing the text "my weekend plans".
            // In other words, we should no treat the term "my" as control text.
            return {filterStartTerm, filterEndTerm, filter};
        }
        state.advanceTerm();
        state.advanceTerm();

        return maybeContinueParseSearchNaturalLanguageFilterDateModifier(
            state,
            {
                filterStartTerm,
                filterEndTerm: assertExists(state.terms[state.termIndex - 1]),
                filter: {
                    ...filter,
                    account: {
                        field: "AnyContributor",
                        accounts: [{id: actorAccount.id, name: actorAccount.name}],
                    },
                },
                allowAccount: false,
                allowTime,
                field: "LastUpdated",
            },
            options,
        );
    }

    if (allowAccount) {
        const accounts = parseAccountsByNameIfPossible(state, options);
        if (accounts) {
            // e.g. "documents john created" or "messages sara smith sent"
            if (
                matchTerms.created.isFuzzyMatch(state.term) ||
                matchTerms.sent.isFuzzyMatch(state.term) ||
                matchTerms.posted.isFuzzyMatch(state.term)
            ) {
                state.advanceTerm();

                return maybeContinueParseSearchNaturalLanguageFilterDateModifier(
                    state,
                    {
                        filterStartTerm,
                        filterEndTerm: assertExists(state.terms[state.termIndex - 1]),
                        filter: {
                            ...filter,
                            account: {
                                field: "Creator",
                                accounts: accounts.map(account => ({
                                    id: account.id,
                                    name: account.initialData.name,
                                })),
                            },
                        },
                        allowAccount: false,
                        allowTime,
                        field: "Created",
                    },
                    options,
                );
            }

            // e.g. "documents john wrote" or "messages sara smith authored"
            if (
                matchTerms.wrote.isFuzzyMatch(state.term) ||
                matchTerms.authored.isFuzzyMatch(state.term)
            ) {
                state.advanceTerm();

                return maybeContinueParseSearchNaturalLanguageFilterDateModifier(
                    state,
                    {
                        filterStartTerm,
                        filterEndTerm: assertExists(state.terms[state.termIndex - 1]),
                        filter: {
                            ...filter,
                            account: {
                                field: "MajorContributor",
                                accounts: accounts.map(account => ({
                                    id: account.id,
                                    name: account.initialData.name,
                                })),
                            },
                        },
                        allowAccount: false,
                        allowTime,
                        field: "Created",
                    },
                    options,
                );
            }

            // e.g. "documents john updated" or "tasks sara smith updated"
            if (
                matchTerms.updated.isFuzzyMatch(state.term) ||
                matchTerms.modified.isFuzzyMatch(state.term)
            ) {
                state.advanceTerm();

                return maybeContinueParseSearchNaturalLanguageFilterDateModifier(
                    state,
                    {
                        filterStartTerm,
                        filterEndTerm: assertExists(state.terms[state.termIndex - 1]),
                        filter: {
                            ...filter,
                            account: {
                                field: "AnyContributor",
                                accounts: accounts.map(account => ({
                                    id: account.id,
                                    name: account.initialData.name,
                                })),
                            },
                        },
                        allowAccount: false,
                        allowTime,
                        field: "LastUpdated",
                    },
                    options,
                );
            }
        }
    }

    return {filterStartTerm, filterEndTerm, filter};
}

function maybeContinueParseSearchNaturalLanguageFilterDateModifier(
    state: SearchNaturalLanguageParserState,
    {
        filterStartTerm,
        filterEndTerm,
        filter,
        allowAccount,
        allowTime,
        field,
    }: {
        filterStartTerm: Term;
        filterEndTerm: Term;
        filter: SearchNaturalLanguageFilter;
        allowAccount: boolean;
        allowTime: boolean;
        field: "Created" | "LastUpdated";
    },
    options: {
        timeZone: TimeZone;
        currentTime: Date;
        actorAccount: {readonly id: AccountId; readonly name: string} | null;
        accountNameIndex: SpaceAccountNameSearchIndex;
    },
) {
    if (allowTime) {
        return continueParseSearchNaturalLanguageFilterDateModifier(
            state,
            {
                filterStartTerm,
                filterEndTerm,
                filter,
                allowAccount,
                field,
            },
            options,
        );
    } else {
        return parseSearchNaturalLanguageFilterModifiers(
            state,
            {
                filterStartTerm,
                filterEndTerm,
                filter,
                allowAccount,
                allowTime: false,
                isFirstModifier: false,
            },
            options,
        );
    }
}

function continueParseSearchNaturalLanguageFilterDateModifier(
    state: SearchNaturalLanguageParserState,
    {
        filterStartTerm,
        filterEndTerm,
        filter,
        allowAccount,
        field,
    }: {
        filterStartTerm: Term;
        filterEndTerm: Term;
        filter: SearchNaturalLanguageFilter;
        allowAccount: boolean;
        field: "Created" | "LastUpdated";
    },
    options: {
        timeZone: TimeZone;
        currentTime: Date;
        actorAccount: {readonly id: AccountId; readonly name: string} | null;
        accountNameIndex: SpaceAccountNameSearchIndex;
    },
): {
    filterStartTerm: Term;
    filterEndTerm: Term;
    filter: SearchNaturalLanguageFilter;
} {
    const {timeZone, currentTime} = options;

    // e.g. "documents updated recently"
    if (matchTerms.recently.isFuzzyMatch(state.term)) {
        state.advanceTerm();

        return parseSearchNaturalLanguageFilterModifiers(
            state,
            {
                filterStartTerm,
                filterEndTerm: assertExists(state.terms[state.termIndex - 1]),
                filter: {
                    ...filter,
                    time: {
                        field,
                        range: {
                            // We arbitrarily decide that "recently" means 3 days ago until now. Ideally
                            // we'd sort by recency as well.
                            inclusiveLowerBoundDate: new Date(
                                currentTime.getTime() - 3 * (1000 * 60 * 60 * 24),
                            ),
                            inclusiveUpperBoundDate: null,
                        },
                    },
                },
                allowAccount,
                allowTime: false,
                isFirstModifier: false,
            },
            options,
        );
    }

    const startTerm = state.term;

    let direction: "Before" | "After" | null = null;

    // e.g. "...before..."
    if (matchTerms.before.isFuzzyMatch(state.term)) {
        state.advanceTerm();
        direction = "Before";
    }
    // e.g. "...after..."
    else if (matchTerms.after.isFuzzyMatch(state.term)) {
        state.advanceTerm();
        direction = "After";
    }

    if (
        !state.term?.tags?.has("Date") ||
        // "from" is tagged as `Date` but `compromise-date` can't parse it. We do,
        // however, need "from" in `parseSearchNaturalLanguageFilterModifiers()`.
        state.term.normal === "from"
    ) {
        // We parsed some terms expecting a date but there was no date!
        if (startTerm !== state.term) return {filterStartTerm, filterEndTerm, filter};

        return parseSearchNaturalLanguageFilterModifiers(
            state,
            {
                filterStartTerm,
                filterEndTerm,
                filter,
                allowAccount,
                // `allowTime` is `true` because we haven't parsed a time yet.
                allowTime: true,
                isFirstModifier: false,
            },
            options,
        );
    }

    const dateStartTerm = state.term;

    // Consume the terms the `compromise-date` plugin tags as `Date`...
    while (state.term?.tags?.has("Date")) {
        state.advanceTerm();
    }

    const dateEndTerm = assertExists(state.terms[state.termIndex - 1]);

    // Remove any surrounding context that could confuse the date parser.
    const dateDoc = nlp(createView(state.doc, dateStartTerm, dateEndTerm).text());

    // Parse the date text so we can use it as a filter.
    const parsedDate = (dateDoc as any).dates({timezone: timeZone, today: currentTime}).get()[0] as
        | {start: DateString | null; end: DateString | null; timezone: TimeZone}
        | undefined;

    if (!parsedDate || !parsedDate.start || !parsedDate.end)
        return {filterStartTerm, filterEndTerm, filter};

    let startDate = new Date(parsedDate.start);
    let endDate = new Date(parsedDate.end);
    const durationMs = endDate.getTime() - startDate.getTime();

    switch (direction) {
        case null: {
            const midDate = new Date(startDate.getTime() + durationMs / 2);

            const dayMs = 1000 * 60 * 60 * 24;

            // When the user targets a specific point in time like "2 hours ago", "2 days
            // ago", or "2 months ago" it's unlikely they mean the exact time 2
            // hours/days/months ago. So add some slop duration to our time filter. The
            // slop duration gets larger the further in the past the time the user
            // specifies is based on the hypothesis that the user's memory gets fuzzier the
            // further in the past we're looking for an entity.
            const slopDurationMs =
                getSlopDurationDays((currentTime.getTime() - midDate.getTime()) / dayMs) * dayMs;

            if (slopDurationMs > durationMs) {
                startDate = new Date(startDate.getTime() - (slopDurationMs - durationMs) / 2);
                endDate = new Date(endDate.getTime() + (slopDurationMs - durationMs) / 2);
            }

            return parseSearchNaturalLanguageFilterModifiers(
                state,
                {
                    filterStartTerm,
                    filterEndTerm: assertExists(state.terms[state.termIndex - 1]),
                    filter: {
                        ...filter,
                        time: {
                            field,
                            range: {
                                inclusiveLowerBoundDate: startDate,
                                inclusiveUpperBoundDate: endDate,
                            },
                        },
                    },
                    allowAccount,
                    allowTime: false,
                    isFirstModifier: false,
                },
                options,
            );
        }
        case "After": {
            return parseSearchNaturalLanguageFilterModifiers(
                state,
                {
                    filterStartTerm,
                    filterEndTerm: assertExists(state.terms[state.termIndex - 1]),
                    filter: {
                        ...filter,
                        time: {
                            field,
                            range: {
                                inclusiveLowerBoundDate: startDate,
                                inclusiveUpperBoundDate: null,
                            },
                        },
                    },
                    allowAccount,
                    allowTime: false,
                    isFirstModifier: false,
                },
                options,
            );
        }
        case "Before": {
            return parseSearchNaturalLanguageFilterModifiers(
                state,
                {
                    filterStartTerm,
                    filterEndTerm: assertExists(state.terms[state.termIndex - 1]),
                    filter: {
                        ...filter,
                        time: {
                            field,
                            range: {
                                inclusiveLowerBoundDate: null,
                                inclusiveUpperBoundDate: endDate,
                            },
                        },
                    },
                    allowAccount,
                    allowTime: false,
                    isFirstModifier: false,
                },
                options,
            );
        }
        default:
            throw exhaustive(direction);
    }
}

/**
 * Stems a possessive english string. Converts "John's" to "John". Adapted from
 * a [Lucene token filter of the same name][1].
 *
 * [1]: https://github.com/apache/lucene/blob/5d6086e1994d766a3dd39a47b14a8cd80a7280e6/lucene/analysis/common/src/java/org/apache/lucene/analysis/en/EnglishPossessiveFilter.java#L32-L50
 */
function stemEnglishPossessive(text: string): string {
    if (
        text.length >= 2 &&
        // eslint-disable-next-line string-quotes
        (text[text.length - 2] === "'" ||
            text[text.length - 2] === "\u2019" ||
            text[text.length - 2] === "\uFF07") &&
        (text[text.length - 1] === "s" || text[text.length - 1] === "S")
    ) {
        text = text.slice(0, -2);
    }

    return text;
}

/**
 * Model returning a slop duration (measured in days) based on the input
 * duration (measured in days).
 *
 * When the user targets a date with natural language (e.g. "5 days ago") we
 * add some slop around the date since it's unlikely they're targeting the
 * exact date. We add more slop the further the time is in the past under the
 * assumption the user's memory gets fuzzier the further away from the date
 * we are.
 *
 * This model is based on a cubic regression of the following data points:
 *
 * - (5 minutes, 5 minutes)
 * - (2 hours, 30 minutes)
 * - (1 day, 1 hour)
 * - (5 days, 1 day)
 * - (60 days, 30 days)
 * - (90 days, 30 days)
 *
 * The model is clamped to a maximum of 30 days.
 */
function getSlopDurationDays(x: number): number {
    // Negative/positive durations produce the same result.
    x = Math.abs(x);

    // Where we intersect with y = 30. Higher x values should not go back down.
    x = Math.min(x, 60);

    const y = 0.025945 + 0.135694 * x + 0.013839 * x ** 2 - 0.000129 * x ** 3;

    return Math.min(y, 30);
}
