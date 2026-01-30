import {redirect} from "@remix-run/node";
import {Outlet, ShouldRevalidateFunction, useSearchParams} from "@remix-run/react";
import {LinkDescriptor} from "@remix-run/server-runtime";
import {
    ContextType,
    ReactElement,
    ReactNode,
    useCallback,
    useContext,
    useEffect,
    useMemo,
    useRef,
    useState,
} from "react";
import {flushSync} from "react-dom";
import {UNSAFE_DataRouterStateContext as DataRouterStateContext, To, useParams} from "react-router";
import {deserializeSpaceIdForLoader} from "~/app/helpers/deserialize_id_for_loader.js";
import {LoadingIndicatorSpaceOutletContainer} from "~/app/router/loading_indicator_space_outlet_container.js";
import {NativeMobileOutlet} from "~/app/router/native_mobile_outlet.js";
import {isNativeMobileRouterState} from "~/app/router/native_mobile_router.js";
import {useAccountRegistryForSpaceId} from "~/client/web/accounts/account_registry_context.js";
import {ContentFileEntityRenderersContext} from "~/client/web/content/content_file_entity_renderers_context.js";
import {ContentFileViewerModal} from "~/client/web/content/content_file_viewer_modal.js";
import {contentFileEntityRenderers} from "~/client/web/content/file_entity/content_file_entity_renderers.js";
import {useAppContext} from "~/client/web/context/app_context.js";
import {Box} from "~/client/web/design/box.js";
import {ContextMenuContextProvider} from "~/client/web/design/context_menu.js";
import {RootOverlayScopeContextProvider} from "~/client/web/design/overlay_scope_context_provider.js";
import {emitMobileKeyboardFrameChangeIfNotNative} from "~/client/web/design/subscribe_to_mobile_keyboard_frame_change.js";
import {useIsBehindMobileFullScreenModal} from "~/client/web/design/use_is_behind_mobile_full_screen_modal.js";
import {useTextInputVisibilityMaintainer} from "~/client/web/design/use_text_input_visibility_maintainer.js";
import {
    attachDevConsoleForAccountInProduction,
    useDevConsoleTool,
} from "~/client/web/dev/dev_console.js";
import {isMobileWebKit} from "~/client/web/helpers/browser/is_mobile_web_kit.js";
import {disableMobileWebKitDefaultScroll} from "~/client/web/helpers/disable_mobile_web_kit_default_scroll.js";
import {isNodeBlockLevel} from "~/client/web/helpers/elements/is_node_block_level.js";
import {
    isTextInputElement,
    textInputTypes,
} from "~/client/web/helpers/elements/is_text_input_element.js";
import {GlobalKeyDownEvent} from "~/client/web/helpers/global_key_down_event.js";
import {useIsInitialAppRender} from "~/client/web/helpers/lifecycle/initial_app_render.js";
import {useLocalStorage} from "~/client/web/helpers/use_local_storage.js";
import {getOrPromptForBrowserPushNotificationPermission} from "~/client/web/notifications/get_or_prompt_for_browser_push_notification_permission.js";
import {subscribeToPushNotificationsInBrowser} from "~/client/web/notifications/subscribe_to_push_notifications_in_browser.js";
import {
    PeekStackContextProvider,
    PeekStackContextProviderRef,
} from "~/client/web/peek/peek_stack.js";
import {useBrowserId, useClientInfo} from "~/client/web/remix/client_info_context.js";
import {NativeMobileBridge} from "~/client/web/remix/native_mobile_bridge.js";
import {usePlatform} from "~/client/web/remix/platform_context.js";
import {useLoaderDataWithSchema} from "~/client/web/remix/use_loader_data_with_schema.js";
import {useUpdateMetaTitle} from "~/client/web/remix/use_update_meta_title.js";
import {SearchModal} from "~/client/web/search/search_modal.js";
import {
    GlobalLoadingIndicatorChip,
    GlobalLoadingIndicatorContextProvider,
    globalLoadingIndicatorChipHeight,
} from "~/client/web/spaces/global_loading_indicator_context_provider.js";
import {GlobalLoadingIndicator} from "~/client/web/spaces/global_loading_indicator_types.js";
import {PurchasedLifetimeAccessModal} from "~/client/web/spaces/layout/purchased_lifetime_access_modal.js";
import {SpaceLayoutNativeMobileInboxController} from "~/client/web/spaces/layout/space_layout_native_mobile_inbox_controller.js";
import {
    SpaceLayoutSideBar,
    SpaceLayoutSideBarContentBlockWidthContextProvider,
} from "~/client/web/spaces/layout/space_layout_side_bar.js";
import {SpaceLayoutWebMobileTabBar} from "~/client/web/spaces/layout/space_layout_web_mobile_tab_bar.js";
import {useSpaceContext} from "~/client/web/spaces/space_context.js";
import {SpaceContextProvider} from "~/client/web/spaces/space_context_provider.js";
import {spaceLayoutWebMobileTabBarHeight} from "~/client/web/styles/space_layout_shared_styles.js";
import {sprinkles} from "~/client/web/styles/styles.js";
import {
    TaskRealtimeClientContextProvider,
    clientLoaderTaskStoreLoaderData,
} from "~/client/web/tasks/core/task_realtime_client_context_provider.js";
import {getOwnAccount} from "~/server/accounts/get_own_account.js";
import {DynamoCacheReadConsistency} from "~/server/dynamo/core/dynamo_read_consistency.js";
import {SessionActorContextModule} from "~/server/helpers/actor_context_module.js";
import {getInbox} from "~/server/notifications/data/get_inbox.js";
import {jsonWithSchema} from "~/server/remix/json_with_schema.js";
import {LoaderArgs, LoaderContextModules} from "~/server/remix/loader_context.js";
import {authorizeSpaceAccessIfPossible} from "~/server/spaces/authorize_space_access.js";
import {getOwnAccountIfExists} from "~/server/spaces/get_own_account_if_exists.js";
import {getSpace} from "~/server/spaces/get_space.js";
import {AccountModelWithoutSpace} from "~/shared/accounts/account_model_without_space.js";
import {alpioneers} from "~/shared/accounts/known_account_ids.js";
import {Context} from "~/shared/context/context.js";
import {addRemLengths, spacing} from "~/shared/design/core/spacing.js";
import {createDynamoGeneralRealtimeItemSchema} from "~/shared/dynamo/dynamo_general_realtime_types.js";
import {PermissionDeniedError} from "~/shared/error/error.js";
import {
    FileAttachmentTarget,
    deserializeFileAttachmentTargetString,
} from "~/shared/files/file_attachment_target.js";
import {runAllPromises} from "~/shared/helpers/async/run_all_promises.js";
import {scheduleMicrotask} from "~/shared/helpers/async/schedule_microtask.js";
import {Timeout, createTimeout} from "~/shared/helpers/async/timeout.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.js";
import {unwrapResult} from "~/shared/helpers/control/capture_result.js";
import {captureResultPromise} from "~/shared/helpers/control/capture_result_promise.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.js";
import {TimeZone, isTimeZone} from "~/shared/helpers/intl/time_zone.js";
import {hasOwnProperty} from "~/shared/helpers/object/has_own_property.js";
import {defaultCompareStrings} from "~/shared/helpers/string/default_compare_strings.js";
import {validateEmailAddress} from "~/shared/helpers/string/email_address.js";
import {Replace} from "~/shared/helpers/types/replace.js";
import {isId} from "~/shared/id/id.js";
import {AccountId, BotId, FileId, SpaceId} from "~/shared/id/types/id_types.js";
import {InboxModel} from "~/shared/notifications/inbox_model.js";
import {
    getAccountByEmailAddressAsAdmin,
    getAccountByIdAsAdmin,
    updateOurAccountName,
    updateOurAccountObservedTimeZone,
    updateOurLastOpenedSpaceId,
} from "~/shared/rpc/accounts_rpc_definitions.js";
import {
    registerOurAccountAppleDeviceToken,
    registerOurAccountWebPushSubscription,
} from "~/shared/rpc/notifications_rpc_definitions.js";
import {
    createAlphaSpaceAsAdmin,
    instantiateBotSpaceAccount,
} from "~/shared/rpc/spaces_rpc_definitions.js";
import {Schema, SchemaType} from "~/shared/schema/schema.js";
import {
    SearchOptions,
    SearchOptionsSchema,
    standardSearchOptions,
} from "~/shared/search/search_options.js";
import {AccountModel} from "~/shared/spaces/account_model.js";
import {alpineCompanyKnownSpaceId} from "~/shared/spaces/known_space_ids.js";
import {createAuthorizeSpaceAccessPermissionDeniedError} from "~/shared/spaces/space_error_messages.js";
import {SpaceModel} from "~/shared/spaces/space_model.js";

