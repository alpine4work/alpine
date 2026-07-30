import {CalendarDate, parseAbsolute, toCalendarDate} from "@internationalized/date";
import nlp from "compromise";
import nlpDatePlugin from "compromise-dates";
import levenshtein from "damerau-levenshtein";
import {stemmer} from "stemmer";
import {
    SearchEntityIndexActivenessType,
    SearchEntityIndexOpennessType,
    SearchEntityIndexPriorityType,
} from "~/server/search/data/index/internal/search_entity_index_doc.js";
import {SpaceAccountNameSearchIndex} from "~/server/spaces/get_space_account_name_search_index.js";
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
 * Helper for fuzzy matching individual terms. Lower cases and stems text before
 * comparing edit distance (levenshtein with transposition). Stems so that we can
 * match both plural and singular forms with the same term.
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
        // matches which are both common words in their own right. Same goes for "site" —
        // "side", "size", "sits" are all within one edit and would cause false matches.
        if (this._text === "chat" || this._text === "site") {
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
    "sites",
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
    "opened",
    "about",
    "i",
    "my",
    "last",
    "before",
    "after",
    "and",
    "that",
    "were",
    "are",
    "not",
    "recently",
    "all",
    "of",
    "person",
    "people",
    // Priority modifiers
    "urgent",
    "high",
    "medium",
    "low",
    "priority",
    "severity",
    "important",
    "critical",
    // Openness modifiers
    "open",
    "pending",
    "todo",
    "closed",
    "done",
    "finished",
    "resolved",
    "fixed",
    // Activeness modifiers
    "active",
    "started",
    "ongoing",
    "inactive",
    // Due date
    "due",
    "overdue",
    "late",
    // Assignment
    "assigned",
    "assignee",
    "to",
] as const;

const matchTerms = Object.fromEntries(
    matchTermTexts.map(text => [text, new SearchNaturalLanguageMatchTerm(text)]),
) as {
    [Key in (typeof matchTermTexts)[number]]: SearchNaturalLanguageMatchTerm;
};

/**
 * Entity types that support priority filtering. Currently only tasks support
 * priority.
 */
const priorityEnabledEntities: ReadonlySet<SearchDynamicEntityIdObject["type"]> = new Set(["Task"]);

/**
 * Entity types that support openness filtering (open/closed). Currently only tasks
 * support openness.
 */
const opennessEnabledEntities: ReadonlySet<SearchDynamicEntityIdObject["type"]> = new Set(["Task"]);

/**
 * Entity types that support activeness filtering (active/inactive). Currently only
 * tasks support activeness.
 */
const activenessEnabledEntities: ReadonlySet<SearchDynamicEntityIdObject["type"]> = new Set([
    "Task",
]);

/**
 * Entity types that support time filtering with Due field (overdue tasks).
 * Currently only tasks support due dates.
 */
const timeEnabledEntities: ReadonlySet<SearchDynamicEntityIdObject["type"]> = new Set(["Task"]);

/**
 * Simple parser state object inspired by code you'd write for an [LR(n)
 * parser][1]. [GraphQL.js is a good example][2] of a clean, handwritten, LR
 * parser. Specifically this class corresponds to GraphQL.js's `Lexer`.
 *
 * `compromise` is responsible for tokenizing natural language, then this class
 * iterates over the tokens (`Term`s) provided by `compromise`.
 *
 * We're parsing natural English language grammar instead of a well defined
 * programming language grammar but we use similar patterns.
 *
 * This is an LR(n) parser, meaning we can peek ahead n tokens to make parsing
 * decisions. This is useful for handling prefix modifiers like "high priority
 * tasks" where we need to look ahead to determine if "high priority" should be
 * treated as a modifier or as search text.
 *
 * [1]: https://en.wikipedia.org/wiki/LR_parser
 * [2]:
 *     https://github.com/graphql/graphql-js/blob/2aedf25e157d1d1c8fdfeaa4c0d2f3d9d3457dba/src/language/parser.ts#L255-L330
 */
class SearchNaturalLanguageParserState {
    private _doc: View;
    private _terms: ReadonlyArray<Term>;
    private _term: Term | null;
    private _termIndex: number;

    constructor(doc: View, terms: ReadonlyArray<Term>, termIndex = 0) {
        this._doc = doc;
        this._terms = terms;
        this._termIndex = termIndex;
        this._term = this._termIndex < this._terms.length ? this._terms[this._termIndex]! : null;
    }

    public get doc() {
        return this._doc;
    }

    public get terms() {
        return this._terms;
    }

    public get term() {
        return this._term;
    }

    public get termIndex() {
        return this._termIndex;
    }

    /**
     * Peek ahead n terms without advancing the parser state. Returns the term at
     * current position + n, or null if out of bounds.
     */
    public peekTerm(n: number): Term | null {
        const targetIndex = this._termIndex + n;
        if (targetIndex < 0 || targetIndex >= this._terms.length) {
            return null;
        }
        return this._terms[targetIndex]!;
    }

    /**
     * Advance the lexer to the next term.
     */
    public advanceTerm(): Term {
        assert(this.termIndex < this.terms.length);

        const lastTerm = this._term!;
        this._termIndex += 1;
        const nextTerm = this._termIndex < this.terms.length ? this.terms[this._termIndex]! : null;
        this._term = nextTerm;

        return lastTerm;
    }
}

class SearchNaturalLanguageParserResult {
    private readonly _filters: Array<SearchNaturalLanguageFilter> = [];
    public isLowConfidence = true;

    public addFilter(filter: SearchNaturalLanguageFilter) {
        // We have low confidence the user wants natural language filters if every filter
        // we parsed only filters on `entityTypes`. These are queries like "train
        // documents" or simply "channels".
        //
        // When we have low confidence natural language filters, we still apply the filters
        // but we don't rank them as highly.
        this.isLowConfidence &&=
            filter.account === null &&
            filter.time === null &&
            filter.date === null &&
            filter.priority === null &&
            filter.openness === null &&
            filter.activeness === null;

        this._filters.push(filter);
    }

    public getFilters(): ReadonlyArray<SearchNaturalLanguageFilter> {
        return this._filters;
    }
}

/**
 * The machine representation of a filter described in natural language. For
 * example "messages sent by sara recently" or "my documents".
 *
 * The way it works is we `AND` together each top-level key. So
 * `entityTypes AND accounts AND time`. We `OR` together individual values within
 * each. So one of the `accounts.ids` fields should match, not all of them.
 *
 * If we parse multiple filters from a query string then all the filters are `OR`d
 * together.
 */
export type SearchNaturalLanguageFilter = {
    readonly entityTypes: ReadonlyArray<SearchDynamicEntityIdObject["type"]>;
    readonly account: {
        readonly field: "Creator" | "MajorContributor" | "AnyContributor" | "Assignee";
        readonly accounts: ReadonlyArray<{readonly id: AccountId; readonly name: string}>;
    } | null;
    readonly time: {
        readonly field: "Created" | "LastUpdated";
        readonly range:
            | {readonly inclusiveUpperBoundDate: Date; readonly inclusiveLowerBoundDate: Date}
            | {readonly inclusiveUpperBoundDate: Date; readonly inclusiveLowerBoundDate: null}
            | {readonly inclusiveUpperBoundDate: null; readonly inclusiveLowerBoundDate: Date};
    } | null;
    readonly date: {
        readonly field: "Due";
        readonly range:
            | {
                  readonly inclusiveUpperBound: CalendarDate;
                  readonly inclusiveLowerBound: CalendarDate;
              }
            | {readonly inclusiveUpperBound: CalendarDate; readonly inclusiveLowerBound: null}
            | {readonly inclusiveUpperBound: null; readonly inclusiveLowerBound: CalendarDate};
    } | null;
    readonly priority: ReadonlyArray<SearchEntityIndexPriorityType> | null;
    readonly openness: ReadonlyArray<SearchEntityIndexOpennessType> | null;
    readonly activeness: ReadonlyArray<SearchEntityIndexActivenessType> | null;
};

/**
 * Parse a search query in our system and extract natural language filters. For
 * example: "train documents by john" will be executed as a keyword query for
 * "train" with filters for document search entities and the "john" account as a
 * contributor.
 *
 * Our natural language parsing is best effort. English is a complicated language!
 * It's likely we'll get it wrong from time to time. So we recommend you still do a
 * keyword search with the control terms ("documents by john" in the above query)
 * as a fallback.
 *
 * Right now, English is the only supported language.
 */
