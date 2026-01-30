import {ZonedDateTime, fromDate, isSameDay, toCalendarDate} from "@internationalized/date";
import {Column, Container, Hr, Row, Section} from "@react-email/components";
import React, {Fragment} from "react";
import {EmailAccountAvatar} from "~/server/emails/internal/components/email_account_avatar.js";
import {EmailFooterText} from "~/server/emails/internal/components/email_footer_text.js";
import {EmailLink} from "~/server/emails/internal/components/email_link.js";
import {emailSpacing} from "~/server/emails/internal/components/email_spacing_scale.js";
import {EmailText, emailFontStyles} from "~/server/emails/internal/components/email_text.js";
import {BaseEmailTemplate} from "~/server/emails/internal/templates/base_email_template.js";
import {getAccountShortNameWithoutFullNameTooltip} from "~/shared/accounts/get_account_short_name_without_full_name_tooltip.js";
import {borderRadius} from "~/shared/design/core/border_radius.js";
import {colors} from "~/shared/design/core/colors.js";
import {defaultThemeColor} from "~/shared/design/core/theme_colors.js";
import {formatPrettyAbsoluteDateWithoutFullTimeTooltip} from "~/shared/design/format_pretty_absolute_date_without_full_time_tooltip.js";
import {printPrettySmallNumberSummary} from "~/shared/design/print_pretty_small_number_summary.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.js";
import {cast} from "~/shared/helpers/control/cast.js";
import {getIntlDateTimeFormat} from "~/shared/helpers/intl/get_intl_date_time_format.js";
import {Locale, defaultLocale} from "~/shared/helpers/intl/locale.js";
import {TimeZone} from "~/shared/helpers/intl/time_zone.js";
import {iterableFirst} from "~/shared/helpers/iterable/iterable_first.js";
import {AccountId} from "~/shared/id/types/id_types.js";
import {
    DigestEntry,
    DigestNotificationContent,
} from "~/shared/notifications/digest_notification_content.js";
import {AccountModelData} from "~/shared/spaces/account_model.js";

