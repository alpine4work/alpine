import {ZonedDateTime, fromDate, isSameDay, toCalendarDate} from "@internationalized/date";
import {Column, Container, Hr, Img, Row, Section} from "@react-email/components";
import React, {Fragment} from "react";
import {EmailAccountAvatar} from "~/server/emails/internal/components/email_account_avatar.js";
import {EmailLink} from "~/server/emails/internal/components/email_link.js";
import {EmailText, emailFontStyles} from "~/server/emails/internal/components/email_text.js";
import {BaseEmailTemplate} from "~/server/emails/internal/templates/base_email_template.js";
import {EmailFooter} from "~/server/emails/internal/templates/email_footer.js";
import {getAccountShortNameWithoutFullNameTooltip} from "~/shared/accounts/get_account_short_name_without_full_name_tooltip.js";
import {borderRadius} from "~/shared/design/core/border_radius.js";
import {colors} from "~/shared/design/core/colors.js";
import {convertRemLengthToPx, spacing} from "~/shared/design/core/spacing.js";
import {defaultThemeColor} from "~/shared/design/core/theme_colors.js";
import {formatPrettyAbsoluteDateWithoutFullTimeTooltip} from "~/shared/design/format_pretty_absolute_date_without_full_time_tooltip.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.js";
import {cast} from "~/shared/helpers/control/cast.js";
import {getIntlDateTimeFormat} from "~/shared/helpers/intl/get_intl_date_time_format.js";
import {Locale, defaultLocale} from "~/shared/helpers/intl/locale.js";
import {TimeZone} from "~/shared/helpers/intl/time_zone.js";
import {iterableFirst} from "~/shared/helpers/iterable/iterable_first.js";
import {AccountId} from "~/shared/id/types/id_types.js";
import {AccountModelData} from "~/shared/spaces/account_model.js";

export type DigestNotificationContent = {
    inboxUrl: string;
    digestEntries: Array<DigestEntry>;
    remainingEntryCount: number;
};

export type DigestEntry = {
    id: string;
    url: string;
    title: Array<string | {type: "Account"; name: string}>;
    summary: string;
    brandIconType: string;
    time: Date;
    loudNotificationCount: number;
    firstAccount: AccountModelData;
    secondAccount?: AccountModelData;
};

