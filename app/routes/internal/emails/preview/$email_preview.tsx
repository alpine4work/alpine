import {Link, ShouldReloadFunction, useParams} from "@remix-run/react";
import {Code, Desktop, DeviceMobileCamera, EnvelopeSimple, IconContext} from "phosphor-react";
import {ReactNode, useRef} from "react";
import {useButton} from "react-aria";
import {Box} from "~/client/design/box";
import {FocusRing} from "~/client/design/focus_ring";
import {Tooltip} from "~/client/design/tooltip";
import {ErrorBodyRenderer} from "~/client/error/error_body_renderer";
import {useLoaderDataWithSchema} from "~/client/helpers/remix/use_loader_data_with_schema";
import {useUrlSearchParamState} from "~/client/helpers/use_url_search_param_state";
import {getEmailTemplatePreviewBySlug} from "~/server/emails/get_email_template_preview_by_slug";
import {jsonWithSchema} from "~/server/helpers/remix/json_with_schema";
import {notFoundResponse} from "~/server/helpers/remix/not_found_response";
import {DataFunctionArgs} from "~/server/helpers/types/remix_data_function_args";
import {spacing} from "~/shared/design/spacing";
import {ErrorSchema} from "~/shared/error/error_schema";
import {captureResult} from "~/shared/helpers/control/capture_result";
import {Schema} from "~/shared/schema/schema";
import {sprinkles} from "~/shared/styles/styles";

export function meta() {
    return {
        title: "Email Playground - Cyberworlds",
    };
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
            }),
        }),
        Schema.object({
            ok: Schema.value(false),
            error: ErrorSchema,
        }),
    ),
});

// If only the `view` search param on the URL changed, we don't need to reload.
export const unstable_shouldReload: ShouldReloadFunction = ({url: _url, prevUrl: _prevUrl}) => {
    const url = new URL(_url);
    const prevUrl = new URL(_prevUrl);

    url.searchParams.delete("view");
    prevUrl.searchParams.delete("view");

    return url.toString() !== prevUrl.toString();
};

export async function loader({params}: DataFunctionArgs) {
    const emailTemplatePreviews = await getEmailTemplatePreviewBySlug();

    const slug = params["email_preview"] ?? "";

    const emailTemplatePreview = emailTemplatePreviews.get(slug);
    if (!emailTemplatePreview) throw notFoundResponse();

    const emailPreviewResult = captureResult(() => {
        const renderedEmail = emailTemplatePreview.render();

        return {
            title: emailTemplatePreview.title,
            html: renderedEmail.html,
            htmlTitle: renderedEmail.getHtmlTitle(),
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
    const {email_preview: activeSlug} = useParams();

    const [_view, setView] = useUrlSearchParamState("view");
    const view = _view === "desktop" || _view === "mobile" || _view === "html" ? _view : "desktop";
    const viewSearchParam = _view ? `?view=${_view}` : "";

    return (
        <main
            className={sprinkles({
                width: "full",
                height: "full",
                overflow: "hidden",
                display: "flex",
            })}
        >
            <Box
                flexShrink="0"
                width="64"
                height="full"
                borderRight="grey-10"
                display="flex"
                flexDirection="column"
            >
                <h1
                    className={sprinkles({
                        position: "relative",
                        zIndex: "20",
                        flexShrink: "0",
                        typographyStyle: "primaryMedium",
                        typographySize: "body",
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
                <Box flexGrow="1" overflowY="scroll">
                    {emailPreviewLinks.map(emailPreviewLink => (
                        <FocusRing key={emailPreviewLink.slug} offset="inset">
                            <Link
                                to={`/internal/emails/preview/${emailPreviewLink.slug}${viewSearchParam}`}
                                className={sprinkles({
                                    display: "block",
                                    width: "full",
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
                        <Box typographyStyle="primaryMedium" typographySize="body">
                            {emailPreviewResult.value.htmlTitle}
                        </Box>
                    )}
                    <Box flexGrow="1" />
                    <Box display="flex" border="grey-10" borderRadius="base" overflow="hidden">
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
                            isLast
                            onPress={() => setView("html")}
                        >
                            <Code />
                        </ViewSwitcherButton>
                    </Box>
                </Box>
                <Box
                    flexGrow="1"
                    width="full"
                    overflowX="hidden"
                    overflowY="scroll"
                    display="flex"
                    justifyContent="center"
                >
                    {emailPreviewResult.ok ? (
                        {
                            desktop: (
                                <iframe
                                    title="Email preview"
                                    src={`data:text/html;charset=utf-8,${escape(
                                        emailPreviewResult.value.html,
                                    )}`}
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
                                    src={`data:text/html;charset=utf-8,${escape(
                                        emailPreviewResult.value.html,
                                    )}`}
                                    className={sprinkles({
                                        width: "96",
                                        height: "full",
                                        backgroundColor: "grey-0-const",
                                    })}
                                />
                            ),
                            html: (
                                <FocusRing offset="inset">
                                    <pre
                                        className={sprinkles({
                                            width: "full",
                                            padding: "4",
                                            overflowX: "scroll",
                                            userSelect: "text",
                                        })}
                                        tabIndex={0}
                                    >
                                        <code>{emailPreviewResult.value.html}</code>
                                    </pre>
                                </FocusRing>
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
    const {buttonProps} = useButton({"aria-label": description, onPress}, ref);

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
