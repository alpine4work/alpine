import {useId, useState} from "react";
import {Box} from "~/client/design/box";
import {FocusRing} from "~/client/design/focus_ring";
import {sprinkles} from "~/shared/styles/styles";

export type MultilineTextInputProps = {
    label: string;
    value: string;
    onChange: (value: string) => void;
    placeholder?: string;
};

export function MultilineTextInput({label, placeholder, value, onChange}: MultilineTextInputProps) {
    const id = useId();

    return (
        <Box typographySize="small">
            <label
                className={sprinkles({
                    display: "inline-block",
                    typographyStyle: "primaryMedium",
                    paddingBottom: "0.5",
                })}
                htmlFor={id}
            >
                {label}
            </label>
            <FocusRing offset="border">
                <textarea
                    className={sprinkles({
                        display: "block",
                        width: "full",
                        paddingX: "2",
                        paddingY: "1.5",
                        minHeight: "16",
                        border: "grey-10",
                        backgroundColor: "grey-0",
                        borderRadius: "base",
                    })}
                    style={{resize: "none"}}
                    id={id}
                    value={value}
                    onChange={event => onChange(event.currentTarget.value)}
                    placeholder={placeholder}
                />
            </FocusRing>
        </Box>
    );
}

export function ControlledMultilineTextInput(
    props: Omit<MultilineTextInputProps, "value" | "onChange"> & {
        initialValue?: string;
    },
) {
    const [value, setValue] = useState(props.initialValue ?? "");

    return <MultilineTextInput {...props} value={value} onChange={setValue} />;
}
