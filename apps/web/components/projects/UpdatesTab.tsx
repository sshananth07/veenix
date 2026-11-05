import { Bot, ClipboardList, Plus, Trash2 } from "lucide-react";
import { SITE_UPDATE_KINDS, type SiteUpdateDto, type TaskDto } from "@veenix/shared";
import { addSiteUpdate, deleteSiteUpdate } from "@/actions/tasks";
import { FormDialog } from "@/components/FormDialog";
import { TaskList } from "@/components/TaskList";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { formatDateTime } from "@/lib/utils";

const KIND_LABELS: Record<SiteUpdateDto["kind"], string> = { progress: "Progress", issue: "Issue", material_request: "Material request", delivery: "Delivery" };
const KIND_TONE: Record<SiteUpdateDto["kind"], "secondary" | "destructive" | "warning" | "success"> = { progress: "success", issue: "destructive", material_request: "warning", delivery: "secondary" };

/** What happened on site, and the project's tasks. Staff check and correct what the assistant recorded here. */
export function UpdatesTab({ projectId, updates, tasks, canWrite, canDeleteTasks }: { projectId: string; updates: SiteUpdateDto[]; tasks: TaskDto[]; canWrite: boolean; canDeleteTasks: boolean }) {
  return (
    <div className="grid gap-6 @5xl:grid-cols-[minmax(0,1fr)_380px]">
      <section className="space-y-4">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="text-lg font-semibold tracking-tight">Site updates</h2>
            <p className="text-sm text-muted-foreground">Progress, issues, material requests and deliveries.</p>
          </div>
          {canWrite && (
            <FormDialog
              title="Add a site update"
              submitLabel="Add update"
              action={addSiteUpdate.bind(null, projectId)}
              uploadPurpose="photos"
              trigger={
                <Button size="sm">
                  <Plus className="size-4" /> Add update
                </Button>
              }
            >
              <Field label="Kind" htmlFor="kind" required>
                <Select name="kind" defaultValue="progress">
                  <SelectTrigger id="kind">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {SITE_UPDATE_KINDS.map((k) => <SelectItem key={k} value={k}>{KIND_LABELS[k]}</SelectItem>)}
                  </SelectContent>
                </Select>
              </Field>
              <Field label="What happened" htmlFor="text" required>
                <Textarea id="text" name="text" required rows={4} maxLength={4000} placeholder="e.g. Tiling 60% done, plumber delayed till Thursday" />
              </Field>
              <Field label="Photos" htmlFor="photos" hint="Up to 10 PNG, JPG or WEBP images">
                <Input id="photos" name="photos" type="file" multiple accept="image/png,image/jpeg,image/webp" />
              </Field>
            </FormDialog>
          )}
        </div>
        {updates.length === 0 ? (
          <div className="rounded-xl border border-dashed bg-card px-6 py-12 text-center">
            <ClipboardList className="mx-auto size-8 text-muted-foreground" />
            <p className="mt-2 font-semibold">No updates yet</p>
            <p className="text-sm text-muted-foreground">Add one here, or tell the assistant what happened on site.</p>
          </div>
        ) : (
          <ul className="space-y-3">
            {updates.map((u) => (
              <li key={u.id} className="rounded-xl border bg-card p-4 shadow-xs">
                <div className="flex items-start gap-2">
                  <Badge variant={KIND_TONE[u.kind]}>{KIND_LABELS[u.kind]}</Badge>
                  <p className="flex flex-1 flex-wrap items-center gap-x-2 text-xs text-muted-foreground">
                    <span>{u.authorName || "Someone"}</span>
                    <span>{formatDateTime(u.createdAt)}</span>
                    {u.fromAssistant && (
                      <span className="flex items-center gap-1">
                        <Bot className="size-3" aria-hidden /> Through the assistant
                      </span>
                    )}
                  </p>
                  {canWrite && (
                    <FormDialog
                      destructive
                      title="Delete this update?"
                      description="Its photos are deleted too. This cannot be undone."
                      submitLabel="Delete update"
                      action={deleteSiteUpdate.bind(null, u.id)}
                      trigger={
                        <button className="flex size-7 items-center justify-center rounded-md text-muted-foreground hover:bg-red-50 hover:text-red-600" aria-label="Delete update">
                          <Trash2 className="size-4" />
                        </button>
                      }
                    />
                  )}
                </div>
                <p className="mt-2 whitespace-pre-wrap text-sm">{u.text}</p>
                {u.photos.length > 0 && (
                  <div className="mt-3 flex flex-wrap gap-2">
                    {u.photos.map((p) => (
                      <a key={p.url} href={p.url} target="_blank" rel="noreferrer">
                        {/* eslint-disable-next-line @next/next/no-img-element -- short-lived storage URLs */}
                        <img src={p.url} alt={p.name} className="size-24 rounded-lg border object-cover" />
                      </a>
                    ))}
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>
      <section className="space-y-4">
        <div>
          <h2 className="text-lg font-semibold tracking-tight">Tasks</h2>
          <p className="text-sm text-muted-foreground">Follow-ups on this project.</p>
        </div>
        <TaskList tasks={tasks} canDelete={canDeleteTasks} showProject={false} />
      </section>
    </div>
  );
}
