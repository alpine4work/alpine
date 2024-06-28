import {ReactNode, useMemo, useState} from "react";
import {useAppContext} from "~/client/context/app_context.js";
import {Box} from "~/client/design/box.js";
import {Button} from "~/client/design/button.js";
import {Spacer} from "~/client/design/spacer.js";
import {TextInput} from "~/client/design/text_input.js";
import {useClientInfo} from "~/client/remix/client_info_context.js";
import {useLoaderDataWithSchema} from "~/client/remix/use_loader_data_with_schema.js";
import {metaTitlePostfix} from "~/client/remix/use_update_meta_title.js";
import {
    getAlphaConfiguration,
    getUndecidedAlphaAccessRequests,
} from "~/server/alpha/alpha_access_table.js";
import {jsonWithSchema} from "~/server/remix/json_with_schema.js";
import {LoaderArgs} from "~/server/remix/loader_context.js";
import {AlphaAccessRequestModel} from "~/shared/alpha/alpha_access_request_model.js";
import {AlphaConfigurationSchema} from "~/shared/alpha/alpha_configuration_schema.js";
import {runAllPromises} from "~/shared/helpers/async/run_all_promises.js";
import {SpaceId} from "~/shared/id/types/id_types.js";
import {
    approveAlphaAccessRequest,
    denyAlphaAccessRequest,
    saveAlphaConfiguration,
} from "~/shared/rpc/alpha_rpc_definitions.js";
import {Schema} from "~/shared/schema/schema.js";
import {sprinkles} from "~/shared/styles/styles.js";

export function meta() {
    return [{title: `Closed Alpha Management${metaTitlePostfix}`}];
}

const LoaderSchema = Schema.object({
    configuration: AlphaConfigurationSchema,
    requests: Schema.array(AlphaAccessRequestModel.schema()),
});

export async function loader({context}: LoaderArgs) {
    const [configuration, requests] = await runAllPromises([
        getAlphaConfiguration(context),
        getUndecidedAlphaAccessRequests(await context.actor.authenticate()),
    ]);
    return jsonWithSchema(LoaderSchema, {configuration, requests});
}

export default function AlphaManagementPage() {
    const context = useAppContext();
    const {locale} = useClientInfo();
    const {configuration, requests: loadedRequests} = useLoaderDataWithSchema(LoaderSchema);

    const dateTimeFormatter = useMemo(() => {
        return new Intl.DateTimeFormat(locale, {
            year: "numeric",
            month: "short",
            day: "numeric",
            hour: "numeric",
            minute: "numeric",
        });
    }, [locale]);

    const [decidedEmailAddresses, setDecidedEmailAddresses] = useState<ReadonlySet<string>>(
        new Set(),
    );

    const requests = loadedRequests.filter(
        request => !decidedEmailAddresses.has(request.emailAddress),
    );

    const [defaultSpaceId, setAddAccountsToSpaceId] = useState(configuration.defaultSpaceId ?? "");
    const [authenticatedHomeUrl, setAuthenticatedHomeUrl] = useState(
        configuration.authenticatedHomeUrl ?? "",
    );

    return (
        <Box display="flex" justifyContent="center" backgroundColor="grey-0" height="full">
            <main
                className={sprinkles({
                    width: "full",
                    maxWidth: "128",
                    paddingX: "4",
                    paddingY: "6",
                })}
            >
                <h1
                    className={sprinkles({
                        fontSize: "400",
                        fontStyle: "bold",
                    })}
                >
                    Alpha Control Panel
                </h1>
                <Box>
                    <Spacer space="3" />
                    <TextInput
                        label="Space ID to add new accounts to"
                        value={defaultSpaceId}
                        onChange={setAddAccountsToSpaceId}
                        fontStyle="code"
                    />
                    <Spacer space="3" />
                    <TextInput
                        label="URL to redirect accounts after signing in"
                        value={authenticatedHomeUrl}
                        onChange={setAuthenticatedHomeUrl}
                        fontStyle="code"
                    />
                    <Spacer space="3" />
                    <Box display="flex" justifyContent="flex-end">
                        <Button
                            variant="accent"
                            pressErrorTitle="Couldn’t save configuration"
                            onPress={async () => {
                                let validatedAddAccountsToSpaceId: SpaceId | undefined;
                                if (defaultSpaceId.length > 0) {
                                    validatedAddAccountsToSpaceId =
                                        Schema.id<SpaceId>().deserialize(defaultSpaceId);
                                }

                                await saveAlphaConfiguration(context, {
                                    configuration: {
                                        defaultSpaceId: validatedAddAccountsToSpaceId,
                                        authenticatedHomeUrl:
                                            authenticatedHomeUrl.length > 0
                                                ? authenticatedHomeUrl
                                                : undefined,
                                    },
                                });
                            }}
                        >
                            Save
                        </Button>
                    </Box>
                </Box>
                <Spacer space="12" />
                <Box borderTop="grey-10" />
                <Spacer space="12" />
                <Box>
                    <Box fontSize="300" fontStyle="bold">
                        Access Requests
                    </Box>
                    <Spacer space="3" />
                    {requests.length === 0 && <Box color="grey-80">No alpha access requests</Box>}
                    <Box display="flex" flexDirection="column" gap="3">
                        {requests.map(request => (
                            <AlphaAccessRequest
                                key={request.emailAddress}
                                request={request}
                                dateTimeFormatter={dateTimeFormatter}
                                onDecided={() =>
                                    setDecidedEmailAddresses(decidedEmailAddresses =>
                                        new Set(decidedEmailAddresses).add(request.emailAddress),
                                    )
                                }
                            />
                        ))}
                    </Box>
                </Box>
            </main>
        </Box>
    );
}