export const LoaderSchema = Schema.union({
    WithAccess: Schema.object({
        type: Schema.value("WithAccess"),
        space: SpaceModel.schema(),
        currentAccount: AccountModel.schema,
        inbox: createDynamoGeneralRealtimeItemSchema(InboxModel.schema()),
    }),
    WithoutAccess: Schema.object({
        type: Schema.value("WithoutAccess"),
        space: SpaceModel.schema(),
        currentAccountWithoutSpace: AccountModelWithoutSpace.schema.nullable(),
    }),
});

export function links(): Array<LinkDescriptor> {
    return [
        // Preload our monospace font Fira Code. This means it'll load before it's
        // referenced in the HTML. If we don't do this the user may see a flash of
        // unstyled monospace text on initial load.
        //
        // Many users won't need the monospace font since they aren't writing code.
        // We'd like the font to be available to much improve the first load
        // experience for users who will see monospace fonts though. Otherwise code
        // can feel janky as the monospace font flashes in.
        //
        // We preload at the space level since usage of the monospace font in our
        // marketing pages is rare.
        //
        // https://web.dev/articles/codelab-preload-web-fonts
        {
            rel: "preload",
            href: __RESOURCE_SERVICE_URL__ + "/fonts/commit-mono.v1.woff2",
            as: "font",
            type: "font/woff2",
            crossOrigin: "anonymous",
        },
        // Rationale for the styles here:
        //
        // - `overflow: hidden`: Turn off scrolling on `body` when in a space which
        //   comes with a top bar. This prevents over-scrolling up and down when at the
        //   top or bottom of a nested scroll view.
        //
        // - `width: 100svw; height: 100svh`: Make sure in a space the `body` height
        //   doesn't grow beyond what fits on the screen.
        {
            rel: "stylesheet",
            href: `data:text/css,${encodeURIComponent(
                `html, body {overflow: hidden; width: 100svw; height: 100svh}`,
            )}`,
        },
    ];
}

// Run the loader again only when the `SpaceId` changes.
export const shouldRevalidate: ShouldRevalidateFunction = ({
    currentParams,
    nextParams,
    nextUrl,
}) => {
    const newSpace = currentParams.spaceId !== nextParams.spaceId;
    const fromInvite = nextUrl.searchParams.get("from") === "invite";
    return newSpace || fromInvite;
};

export async function loader({context: loaderContext, params, request}: LoaderArgs) {
    const url = new URL(request.url);

    const spaceId = deserializeSpaceIdForLoader(params.spaceId);

    // Always use strong consistency for this endpoint. We only run this loader
    // once when the user opens the space so the cost doesn't matter. And it's good
    // to rule out eventual consistency issues in cases where the user is opening
    // the space after updating space or account state (e.g. they're navigating to
    // the space after sign up).
    const context = (await loaderContext.actor.authenticate()).dynamo.expectStrongReadConsistency();
    const consistency: DynamoCacheReadConsistency = "StrongWithinCache";

    switch (context.actor.type) {
        case "System": {
            // Allowing a system actor to load our app would be very dangerous! Since
            // system actors have read/write access to everything in the space.
            throw new PermissionDeniedError("Can\u2019t load the application with a system actor");
        }

        case "ImpersonatedAccount": {
            // Allowing a system actor to load our app would be dangerous! Since a system
            // actor can pretend to be any arbitrary account in the space.
            throw new PermissionDeniedError(
                "Can\u2019t load the application with an impersonated account actor",
            );
        }

        case "Bot": {
            // Bots aren't allowed to load the app. They must use `ApiService` to interact
            // with Alpine.
            throw new PermissionDeniedError("Can\u2019t load the application with a bot actor");
        }

        case "Anonymous": {
            const space = new SpaceModel({
                id: spaceId,
                version: -1,
                // If you don't have space access, you're not allowed to see the space's name.
                // Use an empty string as a placeholder.
                name: "",
                avatars: {
                    darkTheme: null,
                    lightTheme: null,
                },
            });

            return jsonWithSchema(
                LoaderSchema,
                {type: "WithoutAccess", space, currentAccountWithoutSpace: null},
                {propagateEventData: {context: {withoutSpaceAccess: true}}},
            );
        }

        case "Session": {
            const sessionContext = context as Context<
                Replace<LoaderContextModules, {actor: SessionActorContextModule}>
            >;

            // In the case of a permission denial, we may want to expose certain space data
            // This is currently used when an InvitePending account requests data about the space.
            let space: SpaceModel | null = null;

            try {
                // Await on data that we absolutely need first
                const [currentAccount, currentSpace, inboxResult] = await runAllPromises([
                    getOwnAccountIfExists(
                        sessionContext,
                        spaceId,
                        sessionContext.actor.getAccountId(),
                        {consistency},
                    ),

                    // If we're in an `InvitePending` state, we need to return the space
                    // data for the invite screen.
                    getSpace(sessionContext, spaceId, {consistency, allowInvitePending: true}),

                    // If `getInbox()` throws because we don't have space access, that's fine. This
                    // might be a user with a pending invite. We want to load the inbox item here in
                    // parallel with our other data in case we need it. If there's an error, catch
                    // the error and throw later after we know we have space access.
                    captureResultPromise(
                        getInbox(context.actor.authorizeSession(), {spaceId, consistency}),
                    ),
                ]);

                space = currentSpace;

                // Handle invite state before we throw on any permissions errors
                // in getSpace, getInbox, etc. If we are in any invite subtree,
                // don't try to redirect to the invite page.
                const currentPathname = url.pathname;
                const invitePathRoot = `/s/${spaceId}/invite`;
                const accountIsInvitePending =
                    currentAccount?.initialData.space.state.type === "InvitePending";

                if (accountIsInvitePending && !currentPathname.startsWith(invitePathRoot)) {
                    const to =
                        currentPathname !== "/"
                            ? encodeURIComponent(currentPathname.replace(`/s/${spaceId}`, ""))
                            : undefined;
                    return redirect(`${invitePathRoot}${to ? `?to=${to}` : ""}`);
                }

                // It's probably safe to assert here since `getSpace()` will throw if the
                // account doesn't have access (and doesn't have an `InvitePending` state).
                if (!currentAccount) {
                    throw createAuthorizeSpaceAccessPermissionDeniedError(
                        space.id,
                        sessionContext.actor.getAccountId(),
                    );
                }

                const inbox = unwrapResult(inboxResult);

                return jsonWithSchema(LoaderSchema, {
                    type: "WithAccess",
                    space,
                    currentAccount,
                    inbox,
                });
            } catch (error) {
                // If we failed to load the space route because the session actor doesn't have
                // access to the space then we still want to attempt to load the page in
                // `WithoutAccess` mode. In case the underlying content has URL sharing turned
                // on.
                //
                // In order to figure out if the error was a space authorization issue, we call
                // `authorizeSpaceAccessIfPossible()` and rethrow the error if that succeeds.
                // That function only returns an error result if the session actor doesn't have
                // space access.
                const spaceAuthorizationResult = await authorizeSpaceAccessIfPossible(
                    context,
                    spaceId,
                );
                if (spaceAuthorizationResult.ok) throw error;

                const account = await getOwnAccount(sessionContext, {consistency});

                const limitedSpace = new SpaceModel({
                    id: spaceId,
                    version: -1,
                    // If you don't have space access, you're not allowed to see the space's name.
                    // Use an empty string as a placeholder.
                    name: space?.name || "",
                    avatars: {
                        darkTheme: null,
                        lightTheme: null,
                    },
                });

                return jsonWithSchema(
                    LoaderSchema,
                    {
                        type: "WithoutAccess",
                        space: limitedSpace,
                        currentAccountWithoutSpace: account,
                    },
                    {propagateEventData: {context: {withoutSpaceAccess: true}}},
                );
            }
        }
        default:
            throw exhaustive(context.actor);
    }
}

