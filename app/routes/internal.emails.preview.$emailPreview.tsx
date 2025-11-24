import {pretty, toPlainText} from "@react-email/render";
import {Link, ShouldRevalidateFunction, useParams} from "@remix-run/react";
import {
    Code,
    Desktop,
    DeviceMobileCamera,
    EnvelopeSimple,
    IconContext,
    TextT,
} from "phosphor-react";
import {ReactNode, useRef} from "react";
import {useButton} from "react-aria";
import {Box} from "~/client/web/design/box.js";
import {ErrorBodyRenderer} from "~/client/web/design/error_body_renderer.js";
import {FocusRing} from "~/client/web/design/focus_ring.js";
import {ColorSchemeToggleButton} from "~/client/web/design/playground/color_scheme_toggle_button.js";
import {useScrollbar} from "~/client/web/design/scrollbar.js";
import {Tooltip} from "~/client/web/design/tooltip.js";
import {useLoaderDataWithSchema} from "~/client/web/remix/use_loader_data_with_schema.js";
import {metaTitlePostfix} from "~/client/web/remix/use_update_meta_title.js";
import {useUrlSearchParamState} from "~/client/web/remix/use_url_search_param_state.js";
import {sprinkles} from "~/client/web/styles/styles.js";
import {emailTemplatePreviewBySlug} from "~/server/emails/email_template_previews.js";
import {jsonWithSchema} from "~/server/remix/json_with_schema.js";
import {LoaderArgs} from "~/server/remix/loader_context.js";
import {notFoundResponse} from "~/server/remix/not_found_response.js";
import {spacing} from "~/shared/design/core/spacing.js";
import {ErrorSchema} from "~/shared/error/error_schema.js";
import {captureResultPromise} from "~/shared/helpers/control/capture_result_promise.js";
import {Schema} from "~/shared/schema/schema.js";

export function meta() {
    return [{title: `Email Playground${metaTitlePostfix}`}];
}

const LoaderSchema = Schema.object({
    emailPreviewLinks: Schema.array(
        Schema.object({
            title: Schema.string,
            slug: Schema.string,
        }),
    ),
    emailPreviewResult: Schema.result(
        Schema.object({
            ok: Schema.value(true),
            value: Schema.object({
                title: Schema.string,
                html: Schema.string,
                htmlTitle: Schema.string,
                preview: Schema.string.optional(),
                plainText: Schema.string,
            }),
        }),
        Schema.object({
            ok: Schema.value(false),
            error: ErrorSchema,
        }),
    ),
});

// If only the `view` search param on the URL changed, we don't need to reload.
export const shouldRevalidate: ShouldRevalidateFunction = ({
    currentUrl: _currentUrl,
    nextUrl: _nextUrl,
}) => {
    const currentUrl = new URL(_currentUrl);
    const nextUrl = new URL(_nextUrl);

    nextUrl.searchParams.delete("view");
    currentUrl.searchParams.delete("view");

    return nextUrl.toString() !== currentUrl.toString();
};

export async function loader({params, context}: LoaderArgs) {
    const emailTemplatePreviews = emailTemplatePreviewBySlug;

    const slug = params.emailPreview ?? "";

    const emailTemplatePreview = emailTemplatePreviews.get(slug);
    if (!emailTemplatePreview) throw notFoundResponse();

    const emailPreviewResult = await captureResultPromise(async () => {
        const renderedEmail = await emailTemplatePreview.render(context.tracer);
        const plainText = toPlainText(renderedEmail.html);

        // HACK: HTML parsing with regex is bad, but for our internal dev testing,
        // I think we can be a lil' ok with it. Let's find the preview by the data-email-preview
        // tag on a div. We assume the preview is text only (as it's also enforced by TS).
        // NOTE: this will break if the preview contains a "<" currently.
        const previewMatch = renderedEmail.html.match(
            /<div([^>]*)data-email-preview="true"([^>]*)>([^<]+)/,
        );

        return {
            title: emailTemplatePreview.title,
            html: await pretty(renderedEmail.html),
            htmlTitle: renderedEmail.title,
            preview: previewMatch ? previewMatch[3]!.trim() : undefined,
            plainText,
        };
    });

    return jsonWithSchema(LoaderSchema, {
        emailPreviewLinks: Array.from(emailTemplatePreviews, ([slug, preview]) => ({
            title: preview.title,
            slug,
        })),
        emailPreviewResult,
    });
}