export function NotificationDigestEmailTemplate({
    baseUrl,
    locale,
    localizedDigestTime,
    spaceName,
    unsubscribeUrl,
    digestContent,
}: {
    baseUrl: string;
    locale: Locale;
    localizedDigestTime: ZonedDateTime;
    spaceName: string;
    unsubscribeUrl: string;
    digestContent: DigestNotificationContent;
}) {
    const parsedEntries = digestContent.digestEntries.map(entry => {
        const dateString = formatPrettyRelativeLocalDateWithTime(
            entry.time,
            localizedDigestTime.toDate(),
            localizedDigestTime.timeZone as TimeZone,
            locale ?? defaultLocale,
        );

        return {
            ...entry,
            dateString,
        };
    });

    const loudNotificationAccountByIds = new Map<AccountId, AccountModelData>();

    for (const entry of parsedEntries) {
        if (
            entry.loudNotificationCount > 0 &&
            !loudNotificationAccountByIds.has(entry.firstAccount.id)
        ) {
            loudNotificationAccountByIds.set(entry.firstAccount.id, entry.firstAccount);
        }
    }

    // If the user has some urgent notifications, let's give them an urgent subject
    // line to hopefully get them to open the email.
    let title;
    if (loudNotificationAccountByIds.size === 1) {
        const account = assertExists(iterableFirst(loudNotificationAccountByIds.values()));
        const accountShortName = getAccountShortNameWithoutFullNameTooltip(account);

        title = `${accountShortName} is trying to get your attention in ${spaceName}`;
    } else if (loudNotificationAccountByIds.size === 2) {
        const [account1, account2] = loudNotificationAccountByIds.values();
        assert(account1 && account2);
        const account1ShortName = getAccountShortNameWithoutFullNameTooltip(account1);
        const account2ShortName = getAccountShortNameWithoutFullNameTooltip(account2);

        title = `${account1ShortName} and ${account2ShortName} are trying to get your attention in ${spaceName}`;
    } else if (loudNotificationAccountByIds.size === 3) {
        const [account1, account2, account3] = loudNotificationAccountByIds.values();
        assert(account1 && account2 && account3);
        const account1ShortName = getAccountShortNameWithoutFullNameTooltip(account1);
        const account2ShortName = getAccountShortNameWithoutFullNameTooltip(account2);
        const account3ShortName = getAccountShortNameWithoutFullNameTooltip(account3);

        title = `${account1ShortName}, ${account2ShortName}, and ${account3ShortName} are trying to get your attention in ${spaceName}`;
    } else if (loudNotificationAccountByIds.size >= 4) {
        const [account1, account2, account3] = loudNotificationAccountByIds.values();
        assert(account1 && account2 && account3);
        const account1ShortName = getAccountShortNameWithoutFullNameTooltip(account1);
        const account2ShortName = getAccountShortNameWithoutFullNameTooltip(account2);
        const account3ShortName = getAccountShortNameWithoutFullNameTooltip(account3);

        title = `${account1ShortName}, ${account2ShortName}, ${account3ShortName}, and ${
            loudNotificationAccountByIds.size - 3
        } others are trying to get your attention in ${spaceName}`;
    } else {
        title = `What’s been happening in ${spaceName}`;
    }

    return (
        <BaseEmailTemplate
            baseUrl={baseUrl}
            /* eslint-disable string-quotes */
            globalStyles={`
                @media (prefers-color-scheme: dark) {
                    .chat-brand-icon {
                        background-image: url('${baseUrl}/icons/chat_brand_icon_dark.png') !important;
                    }
                    .document-brand-icon {
                        background-image: url('${baseUrl}/icons/document_brand_icon_dark.png') !important;
                    }
                    .post-brand-icon {
                        background-image: url('${baseUrl}/icons/post_brand_icon_dark.png') !important;
                    }
                    .task-brand-icon {
                        background-image: url('${baseUrl}/icons/task_brand_icon_dark.png') !important;
                    }
                }
            `}
            preview={title}
            /* eslint-enable string-quotes */
        >
            <Section>
                <EmailText fontSize="500" fontStyle="bold">
                    Recent activity in {spaceName}
                </EmailText>
            </Section>
            <Section style={{marginBottom: convertRemLengthToPx(spacing["2"], "medium")}}>
                {parsedEntries.map((entry, index) => (
                    <React.Fragment key={entry.id}>
                        {index === 0 && <Hr />}

                        <Row
                            style={{
                                width: "100%",
                                borderCollapse: "separate",
                                verticalAlign: "middle",
                            }}
                        >
                            <Column width={92}>
                                {entry.secondAccount ? (
                                    <TwoAccountAvatar entry={entry} baseUrl={baseUrl} />
                                ) : (
                                    <OneAccountAvatar entry={entry} baseUrl={baseUrl} />
                                )}
                            </Column>
                            <Column>
                                <EmailText
                                    color="grey-40"
                                    fontSize="50"
                                    style={{
                                        marginTop: convertRemLengthToPx(spacing["3"], "medium"),
                                        marginBottom: 0,
                                    }}
                                >
                                    {entry.dateString}
                                </EmailText>
                                <EmailLink color="grey-100" href={`${baseUrl}${entry.url}`}>
                                    <Row>
                                        <EmailText
                                            fontSize="200"
                                            color="grey-100"
                                            style={{
                                                marginBottom: convertRemLengthToPx(
                                                    spacing["1"],
                                                    "medium",
                                                ),
                                                marginTop: convertRemLengthToPx(
                                                    spacing["0.5"],
                                                    "medium",
                                                ),
                                            }}
                                        >
                                            {entry.title.map((item, index) => {
                                                if (typeof item === "string") {
                                                    return <Fragment key={index}> {item}</Fragment>;
                                                } else {
                                                    cast<"Account">(item.type);
                                                    return (
                                                        <span
                                                            key={index}
                                                            style={{
                                                                fontWeight:
                                                                    emailFontStyles.bold.fontWeight,
                                                            }}
                                                        >
                                                            {item.name}
                                                        </span>
                                                    );
                                                }
                                            })}
                                        </EmailText>
                                    </Row>
                                    <Row>
                                        <EmailText
                                            fontSize="100"
                                            color="grey-60"
                                            style={{
                                                marginBottom: convertRemLengthToPx(
                                                    spacing["3"],
                                                    "medium",
                                                ),
                                                marginTop: 0,
                                            }}
                                        >
                                            {entry.summary}
                                        </EmailText>
                                    </Row>
                                </EmailLink>
                            </Column>
                        </Row>
                        {index < digestContent.digestEntries.length - 1 && <Hr />}
                    </React.Fragment>
                ))}
                {digestContent.remainingEntryCount > 0 && (
                    <>
                        <Hr />
                        <Row>
                            <EmailText
                                style={{
                                    marginTop: convertRemLengthToPx(spacing["6"], "medium"),
                                }}
                            >
                                <EmailLink
                                    color={`${defaultThemeColor}-60`}
                                    href={`${baseUrl}${digestContent.inboxUrl}`}
                                >
                                    See {digestContent.remainingEntryCount} more updates in Alpine…
                                </EmailLink>
                            </EmailText>
                        </Row>
                    </>
                )}
            </Section>

            <EmailFooter>
                You’re receiving this email because you’re a member of {spaceName}.{" "}
                <EmailLink
                    href={`${baseUrl}${unsubscribeUrl}`}
                    style={{textDecoration: "underline", color: "inherit"}}
                >
                    Unsubscribe
                </EmailLink>
            </EmailFooter>
        </BaseEmailTemplate>
    );
}