const SearchDebugOptionsSchema = Schema.object({
    isDebugModeEnabled: Schema.boolean,
    options: SearchOptionsSchema,
});

const defaultSearchDebugOptionsSchema: SchemaType<typeof SearchDebugOptionsSchema> = {
    isDebugModeEnabled: false,
    options: standardSearchOptions,
};

const spaceNativeMobileOutletParentRouteIds = ["root", "routes/s.$spaceId"] as const;

const outletContainerContainerClassName = sprinkles({
    overflow: "hidden",
    position: "relative",
    zIndex: "0",
});

const outletContainerClassName = sprinkles({
    display: "flex",
    flexDirection: "row",
    overflow: "hidden",
    position: "relative",
    zIndex: "0",
});

// Make `clientLoaderTaskStoreLoaderData` available when importing the
// `s.$spaceId.tsx` route module.
SpaceLayoutRoute.clientLoaderTaskStoreLoaderData = clientLoaderTaskStoreLoaderData;

/**
 * Search parameters that are useful for controlling the initial state of the layout.
 * They are only one-shot parameters that should be removed after being processed.
 */
const searchParametersToDelete = ["from", "purchased"];

/**
 * Routes that render under `/s/$spaceId` should generally render
 * `<SpaceRouteScrollView>` as their parent since it contains best practices for
 * a space route's content area. Ideally we would make it the default but some
 * routes need to opt-out and manage scrolling on their own
 * (e.g. virtualized lists).
 */