export function NotificationDigestEmailTemplate({
    resourceServiceUrl,
    locale,
    localizedDigestTime,
    spaceName,
    unsubscribeUrl,
    digestContent,
}: {
    resourceServiceUrl: string;
    locale: Locale;
    localizedDigestTime: ZonedDateTime;
    spaceName: string;
    unsubscribeUrl: URL;
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
    let subject;
    if (loudNotificationAccountByIds.size === 1) {
        const account = assertExists(iterableFirst(loudNotificationAccountByIds.values()));
        const accountShortName = getAccountShortNameWithoutFullNameTooltip(account);

        subject = `${accountShortName} is trying to get your attention in ${spaceName}`;
    } else if (loudNotificationAccountByIds.size === 2) {
        const [account1, account2] = loudNotificationAccountByIds.values();
        assert(account1 && account2);
        const account1ShortName = getAccountShortNameWithoutFullNameTooltip(account1);
        const account2ShortName = getAccountShortNameWithoutFullNameTooltip(account2);

        subject = `${account1ShortName} and ${account2ShortName} are trying to get your attention in ${spaceName}`;
    } else if (loudNotificationAccountByIds.size === 3) {
        const [account1, account2, account3] = loudNotificationAccountByIds.values();
        assert(account1 && account2 && account3);
        const account1ShortName = getAccountShortNameWithoutFullNameTooltip(account1);
        const account2ShortName = getAccountShortNameWithoutFullNameTooltip(account2);
        const account3ShortName = getAccountShortNameWithoutFullNameTooltip(account3);

        subject = `${account1ShortName}, ${account2ShortName}, and ${account3ShortName} are trying to get your attention in ${spaceName}`;
    } else if (loudNotificationAccountByIds.size >= 4) {
        const [account1, account2, account3] = loudNotificationAccountByIds.values();
        assert(account1 && account2 && account3);
        const account1ShortName = getAccountShortNameWithoutFullNameTooltip(account1);
        const account2ShortName = getAccountShortNameWithoutFullNameTooltip(account2);
        const account3ShortName = getAccountShortNameWithoutFullNameTooltip(account3);

        subject = `${account1ShortName}, ${account2ShortName}, ${account3ShortName}, and ${
            loudNotificationAccountByIds.size - 3
        } others are trying to get your attention in ${spaceName}`;
    } else {
        subject = `What\u2019s been happening in ${spaceName}`;
    }

    const preview = `You have ${printPrettySmallNumberSummary(
        digestContent.digestEntries.length + digestContent.remainingEntryCount,
        "update",
    )}`;

    return (
        <BaseEmailTemplate
            resourceServiceUrl={resourceServiceUrl}
            /* eslint-disable string-quotes */
            globalStyles={`
                @media (prefers-color-scheme: dark) {
                    .chat-brand-icon {
                        background-image: url('${resourceServiceUrl}/icons/chat_brand_icon_dark.png') !important;
                    }
                    .document-brand-icon {
                        background-image: url('${resourceServiceUrl}/icons/document_brand_icon_dark.png') !important;
                    }
                    .post-brand-icon {
                        background-image: url('${resourceServiceUrl}/icons/post_brand_icon_dark.png') !important;
                    }
                    .task-brand-icon {
                        background-image: url('${resourceServiceUrl}/icons/task_brand_icon_dark.png') !important;
                    }
                }
            `}
            /* eslint-enable string-quotes */
            subject={subject}
            preview={preview}
        >
            <Section>
                <EmailText fontSize="400" color="grey-100" fontStyle="bold">
                    Recent activity in {spaceName}
                </EmailText>
            </Section>
            <Section style={{paddingBottom: emailSpacing["2"]}}>
                {parsedEntries.map((entry, index) => (
                    <React.Fragment key={entry.url.toString()}>
                        {index === 0 && <Hr />}

                        <Row
                            style={{
                                width: "100%",
                                borderCollapse: "separate",
                                verticalAlign: "middle",
                            }}
                        >
                            <Column width={92} data-skip-in-text="true">
                                {entry.secondAccount ? (
                                    <TwoAccountAvatar
                                        entry={entry}
                                        resourceServiceUrl={resourceServiceUrl}
                                    />
                                ) : (
                                    <OneAccountAvatar
                                        entry={entry}
                                        resourceServiceUrl={resourceServiceUrl}
                                    />
                                )}
                            </Column>
                            <Column>
                                <EmailText
                                    color="grey-40"
                                    fontSize="25"
                                    style={{
                                        paddingTop: emailSpacing["3"],
                                        paddingBottom: 0,
                                    }}
                                >
                                    {entry.dateString}
                                </EmailText>
                                <EmailLink color="grey-100" href={entry.url.toString()}>
                                    <Row>
                                        <EmailText
                                            fontSize="100"
                                            color="grey-100"
                                            style={{
                                                paddingBottom: emailSpacing["1"],
                                                paddingTop: emailSpacing["0.5"],
                                            }}
                                        >
                                            {entry.summary.map((item, index) => {
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
                                            fontSize="75"
                                            color="grey-60"
                                            style={{
                                                paddingBottom: emailSpacing["3"],
                                                paddingTop: 0,
                                            }}
                                        >
                                            {entry.preview}
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
                            <EmailText style={{paddingTop: emailSpacing["6"]}}>
                                <EmailLink
                                    color={`${defaultThemeColor}-60`}
                                    href={`${digestContent.inboxUrl.toString()}`}
                                    style={{textDecoration: "underline"}}
                                >
                                    See{" "}
                                    {digestContent.remainingEntryCount > 50
                                        ? "50+"
                                        : digestContent.remainingEntryCount}{" "}
                                    more updates in Alpine…
                                </EmailLink>
                            </EmailText>
                        </Row>
                    </>
                )}
            </Section>
            <Section style={{paddingTop: emailSpacing["6"]}}>
                <EmailFooterText>
                    You&#x2019;re receiving this email because you&#x2019;re a member of {spaceName}
                    .{" "}
                    <EmailLink
                        href={unsubscribeUrl.toString()}
                        color="grey-50"
                        style={{textDecoration: "underline"}}
                    >
                        Unsubscribe
                    </EmailLink>
                </EmailFooterText>
            </Section>
        </BaseEmailTemplate>
    );
}

// This uses a background image to support css-based light/dark mode.
// An `Img` version is included but hidden as some email clients won't render background images via
// CSS `url` if no `img` tags are present in the document.
function getBrandIcon(brandIconType: string, resourceServiceUrl: string) {
    switch (brandIconType) {
        case "Post":
            return (
                <div
                    className="post-brand-icon"
                    style={{
                        // eslint-disable-next-line string-quotes
                        backgroundImage: `url('${resourceServiceUrl}/icons/post_brand_icon_light.png')`,
                        // Force new stacking context to force this element and its background to be placed on top.
                        opacity: 0.999,
                        width: "20px",
                        height: "20px",
                        backgroundSize: "cover",
                        backgroundPosition: "center",
                        backgroundRepeat: "no-repeat",
                    }}
                ></div>
            );
        case "Chat":
            return (
                <div
                    className="chat-brand-icon"
                    style={{
                        // eslint-disable-next-line string-quotes
                        backgroundImage: `url('${resourceServiceUrl}/icons/chat_brand_icon_light.png')`,
                        // Force new stacking context to force this element and its background to be placed on top.
                        opacity: 0.999,
                        width: "20px",
                        height: "20px",
                        backgroundSize: "cover",
                        backgroundPosition: "center",
                        backgroundRepeat: "no-repeat",
                    }}
                ></div>
            );
        case "Document":
            return (
                <div
                    className="document-brand-icon"
                    style={{
                        // eslint-disable-next-line string-quotes
                        backgroundImage: `url('${resourceServiceUrl}/icons/document_brand_icon_light.png')`,
                        // Force new stacking context to force this element and its background to be placed on top.
                        opacity: 0.999,
                        width: "20px",
                        height: "20px",
                        backgroundSize: "cover",
                        backgroundPosition: "center",
                        backgroundRepeat: "no-repeat",
                    }}
                ></div>
            );
        case "Task":
            return (
                <div
                    className="task-brand-icon"
                    style={{
                        // eslint-disable-next-line string-quotes
                        backgroundImage: `url('${resourceServiceUrl}/icons/task_brand_icon_light.png')`,
                        // Force new stacking context to force this element and its background to be placed on top.
                        opacity: 0.999,
                        width: "20px",
                        height: "20px",
                        backgroundSize: "cover",
                        backgroundPosition: "center",
                        backgroundRepeat: "no-repeat",
                    }}
                ></div>
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

function OneAccountAvatar({
    entry,
    resourceServiceUrl,
}: {
    entry: DigestEntry;
    resourceServiceUrl: string;
}) {
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
                        {getBrandIcon(entry.brandIconType, resourceServiceUrl)}
                    </div>
                </Column>
            </Row>
        </Container>
    );
}

function TwoAccountAvatar({
    entry,
    resourceServiceUrl,
}: {
    entry: DigestEntry;
    resourceServiceUrl: string;
}) {
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
                            {getBrandIcon(entry.brandIconType, resourceServiceUrl)}
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
