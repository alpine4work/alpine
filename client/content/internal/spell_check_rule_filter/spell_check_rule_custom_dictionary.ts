import type {SpellCheckRuleFilter} from "~/client/content/internal/spell_check_rule_filter/spell_check_rule_filter.js";

const generalWords = ["demos", "checkout", "realtime", "hostname", "localhost", "lego"];

const loanWords = [
    "fiancée",
    "fiancé",
    "déjà",
    "vu",
    "jalapeño",
    "attaché",
    "café",
    "résumé",
    "exposé",
    "soufflé",
    "touché",
    "cliché",
    "entrée",
    "façade",
    "naïve",
    "soirée",
    "protégé",
    "blasé",
    "papier-mâché",
];

const latinWords = [
    "per",
    "se",
    "ipso",
    "facto",
    "et",
    "al",
    "et",
    "cetera",
    "priori",
    "nauseum",
    "alma",
    "mater",
    "bona",
    "fide",
    "jure",
    "de",
    "facto",
    "memoriam",
    "extremis",
    "modus",
    "operandi",
    "diem",
];

const shortenedWords = ["etc"];

const quirkyChatWords = ["lol", "brb", "btw", "imo", "idk", "smh", "fomo", "tbh", "irl", "dm"];

const canadianSpellings = [
    "abridgement",
    "acknowledgement",
    "aeroplane",
    "aeon",
    "amoeba",
    "anaesthesia",
    "analyse",
    "arbour",
    "axe",
    "barrelled",
    "behaviour",
    "belabour",
    "brunette",
    "calibre",
    "cancelled",
    "candour",
    "catalogue",
    "centimetre",
    "centre",
    "cheque",
    "clamour",
    "colour",
    "counsellor",
    "crueller",
    "crystalline",
    "crystallize",
    "defence",
    "dialogue",
    "encyclopaedia",
    "favour",
    "favourite",
    "fervour",
    "fibre",
    "flavour",
    "fuelled",
    "fulfil",
    "funnelled",
    "gauge",
    "goitre",
    "grey",
    "gruelling",
    "harbour",
    "honour",
    "humour",
    "imperilled",
    "instalment",
    "jeweller",
    "kilometre",
    "labelled",
    "labour",
    "levelled",
    "licence",
    "litre",
    "louvre",
    "lustre",
    "macabre",
    "manoeuvre",
    "marvellous",
    "matte",
    "meagre",
    "medallist",
    "metre",
    "millimetre",
    "mitre",
    "modelled",
    "mould",
    "moult",
    "moustache",
    "neighbour",
    "odour",
    "paean",
    "paleolothic",
    "panelled",
    "panelling",
    "parlour",
    "practise",
    "pummelled",
    "pyjamas",
    "queueing",
    "rancour",
    "raquet",
    "reconnoitre",
    "saleable",
    "savour",
    "sceptre",
    "smoulder",
    "sombre",
    "sulphate",
    "sulphur",
    "theatre",
    "tonne",
    "totalled",
    "tranquillize",
    "traveller",
    "tumour",
    "tunnelled",
    "valour",
    "vapour",
    "vice",
    "vigour",
    "wilful",
    "worshipped",
];

const spellCheckCustomDictionary = new Set<string>([
    ...loanWords,
    ...latinWords,
    ...generalWords,
    ...shortenedWords,
    ...quirkyChatWords,
    ...canadianSpellings,
]);

const holidays = ["Juneteenth"];

const names = ["Alpine", "Airtable"];

const spellCheckProperNounsDictionary = new Set<string>([...holidays, ...names]);

export const spellCheckRuleFilterCustomDictionary: SpellCheckRuleFilter = lint => {
    const {text, breakingRuleKind} = lint;

    if (breakingRuleKind === "spelling" && spellCheckCustomDictionary.has(text.toLowerCase())) {
        return false;
    }

    // Check proper nouns with exact case matching
    if (breakingRuleKind === "spelling" && spellCheckProperNounsDictionary.has(text)) {
        return false;
    }

    return true;
};
