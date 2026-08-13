import { useState } from 'react';
import { useRoute, Link } from 'wouter';
import { 
  useGetCase, 
  useGetCaseTimeline,
  useListCaseDocuments,
  useListTasks,
  useListTimeEntries,
  getGetCaseQueryKey,
  getGetCaseTimelineQueryKey,
  getListCaseDocumentsQueryKey,
  getListTasksQueryKey,
  getListTimeEntriesQueryKey
} from '@workspace/api-client-react';
import { PageHeader } from '@/components/layout/Shell';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { StatusBadge, AmountFormatter } from '@/components/ui/status-badge';
import { format } from 'date-fns';
import { 
  Briefcase, User, MapPin, Building2, Calendar, Scale, 
  FileText, CheckSquare, Clock, ArrowLeft, MoreVertical, 
  Activity, Download
} from 'lucide-react';

export default function CaseDetail() {
  const [, params] = useRoute('/cases/:id');
  const id = Number(params?.id);
  const [activeTab, setActiveTab] = useState<'overview' | 'documents' | 'tasks' | 'time'>('overview');

  const { data: caseData, isLoading } = useGetCase(id, { query: { enabled: !!id, queryKey: getGetCaseQueryKey(id) } });
  const { data: timeline } = useGetCaseTimeline(id, { query: { enabled: !!id && activeTab === 'overview', queryKey: getGetCaseTimelineQueryKey(id) } });
  const { data: documents } = useListCaseDocuments(id, { query: { enabled: !!id && activeTab === 'documents', queryKey: getListCaseDocumentsQueryKey(id) } });
  const { data: tasks } = useListTasks({ caseId: id }, { query: { enabled: !!id && activeTab === 'tasks', queryKey: getListTasksQueryKey({ caseId: id }) } });
  const { data: timeEntries } = useListTimeEntries({ caseId: id }, { query: { enabled: !!id && activeTab === 'time', queryKey: getListTimeEntriesQueryKey({ caseId: id }) } });

  if (isLoading) {
    return <div className="p-8 flex justify-center"><div className="h-8 w-8 rounded-full border-4 border-primary border-t-transparent animate-spin"></div></div>;
  }

  if (!caseData) return <div className="p-8 text-center">Case not found.</div>;

  return (
    <div className="flex-1 flex flex-col bg-slate-50/30 dark:bg-transparent">
      <div className="px-8 py-4 border-b border-border/40 bg-card flex items-center justify-between">
        <div className="flex items-center gap-4">
          <Button variant="ghost" size="icon" asChild className="h-8 w-8 mr-2">
            <Link href="/cases"><ArrowLeft className="h-4 w-4" /></Link>
          </Button>
          <div>
            <div className="text-xs font-mono text-muted-foreground mb-1">{caseData.caseNumber}</div>
            <h1 className="text-2xl font-serif font-bold text-foreground leading-none">{caseData.title}</h1>
          </div>
          <StatusBadge status={caseData.status} className="ml-4" />
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm">Edit Matter</Button>
          <Button size="icon" variant="ghost" className="h-8 w-8"><MoreVertical className="h-4 w-4" /></Button>
        </div>
      </div>

      {/* Tabs */}
      <div className="px-8 border-b border-border/40 bg-card">
        <div className="flex gap-6">
          {(['overview', 'documents', 'tasks', 'time'] as const).map(tab => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={`py-4 text-sm font-medium border-b-2 transition-colors capitalize ${
                activeTab === tab 
                  ? 'border-primary text-primary' 
                  : 'border-transparent text-muted-foreground hover:text-foreground hover:border-border'
              }`}
            >
              {tab}
            </button>
          ))}
        </div>
      </div>

      <div className="p-8 max-w-7xl mx-auto w-full">
        {activeTab === 'overview' && (
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
            <div className="lg:col-span-2 space-y-6">
              <Card className="border-border/40 shadow-sm">
                <CardHeader className="bg-muted/20 border-b border-border/40 pb-4">
                  <CardTitle className="text-lg font-serif">Matter Description</CardTitle>
                </CardHeader>
                <CardContent className="p-6">
                  <p className="text-sm leading-relaxed whitespace-pre-wrap">{caseData.description || 'No description provided.'}</p>
                </CardContent>
              </Card>

              <Card className="border-border/40 shadow-sm">
                <CardHeader className="bg-muted/20 border-b border-border/40 pb-4">
                  <CardTitle className="text-lg font-serif flex items-center gap-2">
                    <Activity className="h-5 w-5 text-primary" />
                    Timeline & Activity
                  </CardTitle>
                </CardHeader>
                <CardContent className="p-6">
                  <div className="space-y-6 relative before:absolute before:inset-0 before:ml-5 before:-translate-x-px before:h-full before:w-0.5 before:bg-border/50">
                    {timeline?.map((act) => (
                      <div key={act.id} className="relative flex items-start gap-4">
                        <div className="flex items-center justify-center w-10 h-10 rounded-full border border-card bg-muted text-muted-foreground z-10 shrink-0">
                          <Activity className="h-4 w-4" />
                        </div>
                        <div className="flex-1 pt-2">
                          <div className="flex items-center justify-between mb-1">
                            <span className="font-semibold text-sm capitalize">{act.activityType.replace('_', ' ')}</span>
                            <time className="text-xs text-muted-foreground font-mono">{format(new Date(act.createdAt), 'MMM dd, yyyy')}</time>
                          </div>
                          <p className="text-sm text-foreground/80">{act.description}</p>
                          <div className="mt-2 text-xs text-muted-foreground">
                            by <span className="font-medium text-foreground">{act.performedBy}</span>
                          </div>
                        </div>
                      </div>
                    ))}
                    {!timeline?.length && <div className="text-center text-muted-foreground py-8">No activity recorded yet.</div>}
                  </div>
                </CardContent>
              </Card>
            </div>

            <div className="space-y-6">
              <Card className="border-border/40 shadow-sm">
                <CardHeader className="bg-muted/20 border-b border-border/40 pb-4">
                  <CardTitle className="text-sm font-bold uppercase tracking-wider text-muted-foreground">Details</CardTitle>
                </CardHeader>
                <CardContent className="p-0 divide-y divide-border/40">
                  <div className="p-4 flex gap-3 items-start">
                    <User className="h-4 w-4 text-muted-foreground mt-0.5 shrink-0" />
                    <div>
                      <div className="text-xs text-muted-foreground">Client</div>
                      <div className="font-medium text-sm">{caseData.clientName}</div>
                      {caseData.clientEmail && <div className="text-xs text-primary">{caseData.clientEmail}</div>}
                    </div>
                  </div>
                  {caseData.opposingParty && (
                    <div className="p-4 flex gap-3 items-start bg-destructive/5">
                      <Scale className="h-4 w-4 text-destructive mt-0.5 shrink-0" />
                      <div>
                        <div className="text-xs text-destructive font-medium uppercase">Opposing Party</div>
                        <div className="font-medium text-sm text-destructive">{caseData.opposingParty}</div>
                        {caseData.opposingCounsel && <div className="text-xs opacity-80 text-destructive mt-0.5">Counsel: {caseData.opposingCounsel}</div>}
                      </div>
                    </div>
                  )}
                  <div className="p-4 flex gap-3 items-start">
                    <Briefcase className="h-4 w-4 text-muted-foreground mt-0.5 shrink-0" />
                    <div>
                      <div className="text-xs text-muted-foreground">Practice Area</div>
                      <div className="font-medium text-sm capitalize">{caseData.caseType.replace('_', ' ')}</div>
                    </div>
                  </div>
                  <div className="p-4 flex gap-3 items-start">
                    <MapPin className="h-4 w-4 text-muted-foreground mt-0.5 shrink-0" />
                    <div>
                      <div className="text-xs text-muted-foreground">Jurisdiction</div>
                      <div className="font-medium text-sm">{caseData.jurisdiction}</div>
                      {caseData.court && <div className="text-xs text-muted-foreground mt-0.5">Court: {caseData.court}</div>}
                    </div>
                  </div>
                  <div className="p-4 flex gap-3 items-start">
                    <Building2 className="h-4 w-4 text-muted-foreground mt-0.5 shrink-0" />
                    <div>
                      <div className="text-xs text-muted-foreground">Assigned To</div>
                      <div className="font-medium text-sm">{caseData.assignedLawyerName || 'Unassigned'}</div>
                    </div>
                  </div>
                </CardContent>
              </Card>
              
              <Card className="border-border/40 shadow-sm">
                <CardHeader className="bg-muted/20 border-b border-border/40 pb-4">
                  <CardTitle className="text-sm font-bold uppercase tracking-wider text-muted-foreground">Financials</CardTitle>
                </CardHeader>
                <CardContent className="p-4">
                  <div className="space-y-4">
                    <div>
                      <div className="text-xs text-muted-foreground mb-1">Retainer Amount</div>
                      <div className="text-lg font-mono font-bold text-foreground">
                        <AmountFormatter amount={caseData.retainerAmount} />
                      </div>
                    </div>
                  </div>
                </CardContent>
              </Card>
            </div>
          </div>
        )}

        {activeTab === 'documents' && (
          <Card className="border-border/40 shadow-sm">
            <div className="p-4 border-b border-border/40 flex justify-between items-center bg-muted/20">
              <h3 className="font-serif font-semibold text-lg">Case Documents</h3>
              <Button size="sm"><FileText className="mr-2 h-4 w-4"/> Upload Document</Button>
            </div>
            <table className="w-full text-sm text-left">
              <thead className="bg-muted/50 text-muted-foreground text-xs uppercase tracking-wider border-b border-border/40">
                <tr>
                  <th className="px-6 py-3 font-medium">Title</th>
                  <th className="px-6 py-3 font-medium">Type</th>
                  <th className="px-6 py-3 font-medium">Status</th>
                  <th className="px-6 py-3 font-medium">Uploaded By</th>
                  <th className="px-6 py-3 font-medium">Date</th>
                  <th className="px-6 py-3 font-medium text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/40">
                {documents?.map(doc => (
                  <tr key={doc.id} className="hover:bg-muted/30">
                    <td className="px-6 py-3 font-medium text-foreground">{doc.title}</td>
                    <td className="px-6 py-3 uppercase text-xs">{doc.fileType}</td>
                    <td className="px-6 py-3"><StatusBadge status={doc.status} /></td>
                    <td className="px-6 py-3">{doc.uploadedBy}</td>
                    <td className="px-6 py-3 text-muted-foreground font-mono text-xs">{format(new Date(doc.createdAt), 'MMM dd, yyyy')}</td>
                    <td className="px-6 py-3 text-right">
                      <Button variant="ghost" size="icon" className="h-8 w-8"><Download className="h-4 w-4"/></Button>
                    </td>
                  </tr>
                ))}
                {!documents?.length && (
                  <tr><td colSpan={6} className="px-6 py-8 text-center text-muted-foreground">No documents uploaded yet.</td></tr>
                )}
              </tbody>
            </table>
          </Card>
        )}

        {activeTab === 'tasks' && (
          <Card className="border-border/40 shadow-sm">
            <div className="p-4 border-b border-border/40 flex justify-between items-center bg-muted/20">
              <h3 className="font-serif font-semibold text-lg">Case Tasks</h3>
              <Button size="sm"><CheckSquare className="mr-2 h-4 w-4"/> Add Task</Button>
            </div>
            <table className="w-full text-sm text-left">
              <thead className="bg-muted/50 text-muted-foreground text-xs uppercase tracking-wider border-b border-border/40">
                <tr>
                  <th className="px-6 py-3 font-medium">Task</th>
                  <th className="px-6 py-3 font-medium">Status</th>
                  <th className="px-6 py-3 font-medium">Priority</th>
                  <th className="px-6 py-3 font-medium">Assignee</th>
                  <th className="px-6 py-3 font-medium">Due Date</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/40">
                {tasks?.map(task => (
                  <tr key={task.id} className="hover:bg-muted/30">
                    <td className="px-6 py-3 font-medium text-foreground">{task.title}</td>
                    <td className="px-6 py-3"><StatusBadge status={task.status} /></td>
                    <td className="px-6 py-3"><StatusBadge status={task.priority} /></td>
                    <td className="px-6 py-3">{task.assigneeName || 'Unassigned'}</td>
                    <td className="px-6 py-3 text-muted-foreground font-mono text-xs">{task.dueDate ? format(new Date(task.dueDate), 'MMM dd, yyyy') : '-'}</td>
                  </tr>
                ))}
                {!tasks?.length && (
                  <tr><td colSpan={5} className="px-6 py-8 text-center text-muted-foreground">No tasks assigned.</td></tr>
                )}
              </tbody>
            </table>
          </Card>
        )}

        {activeTab === 'time' && (
          <Card className="border-border/40 shadow-sm">
            <div className="p-4 border-b border-border/40 flex justify-between items-center bg-muted/20">
              <h3 className="font-serif font-semibold text-lg">Time Entries</h3>
              <Button size="sm"><Clock className="mr-2 h-4 w-4"/> Log Time</Button>
            </div>
            <table className="w-full text-sm text-left">
              <thead className="bg-muted/50 text-muted-foreground text-xs uppercase tracking-wider border-b border-border/40">
                <tr>
                  <th className="px-6 py-3 font-medium">Date</th>
                  <th className="px-6 py-3 font-medium">Lawyer</th>
                  <th className="px-6 py-3 font-medium">Description</th>
                  <th className="px-6 py-3 font-medium text-right">Hours</th>
                  <th className="px-6 py-3 font-medium text-right">Amount</th>
                  <th className="px-6 py-3 font-medium text-center">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/40">
                {timeEntries?.map(entry => (
                  <tr key={entry.id} className="hover:bg-muted/30">
                    <td className="px-6 py-3 text-muted-foreground font-mono text-xs">{format(new Date(entry.date), 'MMM dd, yyyy')}</td>
                    <td className="px-6 py-3 font-medium">{entry.lawyerName}</td>
                    <td className="px-6 py-3 max-w-xs truncate" title={entry.description}>{entry.description}</td>
                    <td className="px-6 py-3 text-right font-mono">{entry.hours}</td>
                    <td className="px-6 py-3 text-right font-mono"><AmountFormatter amount={entry.totalAmount} /></td>
                    <td className="px-6 py-3 text-center">
                      {entry.invoiced ? <StatusBadge status="invoiced" /> : entry.isBillable ? <StatusBadge status="unbilled" /> : <span className="text-xs text-muted-foreground">Non-billable</span>}
                    </td>
                  </tr>
                ))}
                {!timeEntries?.length && (
                  <tr><td colSpan={6} className="px-6 py-8 text-center text-muted-foreground">No time logged yet.</td></tr>
                )}
              </tbody>
            </table>
          </Card>
        )}
      </div>
    </div>
  );
}
