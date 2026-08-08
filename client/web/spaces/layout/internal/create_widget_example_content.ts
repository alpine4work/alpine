import {scenarioCassCadeAvatarContent} from "~/client/web/spaces/layout/internal/fixtures/scenario_cass_cade_avatar_content.js";
import {scenarioCliffWeathersAvatarContent} from "~/client/web/spaces/layout/internal/fixtures/scenario_cliff_weathers_avatar_content.js";
import {scenarioElleKappaTanAvatarContent} from "~/client/web/spaces/layout/internal/fixtures/scenario_elle_kappa_tan_avatar_content.js";
import {scenarioHollyEvergreenAvatarContent} from "~/client/web/spaces/layout/internal/fixtures/scenario_holly_evergreen_avatar_content.js";
import {scenarioMasonClayAvatarContent} from "~/client/web/spaces/layout/internal/fixtures/scenario_mason_clay_avatar_content.js";
import {scenarioMattRHornAvatarContent} from "~/client/web/spaces/layout/internal/fixtures/scenario_matt_r_horn_avatar_content.js";
import {scenarioRoseCompasAvatarContent} from "~/client/web/spaces/layout/internal/fixtures/scenario_rose_compas_avatar_content.js";
import {ThemeColor} from "~/shared/design/core/theme_colors.js";
import {getObjectKeysWithKeyofType} from "~/shared/helpers/object/get_object_keys_with_keyof_type.open_source.js";
import {Schema} from "~/shared/schema/schema.open_source.js";

export type CreateWidgetExamplePerson = {
    readonly name: string;
    readonly avatarContent: Uint8Array;
};

export type CreateWidgetExampleContent = {
    readonly document: {
        readonly title: string;
        readonly paragraph1: string;
        readonly paragraph2: string;
    };
    readonly task: {
        readonly title: string;
        readonly assignee: CreateWidgetExamplePerson;
    };
    readonly projectTask: {
        readonly title: string;
        readonly otherChildTaskTitle: string;
    };
    readonly taskCollection: {
        readonly name: string;
        readonly color: ThemeColor;
    };
    readonly taskQuery: {
        readonly taskTitle1: string;
        readonly taskTitle2: string;
    };
    readonly post: {
        readonly paragraph: string;
        readonly author: CreateWidgetExamplePerson;
    };
    readonly channel: {
        readonly name: string;
    };
    readonly chatMessage: {
        readonly paragraph: string;
        readonly author: CreateWidgetExamplePerson;
    };
    readonly chatRoom: {
        readonly name: string;
    };
};

const roseCompasCreateWidgetExamplePerson: CreateWidgetExamplePerson = {
    name: "Rose Compas",
    avatarContent: scenarioRoseCompasAvatarContent,
};

const cassCadeCreateWidgetExamplePerson: CreateWidgetExamplePerson = {
    name: "Cass Cade",
    avatarContent: scenarioCassCadeAvatarContent,
};

const elleKappaTanCreateWidgetExamplePerson: CreateWidgetExamplePerson = {
    name: "Elle Kappa-Tan",
    avatarContent: scenarioElleKappaTanAvatarContent,
};

const masonClayCreateWidgetExamplePerson: CreateWidgetExamplePerson = {
    name: "Mason Clay",
    avatarContent: scenarioMasonClayAvatarContent,
};

const mattRHornCreateWidgetExamplePerson: CreateWidgetExamplePerson = {
    name: "Matt R. Horn",
    avatarContent: scenarioMattRHornAvatarContent,
};

const cliffWeathersCreateWidgetExamplePerson: CreateWidgetExamplePerson = {
    name: "Cliff Weathers",
    avatarContent: scenarioCliffWeathersAvatarContent,
};

const hollyEvergreenCreateWidgetExamplePerson: CreateWidgetExamplePerson = {
    name: "Holly Evergreen",
    avatarContent: scenarioHollyEvergreenAvatarContent,
};

const createWidgetExampleFounderContent: CreateWidgetExampleContent = {
    document: {
        title: "Company vision",
        paragraph1:
            "We spent years dealing with a problem that had no good solution. We kept waiting for someone to fix it. Nobody did.",
        paragraph2:
            "Our goal is to make something so useful that people can\u2019t imagine going back to the old way of doing things.",
    },
    task: {
        title: "Write job description",
        assignee: cassCadeCreateWidgetExamplePerson,
    },
    projectTask: {
        title: "First hire",
        otherChildTaskTitle: "Interview top candidates",
    },
    taskCollection: {
        name: "Recruiting",
        color: "orange",
    },
    taskQuery: {
        taskTitle1: "Prepare finances for tax accountant",
        taskTitle2: "Schedule team offsite",
    },
    post: {
        paragraph: "If you had more marketing budget how would you use it?",
        author: roseCompasCreateWidgetExamplePerson,
    },
    channel: {
        name: "Marketing",
    },
    chatMessage: {
        paragraph: "Our post is going viral, can you respond to comments?",
        author: mattRHornCreateWidgetExamplePerson,
    },
    chatRoom: {
        name: "Launch day coordination",
    },
};