// This uses a background image to support css-based light/dark mode.
// An `Img` version is included but hidden as some email clients won't render background images via
// CSS `url` if no `img` tags are present in the document.
function getBrandIcon(brandIconType: string, baseUrl: string) {
    switch (brandIconType) {
        case "Post":
            return (
                <div
                    className="post-brand-icon"
                    style={{
                        // eslint-disable-next-line string-quotes
                        backgroundImage: `url('${baseUrl}/icons/post_brand_icon_light.png')`,
                        // Force new stacking context to force this element and its background to be placed on top.
                        opacity: 0.999,
                        width: "20px",
                        height: "20px",
                        backgroundSize: "cover",
                        backgroundPosition: "center",
                        backgroundRepeat: "no-repeat",
                    }}
                >
                    <Img
                        src={`${baseUrl}/icons/post_brand_icon_light.png`}
                        alt=""
                        aria-hidden="true"
                        style={{display: "none !important"}}
                    />
                </div>
            );
        case "Chat":
            return (
                <div
                    className="chat-brand-icon"
                    style={{
                        // eslint-disable-next-line string-quotes
                        backgroundImage: `url('${baseUrl}/icons/chat_brand_icon_light.png')`,
                        // Force new stacking context to force this element and its background to be placed on top.
                        opacity: 0.999,
                        width: "20px",
                        height: "20px",
                        backgroundSize: "cover",
                        backgroundPosition: "center",
                        backgroundRepeat: "no-repeat",
                    }}
                >
                    <Img
                        src={`${baseUrl}/icons/chat_brand_icon_light.png`}
                        alt=""
                        aria-hidden="true"
                        style={{display: "none !important"}}
                    />
                </div>
            );
        case "Document":
            return (
                <div
                    className="document-brand-icon"
                    style={{
                        // eslint-disable-next-line string-quotes
                        backgroundImage: `url('${baseUrl}/icons/document_brand_icon_light.png')`,
                        // Force new stacking context to force this element and its background to be placed on top.
                        opacity: 0.999,
                        width: "20px",
                        height: "20px",
                        backgroundSize: "cover",
                        backgroundPosition: "center",
                        backgroundRepeat: "no-repeat",
                    }}
                >
                    <Img
                        src={`${baseUrl}/icons/document_brand_icon_light.png`}
                        alt=""
                        aria-hidden="true"
                        style={{display: "none !important"}}
                    />
                </div>
            );
        case "Task":
            return (
                <div
                    className="task-brand-icon"
                    style={{
                        // eslint-disable-next-line string-quotes
                        backgroundImage: `url('${baseUrl}/icons/task_brand_icon_light.png')`,
                        // Force new stacking context to force this element and its background to be placed on top.
                        opacity: 0.999,
                        width: "20px",
                        height: "20px",
                        backgroundSize: "cover",
                        backgroundPosition: "center",
                        backgroundRepeat: "no-repeat",
                    }}
                >
                    <Img
                        src={`${baseUrl}/icons/task_brand_icon_light.png`}
                        alt=""
                        aria-hidden="true"
                        style={{display: "none !important"}}
                    />
                </div>
            );
        default:
            return null;
    }
}

function LoudNotificationCount({count}: {count: number}) {
    return (
        <Container
            style={{
                height: "1.25em",
                fontSize: "0.75em",
                margin: "0",
                ...(count > 0
                    ? {}
                    : {
                          visibility: "hidden",
                          display: "none !important",
                      }),
            }}
        >
            <Row
                style={{
                    verticalAlign: "middle",
                }}
            >
                <div
                    className="match-background-border"
                    style={{
                        // Force new stacking context and forces this element and its background to be placed on top.
                        opacity: 0.999,
                        height: "1.25em",
                        width: count > 99 ? "1.9em" : "1.25em",
                        lineHeight: "1.25em",
                        color: colors["grey-0"],
                        border: `2px solid ${colors["grey-0"]}`,
                        borderRadius: borderRadius["full"],
                        backgroundColor: colors["red-50"],
                        textAlign: "center",
                        padding: "0.125em",
                    }}
                >
                    {count > 99 ? "99+" : count}
                </div>
            </Row>
        </Container>
    );
}

