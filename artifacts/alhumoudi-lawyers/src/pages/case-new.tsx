import { useState, useEffect, useRef } from 'react';
import { useCreateCase, useCheckConflict, getCheckConflictQueryKey } from '@workspace/api-client-react';
import { PageHeader } from '@/components/layout/Shell';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { useLocation } from 'wouter';
import { AlertCircle, ShieldAlert, CheckCircle2, ChevronRight, Scale } from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';

export default function CaseNew() {
  const [, setLocation] = useLocation();
  const queryClient = useQueryClient();
  const createCase = useCreateCase();
  
  const [formData, setFormData] = useState({
    title: '',
    clientName: '',
    caseType: 'litigation',
    jurisdiction: 'Riyadh',
    opposingParty: '',
    description: ''
  });

  const [conflictQuery, setConflictQuery] = useState('');
  
  // Debounce conflict check input
  useEffect(() => {
    const timer = setTimeout(() => {
      const query = [formData.clientName, formData.opposingParty].filter(Boolean).join(' ');
      if (query.length > 3) {
        setConflictQuery(query);
      } else {
        setConflictQuery('');
      }
    }, 500);
    return () => clearTimeout(timer);
  }, [formData.clientName, formData.opposingParty]);

  const { data: conflictData, isFetching: isCheckingConflict } = useCheckConflict(
    { query: conflictQuery },
    { query: { enabled: conflictQuery.length > 3, queryKey: getCheckConflictQueryKey({ query: conflictQuery }) } }
  );

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    createCase.mutate({
      data: {
        ...formData,
        status: 'open',
      }
    }, {
      onSuccess: (newCase) => {
        setLocation(`/cases/${newCase.id}`);
      }
    });
  };

  return (
    <div className="flex-1 flex flex-col bg-slate-50/50 dark:bg-transparent">
      <PageHeader 
        title="Open New Matter" 
        description="Initiate a new case file and perform preliminary conflict checks."
      />

      <div className="p-8 max-w-5xl mx-auto w-full grid grid-cols-1 xl:grid-cols-3 gap-8">
        
        {/* Form Column */}
        <div className="xl:col-span-2 space-y-6">
          <form onSubmit={handleSubmit} id="new-matter-form">
            <Card className="border-border/50 shadow-sm overflow-hidden">
              <div className="h-2 w-full bg-primary"></div>
              <CardHeader className="bg-card pb-8">
                <CardTitle className="text-2xl font-serif">Matter Details</CardTitle>
                <CardDescription>Enter the primary information for this new case.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-6">
                <div className="space-y-2">
                  <Label htmlFor="title" className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Matter Title <span className="text-destructive">*</span></Label>
                  <Input 
                    id="title" 
                    value={formData.title} 
                    onChange={e => setFormData({...formData, title: e.target.value})} 
                    placeholder="e.g. Al-Saud Commercial Dispute"
                    required
                    className="h-12 text-lg"
                  />
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <div className="space-y-2">
                    <Label htmlFor="clientName" className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Client Name <span className="text-destructive">*</span></Label>
                    <Input 
                      id="clientName" 
                      value={formData.clientName} 
                      onChange={e => setFormData({...formData, clientName: e.target.value})} 
                      required
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="opposingParty" className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Opposing Party</Label>
                    <Input 
                      id="opposingParty" 
                      value={formData.opposingParty} 
                      onChange={e => setFormData({...formData, opposingParty: e.target.value})} 
                    />
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <div className="space-y-2">
                    <Label htmlFor="caseType" className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Practice Area</Label>
                    <select 
                      id="caseType" 
                      className="flex h-10 w-full items-center justify-between rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
                      value={formData.caseType}
                      onChange={e => setFormData({...formData, caseType: e.target.value})}
                    >
                      <option value="litigation">Litigation</option>
                      <option value="corporate">Corporate</option>
                      <option value="real_estate">Real Estate</option>
                      <option value="intellectual_property">Intellectual Property</option>
                      <option value="employment">Employment</option>
                      <option value="advisory">Advisory</option>
                    </select>
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="jurisdiction" className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Jurisdiction</Label>
                    <Input 
                      id="jurisdiction" 
                      value={formData.jurisdiction} 
                      onChange={e => setFormData({...formData, jurisdiction: e.target.value})} 
                    />
                  </div>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="description" className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Initial Assessment / Description</Label>
                  <textarea 
                    id="description" 
                    className="flex min-h-[120px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 resize-none"
                    value={formData.description} 
                    onChange={e => setFormData({...formData, description: e.target.value})} 
                    placeholder="Brief description of the matter..."
                  />
                </div>
              </CardContent>
            </Card>

            <div className="mt-6 flex justify-end gap-4">
              <Button type="button" variant="outline" onClick={() => setLocation('/cases')}>Cancel</Button>
              <Button type="submit" form="new-matter-form" disabled={createCase.isPending} className="h-10 px-8">
                {createCase.isPending ? 'Opening Matter...' : 'Open Matter'}
                {!createCase.isPending && <ChevronRight className="ml-2 h-4 w-4" />}
              </Button>
            </div>
          </form>
        </div>

        {/* Sidebar Column */}
        <div className="space-y-6">
          <Card className="border-border/40 shadow-sm sticky top-24">
            <CardHeader className="bg-muted/30 border-b border-border/40">
              <CardTitle className="text-base flex items-center gap-2">
                <ShieldAlert className="h-4 w-4" />
                Conflict Check
              </CardTitle>
            </CardHeader>
            <CardContent className="p-6">
              {conflictQuery.length <= 3 ? (
                <div className="text-center text-muted-foreground space-y-3 py-4">
                  <Scale className="h-10 w-10 mx-auto opacity-20" />
                  <p className="text-sm">Enter client or opposing party names to run an automatic conflict of interest check against firm records.</p>
                </div>
              ) : isCheckingConflict ? (
                <div className="space-y-4 py-4">
                  <div className="flex items-center gap-3 text-sm font-medium text-amber-600 dark:text-amber-500 animate-pulse">
                    <div className="h-4 w-4 rounded-full border-2 border-current border-t-transparent animate-spin"></div>
                    Scanning firm records...
                  </div>
                  <div className="space-y-2">
                    <div className="h-2 bg-muted rounded w-full"></div>
                    <div className="h-2 bg-muted rounded w-5/6"></div>
                  </div>
                </div>
              ) : conflictData?.hasConflict ? (
                <div className="space-y-4">
                  <div className="flex items-start gap-3 text-destructive bg-destructive/10 p-3 rounded-md">
                    <AlertCircle className="h-5 w-5 shrink-0 mt-0.5" />
                    <div>
                      <h4 className="text-sm font-bold uppercase tracking-wider">Potential Conflicts Found</h4>
                      <p className="text-xs mt-1 opacity-90">Review matches before proceeding.</p>
                    </div>
                  </div>
                  
                  <div className="space-y-3 mt-4">
                    {conflictData.matches.map((match, i) => (
                      <div key={i} className="text-sm p-3 border border-destructive/20 rounded-md bg-card">
                        <div className="font-semibold">{match.matchedValue}</div>
                        <div className="text-xs text-muted-foreground mt-1">
                          Matched as <span className="uppercase font-medium text-foreground">{match.matchType.replace('_', ' ')}</span> in:
                        </div>
                        <div className="text-xs font-mono mt-1 text-primary">{match.caseTitle}</div>
                      </div>
                    ))}
                  </div>
                </div>
              ) : (
                <div className="flex flex-col items-center justify-center text-center space-y-3 py-6">
                  <div className="h-12 w-12 rounded-full bg-emerald-100 dark:bg-emerald-900/30 flex items-center justify-center text-emerald-600 dark:text-emerald-400">
                    <CheckCircle2 className="h-6 w-6" />
                  </div>
                  <div>
                    <h4 className="text-sm font-bold text-foreground">Clear</h4>
                    <p className="text-xs text-muted-foreground mt-1">No direct conflicts found in current or archived matters.</p>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        </div>
        
      </div>
    </div>
  );
}
