import nlp from "compromise";
import levenshtein from "damerau-levenshtein";
import {stemmer} from "stemmer";
import {AccountModel} from "~/shared/accounts/account_model.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.js";
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
    "my",
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
    readonly level: "Creator" | "CreatorOrMajorContributor" | "AnyContributor";
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

    // Iterate through each clause independently.
    for (const terms of doc.clauses().docs) {
        const {filters: currentFilters, controlPhrases: currentControlPhrases} =
            parseSearchNaturalLanguageFilters(doc, terms, options);

        for (const filter of currentFilters) {
            filters.push(filter);
        }

        for (const controlPhrase of currentControlPhrases) {
            controlPhrases.push(controlPhrase);
        }
    }

    const docWithoutControl = doc.clone();
    const controlDoc = nlp("");

    // Remove all control phrases from our original search query. We remove control
    // phrases in reverse so we don't move indexes in a way that makes it hard to
    // remove the next phrase.
    for (const controlPhrase of [...controlPhrases].reverse()) {
        docWithoutControl.remove(controlPhrase);
    }

    // Add all control phrases to a separate doc.
    for (const controlPhrase of controlPhrases) {
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
        const startTerm = state.term;

        // Add the terms from the start of this loop to where we parsed as a
        // "control phrase". Control phrases we remove from the search query so they
        // don't participate in text matching. Instead we filter based on whatever
        // instruction was in the control phrase.
        //
        // For example: "train documents by john" turns into a keyword search for
        // "train" and a filter for entity types of "document" by the account with the
        // name "john".
        const addControlPhrase = () => {
            const endTerm = assertExists(state.terms[state.termIndex - 1]);

            addSpecificControlPhrase(startTerm, endTerm);
        };

        const addSpecificControlPhrase = (startTerm: Term, endTerm: Term) => {
            assert(startTerm.index && endTerm.index);
            assert(startTerm.index[0] === endTerm.index[0]);

            const pointer: Pointer = [
                startTerm.index[0],
                startTerm.index[1],
                endTerm.index[1]! + 1,
                startTerm.id,
                endTerm.id,
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
                const accounts = parseAccountsByNameIfPossible(state, options);
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
                        level: "CreatorOrMajorContributor",
                    });
                    continue;
                }

                // e.g. "documents written by john" or "posts authored by sara smith"
                const accounts = parseAccountsByNameIfPossible(state, options);
                if (accounts) {
                    // e.g. "documents written by john about..."
                    if (matchTerms.about.isFuzzyMatch(state.term)) state.advanceTerm();

                    addControlPhrase();

                    filters.push({
                        accountIds: accounts.map(account => account.id),
                        entityTypes,
                        level: "CreatorOrMajorContributor",
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
                const accounts = parseAccountsByNameIfPossible(state, options);
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
                        level: "CreatorOrMajorContributor",
                    });
                    continue;
                }

                // e.g. "documents by john" or "messages from sara smith"
                const accounts = parseAccountsByNameIfPossible(state, options);
                if (accounts) {
                    // e.g. "documents by john about..."
                    if (matchTerms.about.isFuzzyMatch(state.term)) state.advanceTerm();

                    addControlPhrase();

                    filters.push({
                        accountIds: accounts.map(account => account.id),
                        entityTypes,
                        level: "CreatorOrMajorContributor",
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
                    level: "CreatorOrMajorContributor",
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

            const accounts = parseAccountsByNameIfPossible(state, options);
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
                        level: "CreatorOrMajorContributor",
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

        // e.g. "my..."
        if (matchTerms.my.isFuzzyMatch(state.term)) {
            const myTerm = state.advanceTerm();

            // e.g. "my documents" or "my messages"
            const entityTypes = parseSearchEntityTypesIfPossible(state);
            if (entityTypes) {
                // e.g. "my messages about..."
                if (matchTerms.about.isFuzzyMatch(state.term)) state.advanceTerm();

                addControlPhrase();

                filters.push({
                    accountIds: [actorAccountId],
                    entityTypes,
                    level: "CreatorOrMajorContributor",
                });
                continue;
            }

            if (myTerm.chunk === "Noun") {
                let shouldContinue = false;

                // e.g. "my ... documents"
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
                while (state.term && state.term.chunk === "Noun") {
                    const firstEntityTypesTerm = state.term;

                    const entityTypes = parseSearchEntityTypesIfPossible(state);
                    if (entityTypes) {
                        // e.g. "john's documents about..."
                        if (matchTerms.about.isFuzzyMatch(state.term)) state.advanceTerm();

                        const lastEntityTypesTerm = assertExists(state.terms[state.termIndex - 1]);

                        addSpecificControlPhrase(startTerm, myTerm);
                        addSpecificControlPhrase(firstEntityTypesTerm, lastEntityTypesTerm);

                        filters.push({
                            accountIds: [actorAccountId],
                            entityTypes,
                            level: "CreatorOrMajorContributor",
                        });
                        shouldContinue = true;
                        break;
                    }

                    state.advanceTerm();
                }

                if (shouldContinue) continue;
            }

            // No match, try parsing the next term.
            continue;
        }

        // e.g. "john's..." or "sara smith's..."
        const accounts = parseAccountsByNameIfPossible(state, options);
        if (accounts) {
            // e.g. "john's documents" or "sara smith's messages"
            const entityTypes = parseSearchEntityTypesIfPossible(state);
            if (entityTypes) {
                // e.g. "john's documents about..."
                if (matchTerms.about.isFuzzyMatch(state.term)) state.advanceTerm();

                addControlPhrase();

                filters.push({
                    accountIds: accounts.map(account => account.id),
                    entityTypes,
                    level: "CreatorOrMajorContributor",
                });
                continue;
            }

            const lastAccountNameTerm = assertExists(state.terms[state.termIndex - 1]);
            if (lastAccountNameTerm.chunk === "Noun") {
                let shouldContinue = false;

                // e.g. "john's ... documents"
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
                //
                // NOTE(calebmer): More often then we'd like it looks like compromise is
                // treating "john's" as "john has" instead of the possessive form of "john".
                // For example in "john's closed tasks". The code that disambiguates `'s` may
                // need to be updated.
                //
                // Disambiguating code:
                // https://github.com/spencermountain/compromise/blob/4ef66b3e5798c63f3f0f3b7935ffae1597b6dd3b/src/2-two/contraction-two/compute/isPossessive.js#L45-L56
                //
                // Issue asking for guidance:
                // https://github.com/spencermountain/compromise/issues/1074
                while (state.term && state.term.chunk === "Noun") {
                    const firstEntityTypesTerm = state.term;

                    const entityTypes = parseSearchEntityTypesIfPossible(state);
                    if (entityTypes) {
                        // e.g. "john's documents about..."
                        if (matchTerms.about.isFuzzyMatch(state.term)) state.advanceTerm();

                        const lastEntityTypesTerm = assertExists(state.terms[state.termIndex - 1]);

                        addSpecificControlPhrase(startTerm, lastAccountNameTerm);
                        addSpecificControlPhrase(firstEntityTypesTerm, lastEntityTypesTerm);

                        filters.push({
                            accountIds: accounts.map(account => account.id),
                            entityTypes,
                            level: "CreatorOrMajorContributor",
                        });
                        shouldContinue = true;
                        break;
                    }

                    state.advanceTerm();
                }

                if (shouldContinue) continue;
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
function parseAccountsByNameIfPossible(
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

/**
 * Stems a possessive english string. Converts "John's" to "John". Adapted from
 * a [Lucene token filter of the same name][1].
 *
 * [1]: https://github.com/apache/lucene/blob/5d6086e1994d766a3dd39a47b14a8cd80a7280e6/lucene/analysis/common/src/java/org/apache/lucene/analysis/en/EnglishPossessiveFilter.java#L32-L50
 */
function stemEnglishPossessive(text: string): string {
    if (
        text.length >= 2 &&
        (text[text.length - 2] === "'" ||
            text[text.length - 2] === "\u2019" ||
            text[text.length - 2] === "\uFF07") &&
        (text[text.length - 1] === "s" || text[text.length - 1] === "S")
    ) {
        text = text.slice(0, -2);
    }

    return text;
}
