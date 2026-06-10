import {
    MockAgentRecording,
    MockAgentRecordingAction,
} from "~/shared/agents/mock_agent_recording.js";
import {
    ApiContentBlockElement,
    ApiContentInlineElement,
    ApiContentInlineElementMark,
    ApiContentListBlockElement,
    ApiContentListBlockElementItem,
    ApiContentMentionInlineElement,
    ApiContentParagraphBlockElement,
    ApiContentTextInlineElement,
    ApiContentUnorderedListBlockElement,
    ApiMentionTarget,
    ApiMessageStreamPartPayload,
} from "~/shared/api/specification/types/api_specification_convenience_types.js";
import {partitionArray} from "~/shared/helpers/array/partition_array.js";
import {DocumentId} from "~/shared/id/types/id_types.js";

function p(...elements: Array<string | ApiContentInlineElement>): ApiContentParagraphBlockElement {
    return {
        type: "Paragraph",
        elements: elements.map(element => (typeof element === "string" ? text(element) : element)),
    };
}

function ul(
    ...items: Array<ApiContentParagraphBlockElement | ApiContentListBlockElementItem>
): ApiContentUnorderedListBlockElement {
    if (items.length === 0) {
        return {type: "UnorderedList", items: [{elements: []}]};
    }

    return {
        type: "UnorderedList",
        items: items.map(item => ("type" in item ? {elements: [item]} : item)),
    };
}

function li(
    ...elements: Array<ApiContentParagraphBlockElement | ApiContentListBlockElement>
): ApiContentListBlockElementItem {
    const [actualElements, nestedListElements] = partitionArray(
        elements,
        (element): element is ApiContentParagraphBlockElement =>
            "type" in element && element.type === "Paragraph",
    );

    return {
        elements: actualElements,
        nestedListElements,
    };
}

function text(
    text: string,
    marks?: ReadonlyArray<ApiContentInlineElementMark>,
): ApiContentTextInlineElement {
    return {type: "Text", text, marks};
}

function mention(target: ApiMentionTarget): ApiContentMentionInlineElement {
    return {type: "Mention", target};
}

const bold: ApiContentInlineElementMark = {type: "Bold"};

export const mockAgentKingKongRecordingDocumentTitles = {
    universalVsNintendo: "Universal City Studios, Inc. v. Nintendo Co., Ltd.",
    kingKongVsGodzilla: "King Kong vs. Godzilla",
    kingKong2005Film: "King Kong (2005 film)",
};

