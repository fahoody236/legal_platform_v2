import { useRoute, Link } from 'wouter';
import { 
  useGetInvoice,
  getGetInvoiceQueryKey
} from '@workspace/api-client-react';
import { PageHeader } from '@/components/layout/Shell';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { StatusBadge, AmountFormatter } from '@/components/ui/status-badge';
import { ArrowLeft, Receipt, Download, Building2, MapPin } from 'lucide-react';
import { format } from 'date-fns';

export default function InvoiceDetail() {
  const [, params] = useRoute('/invoices/:id');
  const id = Number(params?.id);

  const { data: invoice, isLoading } = useGetInvoice(id, { query: { enabled: !!id, queryKey: getGetInvoiceQueryKey(id) } });

  if (isLoading) return <div className="p-8 flex justify-center"><div className="h-8 w-8 rounded-full border-4 border-primary border-t-transparent animate-spin"></div></div>;
  if (!invoice) return <div className="p-8 text-center">Invoice not found.</div>;

  return (
    <div className="flex-1 flex flex-col bg-slate-50/50">
      <div className="px-8 py-4 border-b border-border/40 bg-card flex items-center justify-between">
        <div className="flex items-center gap-4">
          <Button variant="ghost" size="icon" asChild className="h-8 w-8 mr-2">
            <Link href="/billing"><ArrowLeft className="h-4 w-4" /></Link>
          </Button>
          <div>
            <div className="text-xs font-mono text-muted-foreground mb-1">Invoice</div>
            <h1 className="text-2xl font-serif font-bold text-foreground leading-none">{invoice.invoiceNumber}</h1>
          </div>
          <StatusBadge status={invoice.status} className="ml-4" />
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline"><Download className="mr-2 h-4 w-4" /> Download PDF</Button>
        </div>
      </div>

      <div className="p-8 max-w-4xl mx-auto w-full">
        <Card className="border-border/40 shadow-sm p-8">
          <div className="flex justify-between items-start mb-12">
            <div>
              <div className="flex items-center gap-2 mb-4">
                <div className="h-10 w-10 bg-primary text-primary-foreground flex items-center justify-center rounded font-serif font-bold text-xl">A</div>
                <h2 className="font-serif font-bold text-xl tracking-wide">ALHUMOUDI</h2>
              </div>
              <p className="text-sm text-muted-foreground max-w-xs">
                Riyadh, Saudi Arabia<br/>
                King Fahd Road, Tower B, Floor 14<br/>
                billing@alhumoudi.com
              </p>
            </div>
            <div className="text-right">
              <h3 className="text-3xl font-mono text-muted-foreground mb-2">INVOICE</h3>
              <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
                <span className="text-muted-foreground">Invoice No:</span>
                <span className="font-mono font-medium">{invoice.invoiceNumber}</span>
                <span className="text-muted-foreground">Issue Date:</span>
                <span className="font-mono font-medium">{format(new Date(invoice.issuedDate), 'MMM dd, yyyy')}</span>
                {invoice.dueDate && (
                  <>
                    <span className="text-muted-foreground">Due Date:</span>
                    <span className="font-mono font-medium">{format(new Date(invoice.dueDate), 'MMM dd, yyyy')}</span>
                  </>
                )}
              </div>
            </div>
          </div>

          <div className="border-t border-border/40 pt-8 mb-12 flex justify-between">
            <div>
              <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground mb-2">Bill To</p>
              <p className="font-medium text-lg">{invoice.clientName}</p>
              {invoice.caseName && (
                <p className="text-sm text-primary mt-1">Matter: {invoice.caseName}</p>
              )}
            </div>
            {invoice.paidAmount ? (
              <div className="text-right">
                <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground mb-2">Payment Status</p>
                <p className="font-medium text-emerald-600 dark:text-emerald-400">Paid: <AmountFormatter amount={invoice.paidAmount} /></p>
                {invoice.paidDate && <p className="text-sm text-muted-foreground mt-1">on {format(new Date(invoice.paidDate), 'MMM dd, yyyy')}</p>}
              </div>
            ) : null}
          </div>

          <table className="w-full text-sm mb-12">
            <thead className="bg-muted/30 text-muted-foreground text-xs uppercase tracking-wider border-y border-border/40">
              <tr>
                <th className="px-4 py-3 text-left font-medium">Description</th>
                <th className="px-4 py-3 text-right font-medium">Amount</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/40">
              <tr>
                <td className="px-4 py-6">
                  <div className="font-medium mb-1">Legal Services Rendered</div>
                  <div className="text-muted-foreground text-xs">As per agreed terms and logged time entries for the period.</div>
                </td>
                <td className="px-4 py-6 text-right font-mono font-bold"><AmountFormatter amount={invoice.totalAmount + (invoice.retainerApplied || 0)} /></td>
              </tr>
              {invoice.retainerApplied ? (
                <tr>
                  <td className="px-4 py-4 text-muted-foreground">Less: Retainer Applied</td>
                  <td className="px-4 py-4 text-right font-mono text-destructive">-<AmountFormatter amount={invoice.retainerApplied} /></td>
                </tr>
              ) : null}
            </tbody>
            <tfoot className="border-t-2 border-border">
              <tr>
                <td className="px-4 py-4 text-right font-bold uppercase text-muted-foreground">Total Due</td>
                <td className="px-4 py-4 text-right font-mono font-bold text-xl"><AmountFormatter amount={invoice.totalAmount} /></td>
              </tr>
            </tfoot>
          </table>

          {invoice.notes && (
            <div className="bg-muted/20 p-4 rounded-lg border border-border/40">
              <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground mb-1">Notes</p>
              <p className="text-sm">{invoice.notes}</p>
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}
