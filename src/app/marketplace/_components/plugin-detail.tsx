'use client';

import * as React from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  ArrowLeft,
  ArrowRight,
  CheckCircle2,
  Download,
  ExternalLink,
  Globe2,
  Loader2,
  Lock,
  Package,
  Puzzle,
  ShieldCheck,
  ShieldAlert,
  Sparkles,
  Star,
  TrendingUp,
  Users,
} from 'lucide-react';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Checkbox } from '@/components/ui/checkbox';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Textarea } from '@/components/ui/textarea';
import {
  PERMISSION_LABELS,
  type PublicPlugin,
  type PluginReview,
} from '@/marketplace/types';

interface Props {
  plugin: PublicPlugin;
  reviews: PluginReview[];
  dependencies: PublicPlugin[];
  installState: { status: string; installId: string } | null;
}

export function PluginDetailClient({ plugin, reviews, dependencies, installState }: Props) {
  const router = useRouter();
  const [installing, setInstalling] = React.useState(false);
  const [installOpen, setInstallOpen] = React.useState(false);
  const [granted, setGranted] = React.useState<string[]>(plugin.permissions);
  const [reviewOpen, setReviewOpen] = React.useState(false);
  const [reviewRating, setReviewRating] = React.useState(5);
  [reviewRating];
  const [reviewComment, setReviewComment] = React.useState('');
  const [submittingReview, setSubmittingReview] = React.useState(false);

  const onInstall = async () => {
    setInstalling(true);
    try {
      const res = await fetch(`/api/marketplace/${plugin.id}/install`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ permissionsGranted: granted }),
      });
      const json = await res.json();
      if (!res.ok || !json.ok) {
        toast.error(json.error ?? 'Install failed');
        return;
      }
      toast.success('Plugin installed');
      setInstallOpen(false);
      router.refresh();
    } catch (err) {
      toast.error('Install failed');
    } finally {
      setInstalling(false);
    }
  };

  const onSubmitReview = async () => {
    setSubmittingReview(true);
    try {
      const res = await fetch(`/api/marketplace/${plugin.id}/review`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rating: reviewRating, comment: reviewComment }),
      });
      const json = await res.json();
      if (!res.ok || !json.ok) {
        toast.error(json.error ?? 'Review failed');
        return;
      }
      toast.success('Review submitted');
      setReviewOpen(false);
      setReviewComment('');
      router.refresh();
    } catch {
      toast.error('Review failed');
    } finally {
      setSubmittingReview(false);
    }
  };

  return (
    <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6">
      {/* Header */}
      <div className="grid gap-6 lg:grid-cols-[1fr_360px]">
        <div>
          <div className="flex items-start gap-4">
            <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-xl bg-emerald-500/10 text-emerald-600 dark:text-emerald-400">
              <Puzzle className="h-8 w-8" />
            </div>
            <div className="flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">{plugin.name}</h1>
                {plugin.featured && (
                  <Badge className="bg-amber-500/15 text-amber-600 dark:text-amber-400">
                    <Sparkles className="h-3 w-3" /> Featured
                  </Badge>
                )}
                {plugin.verification?.status === 'passed' && (
                  <Badge className="bg-emerald-500/15 text-emerald-600 dark:text-emerald-400">
                    <ShieldCheck className="h-3 w-3" /> Verified
                  </Badge>
                )}
              </div>
              <p className="mt-1 text-sm text-muted-foreground">{plugin.description}</p>
              <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
                <span className="inline-flex items-center gap-1">
                  <Star className="h-3.5 w-3.5 text-amber-500" />
                  {plugin.rating > 0 ? plugin.rating.toFixed(1) : 'New'} ({plugin.reviewCount})
                </span>
                <span className="inline-flex items-center gap-1">
                  <Download className="h-3.5 w-3.5" />
                  {plugin.installCount} installs
                </span>
                <span>v{plugin.version}</span>
                <Link
                  href={`/marketplace/developer/${plugin.developerId}`}
                  className="inline-flex items-center gap-1 text-emerald-600 hover:underline dark:text-emerald-400"
                >
                  by {plugin.developerName}
                  {plugin.developerVerified && (
                    <ShieldCheck className="h-3 w-3" />
                  )}
                </Link>
              </div>
            </div>
          </div>

          {/* Tabs */}
          <Tabs defaultValue="overview" className="mt-6">
            <TabsList>
              <TabsTrigger value="overview">Overview</TabsTrigger>
              <TabsTrigger value="capabilities">Capabilities</TabsTrigger>
              <TabsTrigger value="permissions">Permissions</TabsTrigger>
              <TabsTrigger value="versions">Versions</TabsTrigger>
              <TabsTrigger value="reviews">
                Reviews ({plugin.reviewCount})
              </TabsTrigger>
            </TabsList>

            <TabsContent value="overview" className="mt-4 space-y-4">
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">About this plugin</CardTitle>
                </CardHeader>
                <CardContent>
                  <p className="whitespace-pre-line text-sm text-muted-foreground">
                    {plugin.longDescription || plugin.description}
                  </p>
                </CardContent>
              </Card>

              {plugin.screenshots.length > 0 && (
                <Card>
                  <CardHeader>
                    <CardTitle className="text-base">Screenshots</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="grid gap-3 sm:grid-cols-2">
                      {plugin.screenshots.map((s, i) => (
                        <figure
                          key={i}
                          className="overflow-hidden rounded-lg border bg-muted/40"
                        >
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img
                            src={s.url}
                            alt={s.caption}
                            className="aspect-video w-full object-cover"
                          />
                          <figcaption className="p-2 text-xs text-muted-foreground">
                            {s.caption}
                          </figcaption>
                        </figure>
                      ))}
                    </div>
                  </CardContent>
                </Card>
              )}

              {dependencies.length > 0 && (
                <Card>
                  <CardHeader>
                    <CardTitle className="text-base">Dependencies</CardTitle>
                    <CardDescription>
                      This plugin requires these other plugins to be installed.
                    </CardDescription>
                  </CardHeader>
                  <CardContent>
                    <ul className="space-y-2">
                      {dependencies.map((d) => (
                        <li key={d.id}>
                          <Link
                            href={`/marketplace/plugin/${d.slug}`}
                            className="flex items-center gap-2 rounded-md border p-2 hover:bg-muted/40"
                          >
                            <Package className="h-4 w-4 text-muted-foreground" />
                            <span className="text-sm font-medium">{d.name}</span>
                            <span className="text-xs text-muted-foreground">v{d.version}</span>
                            <ArrowRight className="ml-auto h-3.5 w-3.5 text-muted-foreground" />
                          </Link>
                        </li>
                      ))}
                    </ul>
                  </CardContent>
                </Card>
              )}
            </TabsContent>

            <TabsContent value="capabilities" className="mt-4">
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">Declared capabilities</CardTitle>
                  <CardDescription>
                    What this plugin provides to the PaySwap runtime.
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  {plugin.capabilities.length === 0 ? (
                    <p className="text-sm text-muted-foreground">No capabilities declared.</p>
                  ) : (
                    <ul className="space-y-2">
                      {plugin.capabilities.map((c) => (
                        <li
                          key={c.id}
                          className="flex items-start gap-3 rounded-md border p-3"
                        >
                          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-emerald-500/10 text-emerald-600 dark:text-emerald-400">
                            <Sparkles className="h-4 w-4" />
                          </div>
                          <div className="flex-1">
                            <div className="flex flex-wrap items-center gap-2">
                              <span className="text-sm font-semibold">{c.name}</span>
                              <Badge variant="outline" className="text-[10px]">
                                {c.type}
                              </Badge>
                              <code className="text-[10px] text-muted-foreground">{c.id}</code>
                            </div>
                            {c.config && Object.keys(c.config).length > 0 && (
                              <pre className="mt-2 overflow-x-auto rounded bg-muted/40 p-2 text-[10px]">
                                {JSON.stringify(c.config, null, 2)}
                              </pre>
                            )}
                          </div>
                        </li>
                      ))}
                    </ul>
                  )}
                </CardContent>
              </Card>
            </TabsContent>

            <TabsContent value="permissions" className="mt-4">
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">Permissions required</CardTitle>
                  <CardDescription>
                    The plugin needs these permissions to function. You consent
                    to all of them at install time.
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  {plugin.permissions.length === 0 ? (
                    <p className="text-sm text-muted-foreground">
                      This plugin requires no permissions.
                    </p>
                  ) : (
                    <ul className="space-y-2">
                      {plugin.permissions.map((p) => {
                        const dangerous = [
                          'payments:write',
                          'payouts:write',
                          'wallets:write',
                          'ledger:write',
                          'treasury:write',
                          'compliance:write',
                          'runtime:write',
                        ].includes(p);
                        return (
                          <li
                            key={p}
                            className="flex items-center gap-3 rounded-md border p-3"
                          >
                            {dangerous ? (
                              <ShieldAlert className="h-4 w-4 text-amber-500" />
                            ) : (
                              <Lock className="h-4 w-4 text-muted-foreground" />
                            )}
                            <div className="flex-1">
                              <div className="text-sm font-medium">
                                {PERMISSION_LABELS[p] ?? p}
                              </div>
                              <code className="text-[10px] text-muted-foreground">{p}</code>
                            </div>
                            {dangerous && (
                              <Badge className="bg-amber-500/15 text-amber-600 dark:text-amber-400">
                                Sensitive
                              </Badge>
                            )}
                          </li>
                        );
                      })}
                    </ul>
                  )}
                </CardContent>
              </Card>
            </TabsContent>

            <TabsContent value="versions" className="mt-4">
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">Version history</CardTitle>
                </CardHeader>
                <CardContent>
                  {plugin.changelog.length === 0 ? (
                    <p className="text-sm text-muted-foreground">No version history.</p>
                  ) : (
                    <ScrollArea className="max-h-96">
                      <ul className="space-y-3">
                        {plugin.changelog.map((v, i) => (
                          <li key={i} className="rounded-md border p-3">
                            <div className="flex items-center gap-2">
                              <Badge variant="outline">v{v.version}</Badge>
                              <span className="text-xs text-muted-foreground">
                                {new Date(v.date).toLocaleDateString()}
                              </span>
                            </div>
                            <p className="mt-1 text-sm">{v.changes}</p>
                          </li>
                        ))}
                      </ul>
                    </ScrollArea>
                  )}
                </CardContent>
              </Card>
            </TabsContent>

            <TabsContent value="reviews" className="mt-4 space-y-4">
              <Card>
                <CardHeader className="flex-row items-center justify-between">
                  <CardTitle className="text-base">Reviews</CardTitle>
                  <Dialog open={reviewOpen} onOpenChange={setReviewOpen}>
                    <DialogTrigger asChild>
                      <Button size="sm" variant="outline">
                        Write a review
                      </Button>
                    </DialogTrigger>
                    <DialogContent>
                      <DialogHeader>
                        <DialogTitle>Review {plugin.name}</DialogTitle>
                        <DialogDescription>
                          Share your experience. You must have installed the
                          plugin to review it.
                        </DialogDescription>
                      </DialogHeader>
                      <div className="space-y-3 py-2">
                        <div>
                          <label className="text-xs font-medium">Rating</label>
                          <div className="mt-1 flex gap-1">
                            {[1, 2, 3, 4, 5].map((n) => (
                              <button
                                key={n}
                                type="button"
                                onClick={() => setReviewRating(n)}
                                className="rounded p-1 hover:bg-muted"
                              >
                                <Star
                                  className={`h-5 w-5 ${
                                    n <= reviewRating
                                      ? 'fill-amber-500 text-amber-500'
                                      : 'text-muted-foreground'
                                  }`}
                                />
                              </button>
                            ))}
                          </div>
                        </div>
                        <div>
                          <label className="text-xs font-medium">Comment</label>
                          <Textarea
                            value={reviewComment}
                            onChange={(e) => setReviewComment(e.target.value)}
                            placeholder="What did you like? What could be better?"
                            className="mt-1 min-h-20"
                          />
                        </div>
                      </div>
                      <DialogFooter>
                        <Button
                          variant="outline"
                          onClick={() => setReviewOpen(false)}
                        >
                          Cancel
                        </Button>
                        <Button
                          onClick={onSubmitReview}
                          disabled={submittingReview || reviewComment.trim().length < 3}
                        >
                          {submittingReview && (
                            <Loader2 className="h-4 w-4 animate-spin" />
                          )}
                          Submit review
                        </Button>
                      </DialogFooter>
                    </DialogContent>
                  </Dialog>
                </CardHeader>
                <CardContent>
                  {reviews.length === 0 ? (
                    <p className="text-sm text-muted-foreground">
                      No reviews yet. Be the first!
                    </p>
                  ) : (
                    <ScrollArea className="max-h-96">
                      <ul className="space-y-3">
                        {reviews.map((r) => (
                          <li key={r.id} className="rounded-md border p-3">
                            <div className="flex items-center gap-2">
                              <div className="flex">
                                {Array.from({ length: 5 }).map((_, i) => (
                                  <Star
                                    key={i}
                                    className={`h-3.5 w-3.5 ${
                                      i < r.rating
                                        ? 'fill-amber-500 text-amber-500'
                                        : 'text-muted-foreground'
                                    }`}
                                  />
                                ))}
                              </div>
                              <span className="text-sm font-medium">{r.userName}</span>
                              <span className="ml-auto text-xs text-muted-foreground">
                                {new Date(r.createdAt).toLocaleDateString()}
                              </span>
                            </div>
                            <p className="mt-1 text-sm text-muted-foreground">
                              {r.comment}
                            </p>
                          </li>
                        ))}
                      </ul>
                    </ScrollArea>
                  )}
                </CardContent>
              </Card>
            </TabsContent>
          </Tabs>
        </div>

        {/* Sidebar */}
        <aside className="space-y-4">
          <Card>
            <CardContent className="p-5">
              <div className="text-2xl font-bold">{plugin.pricing.summary}</div>
              <p className="mt-1 text-xs text-muted-foreground">
                {plugin.pricing.model === 'free' && 'Free forever — no usage limits.'}
                {plugin.pricing.model === 'one-time' && 'One-time purchase.'}
                {plugin.pricing.model === 'subscription' && 'Billed monthly.'}
                {plugin.pricing.model === 'usage-based' && 'Pay only for what you use.'}
              </p>
              {plugin.pricing.freeTier && (
                <p className="mt-2 text-xs text-emerald-600 dark:text-emerald-400">
                  Free tier: {plugin.pricing.freeTier}
                </p>
              )}

              <Separator className="my-4" />

              {installState ? (
                <div className="space-y-2">
                  <Badge className="bg-emerald-500/15 text-emerald-600 dark:text-emerald-400">
                    <CheckCircle2 className="h-3 w-3" /> Installed ({installState.status})
                  </Badge>
                  <Button
                    asChild
                    className="w-full bg-emerald-600 text-white hover:bg-emerald-700"
                  >
                    <Link href="/dashboard/extensions">Manage install</Link>
                  </Button>
                </div>
              ) : (
                <Dialog open={installOpen} onOpenChange={setInstallOpen}>
                  <DialogTrigger asChild>
                    <Button className="w-full bg-emerald-600 text-white hover:bg-emerald-700">
                      <Download className="h-4 w-4" /> Install plugin
                    </Button>
                  </DialogTrigger>
                  <DialogContent>
                    <DialogHeader>
                      <DialogTitle>Install {plugin.name}</DialogTitle>
                      <DialogDescription>
                        Grant the requested permissions to install this plugin.
                      </DialogDescription>
                    </DialogHeader>
                    <div className="space-y-2 py-2">
                      {plugin.permissions.length === 0 ? (
                        <p className="text-sm text-muted-foreground">
                          This plugin requires no permissions.
                        </p>
                      ) : (
                        plugin.permissions.map((p) => (
                          <label
                            key={p}
                            className="flex items-center gap-3 rounded-md border p-2"
                          >
                            <Checkbox
                              checked={granted.includes(p)}
                              onCheckedChange={(c) => {
                                setGranted((g) =>
                                  c ? [...g, p] : g.filter((x) => x !== p),
                                );
                              }}
                            />
                            <div>
                              <div className="text-sm font-medium">
                                {PERMISSION_LABELS[p] ?? p}
                              </div>
                              <code className="text-[10px] text-muted-foreground">
                                {p}
                              </code>
                            </div>
                          </label>
                        ))
                      )}
                    </div>
                    <DialogFooter>
                      <Button
                        variant="outline"
                        onClick={() => setInstallOpen(false)}
                      >
                        Cancel
                      </Button>
                      <Button
                        onClick={onInstall}
                        disabled={installing || granted.length < plugin.permissions.length}
                        className="bg-emerald-600 text-white hover:bg-emerald-700"
                      >
                        {installing && (
                          <Loader2 className="h-4 w-4 animate-spin" />
                        )}
                        Grant & install
                      </Button>
                    </DialogFooter>
                  </DialogContent>
                </Dialog>
              )}

              <Button asChild variant="outline" className="mt-2 w-full">
                <Link href={`/marketplace/developer/${plugin.developerId}`}>
                  <Users className="h-4 w-4" /> View developer
                </Link>
              </Button>

              {plugin.documentationUrl && (
                <Button asChild variant="ghost" className="mt-2 w-full">
                  <a href={plugin.documentationUrl} target="_blank" rel="noreferrer">
                    <ExternalLink className="h-4 w-4" /> Documentation
                  </a>
                </Button>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-sm">Verification</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 text-xs">
              {plugin.verification ? (
                <>
                  <div className="flex items-center gap-2">
                    {plugin.verification.status === 'passed' ? (
                      <ShieldCheck className="h-4 w-4 text-emerald-500" />
                    ) : plugin.verification.status === 'failed' ? (
                      <ShieldAlert className="h-4 w-4 text-rose-500" />
                    ) : (
                      <ShieldAlert className="h-4 w-4 text-amber-500" />
                    )}
                    <span className="font-medium capitalize">
                      {plugin.verification.status}
                    </span>
                    <Badge variant="outline" className="ml-auto">
                      Score: {plugin.verification.score}
                    </Badge>
                  </div>
                  <p className="text-muted-foreground">
                    Ran {plugin.verification.findings.length} checks across 6 stages.
                  </p>
                </>
              ) : (
                <p className="text-muted-foreground">Not yet verified.</p>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-sm">Stats</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 text-xs">
              <Stat icon={Download} label="Installs" value={String(plugin.installCount)} />
              <Stat icon={Star} label="Rating" value={plugin.rating.toFixed(1)} />
              <Stat icon={TrendingUp} label="Reviews" value={String(plugin.reviewCount)} />
              <Stat icon={Globe2} label="Published" value={plugin.publishedAt
                ? new Date(plugin.publishedAt).toLocaleDateString()
                : '—'} />
            </CardContent>
          </Card>
        </aside>
      </div>
    </div>
  );
}

function Stat({
  icon: Icon,
  label,
  value,
}: {
  icon: typeof Star;
  label: string;
  value: string;
}) {
  return (
    <div className="flex items-center gap-2">
      <Icon className="h-3.5 w-3.5 text-muted-foreground" />
      <span className="text-muted-foreground">{label}</span>
      <span className="ml-auto font-medium">{value}</span>
    </div>
  );
}
