import {useCallback, useMemo} from "react";
import {ContentFilePreview} from "~/client/web/content/content_file_preview_component.js";
import {useNavigate} from "~/client/web/remix/use_navigate.js";
import {FileModel} from "~/shared/files/file_model.js";
import {PostId} from "~/shared/id/types/id_types.js";

export function ChannelViewContentFilePreview({
    postId,
    size,
    signedUrlSearch,
    file,
}: {
    postId: PostId;
    size: number;
    signedUrlSearch: string;
    file: FileModel;
}) {
    const navigate = useNavigate();

    return (
        <ContentFilePreview
            size={size}
            signedUrlSearch={signedUrlSearch}
            file={file}
            attachmentTarget={useMemo(() => ({type: "Post", postId}), [postId])}
            onOpenViewer={useCallback(() => {
                navigate(`/post/${postId}?scroll=file-${file.id}`);

                return {preventDefault: true};
            }, [file.id, navigate, postId])}
        />
    );
}
