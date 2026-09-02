// Loads the real-sample .txt files under docs/spike-01-samples/ into an
// InboundEmail the parsers can consume. Each file's shape is:
//
//   From: <sender>
//   Subject: ...
//   ...other header lines...
//
//   ---
//
//   <raw email body — the part a real parser actually sees>
//
//   ---
//
//   Extracted:
//     <hand-annotated ground truth, informational only, not machine-read>
//
// Fixtures are read once per file, not per test, so a bad path fails
// fast rather than inside an assertion.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import type { InboundEmail } from "../lib/parsers/types.ts";

const here = path.dirname(fileURLToPath(import.meta.url));
const samplesDir = path.join(here, "..", "docs", "spike-01-samples");

export function loadSample(filename: string, receivedAt: Date): InboundEmail {
  const raw = readFileSync(path.join(samplesDir, filename), "utf-8");
  const sections = raw.split(/\n---\n/);
  if (sections.length < 2) {
    throw new Error(`Fixture ${filename} is missing its "---" body delimiter`);
  }
  const header = sections[0];
  const body = sections[1].trim();

  // Some fixtures annotate the sender with a human-readable aside (e.g.
  // "ibanking.alert@dbs.com (via Amazon SES on behalf of dbs.com)") that
  // is documentation, not part of the real From header address a parser
  // would see — extract just the address.
  const fromLine = header.match(/^From:\s*(.+)$/m);
  if (!fromLine) throw new Error(`Fixture ${filename} has no From: header`);
  const fromAddress = fromLine[1].match(/[\w.+-]+@[\w.-]+/)?.[0];
  if (!fromAddress) throw new Error(`Fixture ${filename}'s From: header has no email address`);

  return {
    from: fromAddress,
    subject: header.match(/^Subject:\s*(.+)$/m)?.[1]?.trim() ?? "",
    textBody: body,
    htmlBody: "",
    receivedAt,
  };
}