const createWidgetExampleMarketerContent: CreateWidgetExampleContent = {
    document: {
        title: "Website copy draft",
        paragraph1:
            "First draft of the text on our new landing page. Focuses on the problem agitation section then the solution section.",
        paragraph2:
            "This draft doesn\u2019t include the copy that goes in product screenshots. Our website designer is responsible for that.",
    },
    task: {
        title: "Write website copy",
        assignee: hollyEvergreenCreateWidgetExamplePerson,
    },
    projectTask: {
        title: "Website redesign",
        otherChildTaskTitle: "Create new product screenshots",
    },
    taskCollection: {
        name: "Marketing",
        color: "orange",
    },
    taskQuery: {
        taskTitle1: "Ad campaign creative",
        taskTitle2: "Run website headline experiment",
    },
    post: {
        paragraph: "Which of these three options for the new website is your favorite?",
        author: mattRHornCreateWidgetExamplePerson,
    },
    channel: {
        name: "Marketing",
    },
    chatMessage: {
        paragraph: "The event starts soon. How do we open the supply closet?",
        author: cliffWeathersCreateWidgetExamplePerson,
    },
    chatRoom: {
        name: "Launch day coordination",
    },
};

const createWidgetExampleDesignerContent: CreateWidgetExampleContent = {
    document: {
        title: "Design system",
        paragraph1:
            "Defines the colors, type styles, spacing, and icons used across the product. The source of truth for all visual decisions.",
        paragraph2:
            "Motion and animation rules are not covered here. Those will be added once we finalize the core visual language.",
    },
    task: {
        title: "Redesign login screen",
        assignee: mattRHornCreateWidgetExamplePerson,
    },
    projectTask: {
        title: "App redesign",
        otherChildTaskTitle: "Create new color palette",
    },
    taskCollection: {
        name: "Design",
        color: "purple",
    },
    taskQuery: {
        taskTitle1: "Update button loading state",
        taskTitle2: "Redesign onboarding flow",
    },
    post: {
        paragraph: "Three options for the new dashboard layout. Which direction do you prefer?",
        author: masonClayCreateWidgetExamplePerson,
    },
    channel: {
        name: "Design",
    },
    chatMessage: {
        paragraph: "Executive review starts soon. Can you send the latest design?",
        author: cassCadeCreateWidgetExamplePerson,
    },
    chatRoom: {
        name: "Launch day coordination",
    },
};

const createWidgetExampleEngineerContent: CreateWidgetExampleContent = {
    document: {
        title: "Search tech spec",
        paragraph1:
            "The implementation plan for our new search feature. Includes a rough breakdown of the work by milestone.",
        paragraph2: "We estimate search will take 1-5 months to build.",
    },
    task: {
        title: "Fix dark mode flicker",
        assignee: elleKappaTanCreateWidgetExamplePerson,
    },
    projectTask: {
        title: "Dark mode",
        otherChildTaskTitle: "Write integration tests",
    },
    taskCollection: {
        name: "Bugs",
        color: "red",
    },
    taskQuery: {
        taskTitle1: "Fix null pointer error",
        taskTitle2: "Upgrade database library",
    },
    post: {
        paragraph: "With the redesign, should we also rewrite the app from scratch?",
        author: masonClayCreateWidgetExamplePerson,
    },
    channel: {
        name: "Engineering",
    },
    chatMessage: {
        paragraph: "Tests are failing on the latest deploy. Can we rollback?",
        author: cassCadeCreateWidgetExamplePerson,
    },
    chatRoom: {
        name: "Incident Response",
    },
};

