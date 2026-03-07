import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

export const DEFAULT_LEARNINGS_TEMPLATE = `# Learnings

Append structured entries:
- LRN-YYYYMMDD-XXX for corrections / best practices / knowledge gaps
- Include summary, details, suggested action, metadata, and status`;

export const DEFAULT_ERRORS_TEMPLATE = `# Errors

Append structured entries:
- ERR-YYYYMMDD-XXX for command/tool/integration failures
- Include symptom, context, probable cause, and prevention`;

export const DEFAULT_FEATURE_REQUESTS_TEMPLATE = `# Feature Requests

Append structured entries:
- FEAT-YYYYMMDD-XXX for missing capabilities
- Include requested behavior, user context, and suggested implementation`;

export async function ensureSelfImprovementLearningFiles(baseDir: string): Promise<void> {
  const learningsDir = join(baseDir, ".learnings");
  await mkdir(learningsDir, { recursive: true });

  const ensureFile = async (filePath: string, content: string) => {
    try {
      const existing = await readFile(filePath, "utf-8");
      if (existing.trim().length > 0) return;
    } catch {
      // write default below
    }
    await writeFile(filePath, `${content.trim()}\n`, "utf-8");
  };

  await ensureFile(join(learningsDir, "LEARNINGS.md"), DEFAULT_LEARNINGS_TEMPLATE);
  await ensureFile(join(learningsDir, "ERRORS.md"), DEFAULT_ERRORS_TEMPLATE);
  await ensureFile(join(learningsDir, "FEATURE_REQUESTS.md"), DEFAULT_FEATURE_REQUESTS_TEMPLATE);
}
