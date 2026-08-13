import { ReactNode } from 'react';
import { Sidebar } from './Sidebar';
import { useAuth } from '@/lib/auth';
import { Redirect } from 'wouter';

export function Shell({ children }: { children: ReactNode }) {
  const { user } = useAuth();

  if (!user) {
    return <Redirect to="/login" />;
  }

  return (
    <div className="flex h-screen w-full bg-background overflow-hidden selection:bg-primary/20">
      <Sidebar />
      <main className="flex-1 overflow-y-auto flex flex-col relative">
        <div className="absolute inset-0 pointer-events-none opacity-[0.015] mix-blend-multiply" style={{ backgroundImage: 'url("data:image/svg+xml,%3Csvg viewBox=%220 0 200 200%22 xmlns=%22http://www.w3.org/2000/svg%22%3E%3Cfilter id=%22noiseFilter%22%3E%3CfeTurbulence type=%22fractalNoise%22 baseFrequency=%220.65%22 numOctaves=%223%22 stitchTiles=%22stitch%22/%3E%3C/filter%3E%3Crect width=%22100%25%22 height=%22100%25%22 filter=%22url(%23noiseFilter)%22/%3E%3C/svg%3E")' }}></div>
        {children}
      </main>
    </div>
  );
}

export function PageHeader({ title, description, children }: { title: string, description?: string, children?: ReactNode }) {
  return (
    <div className="px-8 py-8 border-b border-border/40 bg-card/50 backdrop-blur-sm sticky top-0 z-10">
      <div className="flex justify-between items-start gap-4">
        <div>
          <h1 className="text-3xl font-serif font-semibold text-foreground tracking-tight">{title}</h1>
          {description && <p className="text-muted-foreground mt-1 text-sm">{description}</p>}
        </div>
        {children && <div className="flex items-center gap-3 shrink-0">{children}</div>}
      </div>
    </div>
  );
}