export default function EmailPreviewPage() {
    const {emailPreviewLinks, emailPreviewResult} = useLoaderDataWithSchema(LoaderSchema);
    const {emailPreview: activeSlug} = useParams();

    const [_view, setView] = useUrlSearchParamState("view");
    const view =
        _view === "desktop" || _view === "mobile" || _view === "html" || _view === "plainText"
            ? _view
            : "desktop";
    const viewSearchParam = _view ? `?view=${_view}` : "";

    return (
        <main
            className={sprinkles({
                width: "full",
                overflow: "hidden",
                display: "flex",
            })}
            style={{height: "100svh"}}
        >
            <Box
                flexShrink="0"
                width="64"
                height="full"
                backgroundColor="grey-0"
                borderRight="grey-10"
                display="flex"
                flexDirection="column"
            >
                <h1
                    className={sprinkles({
                        position: "relative",
                        zIndex: "20",
                        flexShrink: "0",
                        fontStyle: "semi-bold",
                        fontSize: "200",
                        height: "12",
                        display: "flex",
                        gap: "2",
                        alignItems: "center",
                        paddingX: "3",
                        borderBottom: "grey-10",
                    })}
                >
                    <EnvelopeSimple />
                    Email Templates
                </h1>
                <Box ref={useScrollbar()} flexGrow="1" overflowY="auto" position="relative">
                    {emailPreviewLinks.map(emailPreviewLink => (
                        <FocusRing key={emailPreviewLink.slug} offset="inset">
                            <Link
                                to={`/internal/emails/preview/${emailPreviewLink.slug}${viewSearchParam}`}
                                className={sprinkles({
                                    display: "block",
                                    width: "full",
                                    fontStyle: "truncate",
                                    paddingY: "2",
                                    paddingX: "3",
                                    backgroundColor:
                                        activeSlug === emailPreviewLink.slug ? "grey-5" : undefined,
                                    borderBottom: "grey-5",
                                })}
                            >
                                {emailPreviewLink.title}
                            </Link>
                        </FocusRing>
                    ))}
                </Box>
            </Box>
            <Box
                flexGrow="1"
                width="full"
                height="full"
                overflow="hidden"
                display="flex"
                flexDirection="column"
                gap={view === "mobile" ? "2" : "0"}
            >
                <Box
                    flexShrink="0"
                    position="relative"
                    zIndex="20"
                    height="12"
                    display="flex"
                    paddingX="4"
                    alignItems="center"
                    backgroundColor="grey-0"
                    borderBottom="grey-10"
                >
                    {emailPreviewResult.ok && (
                        <Box
                            fontStyle="semi-bold"
                            fontSize="200"
                            display="flex"
                            alignItems="center"
                        >
                            {emailPreviewResult.value.htmlTitle}{" "}
                            {emailPreviewResult.value.preview && (
                                <Box paddingLeft="2" color="grey-60">
                                    {emailPreviewResult.value.preview}
                                </Box>
                            )}
                        </Box>
                    )}
                    <Box flexGrow="1" />
                    <Box paddingX="2">
                        <ColorSchemeToggleButton />
                    </Box>

                    <Box display="flex" border="grey-10" borderRadius="1" overflow="hidden">
                        <ViewSwitcherButton
                            description="Desktop view"
                            isActive={view === "desktop"}
                            onPress={() => setView("desktop")}
                        >
                            <Desktop />
                        </ViewSwitcherButton>
                        <ViewSwitcherButton
                            description="Mobile view"
                            isActive={view === "mobile"}
                            onPress={() => setView("mobile")}
                        >
                            <DeviceMobileCamera />
                        </ViewSwitcherButton>
                        <ViewSwitcherButton
                            description="HTML view"
                            isActive={view === "html"}
                            onPress={() => setView("html")}
                        >
                            <Code />
                        </ViewSwitcherButton>
                        <ViewSwitcherButton
                            description="Plain text view"
                            isActive={view === "plainText"}
                            isLast
                            onPress={() => setView("plainText")}
                        >
                            <TextT />
                        </ViewSwitcherButton>
                    </Box>
                </Box>
                <Box
                    flexGrow="1"
                    width="full"
                    overflow="hidden"
                    display="flex"
                    justifyContent="center"
                >
                    {emailPreviewResult.ok ? (
                        {
                            desktop: (
                                <iframe
                                    title="Email preview"
                                    srcDoc={emailPreviewResult.value.html}
                                    className={sprinkles({
                                        width: "full",
                                        height: "full",
                                        backgroundColor: "grey-0-const",
                                    })}
                                />
                            ),
                            mobile: (
                                <iframe
                                    title="Email preview"
                                    srcDoc={emailPreviewResult.value.html}
                                    className={sprinkles({
                                        width: "96",
                                        height: "192",
                                        maxHeight: "full",
                                        backgroundColor: "grey-0-const",
                                        border: "grey-10",
                                        borderRadius: "1",
                                    })}
                                />
                            ),
                            html: <EmailHtmlPreview html={emailPreviewResult.value.html} />,
                            plainText: (
                                <EmailPlainTextPreview
                                    plainText={emailPreviewResult.value.plainText}
                                />
                            ),
                        }[view]
                    ) : (
                        <Box width="full" maxWidth="128" paddingX="4" paddingY="16">
                            <ErrorBodyRenderer
                                title="Could not render email"
                                error={emailPreviewResult.error}
                            />
                        </Box>
                    )}
                </Box>
            </Box>
        </main>
    );
}

