'use client';

import { useState } from 'react';
import Link from 'next/link';
import { motion } from 'framer-motion';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Separator } from '@/components/ui/separator';
import { toast } from 'sonner';
import { Layers, Loader2, CheckCircle2, ArrowLeft, PartyPopper } from 'lucide-react';

const ACCOUNT_TYPES = [
  { value: 'MERCHANT', label: 'Merchant — accept payments' },
  { value: 'LP', label: 'Liquidity Provider — supply capital' },
  { value: 'DEVELOPER', label: 'Developer — build on the API' },
  { value: 'CUSTOMER', label: 'Customer — send payments' },
  { value: 'OTHER', label: 'Other' },
];

const MONTHLY_VOLUMES = [
  { value: '<10K', label: 'Less than $10K' },
  { value: '10K-100K', label: '$10K – $100K' },
  { value: '100K-1M', label: '$100K – $1M' },
  { value: '>1M', label: 'More than $1M' },
];

// A pragmatic subset of countries — covers PaySwap's core African markets
// plus major global corridors so international applicants aren't blocked.
const COUNTRIES = [
  'Ghana', 'Kenya', 'Nigeria', 'South Africa', 'Uganda', 'Tanzania',
  'Rwanda', 'Egypt', 'Morocco', 'Tunisia', 'Algeria', 'Ethiopia',
  'Senegal', 'Côte d\'Ivoire', 'Cameroon', 'Zambia', 'Zimbabwe', 'Mozambique',
  'Botswana', 'Namibia', 'Mauritius', 'Madagascar', 'DRC', 'Angola',
  'United States', 'United Kingdom', 'Canada', 'Germany', 'France',
  'Netherlands', 'Spain', 'Italy', 'Switzerland', 'Sweden', 'Norway',
  'Denmark', 'Finland', 'Belgium', 'Austria', 'Ireland', 'Portugal',
  'United Arab Emirates', 'Saudi Arabia', 'Qatar', 'Israel', 'Turkey',
  'India', 'Singapore', 'Hong Kong', 'Japan', 'South Korea', 'China',
  'Australia', 'New Zealand', 'Brazil', 'Mexico', 'Argentina', 'Chile',
  'Colombia', 'Peru',
  'Other',
];

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export default function WaitlistSignupPage() {
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [form, setForm] = useState({
    name: '',
    email: '',
    company: '',
    country: '',
    accountType: '',
    useCase: '',
    monthlyVolume: '',
    referralSource: '',
  });

  function update<K extends keyof typeof form>(key: K, value: string) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();

    // Client-side validation
    if (!form.name.trim()) {
      toast.error('Full name is required');
      return;
    }
    if (!form.email.trim() || !EMAIL_RE.test(form.email.trim())) {
      toast.error('A valid email is required');
      return;
    }
    if (!form.country) {
      toast.error('Please select your country');
      return;
    }
    if (!form.accountType) {
      toast.error('Please select an account type');
      return;
    }

    setSubmitting(true);
    try {
      const res = await fetch('/api/waitlist', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      });
      const data = await res.json().catch(() => ({}));

      if (!res.ok) {
        if (res.status === 409) {
          // Already on waitlist — treat as a soft success.
          setSubmitted(true);
          toast.success("You're already on the waitlist!");
          return;
        }
        throw new Error(data?.error || 'Failed to join waitlist');
      }

      setSubmitted(true);
      toast.success("You're on the waitlist!", {
        description: 'We will review your application and email you when your account is ready.',
      });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to join waitlist');
    } finally {
      setSubmitting(false);
    }
  }

  // ── Success screen ──
  if (submitted) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-background via-background to-emerald-500/5 p-4">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4 }}
          className="w-full max-w-md"
        >
          <Card className="border-emerald-500/20 shadow-xl">
            <CardContent className="pt-8 pb-8 text-center">
              <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-emerald-500/10">
                <PartyPopper className="h-7 w-7 text-emerald-600" />
              </div>
              <h2 className="text-xl font-bold">You&apos;re on the waitlist!</h2>
              <p className="mt-2 text-sm text-muted-foreground">
                Thanks for your interest in PaySwap. Our team will review your
                application and email{' '}
                <span className="font-medium text-foreground">{form.email}</span>{' '}
                when your account is ready.
              </p>
              <div className="mt-6 rounded-lg border bg-muted/30 p-3 text-left text-xs text-muted-foreground">
                <div className="mb-1 flex items-center gap-1.5 font-medium text-foreground">
                  <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" />
                  What happens next
                </div>
                <ul className="ml-5 list-disc space-y-1">
                  <li>We review applications in batches (1–3 business days).</li>
                  <li>Once approved, you&apos;ll get an email with a sign-up link.</li>
                  <li>Set your password and start using PaySwap.</li>
                </ul>
              </div>
              <Button asChild className="mt-6 w-full bg-emerald-600 hover:bg-emerald-700">
                <Link href="/login">Back to sign in</Link>
              </Button>
            </CardContent>
          </Card>
        </motion.div>
      </div>
    );
  }

  // ── Form screen ──
  return (
    <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-background via-background to-emerald-500/5 p-4">
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4 }}
        className="w-full max-w-2xl"
      >
        {/* Logo */}
        <div className="mb-6 flex flex-col items-center">
          <Link href="/" className="flex items-center gap-2.5">
            <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-gradient-to-br from-emerald-500 to-teal-600 text-white shadow-lg">
              <Layers className="h-6 w-6" />
            </div>
          </Link>
          <h1 className="mt-4 text-2xl font-bold tracking-tight">Join the PaySwap waitlist</h1>
          <p className="mt-1 text-center text-sm text-muted-foreground">
            We&apos;re rolling out access in batches. Tell us about yourself and we&apos;ll
            email you when your account is ready.
          </p>
        </div>

        <Card className="border-emerald-500/10 shadow-xl">
          <CardHeader>
            <CardTitle className="text-lg">Waitlist application</CardTitle>
            <CardDescription>
              All fields marked <span className="text-rose-500">*</span> are required.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit} className="space-y-5">
              {/* Name + Email */}
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label htmlFor="name">
                    Full name <span className="text-rose-500">*</span>
                  </Label>
                  <Input
                    id="name"
                    value={form.name}
                    onChange={(e) => update('name', e.target.value)}
                    placeholder="Jane Doe"
                    required
                    maxLength={120}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="email">
                    Email <span className="text-rose-500">*</span>
                  </Label>
                  <Input
                    id="email"
                    type="email"
                    value={form.email}
                    onChange={(e) => update('email', e.target.value)}
                    placeholder="jane@company.com"
                    required
                    maxLength={200}
                  />
                </div>
              </div>

              {/* Company + Country */}
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label htmlFor="company">Company / business name</Label>
                  <Input
                    id="company"
                    value={form.company}
                    onChange={(e) => update('company', e.target.value)}
                    placeholder="Acme Ltd. (optional)"
                    maxLength={200}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="country">
                    Country <span className="text-rose-500">*</span>
                  </Label>
                  <Select
                    value={form.country}
                    onValueChange={(v) => update('country', v)}
                  >
                    <SelectTrigger id="country">
                      <SelectValue placeholder="Select country" />
                    </SelectTrigger>
                    <SelectContent className="max-h-72">
                      {COUNTRIES.map((c) => (
                        <SelectItem key={c} value={c}>
                          {c}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              {/* Account type + monthly volume */}
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label htmlFor="accountType">
                    Account type <span className="text-rose-500">*</span>
                  </Label>
                  <Select
                    value={form.accountType}
                    onValueChange={(v) => update('accountType', v)}
                  >
                    <SelectTrigger id="accountType">
                      <SelectValue placeholder="Select account type" />
                    </SelectTrigger>
                    <SelectContent>
                      {ACCOUNT_TYPES.map((t) => (
                        <SelectItem key={t.value} value={t.value}>
                          {t.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="monthlyVolume">Estimated monthly volume</Label>
                  <Select
                    value={form.monthlyVolume}
                    onValueChange={(v) => update('monthlyVolume', v)}
                  >
                    <SelectTrigger id="monthlyVolume">
                      <SelectValue placeholder="Select range (optional)" />
                    </SelectTrigger>
                    <SelectContent>
                      {MONTHLY_VOLUMES.map((v) => (
                        <SelectItem key={v.value} value={v.value}>
                          {v.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              {/* Use case */}
              <div className="space-y-1.5">
                <Label htmlFor="useCase">What do you want to use PaySwap for?</Label>
                <Textarea
                  id="useCase"
                  value={form.useCase}
                  onChange={(e) => update('useCase', e.target.value)}
                  placeholder="e.g. Accept mobile money payments from customers across East Africa and settle to my bank account in USD."
                  rows={4}
                  maxLength={2000}
                />
                <p className="text-[11px] text-muted-foreground">
                  The more context you give us, the faster we can prioritise your
                  application.
                </p>
              </div>

              {/* Referral */}
              <div className="space-y-1.5">
                <Label htmlFor="referralSource">How did you hear about us?</Label>
                <Input
                  id="referralSource"
                  value={form.referralSource}
                  onChange={(e) => update('referralSource', e.target.value)}
                  placeholder="Twitter, a friend, an event… (optional)"
                  maxLength={200}
                />
              </div>

              <Separator />

              <div className="flex flex-col-reverse gap-3 sm:flex-row sm:items-center sm:justify-between">
                <Button asChild type="button" variant="ghost" size="sm">
                  <Link href="/login" className="gap-1.5">
                    <ArrowLeft className="h-3.5 w-3.5" />
                    Back to sign in
                  </Link>
                </Button>
                <Button
                  type="submit"
                  disabled={submitting}
                  className="gap-2 bg-emerald-600 hover:bg-emerald-700 sm:w-auto"
                >
                  {submitting ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin" />
                      Submitting…
                    </>
                  ) : (
                    'Join the waitlist'
                  )}
                </Button>
              </div>

              <p className="text-center text-[11px] text-muted-foreground">
                By joining the waitlist you agree to PaySwap&apos;s Terms of Service
                and Privacy Policy. We&apos;ll only email you about your application.
              </p>
            </form>
          </CardContent>
        </Card>
      </motion.div>
    </div>
  );
}
