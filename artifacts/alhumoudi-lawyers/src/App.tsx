import { type ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ErrorBoundary } from '@/components/error-boundary';
import { Toaster } from '@/components/ui/toaster';
import { TooltipProvider } from '@/components/ui/tooltip';
import { Route, Switch, useLocation, Router as WouterRouter } from 'wouter';

import { AuthProvider } from '@/lib/auth';
import { Shell } from '@/components/layout/Shell';

// Pages
import Login from '@/pages/login';
import Dashboard from '@/pages/dashboard';
import Cases from '@/pages/cases';
import CaseNew from '@/pages/case-new';
import CaseDetail from '@/pages/case-detail';
import Documents from '@/pages/documents';
import DocumentDetail from '@/pages/document-detail';
import Billing from '@/pages/billing';
import InvoiceDetail from '@/pages/invoice-detail';
import Contracts from '@/pages/contracts';
import ContractDetail from '@/pages/contract-detail';
import Tasks from '@/pages/tasks';
import AiDrafts from '@/pages/ai-drafts';
import Team from '@/pages/team';
import AdminUsers from '@/pages/admin/users';
import Chat from '@/pages/chat';
import NotFound from '@/pages/not-found';

const queryClient = new QueryClient();

function ProtectedRoute({ component: Component, ...rest }: any) {
  return (
    <Route {...rest}>
      {() => (
        <Shell>
          <Component />
        </Shell>
      )}
    </Route>
  );
}

function Router() {
  return (
    <RoutedErrorBoundary>
      <Switch>
        <Route path="/login" component={Login} />
        <ProtectedRoute path="/" component={Dashboard} />
        <ProtectedRoute path="/cases" component={Cases} />
        <ProtectedRoute path="/cases/new" component={CaseNew} />
        <ProtectedRoute path="/cases/:id" component={CaseDetail} />
        <ProtectedRoute path="/documents" component={Documents} />
        <ProtectedRoute path="/documents/:id" component={DocumentDetail} />
        <ProtectedRoute path="/billing" component={Billing} />
        <ProtectedRoute path="/invoices/:id" component={InvoiceDetail} />
        <ProtectedRoute path="/contracts" component={Contracts} />
        <ProtectedRoute path="/contracts/:id" component={ContractDetail} />
        <ProtectedRoute path="/tasks" component={Tasks} />
        <ProtectedRoute path="/ai-drafts" component={AiDrafts} />
        <ProtectedRoute path="/chat" component={Chat} />
        <ProtectedRoute path="/team" component={Team} />
        <ProtectedRoute path="/admin/users" component={AdminUsers} />
        <ProtectedRoute path="/:rest*" component={NotFound} />
      </Switch>
    </RoutedErrorBoundary>
  );
}

function RoutedErrorBoundary({ children }: { children: ReactNode }) {
  const [location] = useLocation();
  return <ErrorBoundary resetKey={location}>{children}</ErrorBoundary>;
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <TooltipProvider>
          <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, '')}>
            <Router />
          </WouterRouter>
          <Toaster />
        </TooltipProvider>
      </AuthProvider>
    </QueryClientProvider>
  );
}

export default App;
