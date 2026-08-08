import {DocumentContentSchema} from "~/shared/documents/document_content_schema.js";
import {Lazy} from "~/shared/helpers/control/lazy.open_source.js";

export const dummyDocumentContent = new Lazy(() => {
    return DocumentContentSchema.deserialize({
        type: "doc",
        content: [
            {
                type: "title",
                content: [
                    {
                        type: "text",
                        text: "Manifesto of the Communist Party",
                    },
                ],
            },
            {
                type: "paragraph",
                content: [
                    {
                        type: "text",
                        text: "A spectre is haunting Europe — the spectre of communism. All the powers of old Europe have entered into a holy alliance to exorcise this spectre: Pope and Tsar, Metternich and Guizot, French Radicals and German police-spies.",
                    },
                ],
            },
            {
                type: "paragraph",
                content: [
                    {
                        type: "text",
                        text: "Where is the party in opposition that has not been decried as communistic by its opponents in power? Where is the opposition that has not hurled back the branding reproach of communism, against the more advanced opposition parties, as well as against its reactionary adversaries?",
                    },
                ],
            },
            {
                type: "paragraph",
                content: [
                    {
                        type: "text",
                        text: "Two things result from this fact:",
                    },
                ],
            },
            {
                type: "paragraph",
                content: [
                    {
                        type: "text",
                        text: "I. Communism is already acknowledged by all European powers to be itself a power.",
                    },
                ],
            },
            {
                type: "paragraph",
                content: [
                    {
                        type: "text",
                        text: "II. It is high time that Communists should openly, in the face of the whole world, publish their views, their aims, their tendencies, and meet this nursery tale of the Spectre of Communism with a manifesto of the party itself.",
                    },
                ],
            },
            {
                type: "paragraph",
                content: [
                    {
                        type: "text",
                        text: "To this end, Communists of various nationalities have assembled in London and sketched the following manifesto, to be published in the English, French, German, Italian, Flemish and Danish ",
                    },
                    {
                        type: "text",
                        marks: [
                            {
                                type: "link",
                                attrs: {
                                    url: "https://www.marxists.org/xlang/marx.htm",
                                },
                            },
                        ],
                        text: "languages",
                    },
                    {
                        type: "text",
                        text: ".",
                    },
                ],
            },
            {
                type: "heading",
                attrs: {
                    level: 1,
                },
                content: [
                    {
                        type: "text",
                        text: "Chapter I. Bourgeois and Proletarians",
                    },
                ],
            },
            {
                type: "paragraph",
                content: [
                    {
                        type: "text",
                        text: "The history of all hitherto existing society",
                    },
                    {
                        type: "text",
                        marks: [
                            {
                                type: "link",
                                attrs: {
                                    url: "https://www.marxists.org/archive/marx/works/1848/communist-manifesto/ch01.htm#a2",
                                },
                            },
                        ],
                        text: "(2)",
                    },
                    {
                        type: "text",
                        text: " is the history of class struggles.",
                    },
                ],
            },
            {
                type: "paragraph",
                content: [
                    {
                        type: "text",
                        text: "Freeman and slave, patrician and plebeian, lord and serf, guild-master",
                    },
                    {
                        type: "text",
                        marks: [
                            {
                                type: "link",
                                attrs: {
                                    url: "https://www.marxists.org/archive/marx/works/1848/communist-manifesto/ch01.htm#a3",
                                },
                            },
                        ],
                        text: "(3)",
                    },
                    {
                        type: "text",
                        text: " and journeyman, in a word, oppressor and oppressed, stood in constant opposition to one another, carried on an uninterrupted, now hidden, now open fight, a fight that each time ended, either in a revolutionary reconstitution of society at large, or in the common ruin of the contending classes.",
                    },
                ],
            },
            {
                type: "paragraph",
                content: [
                    {
                        type: "text",
                        text: "In the earlier epochs of history, we find almost everywhere a complicated arrangement of society into various orders, a manifold gradation of social rank. In ancient Rome we have patricians, knights, plebeians, slaves; in the Middle Ages, feudal lords, vassals, guild-masters, journeymen, apprentices, serfs; in almost all of these classes, again, subordinate gradations.",
                    },
                ],
            },
            {
                type: "paragraph",
                content: [
                    {
                        type: "text",
                        text: "The modern bourgeois society that has sprouted from the ruins of feudal society has not done away with class antagonisms. It has but established new classes, new conditions of oppression, new forms of struggle in place of the old ones.",
                    },
                ],
            },
            {
                type: "paragraph",
                content: [
                    {
                        type: "text",
                        text: "Our epoch, the epoch of the bourgeoisie, possesses, however, this distinct feature: it has simplified class antagonisms. Society as a whole is more and more splitting up into two great hostile camps, into two great classes directly facing each other — Bourgeoisie and Proletariat.",
                    },
                ],
            },
            {
                type: "paragraph",
                content: [
                    {
                        type: "text",
                        text: "From the serfs of the Middle Ages sprang the chartered burghers of the earliest towns. From these burgesses the first elements of the bourgeoisie were developed.",
                    },
                ],
            },
            {
                type: "paragraph",
                content: [
                    {
                        type: "text",
                        text: "The discovery of America, the rounding of the Cape, opened up fresh ground for the rising bourgeoisie. The East-Indian and Chinese markets, the colonisation of America, trade with the colonies, the increase in the means of exchange and in commodities generally, gave to commerce, to navigation, to industry, an impulse never before known, and thereby, to the revolutionary element in the tottering feudal society, a rapid development.",
                    },
                ],
            },
            {
                type: "paragraph",
                content: [
                    {
                        type: "text",
                        text: "The feudal system of industry, in which industrial production was monopolised by closed guilds, now no longer sufficed for the growing wants of the new markets. The manufacturing system took its place. The guild-masters were pushed on one side by the manufacturing middle class; division of labour between the different corporate guilds vanished in the face of division of labour in each single workshop.",
                    },
                ],
            },
        ],
    });
});