export function parseSearchNaturalLanguageQuery(
    queryText: string,
    options: {
        timeZone: TimeZone;
        currentTime: Date;
        // NOTE(ifitzsimmons, #2025-10-10): A null account ID will disable _all_ natural
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

        // Add the terms from the start of this loop to where we parsed as a "control
        // phrase". Control phrases we remove from the search query so they don't
        // participate in text matching. Instead we filter based on whatever instruction
        // was in the control phrase.
        //
        // For example: "train documents by john" turns into a keyword search for "train"
        // and a filter for entity types of "document" by the account with the name "john".
        const addControlPhrase = (startTerm: Term, endTerm: Term) => {
            controlPhrases.push(createView(doc, startTerm, endTerm));
        };

        // e.g. "documents...", "messages...", "tasks...", "urgent tasks...", "open
        // tasks..." This handles both entity types alone and premodifier + entity type
        // patterns
        const premodifierAndEntityType =
            parseSearchNaturalLanguageFilterPremodifierAndEntityTypesIfPossible(state, options);
        if (premodifierAndEntityType) {
            const lastEntityTypesTerm = assertExists(state.terms[state.termIndex - 1]);
            const entityStartTerm = assertExists(
                state.terms[premodifierAndEntityType.entityStartTermIndex],
            );

            // Build the initial filter with premodifier fields
            const initialFilter: SearchNaturalLanguageFilter = {
                entityTypes: premodifierAndEntityType.entityTypes,
                account: null,
                time: null,
                date: premodifierAndEntityType.filter.date,
                priority: premodifierAndEntityType.filter.priority,
                openness: premodifierAndEntityType.filter.openness,
                activeness: premodifierAndEntityType.filter.activeness,
            };

            const {filterStartTerm, filterEndTerm, filter} =
                parseSearchNaturalLanguageFilterPostmodifierIfPossible(
                    state,
                    {
                        filterStartTerm: entityStartTerm,
                        filterEndTerm: lastEntityTypesTerm,
                        filter: initialFilter,
                        allowAccount: true,
                        allowTime: true,
                        isFirstModifierAfterEntity: true,
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

            // Create one control phrase from the first supported premodifier through entity +
            // postmodifiers If there are supported premodifiers, start from the first one If
            // there are no supported premodifiers, start from the entity type
            const hasSupportedPremodifiers =
                premodifierAndEntityType.supportedPremodifierRanges.length > 0;
            if (hasSupportedPremodifiers) {
                const firstSupportedRange = premodifierAndEntityType.supportedPremodifierRanges[0]!;
                const controlPhraseStart = assertExists(
                    state.terms[firstSupportedRange.startTermIndex],
                );
                addControlPhrase(controlPhraseStart, actualFilterEndTerm);
            } else {
                addControlPhrase(filterStartTerm, actualFilterEndTerm);
            }

            result.addFilter(filter);

            // If we got a filter with meaningful modifiers (from premodifiers or
            // postmodifiers), we're confident the user wanted a natural language filter
            const hasModifiers =
                filter.account !== null ||
                filter.time !== null ||
                filter.date !== null ||
                filter.priority !== null ||
                filter.openness !== null ||
                filter.activeness !== null;
            if (hasModifiers) {
                result.isLowConfidence = false;
            }

            continue;
        }

        const advanceNounChunkAttemptingToParseEntityTypes = (
            partialFilter: Omit<SearchNaturalLanguageFilter, "entityTypes">,
        ): {hasAddedFilter: boolean} => {
            const lastTerm = state.terms[state.termIndex - 1];

            if (
                !lastTerm ||
                (lastTerm.chunk !== "Noun" &&
                    // "all" is part of the adjective chunk. If "all" is followed by a noun chunk then
                    // we're happy.
                    !matchTerms.all.isFuzzyMatch(lastTerm))
            ) {
                return {hasAddedFilter: false};
            }

            // e.g. "my ... documents" or "john's ... documents"
            //
            // We allow this form to support queries like "john's train documents" or "sara's
            // closed tasks" which sound very natural. The way this works is we allow any terms
            // between the account name and entity type as long as they're all part of the same
            // `Noun` chunk (as determined by `compromise`).
            //
            // [Chunks represents parts of a sentence][1] (e.g. noun phrase and verb phrase).
            //
            // [1]:
            //     https://github.com/spencermountain/compromise/blob/4ef66b3e5798c63f3f0f3b7935ffae1597b6dd3b/src/3-three/chunker/api/chunks.js#L1
            while (state.term) {
                const firstEntityTypesTerm = state.term;

                const premodifierAndEntityType =
                    parseSearchNaturalLanguageFilterPremodifierAndEntityTypesIfPossible(
                        state,
                        options,
                    );
                if (premodifierAndEntityType) {
                    // Merge premodifier fields with partial filter, preferring partial filter values
                    const mergedFilter: SearchNaturalLanguageFilter = {
                        ...partialFilter,
                        entityTypes: premodifierAndEntityType.entityTypes,
                        // Use premodifier values if partial filter doesn't have them
                        date: partialFilter.date ?? premodifierAndEntityType.filter.date,
                        priority:
                            partialFilter.priority ?? premodifierAndEntityType.filter.priority,
                        openness:
                            partialFilter.openness ?? premodifierAndEntityType.filter.openness,
                        activeness:
                            partialFilter.activeness ?? premodifierAndEntityType.filter.activeness,
                    };

                    const {filterStartTerm, filterEndTerm, filter} =
                        parseSearchNaturalLanguageFilterPostmodifierIfPossible(
                            state,
                            {
                                filterStartTerm: firstEntityTypesTerm,
                                filterEndTerm: assertExists(state.terms[state.termIndex - 1]),
                                filter: mergedFilter,
                                allowAccount: partialFilter.account === null,
                                allowTime: partialFilter.time === null,
                                isFirstModifierAfterEntity: true,
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

                // Intentionally fallthrough! So we can parse "all of my..." or "all of john's..."
            } else {
                // e.g. "all documents", "all messages", "all closed tasks", "all high priority
                // tasks" parseSearchNaturalLanguageFilterPremodifierAndEntityTypesIfPossible
                // handles both plain entity types and premodifier + entity Save the term index
                // before parsing - this is where premodifiers would start
                const premodifierStartTermIndex = state.termIndex;

                const premodifierAndEntityType =
                    parseSearchNaturalLanguageFilterPremodifierAndEntityTypesIfPossible(
                        state,
                        options,
                    );
                if (premodifierAndEntityType) {
                    const initialFilter: SearchNaturalLanguageFilter = {
                        entityTypes: premodifierAndEntityType.entityTypes,
                        account: null,
                        time: null,
                        date: premodifierAndEntityType.filter.date,
                        priority: premodifierAndEntityType.filter.priority,
                        openness: premodifierAndEntityType.filter.openness,
                        activeness: premodifierAndEntityType.filter.activeness,
                    };

                    // Determine the filter start term:
                    //
                    // - If there are supported premodifiers: start from the entity type
                    // - If no supported premodifiers: start from "all"
                    const entityStartTerm = assertExists(
                        state.terms[premodifierAndEntityType.entityStartTermIndex],
                    );
                    const hasSupportedPremodifiers =
                        premodifierAndEntityType.supportedPremodifierRanges.length > 0;
                    const effectiveFilterStartTerm = hasSupportedPremodifiers
                        ? entityStartTerm
                        : startTerm;

                    const {filterStartTerm, filterEndTerm, filter} =
                        parseSearchNaturalLanguageFilterPostmodifierIfPossible(
                            state,
                            {
                                filterStartTerm: effectiveFilterStartTerm,
                                filterEndTerm: assertExists(state.terms[state.termIndex - 1]),
                                filter: initialFilter,
                                allowAccount: true,
                                allowTime: true,
                                isFirstModifierAfterEntity: true,
                            },
                            options,
                        );

                    let actualFilterEndTerm = filterEndTerm;

                    // e.g. "all messages about"
                    if (
                        filterEndTerm === state.terms[state.termIndex - 1] &&
                        matchTerms.about.isFuzzyMatch(state.term)
                    ) {
                        actualFilterEndTerm = state.advanceTerm();
                    }

                    // If there are supported premodifiers, add "all" separately, then premodifiers +
                    // entity + postmodifiers If no supported premodifiers, add "all" + entity +
                    // postmodifiers as one control phrase
                    if (hasSupportedPremodifiers) {
                        // "all" is the term before the premodifier start
                        const allTerm = assertExists(state.terms[premodifierStartTermIndex - 1]);
                        addControlPhrase(allTerm, allTerm);
                        // Premodifiers + entity + postmodifiers
                        const firstSupportedRange =
                            premodifierAndEntityType.supportedPremodifierRanges[0]!;
                        const controlPhraseStart = assertExists(
                            state.terms[firstSupportedRange.startTermIndex],
                        );
                        addControlPhrase(controlPhraseStart, actualFilterEndTerm);
                    } else {
                        addControlPhrase(filterStartTerm, actualFilterEndTerm);
                    }

                    result.addFilter(filter);

                    // If we got a filter starting with "all" like "all documents" then we're confident
                    // the user wanted a natural language filter.
                    result.isLowConfidence = false;
                    continue;
                }

                const {hasAddedFilter} = advanceNounChunkAttemptingToParseEntityTypes({
                    account: null,
                    time: null,
                    date: null,
                    priority: null,
                    openness: null,
                    activeness: null,
                });
                if (hasAddedFilter) {
                    // If we got a filter starting with "all" like "all documents" then we're confident
                    // the user wanted a natural language filter.
                    result.isLowConfidence = false;
                }
                continue;
            }
        }

        // e.g. "my..."
        if (matchTerms.my.isFuzzyMatch(state.term)) {
            state.advanceTerm();
            if (!actorAccount) {
                // If we don't have an actor account then we can't parse a "my" query. This is
                // because we don't know who the user is. However, it's possible that a Bot queries
                // something like "Documents containing text my weekend plans". In this case, we
                // should just continue so the bot can search for documents containing the text "my
                // weekend plans". In other words, we should no treat the term "my" as control
                // text.
                continue;
            }

            // e.g. "my documents", "my messages", "my high priority tasks", "my open active
            // tasks" parseSearchNaturalLanguageFilterPremodifierAndEntityTypesIfPossible
            // handles both plain entity types and premodifier + entity Save the term index
            // before parsing - this is where premodifiers would start
            const premodifierStartTermIndex = state.termIndex;

            const premodifierAndEntityType =
                parseSearchNaturalLanguageFilterPremodifierAndEntityTypesIfPossible(state, options);
            if (premodifierAndEntityType) {
                const initialFilter: SearchNaturalLanguageFilter = {
                    entityTypes: premodifierAndEntityType.entityTypes,
                    account: {
                        field: "MajorContributor",
                        accounts: [{id: actorAccount.id, name: actorAccount.name}],
                    },
                    time: null,
                    date: premodifierAndEntityType.filter.date,
                    priority: premodifierAndEntityType.filter.priority,
                    openness: premodifierAndEntityType.filter.openness,
                    activeness: premodifierAndEntityType.filter.activeness,
                };

                // Determine the filter start term:
                //
                // - If there are supported premodifiers: start from the entity type
                // - If no supported premodifiers: start from "my"
                const entityStartTerm = assertExists(
                    state.terms[premodifierAndEntityType.entityStartTermIndex],
                );
                const hasSupportedPremodifiers =
                    premodifierAndEntityType.supportedPremodifierRanges.length > 0;
                const effectiveFilterStartTerm = hasSupportedPremodifiers
                    ? entityStartTerm
                    : startTerm;

                const {filterStartTerm, filterEndTerm, filter} =
                    parseSearchNaturalLanguageFilterPostmodifierIfPossible(
                        state,
                        {
                            filterStartTerm: effectiveFilterStartTerm,
                            filterEndTerm: assertExists(state.terms[state.termIndex - 1]),
                            filter: initialFilter,
                            allowAccount: false,
                            allowTime: true,
                            isFirstModifierAfterEntity: true,
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

                // If there are supported premodifiers, add "my" separately, then premodifiers +
                // entity + postmodifiers If no supported premodifiers, add "my" + entity +
                // postmodifiers as one control phrase
                if (hasSupportedPremodifiers) {
                    // "my" is the term before the premodifier start
                    const myTerm = assertExists(state.terms[premodifierStartTermIndex - 1]);
                    addControlPhrase(myTerm, myTerm);
                    // Premodifiers + entity + postmodifiers
                    const firstSupportedRange =
                        premodifierAndEntityType.supportedPremodifierRanges[0]!;
                    const controlPhraseStart = assertExists(
                        state.terms[firstSupportedRange.startTermIndex],
                    );
                    addControlPhrase(controlPhraseStart, actualFilterEndTerm);
                } else {
                    addControlPhrase(filterStartTerm, actualFilterEndTerm);
                }

                result.addFilter(filter);
                continue;
            }

            advanceNounChunkAttemptingToParseEntityTypes({
                account: {
                    field: "MajorContributor",
                    accounts: [{id: actorAccount.id, name: actorAccount.name}],
                },
                time: null,
                date: null,
                priority: null,
                openness: null,
                activeness: null,
            });
            continue;
        }

        // e.g. "john's..." or "sara smith's..."
        const accounts = parseAccountsByNameIfPossible(state, options);
        if (accounts) {
            // Skip any empty tokens that might have been created by the NLP library (e.g., for
            // possessive forms like "john's" which can split into "john's" + "")
            while (state.term && state.term.text.trim() === "") {
                state.advanceTerm();
            }

            // Track the last term before modifiers - this is after skipping empty tokens We
            // use termIndex - 1 which points to the last empty token or the last account term
            const lastAccountTermIndex = state.termIndex - 1;
            const lastAccountTerm = assertExists(state.terms[lastAccountTermIndex]);

            const premodifierAndEntityType =
                parseSearchNaturalLanguageFilterPremodifierAndEntityTypesIfPossible(state, options);
            if (premodifierAndEntityType) {
                const initialFilter: SearchNaturalLanguageFilter = {
                    entityTypes: premodifierAndEntityType.entityTypes,
                    account: {
                        field: "MajorContributor",
                        accounts: accounts.map(account => ({
                            id: account.id,
                            name: account.initialData.name,
                        })),
                    },
                    time: null,
                    date: premodifierAndEntityType.filter.date,
                    priority: premodifierAndEntityType.filter.priority,
                    openness: premodifierAndEntityType.filter.openness,
                    activeness: premodifierAndEntityType.filter.activeness,
                };

                // Determine the filter start term:
                //
                // - If there are supported premodifiers: start from the entity type
                // - If no supported premodifiers: start from the account name
                const entityStartTerm = assertExists(
                    state.terms[premodifierAndEntityType.entityStartTermIndex],
                );
                const hasSupportedPremodifiers =
                    premodifierAndEntityType.supportedPremodifierRanges.length > 0;
                const effectiveFilterStartTerm = hasSupportedPremodifiers
                    ? entityStartTerm
                    : startTerm;

                const {filterStartTerm, filterEndTerm, filter} =
                    parseSearchNaturalLanguageFilterPostmodifierIfPossible(
                        state,
                        {
                            filterStartTerm: effectiveFilterStartTerm,
                            filterEndTerm: assertExists(state.terms[state.termIndex - 1]),
                            filter: initialFilter,
                            allowAccount: false,
                            allowTime: true,
                            isFirstModifierAfterEntity: true,
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

                // If there are supported premodifiers, add account name separately, then
                // premodifiers + entity + postmodifiers If no supported premodifiers, add account
                // name + entity + postmodifiers as one control phrase
                if (hasSupportedPremodifiers) {
                    // Account name as separate control phrase
                    addControlPhrase(startTerm, lastAccountTerm);
                    // Premodifiers + entity + postmodifiers
                    const firstSupportedRange =
                        premodifierAndEntityType.supportedPremodifierRanges[0]!;
                    const controlPhraseStart = assertExists(
                        state.terms[firstSupportedRange.startTermIndex],
                    );
                    addControlPhrase(controlPhraseStart, actualFilterEndTerm);
                } else {
                    addControlPhrase(filterStartTerm, actualFilterEndTerm);
                }

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
                date: null,
                priority: null,
                openness: null,
                activeness: null,
            });
            continue;
        }

        // Only advance if we still have a term (parsing functions may have consumed terms)
        if (state.term) {
            state.advanceTerm();
        }
    }

    return {
        filters: result.getFilters(),
        controlPhrases,
        isLowConfidence: result.isLowConfidence,
    };
}

/**
 * Check if the term is a priority title term like "priority" or "severity". This
 * is useful when checking things like "urgent priority tasks".
 */
function isPriorityTitle(term: Term | null): boolean {
    return matchTerms.priority.isFuzzyMatch(term) || matchTerms.severity.isFuzzyMatch(term);
}

/**
 * If we have a Fuse.js score below this when parsing a name then we consider the
 * name a match.
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

    // Try searching the most specific name first. So we search "Emily Lin" not
    // "Emily".
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
 * Check if the current entity types support a specific modifier type. Returns true
 * if at least one of the entity types in the filter supports the modifier.
 */
function doesFilterSupportModifier(
    filter: SearchNaturalLanguageFilter,
    modifierType: "priority" | "openness" | "activeness",
): boolean {
    const enabledEntities = {
        priority: priorityEnabledEntities,
        openness: opennessEnabledEntities,
        activeness: activenessEnabledEntities,
    }[modifierType];

    return filter.entityTypes.some(entityType => enabledEntities.has(entityType));
}

type PremodifierFilter = Pick<
    SearchNaturalLanguageFilter,
    "priority" | "openness" | "activeness" | "date"
>;

/**
 * A premodifier collected while parsing. Contains an `add` function that applies
 * the modifier to a filter if the entity types support it, plus the term indices
 * for control phrase tracking.
 */
type Premodifier = {
    /**
     * Apply this premodifier to the filter if the entity types support it. Returns the
     * updated filter if supported, or null if not supported.
     */
    add: (
        entityTypes: ReadonlyArray<SearchDynamicEntityIdObject["type"]>,
        filter: PremodifierFilter,
    ) => PremodifierFilter | null;
    startTermIndex: number;
    endTermIndex: number;
};

/**
 * Parses premodifiers and entity types from a natural language query.
 *
 * This function handles query patterns like:
 *
 * - "urgent tasks", "high priority tasks"
 * - "open tasks", "closed tasks"
 * - "active tasks", "inactive tasks"
 * - "overdue tasks"
 *
 * The approach is:
 *
 * 1. Always advance through premodifiers, collecting them in an array with term
 *    indices
 * 2. When we find an entity type, loop through premodifiers and call `add()` for
 *    each
 * 3. If `add()` returns non-null: mark as control phrase and apply to filter
 * 4. If `add()` returns null: don't mark as control phrase (becomes query text)
 *
 * For example, "high priority documents" - documents don't support priority
 * filtering, so "high priority" becomes query text and only "documents" is a
 * control phrase.
 *
 * This is distinct from postmodifiers (relative clauses like "that are urgent")
 * which are handled by `parseSearchNaturalLanguageFilterPostmodifierIfPossible`.
 */
function parseSearchNaturalLanguageFilterPremodifierAndEntityTypesIfPossible(
    state: SearchNaturalLanguageParserState,
    timeOptions: {
        timeZone: TimeZone;
        currentTime: Date;
    },
): {
    readonly entityTypes: Array<SearchDynamicEntityIdObject["type"]>;
    readonly filter: PremodifierFilter;
    readonly entityStartTermIndex: number;
    readonly entityEndTermIndex: number;
    /**
     * Term index ranges for premodifiers that were supported (should be control
     * phrases)
     */
    readonly supportedPremodifierRanges: ReadonlyArray<{
        startTermIndex: number;
        endTermIndex: number;
    }>;
} | null {
    // Collect premodifiers while advancing
    const premodifiers: Array<Premodifier> = [];
    let sawAndBeforeCurrentTerm = false;
    let andTermIndex: number | null = null;

    while (state.term) {
        // Check if we've reached an entity type
        const entityType = advanceEntityTypeIfPossible(state);
        if (entityType) {
            const {entityTypes, entityStartTermIndex, entityEndTermIndex} = entityType;

            // If "and" immediately preceded the entity type, don't attach modifiers e.g.
            // "urgent open and tasks" - premodifiers become query text, only "tasks" is
            // control phrase
            if (sawAndBeforeCurrentTerm) {
                return {
                    entityTypes,
                    filter: {priority: null, openness: null, activeness: null, date: null},
                    entityStartTermIndex,
                    entityEndTermIndex,
                    supportedPremodifierRanges: [],
                };
            }

            // Apply premodifiers that are supported by the entity types
            let filter: PremodifierFilter = {
                priority: null,
                openness: null,
                activeness: null,
                date: null,
            };
            const supportedPremodifierRanges: Array<{
                startTermIndex: number;
                endTermIndex: number;
            }> = [];

            for (const premodifier of premodifiers) {
                const updatedFilter = premodifier.add(entityTypes, filter);
                if (updatedFilter !== null) {
                    filter = updatedFilter;
                    supportedPremodifierRanges.push({
                        startTermIndex: premodifier.startTermIndex,
                        endTermIndex: premodifier.endTermIndex,
                    });
                }
                // If updatedFilter is null, this premodifier is not supported. We don't add it to
                // supportedPremodifierRanges, so it becomes query text.
            }

            return {
                entityTypes,
                filter,
                entityStartTermIndex,
                entityEndTermIndex,
                supportedPremodifierRanges,
            };
        }

        // Reset the "and" flag for this iteration
        sawAndBeforeCurrentTerm = false;

        // Allow "and" between modifiers, but only after we've seen at least one modifier
        // e.g. "open and active tasks"
        if (premodifiers.length > 0 && matchTerms.and.isFuzzyMatch(state.term)) {
            andTermIndex = state.termIndex;
            state.advanceTerm();
            sawAndBeforeCurrentTerm = true;
            continue;
        }

        // Try to parse a premodifier
        const premodifier = advancePremodifierIfPossible(state, timeOptions);
        if (premodifier) {
            // If there was an "and" before this premodifier, extend the range to include it
            if (andTermIndex !== null) {
                premodifier.startTermIndex = andTermIndex;
                andTermIndex = null;
            }
            premodifiers.push(premodifier);
            continue;
        }

        // Not a premodifier or entity type - stop parsing
        break;
    }

    // No entity type found
    return null;
}

/**
 * Try to advance through an entity type. Returns the entity type info if found, or
 * null if the current term is not an entity type.
 */
function advanceEntityTypeIfPossible(state: SearchNaturalLanguageParserState): {
    entityTypes: Array<SearchDynamicEntityIdObject["type"]>;
    entityStartTermIndex: number;
    entityEndTermIndex: number;
} | null {
    if (!state.term) return null;

    const entityStartTermIndex = state.termIndex;

    // Documents / Docs
    if (matchTerms.documents.isFuzzyMatch(state.term) || matchTerms.docs.isFuzzyMatch(state.term)) {
        state.advanceTerm();

        // Document comments: "documents messages" or "documents comments"
        if (
            matchTerms.messages.isFuzzyMatch(state.term) ||
            matchTerms.comments.isFuzzyMatch(state.term)
        ) {
            state.advanceTerm();
            return {
                entityTypes: ["DocumentComment"],
                entityStartTermIndex,
                entityEndTermIndex: state.termIndex - 1,
            };
        }

        return {
            entityTypes: ["Document"],
            entityStartTermIndex,
            entityEndTermIndex: state.termIndex - 1,
        };
    }

    // Channels
    if (matchTerms.channels.isFuzzyMatch(state.term)) {
        state.advanceTerm();
        return {
            entityTypes: ["Channel"],
            entityStartTermIndex,
            entityEndTermIndex: state.termIndex - 1,
        };
    }

    // Posts
    if (matchTerms.posts.isFuzzyMatch(state.term)) {
        state.advanceTerm();

        // Post comments: "posts comments"
        if (matchTerms.comments.isFuzzyMatch(state.term)) {
            state.advanceTerm();
            return {
                entityTypes: ["PostComment"],
                entityStartTermIndex,
                entityEndTermIndex: state.termIndex - 1,
            };
        }

        return {
            entityTypes: ["Post"],
            entityStartTermIndex,
            entityEndTermIndex: state.termIndex - 1,
        };
    }

    // Chats
    if (matchTerms.chats.isFuzzyMatch(state.term)) {
        state.advanceTerm();

        // Chat messages: "chats messages" or "chats comments"
        if (
            matchTerms.messages.isFuzzyMatch(state.term) ||
            matchTerms.comments.isFuzzyMatch(state.term)
        ) {
            state.advanceTerm();
            return {
                entityTypes: ["ChatMessage"],
                entityStartTermIndex,
                entityEndTermIndex: state.termIndex - 1,
            };
        }

        return {
            entityTypes: ["Chat"],
            entityStartTermIndex,
            entityEndTermIndex: state.termIndex - 1,
        };
    }

    // Tasks
    if (matchTerms.tasks.isFuzzyMatch(state.term)) {
        state.advanceTerm();

        if (matchTerms.collections.isFuzzyMatch(state.term)) {
            state.advanceTerm();
            return {
                entityTypes: ["TaskCollection"],
                entityStartTermIndex,
                entityEndTermIndex: state.termIndex - 1,
            };
        }

        // A search like "mobile tasks" should return the mobile task collection. Same with
        // something like "my onboarding tasks".
        return {
            entityTypes: ["Task", "TaskCollection"],
            entityStartTermIndex,
            entityEndTermIndex: state.termIndex - 1,
        };
    }

    // Collections (standalone)
    if (matchTerms.collections.isFuzzyMatch(state.term)) {
        state.advanceTerm();
        return {
            entityTypes: ["TaskCollection"],
            entityStartTermIndex,
            entityEndTermIndex: state.termIndex - 1,
        };
    }

    // Sites
    if (matchTerms.sites.isFuzzyMatch(state.term)) {
        state.advanceTerm();
        return {
            entityTypes: ["Site"],
            entityStartTermIndex,
            entityEndTermIndex: state.termIndex - 1,
        };
    }

    // Messages or comments (standalone - could be chat or document)
    if (
        matchTerms.messages.isFuzzyMatch(state.term) ||
        matchTerms.comments.isFuzzyMatch(state.term)
    ) {
        state.advanceTerm();
        return {
            entityTypes: ["ChatMessage", "DocumentComment", "PostComment"],
            entityStartTermIndex,
            entityEndTermIndex: state.termIndex - 1,
        };
    }

    // Person / People
    if (matchTerms.person.isFuzzyMatch(state.term) || matchTerms.people.isFuzzyMatch(state.term)) {
        state.advanceTerm();
        return {
            entityTypes: ["Account"],
            entityStartTermIndex,
            entityEndTermIndex: state.termIndex - 1,
        };
    }

    // Not an entity type
    return null;
}

/**
 * Try to advance through a single premodifier. Returns the premodifier if found,
 * or null if the current term is not a premodifier.
 */
function advancePremodifierIfPossible(
    state: SearchNaturalLanguageParserState,
    options: {
        timeZone: TimeZone;
        currentTime: Date;
    },
): Premodifier | null {
    const term = state.term;
    if (!term) return null;

    const startTermIndex = state.termIndex;

    // Parse priority premodifiers e.g. "urgent tasks" and "high priority tasks"
    if (matchTerms.urgent.isFuzzyMatch(term)) {
        state.advanceTerm();
        // Skip optional "priority" or "severity" word
        if (isPriorityTitle(state.term)) {
            state.advanceTerm();
        }
        const endTermIndex = state.termIndex - 1;

        return {
            add: (entityTypes, filter) => {
                if (!entityTypes.some(entity => priorityEnabledEntities.has(entity))) {
                    return null;
                }
                const priority = filter.priority?.includes("Urgent")
                    ? filter.priority
                    : [...(filter.priority ?? []), "Urgent" as const];
                return {...filter, priority};
            },
            startTermIndex,
            endTermIndex,
        };
    }

    if (matchTerms.high.isFuzzyMatch(term)) {
        state.advanceTerm();
        if (isPriorityTitle(state.term)) {
            state.advanceTerm();
        }
        const endTermIndex = state.termIndex - 1;

        return {
            add: (entityTypes, filter) => {
                if (!entityTypes.some(entity => priorityEnabledEntities.has(entity))) {
                    return null;
                }
                const priority = filter.priority?.includes("High")
                    ? filter.priority
                    : [...(filter.priority ?? []), "High" as const];
                return {...filter, priority};
            },
            startTermIndex,
            endTermIndex,
        };
    }

    if (matchTerms.medium.isFuzzyMatch(term)) {
        state.advanceTerm();
        if (isPriorityTitle(state.term)) {
            state.advanceTerm();
        }
        const endTermIndex = state.termIndex - 1;

        return {
            add: (entityTypes, filter) => {
                if (!entityTypes.some(entity => priorityEnabledEntities.has(entity))) {
                    return null;
                }
                const priority = filter.priority?.includes("Medium")
                    ? filter.priority
                    : [...(filter.priority ?? []), "Medium" as const];
                return {...filter, priority};
            },
            startTermIndex,
            endTermIndex,
        };
    }

    if (matchTerms.low.isFuzzyMatch(term)) {
        state.advanceTerm();
        if (isPriorityTitle(state.term)) {
            state.advanceTerm();
        }
        const endTermIndex = state.termIndex - 1;

        return {
            add: (entityTypes, filter) => {
                if (!entityTypes.some(entity => priorityEnabledEntities.has(entity))) {
                    return null;
                }
                const priority = filter.priority?.includes("Low")
                    ? filter.priority
                    : [...(filter.priority ?? []), "Low" as const];
                return {...filter, priority};
            },
            startTermIndex,
            endTermIndex,
        };
    }

    if (matchTerms.important.isFuzzyMatch(term) || matchTerms.critical.isFuzzyMatch(term)) {
        state.advanceTerm();
        if (isPriorityTitle(state.term)) {
            state.advanceTerm();
        }
        const endTermIndex = state.termIndex - 1;

        return {
            add: (entityTypes, filter) => {
                if (!entityTypes.some(entity => priorityEnabledEntities.has(entity))) {
                    return null;
                }
                // "important" and "critical" map to both Urgent and High
                const withUrgent = filter.priority?.includes("Urgent")
                    ? filter.priority
                    : [...(filter.priority ?? []), "Urgent" as const];
                const priority = withUrgent.includes("High")
                    ? withUrgent
                    : [...withUrgent, "High" as const];
                return {...filter, priority};
            },
            startTermIndex,
            endTermIndex,
        };
    }

    // Parse time premodifiers e.g. "overdue tasks"
    if (matchTerms.overdue.isFuzzyMatch(term) || matchTerms.late.isFuzzyMatch(term)) {
        state.advanceTerm();
        const endTermIndex = state.termIndex - 1;

        // Capture options for the closure
        const {timeZone, currentTime} = options;

        return {
            add: (entityTypes, filter) => {
                if (!entityTypes.some(entity => timeEnabledEntities.has(entity))) {
                    return null;
                }
                // "Overdue" means due before today (exclusive of today)
                const yesterday = toCalendarDate(
                    parseAbsolute(currentTime.toISOString(), timeZone),
                ).subtract({days: 1});
                return {
                    ...filter,
                    date: {
                        field: "Due",
                        range: {inclusiveUpperBound: yesterday, inclusiveLowerBound: null},
                    },
                };
            },
            startTermIndex,
            endTermIndex,
        };
    }

    // Parse all terms that are potentially negatable
    const isNegated = matchTerms.not.isFuzzyMatch(term);
    // Need to look ahead for negated terms without advancing
    const nextTerm = state.terms[state.termIndex + 1];
    const possiblyNegatedTerm = isNegated ? nextTerm : term;

    // Parse openness modifiers e.g. "open tasks", "not done tasks", and "closed tasks"
    if (
        matchTerms.open.isFuzzyMatch(possiblyNegatedTerm) ||
        matchTerms.pending.isFuzzyMatch(possiblyNegatedTerm) ||
        matchTerms.todo.isFuzzyMatch(possiblyNegatedTerm)
    ) {
        if (isNegated) state.advanceTerm();
        state.advanceTerm();
        const endTermIndex = state.termIndex - 1;
        const openness: ReadonlyArray<SearchEntityIndexOpennessType> = isNegated
            ? ["Closed"]
            : ["Open"];

        return {
            add: (entityTypes, filter) => {
                if (!entityTypes.some(entity => opennessEnabledEntities.has(entity))) {
                    return null;
                }
                return {...filter, openness};
            },
            startTermIndex,
            endTermIndex,
        };
    }

    if (
        matchTerms.closed.isFuzzyMatch(possiblyNegatedTerm) ||
        matchTerms.done.isFuzzyMatch(possiblyNegatedTerm) ||
        matchTerms.finished.isFuzzyMatch(possiblyNegatedTerm) ||
        matchTerms.resolved.isFuzzyMatch(possiblyNegatedTerm) ||
        matchTerms.fixed.isFuzzyMatch(possiblyNegatedTerm)
    ) {
        if (isNegated) state.advanceTerm();
        state.advanceTerm();
        const endTermIndex = state.termIndex - 1;
        const openness: ReadonlyArray<SearchEntityIndexOpennessType> = isNegated
            ? ["Open"]
            : ["Closed"];

        return {
            add: (entityTypes, filter) => {
                if (!entityTypes.some(entity => opennessEnabledEntities.has(entity))) {
                    return null;
                }
                return {...filter, openness};
            },
            startTermIndex,
            endTermIndex,
        };
    }

    // Parse activeness modifiers e.g. "active tasks", "not started tasks", and
    // "inactive tasks"
    if (
        matchTerms.active.isFuzzyMatch(possiblyNegatedTerm) ||
        matchTerms.started.isFuzzyMatch(possiblyNegatedTerm) ||
        matchTerms.ongoing.isFuzzyMatch(possiblyNegatedTerm)
    ) {
        if (isNegated) state.advanceTerm();
        state.advanceTerm();
        const endTermIndex = state.termIndex - 1;
        const activeness: ReadonlyArray<SearchEntityIndexActivenessType> = isNegated
            ? ["Inactive"]
            : ["Active"];

        return {
            add: (entityTypes, filter) => {
                if (!entityTypes.some(entity => activenessEnabledEntities.has(entity))) {
                    return null;
                }
                return {...filter, activeness};
            },
            startTermIndex,
            endTermIndex,
        };
    }

    if (matchTerms.inactive.isFuzzyMatch(possiblyNegatedTerm)) {
        if (isNegated) state.advanceTerm();
        state.advanceTerm();
        const endTermIndex = state.termIndex - 1;
        const activeness: ReadonlyArray<SearchEntityIndexActivenessType> = isNegated
            ? ["Active"]
            : ["Inactive"];

        return {
            add: (entityTypes, filter) => {
                if (!entityTypes.some(entity => activenessEnabledEntities.has(entity))) {
                    return null;
                }
                return {...filter, activeness};
            },
            startTermIndex,
            endTermIndex,
        };
    }

    // Not a premodifier
    return null;
}

/**
 * Recursively parses postmodifiers for a search filter from a natural language
 * query.
 *
 * This is the core recursive parsing function that handles all types of query
 * modifiers that appear after the entity type:
 *
 * - Account modifiers: "created by", "updated by", "assigned to", etc.
 * - Date/time modifiers: "created yesterday", "updated last week", "recently",
 *   etc.
 * - Priority modifiers: "that are urgent", "that are high priority", etc.
 * - Openness modifiers: "that are open", "that are closed", etc.
 * - Activeness modifiers: "that are active", "that are inactive", etc.
 *
 * This function only handles modifiers that appear after the entity type (e.g.,
 * "tasks that are urgent", "tasks created by me"). Premodifiers like "high
 * priority tasks" or "open tasks" are handled by
 * `parseSearchNaturalLanguageFilterPremodifierAndEntityTypesIfPossible`.
 */
function parseSearchNaturalLanguageFilterPostmodifierIfPossible(
    state: SearchNaturalLanguageParserState,
    {
        filterStartTerm,
        filterEndTerm,
        filter,
        allowAccount,
        allowTime,
        isFirstModifierAfterEntity,
    }: {
        filterStartTerm: Term;
        filterEndTerm: Term;
        filter: SearchNaturalLanguageFilter;
        allowAccount: boolean;
        allowTime: boolean;
        isFirstModifierAfterEntity: boolean;
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
    const {actorAccount} = options;

    // Check if this filter's entity types support each modifier type
    const supportsPriority = doesFilterSupportModifier(filter, "priority");
    const supportsOpenness = doesFilterSupportModifier(filter, "openness");
    const supportsActiveness = doesFilterSupportModifier(filter, "activeness");

    // e.g. "documents created by me and updated last month" Only allow "and" if it's
    // not the first modifier after the entity
    if (!isFirstModifierAfterEntity && matchTerms.and.isFuzzyMatch(state.term)) {
        state.advanceTerm();

        // e.g. "documents created last year and were updated by me"
        if (matchTerms.were.isFuzzyMatch(state.term)) state.advanceTerm();
    }

    // Handle connector words for forward modifiers (e.g., "tasks that are urgent")
    // Also supports "tasks that urgent" for fast typers who omit "are"
    if (matchTerms.that.isFuzzyMatch(state.term)) {
        state.advanceTerm(); // advance past "that"

        if (matchTerms.are.isFuzzyMatch(state.term) || matchTerms.were.isFuzzyMatch(state.term)) {
            state.advanceTerm(); // advance past "are" or "were"
        }

        filterEndTerm = assertExists(state.terms[state.termIndex - 1]);
    }

    // (e.g., "tasks that are urgent", "urgent tasks")
    if (supportsPriority) {
        let newPriorities: SearchNaturalLanguageFilter["priority"] = null;

        if (matchTerms.urgent.isFuzzyMatch(state.term)) {
            state.advanceTerm();
            newPriorities = ["Urgent"];
        } else if (
            matchTerms.important.isFuzzyMatch(state.term) ||
            matchTerms.critical.isFuzzyMatch(state.term)
        ) {
            state.advanceTerm();
            newPriorities = ["Urgent", "High"];
        } else if (matchTerms.high.isFuzzyMatch(state.term)) {
            state.advanceTerm();
            newPriorities = ["High"];
        } else if (matchTerms.medium.isFuzzyMatch(state.term)) {
            state.advanceTerm();
            newPriorities = ["Medium"];
        } else if (matchTerms.low.isFuzzyMatch(state.term)) {
            state.advanceTerm();
            newPriorities = ["Low"];
        }

        if (newPriorities) {
            // Skip optional "priority" or "severity" word after the priority level
            if (
                state.term &&
                (matchTerms.priority.isFuzzyMatch(state.term) ||
                    matchTerms.severity.isFuzzyMatch(state.term))
            ) {
                state.advanceTerm();
            }

            // Add new priorities, avoiding duplicates
            for (const newPriority of newPriorities) {
                if (!filter.priority || !filter.priority.includes(newPriority)) {
                    filter = {
                        ...filter,
                        priority: [...(filter.priority ?? []), newPriority],
                    };
                }
            }

            return parseSearchNaturalLanguageFilterPostmodifierIfPossible(
                state,
                {
                    filterStartTerm,
                    filterEndTerm: assertExists(state.terms[state.termIndex - 1]),
                    filter,
                    allowAccount,
                    allowTime,
                    isFirstModifierAfterEntity: false,
                },
                options,
            );
        }
    }

    // (e.g., "tasks that are open", "open tasks", "not open tasks", "tasks that are
    // not done")
    if (supportsOpenness && !filter.openness) {
        let openness: SearchNaturalLanguageFilter["openness"] = null;

        // Peek ahead to check for "not" prefix followed by openness modifier
        const hasNot = matchTerms.not.isFuzzyMatch(state.term);
        const termToCheck = hasNot ? state.peekTerm(1) : state.term;
        const termAfterTermToCheck = hasNot ? state.peekTerm(2) : state.peekTerm(1);
        // `opened by ...` is an alias for `created by ...`, but stemming makes `opened`
        // fuzzy-match `open`. Guard this case so it falls through to the creator-style
        // parser below instead of being parsed as openness.
        const isOpenedByAlias =
            termToCheck?.text.toLowerCase() === "opened" &&
            matchTerms.by.isFuzzyMatch(termAfterTermToCheck);

        if (
            (matchTerms.open.isFuzzyMatch(termToCheck) && !isOpenedByAlias) ||
            matchTerms.pending.isFuzzyMatch(termToCheck) ||
            matchTerms.todo.isFuzzyMatch(termToCheck)
        ) {
            // Advance once for the modifier, twice if "not" was present
            state.advanceTerm();
            if (hasNot) state.advanceTerm();

            // "not open" -> Closed, "open" -> Open
            openness = hasNot ? ["Closed"] : ["Open"];
        } else if (
            matchTerms.closed.isFuzzyMatch(termToCheck) ||
            matchTerms.done.isFuzzyMatch(termToCheck) ||
            matchTerms.finished.isFuzzyMatch(termToCheck) ||
            matchTerms.resolved.isFuzzyMatch(termToCheck) ||
            matchTerms.fixed.isFuzzyMatch(termToCheck)
        ) {
            // Advance once for the modifier, twice if "not" was present
            state.advanceTerm();
            if (hasNot) state.advanceTerm();

            // "not closed" -> Open, "closed" -> Closed
            openness = hasNot ? ["Open"] : ["Closed"];
        }

        if (openness) {
            // TODO: `closed by ...` currently maps to `Closed + Assignee`, but the ideal
            // behavior is `Closed + (Assignee OR Closer)`. That requires indexing/searching a
            // dedicated `Closer` field so closed unassigned tasks, or tasks closed by someone
            // other than the assignee, are included too.
            if (
                openness.includes("Closed") &&
                allowAccount &&
                matchTerms.by.isFuzzyMatch(state.term)
            ) {
                state.advanceTerm();

                if (matchTerms.me.isFuzzyMatch(state.term)) {
                    if (!actorAccount) {
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
                                openness,
                                account: {
                                    field: "Assignee",
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

                const accounts = parseAccountsByNameIfPossible(state, options);
                if (accounts) {
                    return maybeContinueParseSearchNaturalLanguageFilterDateModifier(
                        state,
                        {
                            filterStartTerm,
                            filterEndTerm: assertExists(state.terms[state.termIndex - 1]),
                            filter: {
                                ...filter,
                                openness,
                                account: {
                                    field: "Assignee",
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

            return parseSearchNaturalLanguageFilterPostmodifierIfPossible(
                state,
                {
                    filterStartTerm,
                    filterEndTerm: assertExists(state.terms[state.termIndex - 1]),
                    filter: {...filter, openness},
                    allowAccount,
                    allowTime,
                    isFirstModifierAfterEntity: false,
                },
                options,
            );
        }
    }

    // (e.g., "tasks that are active", "active tasks", "not active tasks", "tasks that
    // are not inactive")
    if (supportsActiveness && !filter.activeness) {
        let activeness: SearchNaturalLanguageFilter["activeness"] = null;

        // Peek ahead to check for "not" prefix followed by activeness modifier
        const hasNot = matchTerms.not.isFuzzyMatch(state.term);
        const termToCheck = hasNot ? state.peekTerm(1) : state.term;

        if (
            matchTerms.active.isFuzzyMatch(termToCheck) ||
            matchTerms.started.isFuzzyMatch(termToCheck) ||
            matchTerms.ongoing.isFuzzyMatch(termToCheck)
        ) {
            // Advance once for the modifier, twice if "not" was present
            state.advanceTerm();
            if (hasNot) state.advanceTerm();

            // "not active" -> Inactive, "active" -> Active
            activeness = hasNot ? ["Inactive"] : ["Active"];
        } else if (matchTerms.inactive.isFuzzyMatch(termToCheck)) {
            // Advance once for the modifier, twice if "not" was present
            state.advanceTerm();
            if (hasNot) state.advanceTerm();

            // "not inactive" -> Active, "inactive" -> Inactive
            activeness = hasNot ? ["Active"] : ["Inactive"];
        }

        if (activeness) {
            return parseSearchNaturalLanguageFilterPostmodifierIfPossible(
                state,
                {
                    // Keep filterStartTerm unchanged - "not" is included in the phrase by virtue of
                    // being between filterStartTerm and filterEndTerm. The caller already set
                    // filterStartTerm to the start of the phrase.
                    filterStartTerm,
                    filterEndTerm: assertExists(state.terms[state.termIndex - 1]),
                    filter: {...filter, activeness},
                    allowAccount,
                    allowTime,
                    isFirstModifierAfterEntity: false,
                },
                options,
            );
        }
    }

    // (e.g., "tasks that are overdue", "overdue tasks", "late tasks")
    if (
        allowTime &&
        !filter.date &&
        (matchTerms.overdue.isFuzzyMatch(state.term) || matchTerms.late.isFuzzyMatch(state.term))
    ) {
        state.advanceTerm();

        // "Overdue" means due before today (exclusive of today)
        const yesterday = toCalendarDate(
            parseAbsolute(options.currentTime.toISOString(), options.timeZone),
        ).subtract({days: 1});

        return parseSearchNaturalLanguageFilterPostmodifierIfPossible(
            state,
            {
                filterStartTerm,
                filterEndTerm: assertExists(state.terms[state.termIndex - 1]),
                filter: {
                    ...filter,
                    date: {
                        field: "Due",
                        range: {
                            inclusiveUpperBound: yesterday,
                            inclusiveLowerBound: null,
                        },
                    },
                },
                allowAccount,
                allowTime: false,
                isFirstModifierAfterEntity: false,
            },
            options,
        );
    }

    // e.g. "documents created..." or "messages sent..."
    if (
        matchTerms.created.isFuzzyMatch(state.term) ||
        matchTerms.opened.isFuzzyMatch(state.term) ||
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
                    // If we don't have an actor account then we can't parse a "my" query. This is
                    // because we don't know who the user is. However, it's possible that a Bot queries
                    // something like "Documents containing text my weekend plans". In this case, we
                    // should just continue so the bot can search for documents containing the text "my
                    // weekend plans". In other words, we should no treat the term "my" as control
                    // text.
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
                    // If we don't have an actor account then we can't parse a "my" query. This is
                    // because we don't know who the user is. However, it's possible that a Bot queries
                    // something like "Documents containing text my weekend plans". In this case, we
                    // should just continue so the bot can search for documents containing the text "my
                    // weekend plans". In other words, we should no treat the term "my" as control
                    // text.
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
                    // If we don't have an actor account then we can't parse a "my" query. This is
                    // because we don't know who the user is. However, it's possible that a Bot queries
                    // something like "Documents containing text my weekend plans". In this case, we
                    // should just continue so the bot can search for documents containing the text "my
                    // weekend plans". In other words, we should no treat the term "my" as control
                    // text.
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
                // If we don't have an actor account then we can't parse a "my" query. This is
                // because we don't know who the user is. However, it's possible that a Bot queries
                // something like "Documents containing text my weekend plans". In this case, we
                // should just continue so the bot can search for documents containing the text "my
                // weekend plans". In other words, we should no treat the term "my" as control
                // text.
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
            // If we don't have an actor account then we can't parse a "my" query. This is
            // because we don't know who the user is. However, it's possible that a Bot queries
            // something like "Documents containing text my weekend plans". In this case, we
            // should just continue so the bot can search for documents containing the text "my
            // weekend plans". In other words, we should no treat the term "my" as control
            // text.
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
            // If we don't have an actor account then we can't parse a "my" query. This is
            // because we don't know who the user is. However, it's possible that a Bot queries
            // something like "Documents containing text my weekend plans". In this case, we
            // should just continue so the bot can search for documents containing the text "my
            // weekend plans". In other words, we should no treat the term "my" as control
            // text.
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
            // If we don't have an actor account then we can't parse a "my" query. This is
            // because we don't know who the user is. However, it's possible that a Bot queries
            // something like "Documents containing text my weekend plans". In this case, we
            // should just continue so the bot can search for documents containing the text "my
            // weekend plans". In other words, we should no treat the term "my" as control
            // text.
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

    // e.g. "tasks due..." or "tasks due today"
    if (matchTerms.due.isFuzzyMatch(state.term)) {
        state.advanceTerm();

        // e.g. "tasks due by tomorrow"
        if (matchTerms.by.isFuzzyMatch(state.term)) {
            state.advanceTerm();
        }

        if (allowTime) {
            return continueParseSearchNaturalLanguageFilterDateModifier(
                state,
                {
                    filterStartTerm,
                    filterEndTerm: assertExists(state.terms[state.termIndex - 1]),
                    filter,
                    allowAccount,
                    field: "Due",
                },
                options,
            );
        }

        return {filterStartTerm, filterEndTerm, filter};
    }

    // e.g. "tasks assigned to..." or "tasks assigned to me" also allow typo of
    // "assignee"
    if (
        matchTerms.assigned.isFuzzyMatch(state.term) ||
        matchTerms.assignee.isFuzzyMatch(state.term)
    ) {
        state.advanceTerm();

        // Optional "to" (e.g., "assigned to me" or just "assigned me")
        if (matchTerms.to.isFuzzyMatch(state.term)) {
            state.advanceTerm();
        }

        // e.g. "tasks assigned to me"
        if (allowAccount && matchTerms.me.isFuzzyMatch(state.term)) {
            if (!actorAccount) {
                return {filterStartTerm, filterEndTerm, filter};
            }
            const endTerm = state.advanceTerm();

            return parseSearchNaturalLanguageFilterPostmodifierIfPossible(
                state,
                {
                    filterStartTerm,
                    filterEndTerm: endTerm,
                    filter: {
                        ...filter,
                        account: {
                            field: "Assignee",
                            accounts: [{id: actorAccount.id, name: actorAccount.name}],
                        },
                    },
                    allowAccount: false,
                    allowTime,
                    isFirstModifierAfterEntity: false,
                },
                options,
            );
        }

        // e.g. "tasks assigned to john" or "tasks assigned to sara smith"
        const accounts = parseAccountsByNameIfPossible(state, options);
        if (accounts) {
            return parseSearchNaturalLanguageFilterPostmodifierIfPossible(
                state,
                {
                    filterStartTerm,
                    filterEndTerm: assertExists(state.terms[state.termIndex - 1]),
                    filter: {
                        ...filter,
                        account: {
                            field: "Assignee",
                            accounts: accounts.map(account => ({
                                id: account.id,
                                name: account.initialData.name,
                            })),
                        },
                    },
                    allowAccount: false,
                    allowTime,
                    isFirstModifierAfterEntity: false,
                },
                options,
            );
        }

        return {filterStartTerm, filterEndTerm, filter};
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
        field: "Created" | "LastUpdated" | "Due";
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
        return parseSearchNaturalLanguageFilterPostmodifierIfPossible(
            state,
            {
                filterStartTerm,
                filterEndTerm,
                filter,
                allowAccount,
                allowTime: false,
                isFirstModifierAfterEntity: false,
            },
            options,
        );
    }
}

/**
 * Helper to convert a Date to CalendarDate using the given timezone.
 */
function dateToCalendarDate(date: Date, timeZone: TimeZone): CalendarDate {
    return toCalendarDate(parseAbsolute(date.toISOString(), timeZone));
}

/**
 * Creates either a `time` or `date` filter update based on the field. For "Due"
 * fields, uses CalendarDate; for "Created"/"LastUpdated", uses Date.
 */
function createDateRangeFilterUpdate(
    filter: SearchNaturalLanguageFilter,
    field: "Created" | "LastUpdated" | "Due",
    range: {startDate: Date | null; endDate: Date | null},
    timeZone: TimeZone,
): Partial<SearchNaturalLanguageFilter> {
    if (field === "Due") {
        return {
            date: {
                field: "Due",
                range:
                    range.startDate && range.endDate
                        ? {
                              inclusiveLowerBound: dateToCalendarDate(range.startDate, timeZone),
                              inclusiveUpperBound: dateToCalendarDate(range.endDate, timeZone),
                          }
                        : range.startDate
                          ? {
                                inclusiveLowerBound: dateToCalendarDate(range.startDate, timeZone),
                                inclusiveUpperBound: null,
                            }
                          : {
                                inclusiveLowerBound: null,
                                inclusiveUpperBound: dateToCalendarDate(range.endDate!, timeZone),
                            },
            },
        };
    }

    return {
        time: {
            field,
            range:
                range.startDate && range.endDate
                    ? {
                          inclusiveLowerBoundDate: range.startDate,
                          inclusiveUpperBoundDate: range.endDate,
                      }
                    : range.startDate
                      ? {
                            inclusiveLowerBoundDate: range.startDate,
                            inclusiveUpperBoundDate: null,
                        }
                      : {
                            inclusiveLowerBoundDate: null,
                            inclusiveUpperBoundDate: range.endDate!,
                        },
        },
    };
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
        field: "Created" | "LastUpdated" | "Due";
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

        // We arbitrarily decide that "recently" means 3 days ago until now. Ideally we'd
        // sort by recency as well.
        const recentlyStartDate = new Date(currentTime.getTime() - 3 * (1000 * 60 * 60 * 24));

        return parseSearchNaturalLanguageFilterPostmodifierIfPossible(
            state,
            {
                filterStartTerm,
                filterEndTerm: assertExists(state.terms[state.termIndex - 1]),
                filter: {
                    ...filter,
                    ...createDateRangeFilterUpdate(
                        filter,
                        field,
                        {startDate: recentlyStartDate, endDate: null},
                        timeZone,
                    ),
                },
                allowAccount,
                allowTime: false,
                isFirstModifierAfterEntity: false,
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
        // "from" is tagged as `Date` but `compromise-date` can't parse it. We do, however,
        // need "from" in `parseSearchNaturalLanguageFilterPostmodifierIfPossible()`.
        state.term.normal === "from"
    ) {
        // We parsed some terms expecting a date but there was no date!
        if (startTerm !== state.term) return {filterStartTerm, filterEndTerm, filter};

        return parseSearchNaturalLanguageFilterPostmodifierIfPossible(
            state,
            {
                filterStartTerm,
                filterEndTerm,
                filter,
                allowAccount,
                // `allowTime` is `true` because we haven't parsed a time yet.
                allowTime: true,
                isFirstModifierAfterEntity: false,
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

            // When the user targets a specific point in time like "2 hours ago", "2 days ago",
            // or "2 months ago" it's unlikely they mean the exact time 2 hours/days/months
            // ago. So add some slop duration to our time filter. The slop duration gets larger
            // the further in the past the time the user specifies is based on the hypothesis
            // that the user's memory gets fuzzier the further in the past we're looking for an
            // entity.
            const slopDurationMs =
                getSlopDurationDays((currentTime.getTime() - midDate.getTime()) / dayMs) * dayMs;

            if (slopDurationMs > durationMs) {
                startDate = new Date(startDate.getTime() - (slopDurationMs - durationMs) / 2);
                endDate = new Date(endDate.getTime() + (slopDurationMs - durationMs) / 2);
            }

            return parseSearchNaturalLanguageFilterPostmodifierIfPossible(
                state,
                {
                    filterStartTerm,
                    filterEndTerm: assertExists(state.terms[state.termIndex - 1]),
                    filter: {
                        ...filter,
                        ...createDateRangeFilterUpdate(
                            filter,
                            field,
                            {startDate, endDate},
                            timeZone,
                        ),
                    },
                    allowAccount,
                    allowTime: false,
                    isFirstModifierAfterEntity: false,
                },
                options,
            );
        }
        case "After": {
            return parseSearchNaturalLanguageFilterPostmodifierIfPossible(
                state,
                {
                    filterStartTerm,
                    filterEndTerm: assertExists(state.terms[state.termIndex - 1]),
                    filter: {
                        ...filter,
                        ...createDateRangeFilterUpdate(
                            filter,
                            field,
                            {startDate, endDate: null},
                            timeZone,
                        ),
                    },
                    allowAccount,
                    allowTime: false,
                    isFirstModifierAfterEntity: false,
                },
                options,
            );
        }
        case "Before": {
            return parseSearchNaturalLanguageFilterPostmodifierIfPossible(
                state,
                {
                    filterStartTerm,
                    filterEndTerm: assertExists(state.terms[state.termIndex - 1]),
                    filter: {
                        ...filter,
                        ...createDateRangeFilterUpdate(
                            filter,
                            field,
                            {startDate: null, endDate},
                            timeZone,
                        ),
                    },
                    allowAccount,
                    allowTime: false,
                    isFirstModifierAfterEntity: false,
                },
                options,
            );
        }
        default:
            throw exhaustive(direction);
    }
}

/**
 * Stems a possessive english string. Converts "John's" to "John". Adapted from a
 * [Lucene token filter of the same name][1].
 *
 * [1]:
 *     https://github.com/apache/lucene/blob/5d6086e1994d766a3dd39a47b14a8cd80a7280e6/lucene/analysis/common/src/java/org/apache/lucene/analysis/en/EnglishPossessiveFilter.java#L32-L50
 */
function stemEnglishPossessive(text: string): string {
    if (
        text.length >= 2 &&
        // eslint-disable-next-line cyberworlds/string-quotes
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
 * Model returning a slop duration (measured in days) based on the input duration
 * (measured in days).
 *
 * When the user targets a date with natural language (e.g. "5 days ago") we add
 * some slop around the date since it's unlikely they're targeting the exact date.
 * We add more slop the further the time is in the past under the assumption the
 * user's memory gets fuzzier the further away from the date we are.
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
