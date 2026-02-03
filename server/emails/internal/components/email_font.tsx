/* eslint-disable cyberworlds/string-quotes */
export function EmailFont() {
    return (
        <style
            dangerouslySetInnerHTML={{
                __html: `
            @import url('https://fonts.googleapis.com/css2?family=Inter:ital,wght@0,200..900;1,700&display=swap');
            *{
                font-family:'Inter', sans-serif;
            }
        `,
            }}
        />
    );
}
