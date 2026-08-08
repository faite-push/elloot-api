import sanitizeHtml from "sanitize-html";

const plainTextOptions: sanitizeHtml.IOptions = {
  allowedTags: [],
  allowedAttributes: {},
  disallowedTagsMode: "discard",
};

/** Strip all HTML — use for titles, names, messages, descriptions. */
export function sanitizePlainText(input: string): string {
  return sanitizeHtml(input, plainTextOptions).trim();
}

/** Bound + sanitize user text fields. */
export function sanitizeUserText(input: string, maxLen: number): string {
  const cleaned = sanitizePlainText(input);
  return cleaned.slice(0, maxLen);
}
