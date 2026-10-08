"use client";

import { useRef, useState } from "react";
import { toast } from "sonner";
import { LoaderCircle, Sparkles } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { toLocalInput } from "@/components/choice-group";
import { IMPACTS, type Impact } from "@/domain/types";
import { extractionSchema, MAX_IMPORT_TEXT, markDuplicateTitles } from "@/domain/task-import";
import { importTasks } from "@/server/import-actions";

type Row = { id: string; title: string; notes: string; impact: Impact; missingImpact: boolean; deadline: string; source: string; selected: boolean };
export function ImportTasksDialog({open,onOpenChange,existing,onCreated,disabled}:{
  open:boolean; onOpenChange:(open:boolean)=>void; existing:{title:string}[]; onCreated:()=>void; disabled?:boolean;
}) {
  const [text,setText] = useState("");
  const [rows,setRows] = useState<Row[]>([]);
  const [step,setStep] = useState<"source"|"review">("source");
  const [busy,setBusy] = useState(false);
  const busyRef = useRef(false);
  const [error,setError] = useState<string|null>(null);
  const [bulkImpact,setBulkImpact] = useState<Impact>("normal");
  const [bulkDeadline,setBulkDeadline] = useState("");
  const [overwrite,setOverwrite] = useState(false);
  const [submission,setSubmission] = useState<{requestId:string; tasks:{title:string;notes:string;impact:Impact;deadlineAt:string}[]}|null>(null);
  const duplicates = markDuplicateTitles(rows,existing);
  const selected = rows.filter(row=>row.selected);
  const update = (id:string,patch:Partial<Row>) => {
    setRows(current=>current.map(row=>row.id===id?{...row,...patch}:row));
    setError(null);
  };
  const reset = () => {setText("");setRows([]);setStep("source");setError(null);setSubmission(null);setBulkDeadline("");setBulkImpact("normal");setOverwrite(false);};
  async function analyze() {
    if (busyRef.current || disabled) return;
    busyRef.current=true;setBusy(true);setError(null);
    try {
      const response = await fetch("/api/import/extract",{method:"POST",headers:{"Content-Type":"application/json"},
        body:JSON.stringify({text,timeZone:Intl.DateTimeFormat().resolvedOptions().timeZone}),signal:AbortSignal.timeout(55000)});
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? "Couldn't analyze this text.");
      const parsed = extractionSchema.safeParse(result);
      if (!parsed.success) throw new Error("Couldn't interpret the suggested tasks.");
      if (!parsed.data.tasks.length) {setError("No actionable tasks found. Add more details and try again.");return;}
      const duplicate = markDuplicateTitles(parsed.data.tasks,existing);
      setRows(parsed.data.tasks.map((task,index)=>({id:crypto.randomUUID(),title:task.title,notes:task.notes,
        impact:task.impact??"normal",missingImpact:task.impact===null,
        deadline:task.deadlineAt?toLocalInput(new Date(task.deadlineAt)):"",source:task.source,selected:!duplicate[index]})));
      setSubmission(null);setStep("review");
    } catch (e) {setError(e instanceof Error?e.message:"Couldn't analyze this text.");}
    finally {busyRef.current=false;setBusy(false);}
  }
  async function create() {
    if (busyRef.current || disabled) return;
    const tasks = selected.map(row=>({title:row.title.trim(),notes:row.notes,impact:row.impact,deadlineAt:row.deadline}));
    if (!submission && (!tasks.length || tasks.some(task=>!task.title || !task.deadlineAt || !Number.isFinite(new Date(task.deadlineAt).getTime()) || new Date(task.deadlineAt).getTime()<=Date.now()+60000))) {
      setError("Select tasks and give each one a title and a future deadline.");return;
    }
    const payload = submission??{requestId:crypto.randomUUID(),tasks:tasks.map(task=>({...task,deadlineAt:new Date(task.deadlineAt).toISOString()}))};
    setSubmission(payload);busyRef.current=true;setBusy(true);setError(null);
    try {
      const result = await importTasks(payload);
      if (result.error) {setError(result.error);if(result.safeToEdit) setSubmission(null);return;}
      toast.success(`${result.taskIds?.length??0} tasks imported.`);
      onCreated();reset();onOpenChange(false);
    } catch {setError("Couldn't confirm the import. Retry this same batch to avoid duplicates.");}
    finally {busyRef.current=false;setBusy(false);}
  }
  return <Dialog open={open} onOpenChange={value=>{if(!busyRef.current) onOpenChange(value);}}>
    <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-3xl" showCloseButton={!busy}>
      <DialogHeader>
        <DialogTitle>Import tasks with AI</DialogTitle>
        <DialogDescription>{step==="source"?"1 · Add text. Then review every task before creating it.":"2 · Review tasks. Uncheck anything you don't want to import."}</DialogDescription>
      </DialogHeader>
      {step==="source"?<>
        <Label htmlFor="import-source">Your tasks, notes or meeting summary</Label>
        <Textarea id="import-source" value={text} onChange={event=>{setText(event.target.value);setError(null);}} maxLength={MAX_IMPORT_TEXT} rows={9} autoFocus disabled={busy||disabled} className="text-base"
          placeholder="Send the proposal to Ana tomorrow. Update the landing page by Friday — high priority. Schedule a meeting with the team." />
        <p className="text-xs text-muted-foreground">{text.length.toLocaleString()} / {MAX_IMPORT_TEXT.toLocaleString()} characters · Up to 30 tasks per import</p>
        <p className="text-xs text-muted-foreground">When you analyze, this text is sent to our AI provider to suggest tasks. Nothing is added to your board until you confirm.</p>
      </>:<>
        <div className="space-y-3 rounded-lg border bg-muted/30 p-3">
          <p className="font-medium">Apply to selected tasks</p>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="space-y-1 text-sm">Priority
              <select value={bulkImpact} onChange={event=>setBulkImpact(event.target.value as Impact)} disabled={busy||!!submission} className="block h-10 w-full rounded-md border bg-background px-2">
                {IMPACTS.map(impact=><option key={impact} value={impact}>{impact[0].toUpperCase()+impact.slice(1)}</option>)}
              </select>
            </label>
            <label className="space-y-1 text-sm">Deadline
              <Input type="datetime-local" value={bulkDeadline} onChange={event=>setBulkDeadline(event.target.value)} disabled={busy||!!submission} className="text-base" />
            </label>
          </div>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={overwrite} onChange={event=>setOverwrite(event.target.checked)} disabled={busy||!!submission} />Replace existing priorities and deadlines</label>
          <Button size="sm" variant="outline" disabled={busy||!!submission||disabled} onClick={()=>setRows(current=>current.map(row=>!row.selected?row:{...row,
            impact:overwrite||row.missingImpact?bulkImpact:row.impact,missingImpact:false,
            deadline:bulkDeadline&&(overwrite||!row.deadline)?bulkDeadline:row.deadline}))}>Apply to selected</Button>
          <p className="text-xs text-muted-foreground">Without replacement, only missing values are filled. All times use your device&apos;s time zone.</p>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="text-sm">{selected.length} of {rows.length} selected</span>
          <Button size="sm" variant="ghost" disabled={busy||!!submission||disabled} onClick={()=>setRows(current=>current.map(row=>({...row,selected:selected.length!==rows.length})))}>{selected.length===rows.length?"Unselect all":"Select all"}</Button>
        </div>
        <div className="space-y-3">
          {rows.map((row,index)=><section key={row.id} className="space-y-3 rounded-lg border p-3" aria-label={`Task ${index+1}`}>
            <label className="flex items-center gap-2 font-medium"><input type="checkbox" checked={row.selected} disabled={busy||!!submission||disabled} onChange={event=>update(row.id,{selected:event.target.checked})} />Task {index+1}{duplicates[index]&&<span className="text-xs text-amber-700">Possible duplicate</span>}</label>
            <label className="block space-y-1">Title<Input aria-label={`Task ${index+1} title`} value={row.title} maxLength={200} onChange={event=>update(row.id,{title:event.target.value})} disabled={busy||!!submission||disabled} className="text-base" /></label>
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="space-y-1">Priority<select aria-label={`Task ${index+1} priority`} value={row.impact} onChange={event=>update(row.id,{impact:event.target.value as Impact,missingImpact:false})} disabled={busy||!!submission||disabled} className="block h-10 w-full rounded-md border bg-background px-2">
                {IMPACTS.map(impact=><option value={impact} key={impact}>{impact[0].toUpperCase()+impact.slice(1)}</option>)}
              </select><span className="text-xs text-muted-foreground">{row.missingImpact?"Default priority · not specified in source":"Review suggested priority"}</span></label>
              <label className="space-y-1">Deadline<Input aria-label={`Task ${index+1} deadline`} type="datetime-local" value={row.deadline} onChange={event=>update(row.id,{deadline:event.target.value})} disabled={busy||!!submission||disabled} className="text-base" /><span className="text-xs text-muted-foreground">{!row.deadline?"Required · no clear deadline in source":"Review suggested deadline"}</span></label>
            </div>
            <details><summary className="cursor-pointer text-sm text-muted-foreground">Notes and source</summary>
              <label className="mt-2 block space-y-1">Notes<Textarea aria-label={`Task ${index+1} notes`} value={row.notes} maxLength={5000} onChange={event=>update(row.id,{notes:event.target.value})} disabled={busy||!!submission||disabled} /></label>
              {row.source&&<blockquote className="mt-2 border-l-2 pl-3 text-xs text-muted-foreground">{row.source}</blockquote>}
            </details>
          </section>)}
        </div>
        {submission&&<p className="text-xs text-muted-foreground">This batch is locked for safe retry. A retry cannot create the same tasks twice.</p>}
      </>}
      {error&&<p role="alert" className="text-sm text-destructive">{error}</p>}
      <div className="flex flex-wrap justify-between gap-2 border-t pt-3">
        <Button variant="ghost" disabled={busy} onClick={()=>{if(step==="review"&&!submission){setStep("source");setError(null);}else{reset();onOpenChange(false);}}}>{step==="review"&&!submission?"Back to text":"Cancel"}</Button>
        {step==="source"?<Button disabled={busy||disabled||text.trim().length<3} onClick={analyze}>{busy?<LoaderCircle className="animate-spin" aria-hidden/>:<Sparkles aria-hidden/>}{busy?"Analyzing…":"Find tasks"}</Button>
          :<Button disabled={busy||disabled||!selected.length} onClick={create}>{busy&&<LoaderCircle className="animate-spin" aria-hidden/>}{busy?"Creating…":submission?"Retry this batch":`Create ${selected.length} tasks`}</Button>}
      </div>
    </DialogContent>
  </Dialog>;
}
