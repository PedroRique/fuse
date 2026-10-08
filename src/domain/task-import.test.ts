import { describe, expect, it } from "vitest";
import { extractionSchema, importTasksSchema, markDuplicateTitles } from "./task-import";

describe("task import review",()=>{
  it("keeps absent dates and priorities unresolved instead of inventing them",()=>{
    const result=extractionSchema.parse({tasks:[{title:"Send proposal",notes:"",impact:null,deadlineAt:null,source:"Send proposal"}]});
    expect(result.tasks[0].deadlineAt).toBeNull();
    expect(result.tasks[0].impact).toBeNull();
  });
  it("flags existing titles and duplicates within the batch despite case/spacing",()=>{
    expect(markDuplicateTitles([{title:" send  PROPOSAL "},{title:"New task"},{title:"NEW TASK"}],[{title:"Send proposal"}])).toEqual([true,false,true]);
  });
  it("requires explicit deadlines and priorities before committing",()=>{
    expect(importTasksSchema.safeParse({requestId:"00000000-0000-4000-8000-000000000000",tasks:[{title:"Task",notes:"",impact:null,deadlineAt:null}]}).success).toBe(false);
  });
  it("rejects overlong and excessive model output",()=>{
    const task={title:"Task",notes:"",impact:null,deadlineAt:null,source:""};
    expect(extractionSchema.safeParse({tasks:Array.from({length:31},()=>task)}).success).toBe(false);
    expect(extractionSchema.safeParse({tasks:[{...task,title:"x".repeat(201)}]}).success).toBe(false);
  });
});