function ViewSwitcherButton({
    description,
    isActive,
    isLast,
    onPress,
    children,
}: {
    description: string;
    isActive: boolean;
    isLast?: boolean;
    onPress: () => void;
    children: ReactNode;
}) {
    const ref = useRef<HTMLButtonElement>(null);
    const {buttonProps} = useButton(
        {"aria-label": description, onPress},
        // @ts-expect-error: NOTE(calebmer, #react-v19-upgrade): `react-aria` handles
        // the ref correctly but the type is wrong after upgrading to React v19.
        ref,
    );

    return (
        <Tooltip content={description}>
            <FocusRing offset="0">
                <button
                    {...buttonProps}
                    ref={ref}
                    className={sprinkles({
                        padding: "1.5",
                        borderRight: !isLast ? "grey-5" : undefined,
                        color: isActive ? "grey-90" : "grey-70",
                        backgroundColor: isActive ? "grey-5" : undefined,
                    })}
                >
                    <IconContext.Provider
                        value={{
                            color: "currentColor",
                            size: spacing["4"],
                        }}
                    >
                        {children}
                    </IconContext.Provider>
                </button>
            </FocusRing>
        </Tooltip>
    );
}

function EmailHtmlPreview({html}: {html: string}) {
    return (
        <FocusRing offset="inset">
            <pre
                ref={useScrollbar()}
                className={sprinkles({
                    width: "full",
                    padding: "4",
                    overflow: "auto",
                    userSelect: "text",
                    position: "relative",
                })}
                tabIndex={0}
            >
                <code>{html}</code>
            </pre>
        </FocusRing>
    );
}
function EmailPlainTextPreview({plainText}: {plainText: string}) {
    return (
        <FocusRing offset="inset">
            <pre
                ref={useScrollbar()}
                className={sprinkles({
                    width: "full",
                    padding: "4",
                    overflow: "auto",
                    userSelect: "text",
                    position: "relative",
                })}
                tabIndex={0}
            >
                <code>{plainText}</code>
            </pre>
        </FocusRing>
    );
}