export default function SpaceLayoutRoute() {
    const dataRouterStateContext = assertExists(useContext(DataRouterStateContext));
    const loaderData = useLoaderDataWithSchema(LoaderSchema);

    const params = useParams();
    const [searchParams, setSearchParams] = useSearchParams();
    const context = useAppContext();
    const isInitialAppRender = useIsInitialAppRender();
    const clientInfo = useClientInfo();
    const platform = usePlatform();
    const browserId = useBrowserId();
    const spaceId = params.spaceId as SpaceId;

    const peekStackRef = useRef<PeekStackContextProviderRef>(null);

    const [isPurchasedLifetimeAccessModalVisible, setIsPurchasedLifetimeAccessModalVisible] =
        useState(false);

    if (
        !isInitialAppRender &&
        !isPurchasedLifetimeAccessModalVisible &&
        searchParams.get("purchased") === "lifetime-access"
    ) {
        setIsPurchasedLifetimeAccessModalVisible(true);
    }

    useEffect(() => {
        if (
            loaderData.type === "WithAccess" &&
            // TODO(calebmer): Gate access to `dev` console helper behind a feature flag
            // instead of looking for known spaces/accounts.
            (spaceId === alpineCompanyKnownSpaceId ||
                hasOwnProperty(alpioneers, loaderData.currentAccount.id))
        ) {
            attachDevConsoleForAccountInProduction();
        }
    }, [loaderData, spaceId]);

    const lastOpenedSpaceIdRef = useRef<SpaceId | null>(null);
    useEffect(() => {
        if (lastOpenedSpaceIdRef.current === spaceId) return;
        lastOpenedSpaceIdRef.current = spaceId;

        // Only update lastOpenedSpaceId if the account has access to the space
        if (loaderData.type !== "WithAccess") return;

        void updateOurLastOpenedSpaceId(context, {
            lastOpenedSpaceId: spaceId,
        });
    }, [spaceId, context, loaderData.type]);

    const observedTimeZoneRef = useRef<TimeZone | null>(null);
    useEffect(() => {
        if (observedTimeZoneRef.current === clientInfo.timeZone) return;
        observedTimeZoneRef.current = clientInfo.timeZone;
        const account =
            loaderData.type === "WithAccess"
                ? loaderData.currentAccount
                : loaderData.currentAccountWithoutSpace;
        if (!account) return;

        // Never update an account's timezone to null or undefined, it's better if it has an old value than a null value
        if (!clientInfo.timeZone || !isTimeZone(clientInfo.timeZone)) return;

        void updateOurAccountObservedTimeZone(context, {timeZone: clientInfo.timeZone});
    }, [clientInfo.timeZone, context, loaderData]);

    const accountRegistry = useAccountRegistryForSpaceId(spaceId);

    useDevConsoleTool("accounts", () => ({
        store: accountRegistry,
        updateOurName: async (name: string) => {
            const {account} = await updateOurAccountName(context, {name});
            accountRegistry.immediatelyUpdateAccountStoreIfExists(account);
        },
    }));

    useEffect(() => {
        // TODO(calebmer): Remove this when we have update account name UI. This is
        // only available temporarily for users who ask for it.
        (globalThis as any).__updateOurAccountName = async (name: string) => {
            const {account} = await updateOurAccountName(context, {name});
            accountRegistry.immediatelyUpdateAccountStoreIfExists(account);
        };

        return () => {
            delete (globalThis as any).__updateOurAccountName;
        };
    }, [accountRegistry, context]);

    useDevConsoleTool("admin", () => ({
        getAccountById: async (accountId: AccountId) => {
            const {account} = await getAccountByIdAsAdmin(context, {accountId});
            return account;
        },
        getAccountByEmailAddress: async (emailAddress: string) => {
            const {account} = await getAccountByEmailAddressAsAdmin(context, {
                emailAddress: validateEmailAddress(emailAddress),
            });
            return account;
        },
        createAlphaSpaceAsAdmin: async (input: {name: string; ownerAccountId: AccountId}) => {
            const output = await createAlphaSpaceAsAdmin(context, input);
            return output;
        },
        instantiateBotSpaceAccount: async (input: {botId: BotId; botAccountId?: AccountId}) => {
            const {account} = await instantiateBotSpaceAccount(context, {
                spaceId,
                botId: input.botId,
                accountId: input.botAccountId,
            });
            return account.id;
        },
    }));

    // When the user types in a text input in a space we need to make sure the new
    // text isn't offscreen (or hidden by the native mobile keyboard).
    useTextInputVisibilityMaintainer();

    const setSearchQueryText = useCallback(
        (queryText: string | null) => {
            setSearchParams(
                oldSearchParams => {
                    if (oldSearchParams.get("search") === queryText) return oldSearchParams;

                    const newSearchParams = new URLSearchParams(oldSearchParams);
                    if (queryText === null) {
                        newSearchParams.delete("search");
                    } else {
                        newSearchParams.set("search", queryText);
                    }
                    return newSearchParams;
                },
                {
                    replace: true,
                    // Don't revalidate when updating search params from here. We can't use the
                    // stable `shouldRevalidate` route function because we want ALL rendered routes
                    // to skip revalidation. And updating all rendered routes `shouldRevalidate`
                    // function to ignore `search` is too much of a burden.
                    unstable_shouldRevalidate: false,
                },
            );
        },
        [setSearchParams],
    );

    // If we switch to mobile then clear the `search` URL parameter
    // since mobile can't render the search modal.
    useEffect(() => {
        if (
            (loaderData.type !== "WithAccess" || platform === "mobile") &&
            searchParams.get("search") !== null
        ) {
            setSearchQueryText(null);
        }
    }, [loaderData.type, platform, searchParams, setSearchQueryText]);

    // Delete search params we don't want to leave in the URL.
    const hasSearchParamsToDelete = searchParametersToDelete.some(param => searchParams.has(param));
    useEffect(() => {
        if (hasSearchParamsToDelete) {
            setSearchParams(
                oldSearchParams => {
                    const newSearchParams = new URLSearchParams(oldSearchParams);
                    for (const param of searchParametersToDelete) {
                        newSearchParams.delete(param);
                    }
                    return newSearchParams;
                },
                // We don't want to revalidate when removing these search params or
                // push new entries into the history stack.
                {replace: true, unstable_shouldRevalidate: false},
            );
        }
    }, [hasSearchParamsToDelete, setSearchParams]);

    const [debugOptions, setDebugOptions] = useLocalStorage(
        "cyberworlds/searchDebugOptions",
        SearchDebugOptionsSchema,
        defaultSearchDebugOptionsSchema,
    );

    useDevConsoleTool("search", () => ({
        toggleDebugMode: () =>
            setDebugOptions({
                ...debugOptions,
                isDebugModeEnabled: !debugOptions.isDebugModeEnabled,
            }),

        getDebugOptions: () => debugOptions.options,
        setDebugOptions: (options: SearchOptions) =>
            setDebugOptions({isDebugModeEnabled: debugOptions.isDebugModeEnabled, options}),
        resetDebugOptions: () =>
            setDebugOptions({
                isDebugModeEnabled: debugOptions.isDebugModeEnabled,
                options: standardSearchOptions,
            }),
    }));

    // In native mobile iOS apps, save any iOS device tokens to the server. We'll
    // use the device token to actually send the user push notifications.
    useEffect(() => {
        if (!NativeMobileBridge) return;

        const take = () => {
            NativeMobileBridge!.notifications.takeAppleDeviceTokens().then(
                deviceTokens => {
                    for (const deviceToken of deviceTokens) {
                        registerOurAccountAppleDeviceToken(context, {deviceToken}).then(
                            () => {
                                // Hooray!
                            },
                            error => {
                                context.tracer
                                    .getRoot()
                                    .logException("Couldn\u2019t save iOS device token", error);
                            },
                        );
                    }
                },
                error => {
                    context.tracer
                        .getRoot()
                        .logException("Couldn\u2019t take iOS device tokens", error);
                },
            );
        };

        // Initial take call in case device tokens were added before our JavaScript
        // code started running.
        take();

        return NativeMobileBridge.notifications.subscribeToAppleDeviceTokensUpdate(() => {
            take();
        });
    }, [context]);

    // Don't re-prompt or recheck for browser push notification permission if we've already done so. The user
    // may have dismissed the permission prompt, and we don't want to ask again unless they reload the page.
    const hasPromptedForBrowserPushNotificationPermissionRef = useRef<boolean>(false);

    useEffect(() => {
        if (loaderData.type !== "WithAccess") return;
        if (hasPromptedForBrowserPushNotificationPermissionRef.current) return;
        hasPromptedForBrowserPushNotificationPermissionRef.current = true;

        const promptAndSubscribeToWebPushNotifications = async () => {
            // Note: This prompt will not happen in Safari as it requires the prompt to be triggered by a user action.
            // Safari users must instead enable push notifications in Notifications settings.
            const permission = await getOrPromptForBrowserPushNotificationPermission();
            if (permission === "granted") {
                const subscription = await subscribeToPushNotificationsInBrowser(browserId);

                if (!subscription) return;

                await registerOurAccountWebPushSubscription(context, {
                    browserId,
                    subscription,
                });
            }
        };

        promptAndSubscribeToWebPushNotifications().catch(error => {
            context.tracer
                .getRoot()
                .logException("Error subscribing to web push notifications", error);
        });
    }, [loaderData, spaceId, context, browserId]);

    const handleSearchModalClose = useCallback(() => {
        setSearchQueryText(null);
    }, [setSearchQueryText]);

    const handleSearchModalPushPeekStack = useCallback(
        async (to: To, options?: {focus?: boolean}) => {
            await assertExists(peekStackRef.current).push(to, options);
        },
        [],
    );

    const modals: Array<ReactNode> = [];
    let hasAddedSearchModal = false;
    let hasAddedContentFileViewerModal = false;

    // Add modals to the DOM in the order they appear in `searchParams`. So if the
    // search modal was opened before the file viewer modal then the search modal
    // should render underneath the file viewer modal. If the search modal was
    // opened after the file viewer modal then the search modal should render on
    // top of the file viewer modal.
    for (const [searchParamName, searchParamValue] of searchParams) {
        switch (searchParamName) {
            case "search": {
                if (loaderData.type !== "WithAccess") continue;
                if (platform === "mobile") continue;
                if (isInitialAppRender) continue;

                if (hasAddedSearchModal) continue;
                hasAddedSearchModal = true;

                modals.push(
                    <SearchModal
                        key={searchParamName}
                        onClose={handleSearchModalClose}
                        pushPeekStack={handleSearchModalPushPeekStack}
                        debugOptions={debugOptions.isDebugModeEnabled ? debugOptions.options : null}
                    />,
                );
                break;
            }
            case "file": {
                if (isInitialAppRender) continue;

                if (hasAddedContentFileViewerModal) continue;
                hasAddedContentFileViewerModal = true;

                const [fileId = "", fileAttachmentTargetString] = searchParamValue.split(" ", 2);

                if (!isId<FileId>(fileId)) continue;

                let fileAttachmentTarget: FileAttachmentTarget | "Uploader";
                if (fileAttachmentTargetString === undefined) {
                    fileAttachmentTarget = "Uploader";
                } else {
                    try {
                        fileAttachmentTarget = deserializeFileAttachmentTargetString(
                            fileAttachmentTargetString,
                        );
                    } catch {
                        // Ignore formatting errors.
                        continue;
                    }
                }

                const handleClose = () => {
                    setSearchParams(
                        oldSearchParams => {
                            const newSearchParams = new URLSearchParams(oldSearchParams);
                            newSearchParams.delete("file");
                            return newSearchParams;
                        },
                        {
                            replace: true,
                            // Don't fetch route data from the server. We don't need any new route data.
                            unstable_shouldRevalidate: false,
                        },
                    );
                };

                modals.push(
                    <ContentFileViewerModal
                        key={searchParamName}
                        fileId={fileId}
                        attachmentTarget={fileAttachmentTarget}
                        onClose={handleClose}
                    />,
                );
                break;
            }
        }
    }

    if (isPurchasedLifetimeAccessModalVisible) {
        modals.push(
            <PurchasedLifetimeAccessModal
                onClose={() => setIsPurchasedLifetimeAccessModalVisible(false)}
            />,
        );
    }

    const hasSpaceLayoutWebMobileTabBar =
        loaderData.type === "WithAccess" && platform === "mobile" && !clientInfo.isNativeMobile;

    return (
        <GlobalKeyDownEvent
            // Re-render everything when the space changes.
            key={spaceId}
            onGlobalKeyDown={event => {
                switch (event.key) {
                    // Disable Home/End browser behavior when not focused in a text input. When
                    // focused in a text input Home/End go to the beginning or end of the input.
                    // When not focused in a text input Home/End scroll to the beginning or end of
                    // the page.
                    //
                    // We don't want to let these keyboard shortcuts scroll our page. Scrolling
                    // to the extremity of a lazy loaded virtualized scroll view with Home/End
                    // doesn't make sense. Forces the user to scroll continuously with the scroll
                    // wheel or scroll bar.
                    //
                    // Individual components may implement Home/End keyboard shortcuts. These
                    // shortcuts are focused on small, local, start/end navigations. Instead of full
                    // page disruptive navigations. (Which a user may trigger on accident.)
                    case "Home":
                    case "End": {
                        event.preventDefault();
                        event.stopPropagation();

                        // Manually implement Home/End key presses for text input elements since
                        // browsers may have inconsistent behaviors. For example Safari will scroll
                        // instead of moving the text cursor.
                        handleHomeOrEndKeyDownForTextInputElement(event);
                        break;
                    }

                    // Don't perform the browser default undo logic unless we are focused in a text
                    // input. The browser will pick the last text input you interacted with and undo
                    // from there which we don't want. Some of our more complex systems (like the
                    // task system) need careful control over what we undo.
                    case "z":
                    case "y": {
                        if (
                            (!document.activeElement ||
                                !isTextInputElement(document.activeElement)) &&
                            (clientInfo.isAppleDevice ? event.metaKey : event.ctrlKey)
                        ) {
                            event.preventDefault();
                            event.stopPropagation();
                        }
                        break;
                    }

                    // NOTE(calebmer): cmd-p is the superior shortcut to cmd-k for search. cmd-k is
                    // also used for links when text is selected. We only document support for cmd-p
                    // because it's unambiguous but we support cmd-k because it's popular among many
                    // modern productivity apps (e.g. Slack, Notion, Linear) and we don't want to
                    // break people's muscle memory.
                    //
                    // In the future I'd love to phase out cmd-k support for search. e.g. If someone
                    // hits cmd-k when text isn't selected then open search either via cmd-p or
                    // clicking the search button ask them if they want to bind cmd-k (when text
                    // isn't selected) to search.
                    case "p":
                    case "k": {
                        if (
                            platform !== "mobile" &&
                            (clientInfo.isAppleDevice ? event.metaKey : event.ctrlKey)
                        ) {
                            event.preventDefault();
                            event.stopPropagation();

                            if (loaderData.type === "WithAccess") {
                                setSearchQueryText("");
                            }
                        }
                        break;
                    }

                    // Disable the browser default Cmd+ArrowLeft to navigate back behavior. It's
                    // confusing when you're in a text input, try to use this shortcut, but
                    // Cmd+ArrowLeft does nothing since you're selection is already at the start of
                    // the text input. Instead you should use the Cmd+[ shortcut to navigate back.
                    case "ArrowLeft":
                    case "ArrowRight": {
                        if (
                            (!document.activeElement ||
                                !isTextInputElement(document.activeElement)) &&
                            (clientInfo.isAppleDevice ? event.metaKey : event.ctrlKey)
                        ) {
                            event.preventDefault();
                            event.stopPropagation();
                        }
                        break;
                    }
                }
            }}
        >
            <ContentFileEntityRenderersContext.Provider value={contentFileEntityRenderers}>
                <GlobalLoadingIndicatorContextProvider>
                    {globalLoadingIndicator => (
                        <SpaceContextProvider
                            initialSpace={loaderData.space}
                            currentAccount={
                                loaderData.type === "WithAccess" ? loaderData.currentAccount : null
                            }
                            currentAccountWithoutSpace={
                                loaderData.type === "WithAccess"
                                    ? loaderData.currentAccount
                                    : loaderData.currentAccountWithoutSpace
                            }
                        >
                            <TaskRealtimeClientContextProvider
                                spaceId={spaceId}
                                currentAccountId={
                                    loaderData.type === "WithAccess"
                                        ? loaderData.currentAccount.id
                                        : (loaderData.currentAccountWithoutSpace?.id ?? null)
                                }
                            >
                                <ContextMenuContextProvider>
                                    <PeekStackContextProvider
                                        ref={peekStackRef}
                                        // The peek stack component is responsible for rendering our global loading
                                        // indicator so it can make sure the loading indicator avoids the peek stack.
                                        globalLoadingIndicator={globalLoadingIndicator}
                                    >
                                        <SpaceLayoutRouteOutlet
                                            dataRouterStateContext={dataRouterStateContext}
                                            loaderData={loaderData}
                                            setSearchQueryText={setSearchQueryText}
                                            globalLoadingIndicator={globalLoadingIndicator}
                                        />
                                    </PeekStackContextProvider>
                                    {modals}
                                    {hasSpaceLayoutWebMobileTabBar && (
                                        <SpaceLayoutWebMobileTabBar
                                            initialInbox={loaderData.inbox}
                                        />
                                    )}
                                    {loaderData.type === "WithAccess" &&
                                        clientInfo.isNativeMobile && (
                                            <SpaceLayoutNativeMobileInboxController
                                                initialInbox={loaderData.inbox}
                                            />
                                        )}
                                </ContextMenuContextProvider>
                            </TaskRealtimeClientContextProvider>
                        </SpaceContextProvider>
                    )}
                </GlobalLoadingIndicatorContextProvider>
                ,
            </ContentFileEntityRenderersContext.Provider>
        </GlobalKeyDownEvent>
    );
}

