import {TokenAgent} from "~/server/tokens/token_agent.js";
import {ContextModuleBase} from "~/shared/context/context_module_base.js";
import {ForkableContextModuleBase} from "~/shared/context/fork_action_context_module.js";
import {FileHasPreview} from "~/shared/files/file_preview.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {FileId, SpaceId} from "~/shared/id/types/id_types.js";

/**
 * Manages the URLs we need to load file content from Cloudflare R2.
 *
 * File content is returned from the `EdgeService` route
 * `/files/:spaceId/:fileId`. We use signed URLs to authorize access to this
 * route. So `AppService` signs a URL in advance, sends it to the client, then
 * the client uses the URL to load the file from `EdgeService`. This is good
 * for performance since `EdgeService` doesn't need to make a round trip to
 * `AppService` whenever a file is requested and it prevents Alpine's use as a
 * CDN. Since it depends on client support for requesting a new signed URL to
 * view a file.
 */
export abstract class FilesContextModuleBase
    extends ContextModuleBase
    implements ForkableContextModuleBase
{
    /**
     * Create a signed URL for a file's preview. The signed URL expires after
     * 10 minutes.
     *
     * If the file doesn't have preview content then this function returns null.
     * Files with an image preview will either load the file's image preview
     * content or the file itself if the file is a web safe image.
     */
    public abstract dangerouslySignFilePreviewUrlWithoutAuthorization(
        spaceId: SpaceId,
        fileId: FileId,
        file: {hasPreview: FileHasPreview | null},
    ): Promise<URL | null>;

    public abstract fork(): FilesContextModuleBase;
}

export class FilesContextModule extends FilesContextModuleBase {
    private readonly _tokenAgent: TokenAgent;

    constructor(tokenAgent: TokenAgent) {
        super();
        this._tokenAgent = tokenAgent;
    }

    public override async dangerouslySignFilePreviewUrlWithoutAuthorization(
        spaceId: SpaceId,
        fileId: FileId,
        file: {hasPreview: FileHasPreview | null},
    ): Promise<URL | null> {
        if (file.hasPreview?.type !== "Image") return null;

        return this._tokenAgent.privateSide.dangerouslySignShortLivedUrl(
            "EdgeService",
            new URL(
                `https://cyberworlds.dev/files/${spaceId}/${fileId}${
                    file.hasPreview.hasContent ? "-preview" : ""
                }`,
            ),
            // Expire the signed URL in 10 minutes instead of the default, 2.
            {expirationMinutes: 10},
        );
    }

    public fork() {
        return new FilesContextModule(this._tokenAgent);
    }
}

// We don't actually sign URLs in the test context module since we don't have a
// `TokenAgent`. Construct a `FilesContextModule` with a proper `TokenAgent` if
// you want signing in tests.
export class TestFilesContextModule extends FilesContextModuleBase {
    constructor() {
        super();
        assert(process.env.NODE_ENV === "test");
    }

    public override async dangerouslySignFilePreviewUrlWithoutAuthorization(
        spaceId: SpaceId,
        fileId: FileId,
        file: {hasPreview: FileHasPreview | null},
    ): Promise<URL | null> {
        if (file.hasPreview?.type !== "Image") return null;

        return new URL(
            `https://cyberworlds.dev/files/${spaceId}/${fileId}${
                file.hasPreview.hasContent ? "-preview" : ""
            }`,
        );
    }

    public fork() {
        return new TestFilesContextModule();
    }
}
