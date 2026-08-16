import { convert } from "html-to-text";

/** Two of the nine real samples in spike-01-samples/ had no plain-text
 * MIME part at all — HTML-only is the norm for some DBS notification
 * types, not the exception. See SPIKE-01-RESULTS.md. */
export function stripHtml(html: string): string {
  return convert(html, {
    wordwrap: false,
    selectors: [
      { selector: "img", format: "skip" },
      { selector: "a", options: { ignoreHref: true } },
    ],
  });
}