function SpaceLayoutRouteOutlet({
    dataRouterStateContext,
    loaderData,
    setSearchQueryText,
    globalLoadingIndicator,
}: {
    dataRouterStateContext: NonNullable<ContextType<typeof DataRouterStateContext>>;
    loaderData: SchemaType<typeof LoaderSchema>;
    setSearchQueryText: (queryText: string) => void;
    globalLoadingIndicator: GlobalLoadingIndicator | null;
}) {
    const params = useParams();
    const context = useAppContext();
    const updateMetaTitle = useUpdateMetaTitle();
    const clientInfo = useClientInfo();
    const platform = usePlatform();
    const {space} = useSpaceContext();

    const {resizedWindowHeightForMobileWebKit} = useMobileWebKitKeyboardSupport();

    // We've observed that sometimes Chrome will change the `scrollTop` of our
    // `<body>` element even though `overflow: hidden` is set. Specifically we've
    // observed this when `element.scrollIntoView()` is called for an element in a
    // peek which is animating up (since the peek starts offscreen). We've also
    // seen this occasionally happen in Playwright integration tests.
    //
    // Make sure if we see a scroll event on the window we immediately reset our
    // `<body>`'s `scrollTop` to 0 or else we'll get into weird states.
    //
    // NOTE(calebmer, 2025-10-11): I'm able to reliably reproduce this with the
    // Playwright test "can reply to range in single message" in
    // `messaging_message_range_parent_desktop.spec.ts`. [Demo video][1]
    //
    // [1]: https://alpine.inc/s/c2pwxmpv3z7b3db19tsn6y1qfg/documents/cc7w1v6xhkyzg377anyk42e28m
    useEffect(() => {
        // Mobile WebKit has its own handling for document scrolling in
        // `useMobileWebKitKeyboardSupport()`.
        if (isMobileWebKit) return;

        document.documentElement.scrollTop = 0;
        document.documentElement.scrollLeft = 0;
        document.body.scrollTop = 0;
        document.body.scrollLeft = 0;

        const handleWindowScroll = () => {
            document.documentElement.scrollTop = 0;
            document.documentElement.scrollLeft = 0;
        };

        const handleBodyScroll = () => {
            document.body.scrollTop = 0;
            document.body.scrollLeft = 0;
        };

        window.addEventListener("scroll", handleWindowScroll);
        document.body.addEventListener("scroll", handleBodyScroll);

        return () => {
            window.removeEventListener("scroll", handleWindowScroll);
            document.body.removeEventListener("scroll", handleBodyScroll);
        };
    }, []);

    const nativeMobileRouterState = isNativeMobileRouterState(dataRouterStateContext)
        ? dataRouterStateContext
        : null;

    const isBehindMobileFullScreenModal = useIsBehindMobileFullScreenModal();
    const isInert = isBehindMobileFullScreenModal;

    // `height` is not a typo here. Even though all our containers (e.g. `html` and
    // `body`) use `minHeight`. For space content, we use nested scroll views when
    // we need to scroll instead of body scrolling. See how body scrolling is
    // disabled with `body {overflow: hidden}` in the `links()` function above.
    //
    // 100svh is the default so our content isn't occluded by browser navigation
    // elements on mobile devices. (Like the URL bar.)
    const outletContainerHeight =
        resizedWindowHeightForMobileWebKit !== null
            ? loaderData.type === "WithAccess" &&
              platform === "mobile" &&
              !clientInfo.isNativeMobile
                ? `min(${resizedWindowHeightForMobileWebKit}px, 100svh - ${spacing[spaceLayoutWebMobileTabBarHeight]})`
                : `min(${resizedWindowHeightForMobileWebKit}px, 100svh)`
            : loaderData.type === "WithAccess" &&
                platform === "mobile" &&
                !clientInfo.isNativeMobile
              ? `calc(100svh - ${spacing[spaceLayoutWebMobileTabBarHeight]})`
              : "100svh";

    const globalLoadingIndicatorForMobile = platform === "mobile" ? globalLoadingIndicator : null;

    const nodes = useMemo(() => {
        const nodes = [];

        if (!nativeMobileRouterState) {
            const hasSpaceLayoutSideBar = loaderData.type === "WithAccess" && platform !== "mobile";

            nodes.push(
                <div
                    // We need a key since we're in an array but the key doesn't matter.
                    key="0"
                    className={outletContainerContainerClassName}
                    style={{
                        height: outletContainerHeight,
                        // @ts-expect-error: TypeScript doesn't understand CSS variables but
                        // they're fine.
                        "--space-outlet-height": outletContainerHeight,
                    }}
                >
                    <RootOverlayScopeContextProvider
                        // Only create a root overlay scope here if we'll be shrinking our outlet height
                        // when the mobile keyboard opens.
                        isDisabled={platform !== "mobile"}
                    >
                        <div
                            className={outletContainerClassName}
                            style={{
                                height: outletContainerHeight,
                                // While inert, remove the document from the content flow and make
                                // it invisible. `bottom: 0` is so that a tall inert route doesn't grow
                                // our `<body>`'s height.
                                position: isInert ? "absolute" : "relative",
                                bottom: isInert ? "0" : undefined,
                                visibility: isInert ? "hidden" : undefined,
                                // A `<div>` positioned relatively is implicitly `width: 100%`. Make sure the
                                // absolutely positioned inert route gets the same width.
                                left: isInert ? "0" : undefined,
                                right: isInert ? "0" : undefined,
                            }}
                            // The [`<Offscreen>` component][1] React claims is coming may be a better
                            // fit here so we don't actually render content in the DOM. `inert` has good
                            // browser support though!
                            //
                            // [1]: https://react.dev/blog/2022/03/29/react-v18
                            // [2]: https://caniuse.com/?search=inert
                            inert={isInert ? true : undefined}
                            // Make sure inert content is not in the accessibility tree.
                            aria-hidden={isInert ? "true" : undefined}
                        >
                            {hasSpaceLayoutSideBar && (
                                <SpaceLayoutSideBar
                                    space={space}
                                    currentAccount={loaderData.currentAccount}
                                    initialInbox={loaderData.inbox}
                                    onSearchPress={() => setSearchQueryText("")}
                                />
                            )}
                            <LoadingIndicatorSpaceOutletContainer
                                routeId="routes/s.$spaceId"
                                hasSpaceLayoutSidebar={platform !== "mobile"}
                            >
                                <SpaceLayoutSideBarContentBlockWidthContextProvider
                                    isDisabled={!hasSpaceLayoutSideBar}
                                >
                                    <Outlet />
                                </SpaceLayoutSideBarContentBlockWidthContextProvider>
                            </LoadingIndicatorSpaceOutletContainer>
                            {globalLoadingIndicatorForMobile && (
                                <Box
                                    pointerEvents="none"
                                    position="absolute"
                                    zIndex="10"
                                    right="0"
                                    borderTopLeftRadius="1"
                                    backgroundColor="grey-0"
                                    style={{
                                        // Position with `top` instead of using `bottom: 0` so the saving indicator is
                                        // below the keyboard when the keyboard opens.
                                        top:
                                            loaderData.type === "WithAccess" &&
                                            platform === "mobile"
                                                ? `calc(100svh - ${addRemLengths(
                                                      spaceLayoutWebMobileTabBarHeight,
                                                      globalLoadingIndicatorChipHeight,
                                                  )})`
                                                : undefined,
                                    }}
                                >
                                    <GlobalLoadingIndicatorChip
                                        indicator={globalLoadingIndicatorForMobile}
                                    />
                                </Box>
                            )}
                        </div>
                    </RootOverlayScopeContextProvider>
                </div>,
            );
        } else {
            const outletContainerStyle = {height: outletContainerHeight};

            // In our native mobile app, render all inert routes for this `SpaceId`. We
            // render them here instead of `root.tsx` so we can share space context like
            // the task realtime client.
            //
            // To learn more about inert route rendering, there's a comment in `root.tsx`
            // on top of a similar loop over `nativeMobileRouterState.inertRouterStates`
            // you can read.
            for (const {
                entryKey,
                routerState: inertRouterState,
            } of nativeMobileRouterState.inertRouterStates) {
                if (
                    !inertRouterState.matches.some(
                        match =>
                            match.route.id === "routes/s.$spaceId" &&
                            match.params.spaceId === params.spaceId,
                    )
                ) {
                    continue;
                }

                nodes.push(
                    <NativeMobileOutlet
                        key={entryKey}
                        parentRouteIds={spaceNativeMobileOutletParentRouteIds}
                        tracer={context.tracer.getRoot()}
                        inertRouterState={inertRouterState}
                        onUpdateMetaTitle={updateMetaTitle}
                        globalLoadingIndicator={null}
                        className={outletContainerClassName}
                        style={outletContainerStyle}
                        renderOutlet={outlet => (
                            <LoadingIndicatorSpaceOutletContainer routeId="routes/s.$spaceId">
                                {outlet}
                            </LoadingIndicatorSpaceOutletContainer>
                        )}
                    />,
                );
            }

            nodes.push(
                <NativeMobileOutlet
                    key={nativeMobileRouterState.entryKey}
                    parentRouteIds={spaceNativeMobileOutletParentRouteIds}
                    tracer={context.tracer.getRoot()}
                    isInert={isInert}
                    inertRouterState={null}
                    onUpdateMetaTitle={updateMetaTitle}
                    globalLoadingIndicator={globalLoadingIndicatorForMobile}
                    className={outletContainerClassName}
                    style={outletContainerStyle}
                    renderOutlet={outlet => (
                        <LoadingIndicatorSpaceOutletContainer routeId="routes/s.$spaceId">
                            {outlet}
                        </LoadingIndicatorSpaceOutletContainer>
                    )}
                />,
            );
        }

        // Maintain a consistent ordering of history stack items in the DOM. If history
        // stack items move during a navigation then their scroll positions and other
        // DOM state will be reset!
        //
        // History stack items often change order when switching tabs. For instance if
        // you switch to the inbox tab then all previous inbox history stack entries
        // will be moved to the end of `inertRouterStates`. If we keep entries in
        // `inertRouterStates` order then React will happily call
        // `Element.appendChild()` (or `Element.insertBefore()`) to move the history
        // stack entry in the DOM which resets the route's `scrollTop` state so if the
        // user navigates back their scroll position is lost. `scrollTop` also updates
        // without sending a scroll event which means `useNavigationBar()`'s state
        // won't update which will look broken.
        //
        // [Example of a problem not sorting causes][1]. Notice how the second time we
        // navigate to the document it's been scrolled to the top. That's because the
        // inert route DOM nodes are being reordered.
        //
        // [1]: https://gist.github.com/calebmer/9fdbc9ffb08c700c6737866f18fe340a
        if (nodes.length > 1) {
            nodes.sort((node1, node2) =>
                defaultCompareStrings(String(node1.key), String(node2.key)),
            );
        }

        return nodes;
    }, [
        context.tracer,
        globalLoadingIndicatorForMobile,
        isInert,
        loaderData,
        space,
        nativeMobileRouterState,
        outletContainerHeight,
        params.spaceId,
        platform,
        setSearchQueryText,
        updateMetaTitle,
    ]);

    // React supports rendering an array as children but TypeScript gets confused.
    return nodes as any as ReactElement;
}

