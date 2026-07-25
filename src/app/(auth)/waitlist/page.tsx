'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { motion } from 'framer-motion';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { toast } from 'sonner';
import { Layers, CheckCircle2, Loader2, ArrowLeft } from 'lucide-react';

export default function WaitlistPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(false);
  const [form, setForm] = useState({ name: '', email: '', company: '', phone: '', country: 'Ghana', businessType: 'SMALL_BUSINESS' });

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    try {
      const res = await fetch('/api/waitlist', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(form) });
      if (res.ok) { setDone(true); toast.success("You're on the waitlist!"); }
      else { const d = await res.json(); toast.error(d.error || 'Failed'); }
    } catch { toast.error('Failed'); }
    setLoading(false);
  };

  if (done) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-background via-background to-emerald-500/5 p-4">
        <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} className="w-full max-w-md text-center">
          <div className="mx-auto mb-6 flex h-16 w-16 items-center justify-center rounded-full bg-emerald-500/10"><CheckCircle2 className="h-8 w-8 text-emerald-600" /></div>
          <h1 className="text-2xl font-bold">You're on the waitlist!</h1>
          <p className="mt-2 text-sm text-muted-foreground">We'll review your application and reach out soon. Check your email for confirmation.</p>
          <Button asChild className="mt-6 bg-emerald-600 hover:bg-emerald-700 text-white"><Link href="/login">Back to login</Link></Button>
        </motion.div>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-background via-background to-emerald-500/5 p-4">
      <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="w-full max-w-md">
        <div className="mb-6 flex flex-col items-center">
          <Link href="/" className="flex items-center gap-2.5 mb-4">
            <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-gradient-to-br from-emerald-500 to-teal-600 text-white shadow-lg"><Layers className="h-6 w-6" /></div>
          </Link>
          <h1 className="text-2xl font-bold tracking-tight">Join the waitlist</h1>
          <p className="mt-1 text-sm text-muted-foreground">Tell us about your business</p>
        </div>
        <Card className="border-emerald-500/10 shadow-xl">
          <CardContent className="pt-6">
            <form onSubmit={submit} className="space-y-4">
              <div className="space-y-2"><Label htmlFor="name">Full Name *</Label><Input id="name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required className="h-10" /></div>
              <div className="space-y-2"><Label htmlFor="email">Email *</Label><Input id="email" type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} required className="h-10" /></div>
              <div className="space-y-2"><Label htmlFor="company">Company</Label><Input id="company" value={form.company} onChange={(e) => setForm({ ...form, company: e.target.value })} className="h-10" /></div>
              <div className="space-y-2"><Label htmlFor="phone">Phone</Label><Input id="phone" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} className="h-10" /></div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-2"><Label htmlFor="country">Country *</Label><Input id="country" value={form.country} onChange={(e) => setForm({ ...form, country: e.target.value })} required className="h-10" /></div>
                <div className="space-y-2"><Label>Business Type</Label>
                  <Select value={form.businessType} onValueChange={(v) => setForm({ ...form, businessType: v })}>
                    <SelectTrigger className="h-10"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="INDIVIDUAL">Individual</SelectItem>
                      <SelectItem value="SMALL_BUSINESS">Small Business</SelectItem>
                      <SelectItem value="ENTERPRISE">Enterprise</SelectItem>
                      <SelectItem value="STARTUP">Startup</SelectItem>
                      <SelectItem value="NGO">NGO</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <Button type="submit" disabled={loading} className="w-full h-10 bg-emerald-600 hover:bg-emerald-700 text-white">{loading ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Join waitlist'}</Button>
            </form>
            <div className="mt-4 text-center"><Link href="/" className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"><ArrowLeft className="h-3 w-3" /> Back to home</Link></div>
          </CardContent>
        </Card>
      </motion.div>
    </div>
  );
}
