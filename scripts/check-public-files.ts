import { execFileSync } from "node:child_process";
import { lstatSync, readFileSync } from "node:fs";

// Scan tracked files, never the private runtime directory or generated credentials.
const files = execFileSync("git", ["ls-files", "-z"], { encoding: "utf8" })
  .split("\0")
  .filter(Boolean);
const failures: string[] = [];
const privatePath =
  /(^|\/)(\.local|\.next|\.vercel|node_modules|test-results|backups|exports|output|\.idea|\.vscode)(\/|$)|\.(?:sqlite(?:[\w.-]*)?|db(?:-\w+)?|log|pem|key|p12|pfx|dump|bak)$/i;
const personalPath = /(?:\/Users\/|\/home\/)[\w.-]+\//;
const email = /[A-Z0-9.!#$%&*+/=?^_`{|}~-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
const exampleEmail =
  /@(?:[\w.-]+\.)?(?:example\.(?:com|net|org|test)|autoraum\.local|users\.noreply\.github\.com)$/i;
for (const file of files) {
  if (
    privatePath.test(file) ||
    (/(^|\/)\.env(?:\.|$)/.test(file) && file !== ".env.example") ||
    /(^|\/)(?:\.npmrc|\.netrc|access[^/]*\.txt)$/.test(file)
  )
    failures.push(`${file}: private file must not be tracked`);
  if (lstatSync(file).isSymbolicLink()) {
    failures.push(`${file}: review symlinks before publication`);
    continue;
  }
  const content = readFileSync(file, "utf8");
  if (personalPath.test(content))
    failures.push(`${file}: machine-specific home path`);
  if ((content.match(email) || []).some((value) => !exampleEmail.test(value)))
    failures.push(
      `${file}: replace personal/contact emails with example addresses`,
    );
}
if (failures.length) {
  console.error(failures.join("\n"));
  process.exitCode = 1;
} else
  console.log(
    `Publication hygiene passed for ${files.length} tracked files. Run Gitleaks separately for secrets.`,
  );