/**
 * Handle `Home` or `End` keyboard presses. Moving the cursor to the start or
 * end of the current line respectively.
 */
function handleHomeOrEndKeyDownForTextInputElement(event: KeyboardEvent) {
    const {activeElement} = document;

    if (
        activeElement instanceof HTMLInputElement &&
        textInputTypes.has(activeElement.type) &&
        !activeElement.readOnly &&
        !activeElement.disabled
    ) {
        if (event.key === "Home") {
            activeElement.selectionStart = 0;
            if (!event.shiftKey) activeElement.selectionEnd = 0;
        } else {
            activeElement.selectionEnd = activeElement.value.length;
            if (!event.shiftKey) activeElement.selectionStart = activeElement.value.length;
        }
    }

    if (
        activeElement instanceof HTMLTextAreaElement &&
        !activeElement.readOnly &&
        !activeElement.disabled
    ) {
        if (event.key === "Home") {
            const index = activeElement.value.lastIndexOf("\n", activeElement.selectionStart - 1);

            if (index !== -1) {
                activeElement.selectionStart = index + 1;
                if (!event.shiftKey) activeElement.selectionEnd = index + 1;
            } else {
                activeElement.selectionStart = 0;
                if (!event.shiftKey) activeElement.selectionEnd = 0;
            }
        } else {
            const index = activeElement.value.indexOf("\n", activeElement.selectionEnd);

            if (index !== -1) {
                activeElement.selectionEnd = index;
                if (!event.shiftKey) activeElement.selectionStart = index;
            } else {
                activeElement.selectionEnd = activeElement.value.length;
                if (!event.shiftKey) activeElement.selectionStart = activeElement.value.length;
            }
        }
    }

    if (activeElement instanceof HTMLElement && activeElement.isContentEditable) {
        const selection = window.getSelection();
        const range = selection?.getRangeAt(0);
        let currentNode: Node | null = range?.startContainer ?? null;

        if (selection && range && currentNode instanceof Text) {
            if (event.key === "Home") {
                range.setStart(currentNode, 0);

                while (currentNode && currentNode !== activeElement) {
                    if (currentNode.previousSibling) {
                        if (isNodeBlockLevel(currentNode.previousSibling)) break;
                        currentNode = currentNode.previousSibling;
                    } else {
                        currentNode = currentNode.parentNode;
                        if (isNodeBlockLevel(currentNode)) break;
                    }

                    if (currentNode instanceof Text) {
                        range.setStart(currentNode, 0);
                    }
                }

                if (!event.shiftKey) {
                    range.collapse(true);
                }

                selection.removeAllRanges();
                selection.addRange(range);
            } else {
                const range = selection.getRangeAt(0);
                let currentNode: Node | null = range.startContainer;

                range.setEnd(currentNode, currentNode.textContent!.length);

                while (currentNode && currentNode !== activeElement) {
                    if (currentNode.nextSibling) {
                        if (isNodeBlockLevel(currentNode.nextSibling)) break;
                        currentNode = currentNode.nextSibling;
                    } else {
                        currentNode = currentNode.parentNode;
                        if (isNodeBlockLevel(currentNode)) break;
                    }

                    if (currentNode instanceof Text) {
                        range.setEnd(currentNode, currentNode.textContent.length);
                    }
                }

                if (!event.shiftKey) {
                    range.collapse(false);
                }

                selection.removeAllRanges();
                selection.addRange(range);
            }
        }
    }
}