export function createMockAgentKingKongRecording(
    documentIds: Record<keyof typeof mockAgentKingKongRecordingDocumentTitles, DocumentId>,
): MockAgentRecording {
    const playbackRate = 2;
    let lastTime: number | null = null;
    const recording: Array<MockAgentRecordingAction> = [];

    function ping(time: number) {
        if (lastTime === null) {
            lastTime = time;
        } else {
            const milliseconds = (time - lastTime) / playbackRate;
            if (milliseconds > 0) recording.push({type: "Wait", milliseconds});
            lastTime = time;
        }

        recording.push({type: "Ping"});
    }

    function put(time: number, index: number, payload: ApiMessageStreamPartPayload) {
        if (lastTime === null) {
            lastTime = time;
        } else {
            const milliseconds = (time - lastTime) / playbackRate;
            if (milliseconds > 0) recording.push({type: "Wait", milliseconds});
            lastTime = time;
        }

        recording.push({type: "PutPart", index, payload});
    }

    function putReasoningPart(
        time: number,
        index: number,
        ...elements: Array<ApiContentBlockElement>
    ) {
        put(time, index, {
            type: "Reasoning",
            content: {elements},
        });
    }

    function putContentPart(
        time: number,
        index: number,
        ...elements: Array<ApiContentBlockElement>
    ) {
        put(time, index, {
            type: "Content",
            content: {elements},
        });
    }

    ping(698361);

    put(702360, 0, {type: "ToolCall", call: {type: "Search", query: "King Kong legal case"}});

    put(703812, 1, {
        type: "ToolCall",
        call: {
            type: "Read",
            target: {type: "Document", id: documentIds.universalVsNintendo},
        },
    });

    put(705989, 2, {
        type: "ToolCall",
        call: {
            type: "Read",
            target: {type: "Document", id: documentIds.universalVsNintendo},
        },
    });

    ping(709060);

    putReasoningPart(
        714042,
        3,
        p(text("Exploring legal cases regarding King Kong", [bold])),
        p(
            "I\u2019m thinking about the relevant legal cases related to King Kong. One significant case is Universal v Nintendo. Another important one is Universal City Studios, Inc. v. RKO General, Inc. from 1975, which determined that King Kong rights were in the public domain concerning the film plot. There\u2019s also the case regarding Universal\u2019s 1976 remake rights and RKO. Ultimately, the rights surrounding King Kong are quite complicated, with several cases involved, including others like RKO v. Dino De Laurentiis.",
        ),
    );

    putReasoningPart(
        717207,
        4,
        p(text("Reviewing King Kong rights cases", [bold])),
        p(
            "I\u2019m thinking about the legal battles over King Kong rights. Cooper sued RKO in 1976, arguing he owned rights to King Kong, but the court ruled that RKO retained ownership of the film rights. However, it seems Cooper kept some publication rights. The original film is still copyrighted, but the 1932 novelization by Delos W. Lovelace entered the public domain in the 1960s. I should also look up \u201CUniversal City Studios v. RKO General\u201D to gather more information.",
        ),
    );

    put(718989, 5, {
        type: "ToolCall",
        call: {type: "Search", query: "Universal City Studios v. RKO General King Kong"},
    });

    put(720483, 6, {
        type: "ToolCall",
        call: {type: "Search", query: "Merian C. Cooper King Kong rights lawsuit RKO"},
    });

    ping(724374);

    putReasoningPart(
        728938,
        7,
        p(text("Investigating legal cases", [bold])),
        p(
            "Searching in Alpine might be a bit tricky since results may be limited. I can explain the Universal v. Nintendo case, which relies on a prior one, Universal City Studios v. RKO General, Inc., but I\u2019ll need to reference it carefully since the separate document isn\u2019t available. I need to link to Alpine documents while discussing relevant cases about King Kong, and it looks like \u201CKing Kong vs. Godzilla\u201D might have some rights discussions worth exploring. Let\u2019s open that up!",
        ),
    );

    put(729785, 8, {
        type: "ToolCall",
        call: {
            type: "Read",
            target: {type: "Document", id: documentIds.kingKongVsGodzilla},
        },
    });

    put(731006, 9, {
        type: "ToolCall",
        call: {
            type: "Read",
            target: {type: "Document", id: documentIds.kingKongVsGodzilla},
        },
    });

    put(734583, 10, {
        type: "ToolCall",
        call: {
            type: "Read",
            target: {type: "Document", id: documentIds.kingKong2005Film},
        },
    });

    ping(736444);

    put(741169, 11, {
        type: "ToolCall",
        call: {type: "Search", query: "King Kong public domain rights lawsuit"},
    });

    ping(742236);

    put(747490, 12, {
        type: "ToolCall",
        call: {type: "Search", query: "King Kong (1933 film) legal rights RKO lawsuit"},
    });

    ping(751825);

    ping(757176);

    putReasoningPart(
        762064,
        13,
        p(text("Planning legal search", [bold])),
        p(
            "I see this task isn\u2019t too challenging; it\u2019s mostly about searching and summarizing. First, I\u2019ll search Alpine for \u201CKing Kong\u201D and then pull out key cases. After that, I\u2019ll summarize the holdings and outcomes while including pointers to the relevant documents.",
        ),
        p(
            "I\u2019ll make sure to provide dates and outcomes, noting that the user is in PST. I\u2019ll check to clarify: the dates are in 1983, so no confusion there. I\u2019ll also add a prompt asking if the user wants me to dig deeper. I\u2019ll keep everything concise and stick to the \u201CSearch Alpine\u201D results.",
        ),
    );

    putReasoningPart(
        764796,
        14,
        p(text("Summarizing King Kong legal cases", [bold])),
        p(
            "I see some key details in play, like the 1984 appeals and the 1986 counterclaims decision that awarded damages of 1.8 million plus $56,689.41, along with fees and profits. This decision indicated that Tiger\u2019s King Kong infringed on Donkey Kong. The document quotes that \u201Cat best, Donkey Kong is a parody of King Kong\u201D and mentions there\u2019s \u201Cno right over the name King Kong.\u201D",
        ),
        p(
            "The user seems to be interested in the Donkey Kong case, specifically Universal City Studios, Inc. v. Nintendo Co., Ltd., from 1983 to 1986. I\u2019ll prepare the final response and provide the required links.",
        ),
    );

    putReasoningPart(
        767770,
        15,
        p(text("Drafting with clarity", [bold])),
        p(
            "I recognize that all Alpine links are acceptable, which is great! I need to keep in mind the word limits for my responses, ensuring they remain concise but still thorough. Balancing brevity with clarity is key here. Let\u2019s get started on drafting the content while adhering to those guidelines. I want to make sure I cover everything necessary without getting too lengthy. Keeping it neat and informative feels like the way to go!",
        ),
    );

    putContentPart(768541, 16, p("Plan:"));

    putContentPart(768648, 17, ul(p("Searched Alpine for \u201CKing Kong\u201D + legal/lawsuit.")));

    putContentPart(768661, 18, ul(p("Pulled the most relevant Alpine docs.")));

    putContentPart(
        768674,
        19,
        ul(p("Summarized each case\u2019s core facts, rulings, and impact.")),
    );

    putContentPart(768686, 20, ul(p("Linked to the source docs so you can dive deeper.")));

    putContentPart(768697, 21, p("Likely the one you\u2019re thinking of"));

    let part22Paragraph1: string;
    let part22Paragraph2: string;

    putContentPart(
        768708,
        22,
        ul(
            li(
                p(
                    (part22Paragraph1 =
                        "Universal City Studios, Inc. v. Nintendo Co., Ltd. (1982–1986) — Donkey Kong vs. King Kong"),
                ),
                ul(p((part22Paragraph2 = "What happened: Universal claimed"))),
            ),
        ),
    );

    putContentPart(
        768719,
        22,
        ul(
            li(
                p(part22Paragraph1),
                ul(
                    p(
                        (part22Paragraph2 +=
                            " Nintendo\u2019s Donkey Kong infringed King Kong. Nintendo countered that Universal had already argued King Kong\u2019s story/characters were public domain in a prior case against RKO. Judge Robert W. Sweet (S.D.N.Y.) found no Universal rights in \u201CKing Kong\u201D as a trademark and no likelihood of confusion; he also criticized Universal\u2019s threats to Nintendo\u2019s licensees. The Second Circuit affirmed. On Nintendo\u2019s counterclaims, Universal was ordered to"),
                    ),
                ),
            ),
        ),
    );

    putContentPart(
        768751,
        22,
        ul(
            li(
                p(part22Paragraph1),
                ul(
                    p(
                        (part22Paragraph2 +=
                            " pay Nintendo about $1.8M in fees/costs plus profits from Universal\u2019s King Kong licensing tied to the dispute (~$56.7k). Nintendo also got additional damages/fees; Tiger\u2019s \u201CKing Kong\u201D handheld was found to infringe Donkey Kong\u2019s expression. Impact: A landmark win for Nintendo and a key modern episode in the tangled \u201CKing Kong\u201D rights story. Source: Universal"),
                    ),
                ),
            ),
        ),
    );

    putContentPart(
        768856,
        22,
        ul(
            li(
                p(part22Paragraph1),
                ul(
                    p(
                        (part22Paragraph2 = part22Paragraph2.slice(0, -9)),
                        mention({type: "Document", id: documentIds.universalVsNintendo}),
                    ),
                ),
            ),
        ),
    );

    let part23Paragraph: string;

    putContentPart(768965, 23, p((part23Paragraph = "Other King Kong–related legal/")));

    putContentPart(769110, 23, {
        type: "Heading",
        level: 2,
        elements: [text((part23Paragraph += "/rights notes in Alpine"))],
    });

    putContentPart(769185, 23, p(part23Paragraph));

    let part24Paragraph1: string;
    let part24Paragraph2: string;

    putContentPart(769318, 24, ul(p((part24Paragraph1 = "Universal City Studios, Inc."))));

    putContentPart(769340, 24, ul(p((part24Paragraph1 += " v. RKO General, Inc"))));

    putContentPart(769407, 24, ul(p((part24Paragraph1 += ". (mid‑1970"))));

    putContentPart(769523, 24, ul(p((part24Paragraph1 += "s) — referenced within the"))));

    putContentPart(
        769686,
        24,
        ul(li(p((part24Paragraph1 += " Nintendo case")), ul(p((part24Paragraph2 = "Relevance"))))),
    );

    putContentPart(
        769741,
        24,
        ul(
            li(
                p(part24Paragraph1),
                ul(p((part24Paragraph2 += ": The Nintendo doc notes Universal had"))),
            ),
        ),
    );

    putContentPart(
        769858,
        24,
        ul(
            li(
                p(part24Paragraph1),
                ul(p((part24Paragraph2 += " previously argued the King Kong plot/"))),
            ),
        ),
    );

    putContentPart(
        769975,
        24,
        ul(
            li(
                p(part24Paragraph1),
                ul(p((part24Paragraph2 += "characters were in the public domain in"))),
            ),
        ),
    );

    putContentPart(
        770099,
        24,
        ul(
            li(
                p(part24Paragraph1),
                ul(p((part24Paragraph2 += " its litigation with RKO over the"))),
            ),
        ),
    );

    putContentPart(
        770233,
        24,
        ul(li(p(part24Paragraph1), ul(p((part24Paragraph2 += " 1976 remake, and Judge"))))),
    );

    putContentPart(
        770328,
        24,
        ul(
            li(
                p(part24Paragraph1),
                ul(p((part24Paragraph2 += " Sweet leaned on that history when rejecting"))),
            ),
        ),
    );

    putContentPart(
        770447,
        24,
        ul(
            li(
                p(part24Paragraph1),
                ul(p((part24Paragraph2 += " Universal\u2019s Donkey Kong claims."))),
            ),
        ),
    );

    putContentPart(
        770564,
        24,
        ul(
            li(
                p(part24Paragraph1),
                ul(p((part24Paragraph2 += " See discussion in Universal City Studios"))),
            ),
        ),
    );

    putContentPart(
        770680,
        24,
        ul(li(p(part24Paragraph1), ul(p((part24Paragraph2 += ", Inc. v. Nintendo"))))),
    );

    putContentPart(
        770803,
        24,
        ul(li(p(part24Paragraph1), ul(p((part24Paragraph2 += " Co., Ltd.(/document"))))),
    );

    putContentPart(
        770909,
        24,
        ul(li(p(part24Paragraph1), ul(p((part24Paragraph2 += "/universal-city-studios-inc-v"))))),
    );

    putContentPart(
        771022,
        24,
        ul(
            li(
                p(part24Paragraph1),
                ul(
                    p(
                        (part24Paragraph2 = part24Paragraph2.slice(0, -39)),
                        mention({type: "Document", id: documentIds.universalVsNintendo}),
                    ),
                ),
            ),
        ),
    );

    putContentPart(771132, 25, ul());

    let part25Paragraph1: string;

    putContentPart(771145, 25, ul(p((part25Paragraph1 = "Merian C. Cooper\u2019s"))));

    putContentPart(771242, 25, ul(p((part25Paragraph1 += " 196"))));

    putContentPart(771404, 25, ul(p((part25Paragraph1 += "3 lawsuit"))));

    putContentPart(771514, 25, ul(p((part25Paragraph1 += " over King"))));

    putContentPart(771705, 25, ul(p((part25Paragraph1 += " Kong"))));

    putContentPart(771949, 25, ul(p((part25Paragraph1 += " vs."))));

    putContentPart(772074, 25, ul(p((part25Paragraph1 += " God"))));

    putContentPart(772220, 25, ul(p((part25Paragraph1 += "zilla"))));

    let part25Paragraph2A: string;

    putContentPart(
        772336,
        25,
        ul(li(p(part25Paragraph1), ul(p((part25Paragraph2A = "What happened: Cooper (co"))))),
    );

    putContentPart(
        772506,
        25,
        ul(li(p(part25Paragraph1), ul(p((part25Paragraph2A += "-director/"))))),
    );

    putContentPart(
        772557,
        25,
        ul(li(p(part25Paragraph1), ul(p((part25Paragraph2A += "producer of"))))),
    );

    putContentPart(
        772661,
        25,
        ul(
            li(
                p(part25Paragraph1),
                ul(
                    p(
                        (part25Paragraph2A +=
                            " the 1933 film) tried to enjoin the distribution of To"),
                    ),
                ),
            ),
        ),
    );

    putContentPart(
        772828,
        25,
        ul(
            li(
                p(part25Paragraph1),
                ul(p((part25Paragraph2A += "ho\u2019s King Kong vs. Godzilla"))),
            ),
        ),
    );

    putContentPart(
        772947,
        25,
        ul(li(p(part25Paragraph1), ul(p((part25Paragraph2A += " (naming John Beck, To"))))),
    );

    putContentPart(
        773062,
        25,
        ul(
            li(
                p(part25Paragraph1),
                ul(p((part25Paragraph2A += "ho, and Universal). According to"))),
            ),
        ),
    );

    putContentPart(
        773173,
        25,
        ul(
            li(
                p(part25Paragraph1),
                ul(p((part25Paragraph2A += " the Alpine doc, it \u201Cnever"))),
            ),
        ),
    );

    putContentPart(
        773293,
        25,
        ul(li(p(part25Paragraph1), ul(p((part25Paragraph2A += " went through,\u201D"))))),
    );

    putContentPart(
        773402,
        25,
        ul(
            li(
                p(part25Paragraph1),
                ul(p((part25Paragraph2A += " because Cooper wasn\u2019t the sole owner he"))),
            ),
        ),
    );

    putContentPart(
        773543,
        25,
        ul(li(p(part25Paragraph1), ul(p((part25Paragraph2A += " believed he was. The same"))))),
    );

    putContentPart(
        773633,
        25,
        ul(li(p(part25Paragraph1), ul(p((part25Paragraph2A += " article notes Toho paid R"))))),
    );

    putContentPart(
        773748,
        25,
        ul(
            li(
                p(part25Paragraph1),
                ul(p((part25Paragraph2A += "KO for Kong rights for that film"))),
            ),
        ),
    );

    putContentPart(
        773848,
        25,
        ul(li(p(part25Paragraph1), ul(p((part25Paragraph2A += " and even had to alter Kong"))))),
    );

    putContentPart(
        773962,
        25,
        ul(
            li(
                p(part25Paragraph1),
                ul(p((part25Paragraph2A += "\u2019s face design at RKO\u2019s"))),
            ),
        ),
    );

    putContentPart(
        774107,
        25,
        ul(li(p(part25Paragraph1), ul(p((part25Paragraph2A += " direction, underscoring the"))))),
    );

    putContentPart(
        774187,
        25,
        ul(
            li(
                p(part25Paragraph1),
                ul(p((part25Paragraph2A += " messy rights landscape. Source: "))),
            ),
        ),
    );

    putContentPart(
        774304,
        25,
        ul(li(p(part25Paragraph1), ul(p((part25Paragraph2A += " King Kong vs. Godzilla"))))),
    );

    putContentPart(
        774415,
        25,
        ul(li(p(part25Paragraph1), ul(p((part25Paragraph2A += "(/document/king-kong-v"))))),
    );

    let part25Paragraph2B: string;

    putContentPart(
        774534,
        25,
        ul(
            li(
                p(part25Paragraph1),
                ul(
                    p(
                        text((part25Paragraph2A = part25Paragraph2A.slice(0, -22))),
                        mention({type: "Document", id: documentIds.kingKongVsGodzilla}),
                        text((part25Paragraph2B = " (")),
                    ),
                ),
            ),
        ),
    );

    putContentPart(
        774671,
        25,
        ul(
            li(
                p(part25Paragraph1),
                ul(
                    p(
                        text(part25Paragraph2A),
                        mention({type: "Document", id: documentIds.kingKongVsGodzilla}),
                        text((part25Paragraph2B += "see \u201CConception\u201D and production")),
                    ),
                ),
            ),
        ),
    );

    putContentPart(
        774756,
        25,
        ul(
            li(
                p(part25Paragraph1),
                ul(
                    p(
                        text(part25Paragraph2A),
                        mention({type: "Document", id: documentIds.kingKongVsGodzilla}),
                        text((part25Paragraph2B += " notes)")),
                    ),
                ),
            ),
        ),
    );

    let part26Paragraph1: string;
    let part26Paragraph2: string;

    putContentPart(774870, 26, ul(p((part26Paragraph1 = "Public‑domain"))));

    putContentPart(
        774880,
        26,
        ul(p(text((part26Paragraph1 += " (as described in Alpine)"), [bold]))),
    );

    putContentPart(
        774978,
        26,
        ul(
            li(
                p(part26Paragraph1),
                ul(
                    p(
                        (part26Paragraph2 =
                            "The Alpine entry on Peter Jackson\u2019s 2005 remake states that"),
                    ),
                ),
            ),
        ),
    );

    putContentPart(
        775104,
        26,
        ul(
            li(
                p(part26Paragraph1),
                ul(
                    p(
                        (part26Paragraph2 +=
                            " Universal \u201Cdid not have to worry about lawsuits concerning"),
                    ),
                ),
            ),
        ),
    );

    putContentPart(
        775265,
        26,
        ul(
            li(
                p(part26Paragraph1),
                ul(p((part26Paragraph2 += " the film rights from RKO … because the King Kong"))),
            ),
        ),
    );

    putContentPart(
        775308,
        26,
        ul(
            li(
                p(part26Paragraph1),
                ul(
                    p(
                        (part26Paragraph2 +=
                            " character is held in the public domain.\u201D This reflects"),
                    ),
                ),
            ),
        ),
    );

    putContentPart(
        775423,
        26,
        ul(li(p(part26Paragraph1), ul(p((part26Paragraph2 += " the way Alpine sources"))))),
    );

    putContentPart(
        775539,
        26,
        ul(
            li(
                p(part26Paragraph1),
                ul(p((part26Paragraph2 += " frame the status, and it connects"))),
            ),
        ),
    );

    putContentPart(
        775645,
        26,
        ul(
            li(
                p(part26Paragraph1),
                ul(
                    p(
                        (part26Paragraph2 +=
                            " to how \u201Cpublic domain\u201D arguments were leveraged"),
                    ),
                ),
            ),
        ),
    );

    putContentPart(
        775803,
        26,
        ul(
            li(
                p(part26Paragraph1),
                ul(p((part26Paragraph2 += " in the Nintendo litigation. Source: King"))),
            ),
        ),
    );

    putContentPart(
        775866,
        26,
        ul(
            li(
                p(part26Paragraph1),
                ul(p((part26Paragraph2 += " Kong (2005 film)(/document/king-kong-200"))),
            ),
        ),
    );

    putContentPart(
        778057,
        26,
        ul(
            li(
                p(part26Paragraph1),
                ul(
                    p(
                        text((part26Paragraph2 = part26Paragraph2.slice(0, -24))),
                        mention({type: "Document", id: documentIds.kingKong2005Film}),
                        text(" and discussion in "),
                        mention({type: "Document", id: documentIds.universalVsNintendo}),
                    ),
                ),
            ),
        ),
    );

    putContentPart(
        778069,
        27,
        p(
            "Want me to pull key quotes, dates, and dollar figures into a one‑page brief, or map out a rights chain timeline (RKO → Toho deals → Universal remakes → modern status) from these Alpine sources?",
        ),
    );

    return recording;
}