function AlphaAccessRequest({
    request,
    dateTimeFormatter,
    onDecided,
}: {
    request: AlphaAccessRequestModel;
    dateTimeFormatter: Intl.DateTimeFormat;
    onDecided: () => void;
}) {
    const context = useAppContext();

    return (
        <Box padding="3" borderRadius="1" border="grey-10">
            <Box marginBottom="3" paddingBottom="3" borderBottom="grey-10" display="flex" gap="2">
                <Box flexGrow="1" fontStyle="bold" fontSize="300" userSelect="text">
                    {request.emailAddress}
                </Box>
                <Button
                    variant="quiet"
                    pressErrorTitle="Couldn’t deny access request"
                    onPress={async () => {
                        await denyAlphaAccessRequest(context, {
                            emailAddress: request.emailAddress,
                        });
                        onDecided();
                    }}
                >
                    Deny
                </Button>
                <Button
                    variant="accent"
                    pressErrorTitle="Couldn’t approve access request"
                    onPress={async () => {
                        await approveAlphaAccessRequest(context, {
                            emailAddress: request.emailAddress,
                        });
                        onDecided();
                    }}
                >
                    Approve
                </Button>
            </Box>
            <Box display="flex" flexDirection="column" gap="2">
                <AlphaAccessRequestField
                    label="Requested"
                    value={dateTimeFormatter.format(request.createdTime)}
                />
                <AlphaAccessRequestField label="Name" value={request.name} />
                <AlphaAccessRequestField
                    label="Message"
                    value={
                        request.message.length !== 0
                            ? request.message
                                  .split("\n")
                                  .flatMap((message, i) =>
                                      i === 0 ? [message] : [<br key={i} />, message],
                                  )
                            : "\u2013"
                    }
                />
            </Box>
        </Box>
    );
}

function AlphaAccessRequestField({label, value}: {label: string; value: ReactNode}) {
    return (
        <Box display="flex" gap="2">
            <Box flexShrink="0" width="16" color="grey-60">
                {label}
            </Box>
            <Box flexGrow="1" userSelect="text">
                {value}
            </Box>
        </Box>
    );
}
