import { useRoute, Link } from 'wouter';
import { 
  useGetContract, 
  useListContractPayments,
  getGetContractQueryKey,
  getListContractPaymentsQueryKey
} from '@workspace/api-client-react';
import { PageHeader } from '@/components/layout/Shell';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { StatusBadge, AmountFormatter } from '@/components/ui/status-badge';
import { ArrowLeft, CreditCard, Calendar, Plus } from 'lucide-react';
import { format } from 'date-fns';

export default function ContractDetail() {
  const [, params] = useRoute('/contracts/:id');
  const id = Number(params?.id);

  const { data: contract, isLoading } = useGetContract(id, { query: { enabled: !!id, queryKey: getGetContractQueryKey(id) } });
  const { data: payments, isLoading: paymentsLoading } = useListContractPayments(id, { query: { enabled: !!id, queryKey: getListContractPaymentsQueryKey(id) } });

  if (isLoading) return <div className="p-8 flex justify-center"><div className="h-8 w-8 rounded-full border-4 border-primary border-t-transparent animate-spin"></div></div>;
  if (!contract) return <div className="p-8 text-center">Contract not found.</div>;

  return (
    <div className="flex-1 flex flex-col">
      <div className="px-8 py-4 border-b border-border/40 bg-card flex items-center justify-between">
        <div className="flex items-center gap-4">
          <Button variant="ghost" size="icon" asChild className="h-8 w-8 mr-2">
            <Link href="/contracts"><ArrowLeft className="h-4 w-4" /></Link>
          </Button>
          <div>
            <div className="text-xs font-mono text-muted-foreground mb-1">{contract.contractNumber}</div>
            <h1 className="text-2xl font-serif font-bold text-foreground leading-none">{contract.title}</h1>
          </div>
          <StatusBadge status={contract.status} className="ml-4" />
        </div>
      </div>

      <div className="p-8 max-w-5xl mx-auto w-full grid grid-cols-1 md:grid-cols-3 gap-8">
        <div className="md:col-span-2 space-y-6">
          <Card className="border-border/40 shadow-sm">
            <CardHeader className="bg-muted/20 border-b border-border/40 pb-4 flex flex-row items-center justify-between">
              <CardTitle className="text-lg font-serif flex items-center gap-2">
                <CreditCard className="h-5 w-5 text-primary" />
                Payment Schedule
              </CardTitle>
              <Button size="sm"><Plus className="mr-2 h-4 w-4" /> Record Payment</Button>
            </CardHeader>
            <table className="w-full text-sm text-left">
              <thead className="bg-muted/50 text-muted-foreground text-xs uppercase tracking-wider border-b border-border/40">
                <tr>
                  <th className="px-6 py-3 font-medium">Due Date</th>
                  <th className="px-6 py-3 font-medium">Amount</th>
                  <th className="px-6 py-3 font-medium">Status</th>
                  <th className="px-6 py-3 font-medium">Paid Date</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/40">
                {paymentsLoading ? (
                  <tr><td colSpan={4} className="p-6 text-center"><div className="h-5 w-5 rounded-full border-2 border-primary border-t-transparent animate-spin mx-auto"></div></td></tr>
                ) : payments?.length ? (
                  payments.map(p => (
                    <tr key={p.id} className="hover:bg-muted/20">
                      <td className="px-6 py-3 font-mono text-xs">{format(new Date(p.dueDate), 'MMM dd, yyyy')}</td>
                      <td className="px-6 py-3 font-mono font-bold"><AmountFormatter amount={p.amount} /></td>
                      <td className="px-6 py-3"><StatusBadge status={p.status} /></td>
                      <td className="px-6 py-3 text-muted-foreground font-mono text-xs">
                        {p.paidDate ? format(new Date(p.paidDate), 'MMM dd, yyyy') : '-'}
                      </td>
                    </tr>
                  ))
                ) : (
                  <tr><td colSpan={4} className="p-8 text-center text-muted-foreground">No payments scheduled.</td></tr>
                )}
              </tbody>
            </table>
          </Card>
        </div>

        <div className="space-y-6">
          <Card className="border-border/40 shadow-sm">
            <CardHeader className="bg-muted/20 border-b border-border/40 pb-4">
              <CardTitle className="text-sm font-bold uppercase tracking-wider text-muted-foreground">Contract Details</CardTitle>
            </CardHeader>
            <CardContent className="p-0 divide-y divide-border/40">
              <div className="p-4">
                <div className="text-xs text-muted-foreground">Client</div>
                <div className="font-medium text-sm">{contract.clientName}</div>
              </div>
              <div className="p-4">
                <div className="text-xs text-muted-foreground">Type</div>
                <div className="font-medium text-sm capitalize">{contract.contractType.replace('_', ' ')}</div>
              </div>
              <div className="p-4">
                <div className="text-xs text-muted-foreground">Total Value</div>
                <div className="font-mono font-bold text-lg"><AmountFormatter amount={contract.totalValue} /></div>
              </div>
              <div className="p-4">
                <div className="text-xs text-muted-foreground">Terms</div>
                <div className="text-sm">
                  {format(new Date(contract.startDate), 'MMM dd, yyyy')} 
                  {contract.endDate && ` - ${format(new Date(contract.endDate), 'MMM dd, yyyy')}`}
                </div>
              </div>
              <div className="p-4">
                <div className="text-xs text-muted-foreground">Responsible</div>
                <div className="font-medium text-sm">{contract.responsibleLawyerName}</div>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