// NOTE(calebmer, #mobile-webkit-weirdness): The iOS Safari support for the
// software keyboard is frustrating. It forces the web page into a state which
// breaks our assumptions of how a web browser should work, it's observable
// through (at times) inconsistent means, and lacks any customization.
//
// Note that this only applies to the iOS Safari web browser! In our native
// mobile app we use different tricks to handle the software keyboard. Namely,
// we disable WebKit's keyboard handling and add our own that supports custom
// animations and such.
//
// Proper keyboard support for our product requires a couple arcane tricks.
//
// Two excellent blog posts document the issues with the iOS Safari keyboard.
// "[The Eccentric Ways of iOS Safari with the Keyboard][1]" and "[Fixing the
// Safari Mobile Resizing Bug: A Developer's Guide][2]". It is easy reading
// these posts then working with our code to feel hopeless, but don't feel
// broken dear developer! You are a software engineer, you are a master of
// your programming environment. Anything you dream can happen on a screen you
// can make happen with enough time. This is a battle with Apple's willful
// ignorance of advanced web programming. There's no rule that says we can't
// make this work, so let's make it work.
//
// Now, at the core of the problem is how iOS Safari chooses to accommodate the
// software keyboard with websites. Most websites are not designed with the iOS
// software keyboard in mind. So Apple needed to choose behavior for their
// keyboard that would work good enough with all the websites out there. The
// method they chose is to have the keyboard push the web view up instead of
// shrinking the web view when the keyboard opens. They also scroll the
// web view to make sure they didn't push the content the user tapped
// offscreen.
//
// This is good for fluid animation performance. Slow JavaScript code
// responding to window resizing may make the website feel broken. However,
// this leads to the weird experience of the website's sticky navigation
// headers being moved offscreen. Which doesn't happen in native apps.
//
// Since part of the website is offscreen, iOS needs to let the user scroll to
// see it so Safari OVERRIDES any `body { overflow: hidden }` CSS. Given Alpine
// completely disables body scrolling in a space, instead adding scroll
// sub-views this is a problem. There are two competing scroll bars! One for the
// main content, one for the `html` element.
//
// So, in short what we need to do is:
//
// 1. Detect the actual displayed size of the web view and render our content
//    in that space (instead of the full shifted web view space)
//
// 2. Enforce our `body { overflow: hidden }` and stop the user from scrolling
//    the `html` element.
//
// To accomplish these two goals our implementation:
//
// 1. Can't rely on `height: 100svh` or `height: 100%` to get the height.
//    However, `window.visualViewport.height` and `window.innerHeight` appear
//    to have the right value. (Though the blog posts we link claim
//    `window.innerHeight` has different behavior in different versions of
//    iOS.)
//
//    We can observe changes to height with a `resize` listener on
//    `window.visualViewport` but a resize listener on `window` doesn't fire,
//    frustratingly. We put the correct height in React state and render our
//    container element with that height (instead of 100svh).
//
// 2. Adds a non-passive `touchmove` event handler that calls
//    `event.preventDefault()` if the user moves their touch in a
//    non-scrollable element. Since the scroll event would bubble to the `html`
//    element otherwise.
//
//    We allow `touchmove` events in scrollable elements. However, then
//    overscroll is a problem! If the user reaches the end of a scrollable
//    element then they start scrolling a parent element. This is fixed by
//    [`overscroll-behavior: contain`][3] which means we need to set
//    `overscroll-behavior: contain` on _every scrollable element_. We make
//    this happen with our Sprinkles CSS framework. `overflowY: "auto"` also
//    adds `overscrollBehavior: "contain"`.
//
// This leads to the behavior we want when the keyboard is opened/closed but
// the keyboard open/close animation looks terrible. The keyboard opens and
// sometime before/during/after the animation content jumps into the right
// position.
//
// [1]: https://blog.opendigerati.com/the-eccentric-ways-of-ios-safari-with-the-keyboard-b5aa3f34228d
// [2]: https://medium.com/@krutilin.sergey.ks/fixing-the-safari-mobile-resizing-bug-a-developers-guide-6568f933cde0
// [3]: https://developer.mozilla.org/en-US/docs/Web/CSS/overscroll-behavior
function useMobileWebKitKeyboardSupport() {
    const [resizedWindowHeightForMobileWebKit, setResizedWindowHeightForMobileWebKit] = useState<
        number | null
    >(null);

    useEffect(() => {
        if (!isMobileWebKit) return;

        // Don't install WebKit keyboard support in our native mobile app since we
        // completely disable WebKit's keyboard behavior there. Opting to implement our
        // own keyboard support for native mobile apps.
        //
        // Notably we'd like to avoid a `touchmove` handler with `{ passive: false }`
        // to improve touch interaction performance.
        if (NativeMobileBridge) return;

        let resizeTimeout: Timeout | null = null;

        const handleResize = () => {
            // We've observed setting `scrollTop` will cause some more resizes to happen in
            // quick succession that settle down into the same state we started with. To
            // work around this, throttle our resize handler. We wait at least 0.5s between
            // resize events then debounce consecutive resize events.
            if (resizeTimeout === null) {
                actuallyHandleResize();

                resizeTimeout = createTimeout(() => {
                    resizeTimeout = null;
                }, 500);
            } else {
                resizeTimeout.clear();

                resizeTimeout = createTimeout(() => {
                    resizeTimeout = null;
                    actuallyHandleResize();
                }, 500);
            }
        };

        const actuallyHandleResize = () => {
            // iOS will scroll the `html` element when the software keyboard opens even
            // though we have `html, body { overflow: hidden }` set. Immediately unset the
            // scroll.
            //
            // While our `scroll` event should cleanup `scrollTop`, we set `scrollTop = 0`
            // here too to make sure any subscribers to our keyboard frame change don't
            // observe the wrong `scrollTop`.
            document.documentElement.scrollTop = 0;

            // Since the resize may be a part of an animation, immediately update the
            // view height.
            flushSync(() => {
                setResizedWindowHeightForMobileWebKit(getWindowHeightAfterMobileWebKitKeyboard());
            });
        };

        const handleScroll = () => {
            // iOS will scroll the `html` element when the software keyboard opens even
            // though we have `html, body { overflow: hidden }` set. Immediately unset the
            // scroll.
            document.documentElement.scrollTop = 0;
        };

        (window.visualViewport ?? window).addEventListener("resize", handleResize);
        window.addEventListener("scroll", handleScroll);

        // Disable default scroll when the keyboard is open. Opening the keyboard makes the
        // `html` element scrollable even though `overflow: hidden` is set in CSS. This
        // function stops the `html` element from being scrolled.
        const enableDefaultScroll = disableMobileWebKitDefaultScroll();

        return () => {
            (window.visualViewport ?? window).removeEventListener("resize", handleResize);
            window.removeEventListener("scroll", handleScroll);
            enableDefaultScroll();
        };
    }, []);

    const lastResizedWindowHeightForMobileWebKitRef = useRef<number | null>(null);

    // When the keyboard height changes, let our listeners know so they can scroll
    // the view if necessary.
    useEffect(() => {
        if (lastResizedWindowHeightForMobileWebKitRef.current === null) {
            lastResizedWindowHeightForMobileWebKitRef.current =
                getWindowHeightAfterMobileWebKitKeyboard();
        }

        if (resizedWindowHeightForMobileWebKit === null) return;

        const lastResizedWindowHeightForMobileWebKit =
            lastResizedWindowHeightForMobileWebKitRef.current;
        if (lastResizedWindowHeightForMobileWebKit === resizedWindowHeightForMobileWebKit) {
            return;
        }
        lastResizedWindowHeightForMobileWebKitRef.current = resizedWindowHeightForMobileWebKit;

        const windowHeight = getWindowHeightBeforeMobileWebKitKeyboard();

        const oldKeyboardHeight = windowHeight - lastResizedWindowHeightForMobileWebKit;
        const newKeyboardHeight = windowHeight - resizedWindowHeightForMobileWebKit;

        // This emit function triggers some listeners that might call `flushSync()`
        // react warns if `flushSync()` is called during a lifecycle method. So
        // schedule a microtask so we don't end up calling in a lifecycle method.
        scheduleMicrotask(() => {
            emitMobileKeyboardFrameChangeIfNotNative({
                newKeyboardHeight,
                oldKeyboardHeight,
                shouldScroll: true,
                isAnimated: true,
            });
        });
    }, [resizedWindowHeightForMobileWebKit]);

    return {resizedWindowHeightForMobileWebKit};
}

/**
 * Get the window height before taking away space for the mobile WebKit
 * keyboard.
 */
function getWindowHeightBeforeMobileWebKitKeyboard() {
    // NOTE(calebmer): I've observed `window.innerHeight` sometimes giving the
    // height with the keyboard and sometimes giving the height without the
    // keyboard. This is consistent, though.
    return Math.round(document.documentElement.getBoundingClientRect().height);
}

/**
 * Get the window height after taking away space for the mobile WebKit
 * keyboard.
 */
function getWindowHeightAfterMobileWebKitKeyboard() {
    return Math.round(window.visualViewport?.height ?? window.innerHeight);
}
