import { useState } from 'react';
import { useAuth } from '@/lib/auth';
import { useLocation } from 'wouter';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Scale } from 'lucide-react';

export default function Login() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const { login } = useAuth();
  const [, setLocation] = useLocation();

  const handleLogin = (e: React.FormEvent) => {
    e.preventDefault();
    // Mock login
    login({
      id: 1,
      name: email.includes('admin') ? 'Senior Partner' : 'Associate Lawyer',
      email: email || 'lawyer@alhumoudi.com',
      role: email.includes('admin') ? 'admin' : 'lawyer',
      barNumber: 'SA-12345',
      specialization: 'Corporate Law',
      billableRate: 500,
      active: true,
      createdAt: new Date().toISOString()
    });
    setLocation('/');
  };

  return (
    <div className="min-h-screen w-full bg-slate-50 dark:bg-slate-950 flex flex-col items-center justify-center p-4 relative overflow-hidden">
      <div className="absolute inset-0 pointer-events-none opacity-[0.02]" style={{ backgroundImage: 'url("data:image/svg+xml,%3Csvg viewBox=%220 0 200 200%22 xmlns=%22http://www.w3.org/2000/svg%22%3E%3Cfilter id=%22noiseFilter%22%3E%3CfeTurbulence type=%22fractalNoise%22 baseFrequency=%220.65%22 numOctaves=%223%22 stitchTiles=%22stitch%22/%3E%3C/filter%3E%3Crect width=%22100%25%22 height=%22100%25%22 filter=%22url(%23noiseFilter)%22/%3E%3C/svg%3E")' }}></div>
      
      <div className="w-full max-w-md relative z-10">
        <div className="mb-10 text-center flex flex-col items-center">
          <div className="h-16 w-16 bg-primary rounded-xl flex items-center justify-center text-primary-foreground mb-6 shadow-2xl shadow-primary/20">
            <Scale className="h-8 w-8" />
          </div>
          <h1 className="text-4xl font-serif font-bold text-foreground mb-2 tracking-tight">ALHUMOUDI</h1>
          <p className="text-muted-foreground uppercase tracking-widest text-sm font-semibold">Law Firm Practice Management</p>
        </div>

        <Card className="border-border/50 shadow-xl shadow-black/5 bg-card/80 backdrop-blur-md">
          <CardHeader className="space-y-1 pb-6">
            <CardTitle className="text-2xl font-serif">Secure Login</CardTitle>
            <CardDescription>Enter your credentials to access the firm's systems.</CardDescription>
          </CardHeader>
          <form onSubmit={handleLogin}>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="email" className="font-semibold text-xs uppercase tracking-wider text-muted-foreground">Professional Email</Label>
                <Input 
                  id="email" 
                  type="email" 
                  placeholder="name@alhumoudi.com" 
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="bg-background/50 h-12"
                  required
                />
              </div>
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label htmlFor="password" className="font-semibold text-xs uppercase tracking-wider text-muted-foreground">Password</Label>
                  <a href="#" className="text-xs text-primary font-medium hover:underline">Forgot password?</a>
                </div>
                <Input 
                  id="password" 
                  type="password" 
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="bg-background/50 h-12"
                  required
                  placeholder="••••••••"
                />
              </div>
            </CardContent>
            <CardFooter className="pt-2 pb-6 flex flex-col gap-4">
              <Button type="submit" className="w-full h-12 font-medium text-base shadow-lg shadow-primary/20">
                Authenticate
              </Button>
              <p className="text-xs text-muted-foreground text-center">
                Authorized personnel only. All access is logged and monitored.
                <br/>(Use "admin" in email for admin privileges)
              </p>
            </CardFooter>
          </form>
        </Card>
      </div>
    </div>
  );
}
