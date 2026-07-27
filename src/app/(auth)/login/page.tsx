'use client';

import { useState } from 'react';
import { signIn } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { motion } from 'framer-motion';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Separator } from '@/components/ui/separator';
import { Badge } from '@/components/ui/badge';
import { toast } from 'sonner';
import { Layers, Loader2, ArrowRight } from 'lucide-react';

const demoAccounts = [
  { label: 'Admin', email: 'ekontetevi@gmail.com', color: 'bg-violet-500/10 text-violet-600 border-violet-500/20' },
  { label: 'Merchant', email: 'merchant@payswap.demo', color: 'bg-emerald-500/10 text-emerald-600 border-emerald-500/20' },
  { label: 'Customer', email: 'customer@payswap.demo', color: 'bg-sky-500/10 text-sky-600 border-sky-500/20' },
  { label: 'LP', email: 'lp@payswap.demo', color: 'bg-amber-500/10 text-amber-600 border-amber-500/20' },
  { label: 'Treasury', email: 'treasury@payswap.demo', color: 'bg-teal-500/10 text-teal-600 border-teal-500/20' },
  { label: 'Compliance', email: 'compliance@payswap.demo', color: 'bg-rose-500/10 text-rose-600 border-rose-500/20' },
  { label: 'Support', email: 'support@payswap.demo', color: 'bg-cyan-500/10 text-cyan-600 border-cyan-500/20' },
  { label: 'Ops', email: 'ops@payswap.demo', color: 'bg-orange-500/10 text-orange-600 border-orange-500/20' },
  { label: 'Developer', email: 'developer@payswap.demo', color: 'bg-indigo-500/10 text-indigo-600 border-indigo-500/20' },
];

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    const res = await signIn('credentials', { email, password, redirect: false });
    setLoading(false);

    if (res?.error) {
      toast.error('Invalid credentials');
    } else if (res?.ok) {
      toast.success('Welcome back!');
      // The middleware will handle role-based redirects
      router.push('/dashboard');
      router.refresh();
    }
  };

  const quickLogin = async (demoEmail: string) => {
    setLoading(true);
    setEmail(demoEmail);
    setPassword('Payswap123456');
    const res = await signIn('credentials', { email: demoEmail, password: 'Payswap123456', redirect: false });
    setLoading(false);

    if (res?.ok) {
      toast.success('Logged in');
      // Route based on role
      const roleMap: Record<string, string> = {
        'ekontetevi@gmail.com': '/admin',
        'merchant@payswap.demo': '/dashboard',
        'customer@payswap.demo': '/portal',
        'lp@payswap.demo': '/lp',
        'treasury@payswap.demo': '/treasury',
        'compliance@payswap.demo': '/compliance',
        'support@payswap.demo': '/support',
        'ops@payswap.demo': '/ops',
        'developer@payswap.demo': '/developers',
      };
      router.push(roleMap[demoEmail] || '/dashboard');
      router.refresh();
    } else {
      toast.error('Login failed');
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-background via-background to-emerald-500/5 p-4">
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4 }}
        className="w-full max-w-md"
      >
        {/* Logo */}
        <div className="mb-8 flex flex-col items-center">
          <Link href="/" className="flex items-center gap-2.5">
            <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-gradient-to-br from-emerald-500 to-teal-600 text-white shadow-lg">
              <Layers className="h-6 w-6" />
            </div>
          </Link>
          <h1 className="mt-4 text-2xl font-bold tracking-tight">Welcome back</h1>
          <p className="mt-1 text-sm text-muted-foreground">Sign in to your PaySwap account</p>
        </div>

        <Card className="border-emerald-500/10 shadow-xl">
          <CardHeader>
            <CardTitle className="text-lg">Sign in</CardTitle>
            <CardDescription>Enter your credentials to access your dashboard</CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="email">Email</Label>
                <Input
                  id="email"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@company.com"
                  required
                  className="h-10"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="password">Password</Label>
                <Input
                  id="password"
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••"
                  required
                  className="h-10"
                />
              </div>
              <Button
                type="submit"
                disabled={loading}
                className="w-full h-10 bg-emerald-600 hover:bg-emerald-700 text-white"
              >
                {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Sign in'}
              </Button>
            </form>

            <div className="my-6 relative">
              <Separator />
              <span className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 bg-card px-3 text-xs text-muted-foreground">
                or try a demo account
              </span>
            </div>

            <div className="grid grid-cols-3 gap-2">
              {demoAccounts.map((acc) => (
                <button
                  key={acc.email}
                  onClick={() => quickLogin(acc.email)}
                  disabled={loading}
                  className={`rounded-lg border px-2 py-2 text-xs font-medium transition-colors hover:scale-105 ${acc.color}`}
                >
                  {acc.label}
                </button>
              ))}
            </div>

            <div className="mt-6 text-center text-xs text-muted-foreground">
              Don't have an account?{' '}
              <Link href="/waitlist" className="font-medium text-emerald-600 hover:underline">
                Join the waitlist
              </Link>
            </div>
          </CardContent>
        </Card>
      </motion.div>
    </div>
  );
}
