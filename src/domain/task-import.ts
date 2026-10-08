import { z } from "zod";
import { IMPACTS } from "./types";

export const MAX_IMPORT_TASKS = 30;
export const MAX_IMPORT_TEXT = 16000;
export const importDraftSchema = z.object({
  title: z.string().trim().min(1).max(200),
  notes: z.string().max(5000),
  impact: z.enum(IMPACTS).nullable(),
  deadlineAt: z.iso.datetime({ offset: true }).nullable(),
  source: z.string().max(600),
});
export const extractionSchema = z.object({ tasks: z.array(importDraftSchema).max(MAX_IMPORT_TASKS) });
export type ImportDraft = z.infer<typeof importDraftSchema>;
export const importTasksSchema = z.object({
  requestId: z.uuid(),
  tasks: z.array(z.object({
    title: z.string().trim().min(1).max(200),
    notes: z.string().max(5000),
    impact: z.enum(IMPACTS),
    deadlineAt: z.iso.datetime({ offset: true }),
  })).min(1).max(MAX_IMPORT_TASKS),
});
export function normalizedTitle(title: string) {
  return title.normalize("NFKC").trim().replace(/\s+/g, " ").toLocaleLowerCase();
}
export function markDuplicateTitles(drafts: Pick<ImportDraft, "title">[], existing: { title: string }[]) {
  const seen = new Set(existing.map((task) => normalizedTitle(task.title)));
  return drafts.map((draft) => {
    const title = normalizedTitle(draft.title);
    const duplicate = seen.has(title);
    seen.add(title);
    return duplicate;
  });
}
