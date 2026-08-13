import { useState } from 'react';
import { useListAllDocuments, getListAllDocumentsQueryKey } from '@workspace/api-client-react';
import { PageHeader } from '@/components/layout/Shell';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent } from '@/components/ui/card';
import { StatusBadge } from '@/components/ui/status-badge';
import { Search, Upload, Download, FileText, File, MoreHorizontal, Filter } from 'lucide-react';
import { Link } from 'wouter';
import { format } from 'date-fns';

export default function Documents() {
  const [search, setSearch] = useState('');

  const { data: documents, isLoading } = useListAllDocuments({ 
    query: { queryKey: getListAllDocumentsQueryKey() } 
  });

  const filteredDocuments = documents?.filter(d => 
    !search || 
    d.title.toLowerCase().includes(search.toLowerCase()) || 
    d.caseName?.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="flex-1 flex flex-col">
      <PageHeader 
        title="Document Repository" 
        description="Firm-wide access to all case files, pleadings, and correspondence."
      >
        <Button className="h-10 px-4 py-2">
          <Upload className="mr-2 h-4 w-4" />
          Upload Document
        </Button>
      </PageHeader>

      <div className="p-8 space-y-6 max-w-7xl mx-auto w-full">
        <div className="flex flex-col sm:flex-row gap-4 items-center justify-between">
          <div className="relative w-full sm:w-96">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input 
              placeholder="Search documents..." 
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-9 bg-card"
            />
          </div>
          <Button variant="outline" className="w-full sm:w-auto">
            <Filter className="mr-2 h-4 w-4" />
            Filters
          </Button>
        </div>

        <Card className="border-border/40 shadow-sm overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm text-left">
              <thead className="bg-muted/30 text-muted-foreground text-xs uppercase tracking-wider border-b border-border/40">
                <tr>
                  <th className="px-6 py-4 font-medium">Document</th>
                  <th className="px-6 py-4 font-medium">Related Matter</th>
                  <th className="px-6 py-4 font-medium">Status & Version</th>
                  <th className="px-6 py-4 font-medium">Uploaded By</th>
                  <th className="px-6 py-4 font-medium">Date</th>
                  <th className="px-6 py-4 font-medium text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/40">
                {isLoading ? (
                  [...Array(6)].map((_, i) => (
                    <tr key={i}>
                      <td className="px-6 py-4"><div className="h-10 bg-muted animate-pulse rounded"></div></td>
                      <td className="px-6 py-4"><div className="h-5 bg-muted animate-pulse rounded w-32"></div></td>
                      <td className="px-6 py-4"><div className="h-6 bg-muted animate-pulse rounded-full w-16"></div></td>
                      <td className="px-6 py-4"><div className="h-5 bg-muted animate-pulse rounded w-24"></div></td>
                      <td className="px-6 py-4"><div className="h-5 bg-muted animate-pulse rounded w-20"></div></td>
                      <td className="px-6 py-4"></td>
                    </tr>
                  ))
                ) : filteredDocuments?.length ? (
                  filteredDocuments.map((doc) => (
                    <tr key={doc.id} className="hover:bg-muted/20 transition-colors group">
                      <td className="px-6 py-4">
                        <div className="flex items-start gap-3">
                          <div className="mt-0.5 p-2 bg-muted rounded-md text-muted-foreground">
                            {doc.fileType === 'pdf' ? <FileText className="h-4 w-4" /> : <File className="h-4 w-4" />}
                          </div>
                          <div>
                            <Link href={`/documents/${doc.id}`} className="font-semibold text-foreground hover:text-primary transition-colors leading-tight block">{doc.title}</Link>
                            <div className="text-xs uppercase text-muted-foreground mt-1 font-mono">{doc.fileType}</div>
                          </div>
                        </div>
                      </td>
                      <td className="px-6 py-4">
                        {doc.caseId ? (
                          <Link href={`/cases/${doc.caseId}`} className="font-medium text-primary hover:underline block truncate max-w-[200px]" title={doc.caseName || ''}>
                            {doc.caseName}
                          </Link>
                        ) : (
                          <span className="text-muted-foreground text-xs italic">General Firm File</span>
                        )}
                      </td>
                      <td className="px-6 py-4">
                        <div className="flex items-center gap-2">
                          <StatusBadge status={doc.status} />
                          <span className="text-xs font-mono text-muted-foreground bg-muted px-1.5 py-0.5 rounded">v{doc.version}</span>
                        </div>
                      </td>
                      <td className="px-6 py-4">
                        <div className="font-medium">{doc.uploadedBy}</div>
                      </td>
                      <td className="px-6 py-4 text-muted-foreground font-mono text-xs">
                        {format(new Date(doc.createdAt), 'MMM dd, yyyy')}
                      </td>
                      <td className="px-6 py-4 text-right">
                        <div className="flex items-center justify-end gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                          <Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground hover:text-foreground">
                            <Download className="h-4 w-4" />
                          </Button>
                          <Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground hover:text-foreground">
                            <MoreHorizontal className="h-4 w-4" />
                          </Button>
                        </div>
                      </td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td colSpan={6} className="px-6 py-12 text-center text-muted-foreground">
                      <FileText className="h-10 w-10 mx-auto opacity-20 mb-3" />
                      <p>No documents found matching your search.</p>
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </Card>
      </div>
    </div>
  );
}
