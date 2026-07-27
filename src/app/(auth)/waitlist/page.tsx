'use client';

import { useState } from 'react';
import Link from 'next/link';
import { motion } from 'framer-motion';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { toast } from 'sonner';
import {
  Layers, Loader2, ArrowRight, ArrowLeft, CheckCircle2, Sparkles,
} from 'lucide-react';

const businessTypes = [
  { value: 'INDIVIDUAL', label: 'Individual / Sole trader' },
  { value: 'SMALL_BUSINESS', label: 'Small business' },
  { value: 'STARTUP', label: 'Startup' },
  { value: 'ENTERPRISE', label: 'Enterprise' },
  { value: 'NGO', label: 'NGO / Non-profit' },
];

const countries = [
  'Ghana', 'Nigeria', 'Kenya', 'South Africa', 'Rwanda', 'Uganda',
  'Tanzania', 'Egypt', 'Morocco', 'Senegal', 'Côte d\'Ivoire', 'Other',
];

export default function WaitlistPage() {
  const [submitting, setSubmitting] = useState(false);
  const [success, setSuccess] = useState(false);
  const [form, setForm] = useState({
    company: '', name: '', email: '', phone: '', country: '', businessType: '',
  });

  const update = (key: keyof typeof form, value: string) =>
    setForm((prev) => ({ ...prev, [key]: value }));

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.email || !form.name || !form.country) {
      toast.error('Name, email and country are required.');
      return;
    }
    setSubmitting(true);
    try {
      const res = await fetch('/api/waitlist', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j.error || 'Failed to join waitlist');
      }
      setSuccess(true);
      toast.success("You're on the waitlist!");
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to join waitlist';
      toast.error(msg);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-background via-background to-emerald-500/5 p-4">
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4 }}
        className="w-full max-w-lg"
      >
        {/* Logo */}
        <div className="mb-8 flex flex-col items-center">
          <Link href="/" className="flex items-center gap-2.5">
            <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-gradient-to-br from-emerald-500 to-teal-600 text-white shadow-lg">
              <Layers className="h-6 w-6" />
            </div>
          </Link>
          <h1 className="mt-4 text-2xl font-bold tracking-tight">Join the PaySwap waitlist</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            We&apos;re onboarding select merchants each week.
          </p>
        </div>

        {success ? (
          <Card className="border-emerald-500/20 shadow-xl">
            <CardContent className="flex flex-col items-center px-6 py-10 text-center">
              <div className="flex h-14 w-14 items-center justify-center rounded-full bg-emerald-500/10 text-emerald-600 dark:text-emerald-400">
                <CheckCircle2 className="h-7 w-7" />
              </div>
              <h2 className="mt-4 text-xl font-semibold">You&apos;re on the waitlist!</h2>
              <p className="mt-2 max-w-sm text-sm text-muted-foreground">
                Thanks for your interest, {form.name.split(' ')[0] || 'there'}. Our team will reach
                out to <span className="font-medium text-foreground">{form.email}</span> within 2–3
                business days with the next steps.
              </p>
              <div className="mt-6 flex flex-col gap-2 sm:flex-row">
                <Button asChild variant="outline">
                  <Link href="/">
                    <ArrowLeft className="h-4 w-4" /> Back to home
                  </Link>
                </Button>
                <Button asChild className="bg-emerald-600 text-white hover:bg-emerald-700">
                  <Link href="/login">
                    Sign in <ArrowRight className="h-4 w-4" />
                  </Link>
                </Button>
              </div>
            </CardContent>
          </Card>
        ) : (
          <Card className="border-emerald-500/10 shadow-xl">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-lg">
                <Sparkles className="h-4 w-4 text-emerald-500" />
                Tell us about your business
              </CardTitle>
              <CardDescription>
                We&apos;ll review your application and reach out with next steps.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <form onSubmit={handleSubmit} className="space-y-4">
                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="space-y-2">
                    <Label htmlFor="name">Full name *</Label>
                    <Input
                      id="name"
                      value={form.name}
                      onChange={(e) => update('name', e.target.value)}
                      placeholder="Kwame Asante"
                      required
                      className="h-10"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="company">Company</Label>
                    <Input
                      id="company"
                      value={form.company}
                      onChange={(e) => update('company', e.target.value)}
                      placeholder="Accra Coffee Co."
                      className="h-10"
                    />
                  </div>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="email">Work email *</Label>
                  <Input
                    id="email"
                    type="email"
                    value={form.email}
                    onChange={(e) => update('email', e.target.value)}
                    placeholder="you@company.com"
                    required
                    className="h-10"
                  />
                </div>

                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="space-y-2">
                    <Label htmlFor="phone">Phone</Label>
                    <Input
                      id="phone"
                      value={form.phone}
                      onChange={(e) => update('phone', e.target.value)}
                      placeholder="+233 24 000 0000"
                      className="h-10"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="country">Country *</Label>
                    <Select value={form.country} onValueChange={(v) => update('country', v)}>
                      <SelectTrigger id="country" className="h-10">
                        <SelectValue placeholder="Select country" />
                      </SelectTrigger>
                      <SelectContent>
                        {countries.map((c) => (
                          <SelectItem key={c} value={c}>{c}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="businessType">Business type</Label>
                  <Select value={form.businessType} onValueChange={(v) => update('businessType', v)}>
                    <SelectTrigger id="businessType" className="h-10">
                      <SelectValue placeholder="Select business type" />
                    </SelectTrigger>
                    <SelectContent>
                      {businessTypes.map((b) => (
                        <SelectItem key={b.value} value={b.value}>{b.label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <Button
                  type="submit"
                  disabled={submitting}
                  className="h-10 w-full bg-emerald-600 text-white hover:bg-emerald-700"
                >
                  {submitting ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <>Join the waitlist <ArrowRight className="h-4 w-4" /></>
                  )}
                </Button>

                <div className="text-center text-xs text-muted-foreground">
                  Already have an account?{' '}
                  <Link href="/login" className="font-medium text-emerald-600 hover:underline">
                    Sign in
                  </Link>
                </div>
              </form>
            </CardContent>
          </Card>
        )}

        <div className="mt-6 text-center">
          <Button asChild variant="ghost" size="sm">
            <Link href="/">
              <ArrowLeft className="h-3.5 w-3.5" /> Back to home
            </Link>
          </Button>
        </div>
      </motion.div>
    </div>
  );
}
