import { useRoute, Link } from 'wouter';
import { 
  useGetDocument, 
  useGetDocumentVersions,
  getGetDocumentQueryKey,
  getGetDocumentVersionsQueryKey
} from '@workspace/api-client-react';
import { PageHeader } from '@/components/layout/Shell';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { StatusBadge } from '@/components/ui/status-badge';
import { ArrowLeft, FileText, Download, History, User, Clock } from 'lucide-react';
import { format } from 'date-fns';

export default function DocumentDetail() {
  const [, params] = useRoute('/documents/:id');
  const id = Number(params?.id);

  const { data: document, isLoading } = useGetDocument(id, { query: { enabled: !!id, queryKey: getGetDocumentQueryKey(id) } });
  const { data: versions, isLoading: versionsLoading } = useGetDocumentVersions(id, { query: { enabled: !!id, queryKey: getGetDocumentVersionsQueryKey(id) } });

  if (isLoading) return <div className="p-8 flex justify-center"><div className="h-8 w-8 rounded-full border-4 border-primary border-t-transparent animate-spin"></div></div>;
  if (!document) return <div className="p-8 text-center">Document not found.</div>;

  return (
    <div className="flex-1 flex flex-col">
      <div className="px-8 py-4 border-b border-border/40 bg-card flex items-center justify-between">
        <div className="flex items-center gap-4">
          <Button variant="ghost" size="icon" asChild className="h-8 w-8 mr-2">
            <Link href="/documents"><ArrowLeft className="h-4 w-4" /></Link>
          </Button>
          <div className="flex items-center gap-3">
            <div className="p-2 bg-muted rounded-md text-muted-foreground">
              <FileText className="h-5 w-5" />
            </div>
            <div>
              <h1 className="text-2xl font-serif font-bold text-foreground leading-none">{document.title}</h1>
              <div className="text-xs uppercase font-mono text-muted-foreground mt-1">
                {document.fileType} • Version {document.version}
              </div>
            </div>
          </div>
          <StatusBadge status={document.status} className="ml-4" />
        </div>
        <div className="flex items-center gap-2">
          <Button><Download className="mr-2 h-4 w-4" /> Download</Button>
        </div>
      </div>

      <div className="p-8 max-w-5xl mx-auto w-full grid grid-cols-1 md:grid-cols-3 gap-8">
        <div className="space-y-6">
          <Card className="border-border/40 shadow-sm">
            <CardHeader className="bg-muted/20 border-b border-border/40 pb-4">
              <CardTitle className="text-sm font-bold uppercase tracking-wider text-muted-foreground">Document Info</CardTitle>
            </CardHeader>
            <CardContent className="p-0 divide-y divide-border/40">
              <div className="p-4">
                <div className="text-xs text-muted-foreground">Related Matter</div>
                {document.caseId ? (
                  <Link href={`/cases/${document.caseId}`} className="font-medium text-sm text-primary hover:underline">{document.caseName}</Link>
                ) : (
                  <div className="font-medium text-sm">General File</div>
                )}
              </div>
              <div className="p-4">
                <div className="text-xs text-muted-foreground">Uploaded By</div>
                <div className="font-medium text-sm">{document.uploadedBy}</div>
              </div>
              <div className="p-4">
                <div className="text-xs text-muted-foreground">Date</div>
                <div className="font-medium text-sm font-mono">{format(new Date(document.createdAt), 'MMM dd, yyyy h:mm a')}</div>
              </div>
              {document.description && (
                <div className="p-4">
                  <div className="text-xs text-muted-foreground mb-1">Description</div>
                  <p className="text-sm text-foreground/80">{document.description}</p>
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        <div className="md:col-span-2 space-y-6">
          <Card className="border-border/40 shadow-sm">
            <CardHeader className="bg-muted/20 border-b border-border/40 pb-4 flex flex-row items-center justify-between">
              <CardTitle className="text-lg font-serif flex items-center gap-2">
                <History className="h-5 w-5 text-primary" />
                Version History
              </CardTitle>
            </CardHeader>
            <div className="p-6">
              <div className="space-y-6 relative before:absolute before:inset-0 before:ml-5 before:-translate-x-px before:h-full before:w-0.5 before:bg-border/50">
                {versionsLoading ? (
                  <div className="h-24 bg-muted animate-pulse rounded-md ml-12"></div>
                ) : versions?.length ? (
                  versions.map(v => (
                    <div key={v.id} className="relative flex items-start gap-4">
                      <div className="flex items-center justify-center w-10 h-10 rounded-full border-4 border-card bg-muted text-muted-foreground z-10 shrink-0 font-mono text-xs font-bold">
                        v{v.version}
                      </div>
                      <div className="flex-1 pt-1">
                        <div className="flex items-center gap-2 mb-1">
                          <span className="font-semibold text-sm">Version {v.version}</span>
                          <time className="text-xs text-muted-foreground font-mono">{format(new Date(v.editedAt), 'MMM dd, yyyy')}</time>
                        </div>
                        <p className="text-sm text-foreground/80 bg-muted/30 p-3 rounded-md border border-border/50 mt-2">
                          {v.changeNote}
                        </p>
                        <div className="mt-2 text-xs text-muted-foreground flex items-center gap-1">
                          <User className="h-3 w-3" /> {v.editedBy}
                        </div>
                      </div>
                    </div>
                  ))
                ) : (
                  <div className="text-center text-muted-foreground py-4 ml-8">No previous versions.</div>
                )}
              </div>
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
}