const createWidgetExampleProductManagerContent: CreateWidgetExampleContent = {
    document: {
        title: "Q2 Roadmap",
        paragraph1:
            "Our three themes for Q2 are mobile, onboarding, and search. Each one has a lead and metrics we\u2019re looking to improve.",
        paragraph2:
            "The calendar feature got pushed to Q3 to make room. Search came out ahead in user research so we moved it up.",
    },
    task: {
        title: "Write search feature spec",
        assignee: cassCadeCreateWidgetExamplePerson,
    },
    projectTask: {
        title: "Search feature",
        otherChildTaskTitle: "Build search backend",
    },
    taskCollection: {
        name: "Q2 Roadmap",
        color: "cyan",
    },
    taskQuery: {
        taskTitle1: "Schedule user interviews",
        taskTitle2: "Make retention metric dashboard",
    },
    post: {
        paragraph: "What should we cut from the roadmap to hit our deadline?",
        author: roseCompasCreateWidgetExamplePerson,
    },
    channel: {
        name: "Product Leads",
    },
    chatMessage: {
        paragraph: "They\u2019re asking about pricing on social media, can you respond?",
        author: cliffWeathersCreateWidgetExamplePerson,
    },
    chatRoom: {
        name: "Launch day coordination",
    },
};

const createWidgetExampleSalesContent: CreateWidgetExampleContent = {
    document: {
        title: "Enterprise renewal proposal",
        paragraph1:
            "Draft proposal. Covers the new pricing tiers, the discount offer, and the support plan.",
        paragraph2:
            "Legal has not reviewed the contract terms yet. Do not share this with the customer until we get their sign-off.",
    },
    task: {
        title: "Follow up with customer",
        assignee: cliffWeathersCreateWidgetExamplePerson,
    },
    projectTask: {
        title: "Enterprise renewal",
        otherChildTaskTitle: "Send contract draft",
    },
    taskCollection: {
        name: "Pipeline",
        color: "green",
    },
    taskQuery: {
        taskTitle1: "Schedule enterprise demos",
        taskTitle2: "Review lost deals",
    },
    post: {
        paragraph: "Should we offer a discount to close the deal this quarter?",
        author: cassCadeCreateWidgetExamplePerson,
    },
    channel: {
        name: "Deal Room",
    },
    chatMessage: {
        paragraph: "Client is on hold asking about pricing. What should I tell them?",
        author: hollyEvergreenCreateWidgetExamplePerson,
    },
    chatRoom: {
        name: "Sales Floor",
    },
};

const createWidgetExampleConsultantContent: CreateWidgetExampleContent = {
    document: {
        title: "Project findings",
        paragraph1: "Covers the three main gaps we found and our initial recommendations.",
        paragraph2:
            "We present these findings to the client next week. The goal is to agree on which gaps to tackle first.",
    },
    task: {
        title: "Stakeholder interviews",
        assignee: roseCompasCreateWidgetExamplePerson,
    },
    projectTask: {
        title: "Client onboarding",
        otherChildTaskTitle: "Send first invoice",
    },
    taskCollection: {
        name: "Billable work",
        color: "purple",
    },
    taskQuery: {
        taskTitle1: "Review final deliverables",
        taskTitle2: "Write weekly update",
    },
    post: {
        paragraph:
            "What\u2019s the client\u2019s brand guidelines? I want to use them in our report.",
        author: mattRHornCreateWidgetExamplePerson,
    },
    channel: {
        name: "Client work",
    },
    chatMessage: {
        paragraph: "Client wants changes to the report. Can you update it today?",
        author: elleKappaTanCreateWidgetExamplePerson,
    },
    chatRoom: {
        name: "Client coordination",
    },
};

export const createWidgetExampleContentByRole = {
    Founder: createWidgetExampleFounderContent,
    Marketer: createWidgetExampleMarketerContent,
    Designer: createWidgetExampleDesignerContent,
    Engineer: createWidgetExampleEngineerContent,
    ProductManager: createWidgetExampleProductManagerContent,
    Sales: createWidgetExampleSalesContent,
    Consultant: createWidgetExampleConsultantContent,
};

export type CreateWidgetExampleContentRole = keyof typeof createWidgetExampleContentByRole;

export const startOfSentenceNameByCreateWidgetExampleContentRole: Record<
    CreateWidgetExampleContentRole,
    string
> = {
    Founder: "Founder",
    Marketer: "Marketer",
    Designer: "Designer",
    Engineer: "Engineer",
    ProductManager: "Product manager",
    Sales: "Sales",
    Consultant: "Consultant",
};

export const nameByCreateWidgetExampleContentRole: Record<CreateWidgetExampleContentRole, string> =
    {
        Founder: "founder",
        Marketer: "marketer",
        Designer: "designer",
        Engineer: "engineer",
        ProductManager: "product manager",
        Sales: "sales",
        Consultant: "consultant",
    };

export const allCreateWidgetExampleContentRoles = getObjectKeysWithKeyofType(
    createWidgetExampleContentByRole,
);

export const CreateWidgetExampleContentRoleSchema: Schema<CreateWidgetExampleContentRole> =
    Schema.enum(allCreateWidgetExampleContentRoles);
