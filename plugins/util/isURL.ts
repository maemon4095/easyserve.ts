const urlPattern = /^((http|https):\/\/|data:).*$/;
export function isURL(str: string) {
    return urlPattern.test(str);
}