function OneAccountAvatar({entry, baseUrl}: {entry: DigestEntry; baseUrl: string}) {
    return (
        <Container
            border={0}
            cellPadding={0}
            cellSpacing={0}
            style={{height: "70px", verticalAlign: "middle"}}
        >
            <Row>
                <Column>
                    <div style={{height: "10px"}}></div>
                    <div
                        style={{
                            maxHeight: "0",
                            maxWidth: "0",
                            marginLeft: "15px",
                            marginTop: "5px",
                        }}
                    >
                        <EmailAccountAvatar accountData={entry.firstAccount} size="10" />
                    </div>
                </Column>
            </Row>
            <Row>
                <Column>
                    <div style={{maxHeight: "0", marginLeft: "55px"}}>
                        <LoudNotificationCount count={entry.loudNotificationCount} />
                    </div>
                </Column>
            </Row>
            <Row>
                <Column>
                    <div
                        className="match-background"
                        style={{
                            // Force new stacking context to force this element and its background to be placed on top.
                            opacity: 0.999,
                            backgroundColor: colors["grey-0"],
                            borderRadius: borderRadius["full"],
                            padding: "5px",
                            marginTop: "32px",
                            width: "20px",
                            height: "20px",
                        }}
                    >
                        {getBrandIcon(entry.brandIconType, baseUrl)}
                    </div>
                </Column>
            </Row>
        </Container>
    );
}

function TwoAccountAvatar({entry, baseUrl}: {entry: DigestEntry; baseUrl: string}) {
    return (
        <Container border={0} cellPadding={0} cellSpacing={0} style={{height: "70px"}}>
            <Row>
                <Column>
                    <div
                        style={{
                            maxWidth: "0",
                            maxHeight: "0",
                            marginLeft: "10px",
                        }}
                    >
                        <EmailAccountAvatar accountData={entry.secondAccount!} size="9" />
                    </div>
                </Column>
                <Column style={{verticalAlign: "top"}}>
                    <div style={{maxWidth: "0", maxHeight: "0", marginLeft: "20px"}}>
                        <LoudNotificationCount count={entry.loudNotificationCount} />
                    </div>
                </Column>
            </Row>
            <Row>
                <Column>
                    <div style={{maxWidth: "0", marginTop: "40px"}}>
                        <div
                            className="match-background"
                            style={{
                                // Force new stacking context to force this element and its background to be placed on top.
                                opacity: 0.999,
                                backgroundColor: colors["grey-0"],
                                borderRadius: borderRadius["full"],
                                padding: "5px",
                                width: "20px",
                                height: "20px",
                            }}
                        >
                            {getBrandIcon(entry.brandIconType, baseUrl)}
                        </div>
                    </div>
                </Column>
                <Column>
                    <div
                        style={{
                            maxWidth: "0",
                            maxHeight: "0",
                            marginLeft: "25px",
                            marginBottom: "35px",
                        }}
                    >
                        <div
                            className="match-background"
                            style={{
                                // Force new stacking context to force this element and its background to be placed on top.
                                opacity: 0.999,
                                backgroundColor: colors["grey-0"],
                                borderRadius: "50%",
                                padding: "2px",
                                height: "45px",
                                width: "45px",
                            }}
                        >
                            <EmailAccountAvatar accountData={entry.firstAccount} size="9" />
                        </div>
                    </div>
                </Column>
            </Row>
        </Container>
    );
}

/**
 * Formats a date to a relative localized date string with the time. If a date occurs today or
 * yesterday compared to the current time, the date portion is replaced with "Today" or "Yesterday"
 * respectively. Otherwise, the date is formatted like "Friday, Sept 27 at 1:00pm".
 */
function formatPrettyRelativeLocalDateWithTime(
    time: Date,
    currentTime: Date,
    timeZone: TimeZone,
    locale?: Locale,
) {
    const zonedTime = fromDate(time, timeZone);
    const currentZonedTime = fromDate(currentTime, timeZone);
    const isToday = isSameDay(zonedTime, currentZonedTime);
    const isYesterday = isSameDay(zonedTime, currentZonedTime.subtract({days: 1}));

    const shortFormatter = getIntlDateTimeFormat({
        locale: locale ?? defaultLocale,
        timeZone: timeZone,
        hour: "numeric",
        minute: "numeric",
    });

    if (isToday) {
        return `Today at ${shortFormatter.format(zonedTime.toDate())}`.replaceAll(
            /\s*(AM|PM)/g,
            string => string.trim().toLowerCase(),
        );
    } else if (isYesterday) {
        return `Yesterday at ${shortFormatter.format(zonedTime.toDate())}`.replaceAll(
            /\s*(AM|PM)/g,
            string => string.trim().toLowerCase(),
        );
    } else {
        return formatPrettyAbsoluteDateWithoutFullTimeTooltip(
            locale ?? defaultLocale,
            timeZone,
            toCalendarDate(currentZonedTime),
            time,
            {withWeekday: true},
        );
    }
}
