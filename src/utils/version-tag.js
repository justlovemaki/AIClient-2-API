const VERSION_TAG_REGEX = /^v?\d+(?:\.\d+){1,3}(?:[-+][0-9A-Za-z.-]+)?$/;

export function isValidVersionTag(tag) {
    return typeof tag === 'string' && VERSION_TAG_REGEX.test(tag);
}
