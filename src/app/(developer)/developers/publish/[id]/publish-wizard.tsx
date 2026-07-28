'use client';

import * as React from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  ArrowLeft,
  ArrowRight,
  CheckCircle2,
  Code2,
  DollarSign,
  Eye,
  ImageIcon,
  Info,
  Layers,
  Loader2,
  Lock,
  Save,
  Send,
  ShieldAlert,
  ShieldCheck,
  Sparkles,
  Star,
  XCircle,
  type LucideIcon,
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
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  CATEGORY_META,
  PERMISSION_LABELS,
  type MarketplaceCategory,
} from '@/marketplace';
import type {
  CapabilityDeclaration,
  CapabilityType,
  Permission,
  PluginManifest,
} from '@/sdk/types';
import type {
  PricingPlan,
  VerificationResult,
  PluginScreenshot,
} from '@/marketplace';
import type { WizardPluginData } from './page';

const CAPABILITY_TYPES: CapabilityType[] = [
  'settlement-rail',
  'wallet',
  'compliance',
  'identity',
  'analytics',
  'fraud-detection',
  'corridor-optimizer',
  'pricing-engine',
  'country',
  'stablecoin',
  'twin-token',
  'marketplace-algorithm',
  'ai-director',
  'notification',
  'custom',
];

const ALL_PERMISSIONS = Object.keys(PERMISSION_LABELS) as Permission[];

const STEPS: Array<{ n: number; label: string; icon: LucideIcon }> = [
  { n: 1, label: 'Basic info', icon: Info },
  { n: 2, label: 'Manifest', icon: Code2 },
  { n: 3, label: 'Capabilities', icon: Layers },
  { n: 4, label: 'Permissions', icon: Lock },
  { n: 5, label: 'Pricing', icon: DollarSign },
  { n: 6, label: 'Screenshots', icon: ImageIcon },
  { n: 7, label: 'Review', icon: Eye },
];

interface Props {
  plugin: WizardPluginData;
}

export function PublishWizard({ plugin }: Props) {
  const router = useRouter();
  const [step, setStep] = React.useState(1);
  const [saving, setSaving] = React.useState(false);
  const [submitting, setSubmitting] = React.useState(false);
  const [verifying, setVerifying] = React.useState(false);
  const [verification, setVerification] = React.useState<VerificationResult | null>(
    plugin.verification,
  );

  // Form state — populated from the initial plugin data.
  const [name, setName] = React.useState(plugin.name);
  const [description, setDescription] = React.useState(plugin.description);
  const [category, setCategory] = React.useState<MarketplaceCategory>(plugin.category);
  const [iconUrl, setIconUrl] = React.useState(plugin.iconUrl ?? '');
  const [version, setVersion] = React.useState(plugin.version);
  const [longDescription, setLongDescription] = React.useState(plugin.longDescription);
  const [documentationUrl, setDocumentationUrl] = React.useState(plugin.documentationUrl);
  const [supportUrl, setSupportUrl] = React.useState(plugin.supportUrl);
  const [privacyUrl, setPrivacyUrl] = React.useState(plugin.privacyUrl);
  const [termsUrl, setTermsUrl] = React.useState(plugin.termsUrl);
  const [tags, setTags] = React.useState<string[]>(plugin.tags);
  const [tagInput, setTagInput] = React.useState('');
  const [developerBio, setDeveloperBio] = React.useState(plugin.developerBio);
  const [dependencies, setDependencies] = React.useState(plugin.dependencies);

  const [manifestJson, setManifestJson] = React.useState<string>(
    plugin.manifest ? JSON.stringify(plugin.manifest, null, 2) : '',
  );
  const [manifestError, setManifestError] = React.useState<string | null>(null);

  const [capabilities, setCapabilities] = React.useState<CapabilityDeclaration[]>(
    plugin.capabilities,
  );
  const [permissions, setPermissions] = React.useState<Permission[]>(plugin.permissions);
  const [pricing, setPricing] = React.useState<PricingPlan>(plugin.pricing);
  const [screenshots, setScreenshots] = React.useState<PluginScreenshot[]>(plugin.screenshots);

  // ── Save (PATCH) ──────────────────────────────────────────────────────
  const save = async (silent = false): Promise<boolean> => {
    setSaving(true);
    try {
      // Parse manifest JSON (if present).
      let manifest: PluginManifest | undefined;
      if (manifestJson.trim()) {
        try {
          manifest = JSON.parse(manifestJson);
          setManifestError(null);
        } catch (e) {
          setManifestError(e instanceof Error ? e.message : 'Invalid JSON');
          if (!silent) toast.error('Manifest JSON is invalid');
          setSaving(false);
          return false;
        }
      }

      const res = await fetch(`/api/developer/publish/${plugin.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: name.trim(),
          description: description.trim(),
          category,
          iconUrl: iconUrl.trim() || null,
          version: version.trim(),
          longDescription,
          documentationUrl,
          supportUrl,
          privacyUrl,
          termsUrl,
          developerBio,
          tags,
          dependencies,
          manifest,
          capabilities,
          permissions,
          pricing,
          screenshots,
        }),
      });
      const json = await res.json();
      if (!res.ok || !json.ok) {
        toast.error(json.error ?? 'Save failed');
        return false;
      }
      if (!silent) toast.success('Saved');
      return true;
    } catch {
      toast.error('Save failed');
      return false;
    } finally {
      setSaving(false);
    }
  };

  // ── Verify ────────────────────────────────────────────────────────────
  const verify = async () => {
    setVerifying(true);
    try {
      let manifest: PluginManifest | undefined;
      if (manifestJson.trim()) {
        try {
          manifest = JSON.parse(manifestJson);
        } catch (e) {
          toast.error('Manifest JSON is invalid');
          setVerifying(false);
          return;
        }
      }
      const res = await fetch(`/api/developer/publish/${plugin.id}/verify`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ manifest }),
      });
      const json = await res.json();
      if (!res.ok || !json.ok) {
        toast.error(json.error ?? 'Verification failed');
        return;
      }
      setVerification(json.verification);
      toast.success(
        `Verification: ${json.verification.status} (score ${json.verification.score})`,
      );
    } catch {
      toast.error('Verification failed');
    } finally {
      setVerifying(false);
    }
  };

  // ── Submit for review ─────────────────────────────────────────────────
  const submit = async () => {
    setSubmitting(true);
    const ok = await save(true);
    if (!ok) {
      setSubmitting(false);
      return;
    }
    try {
      const res = await fetch(`/api/developer/publish/${plugin.id}/submit`, {
        method: 'POST',
      });
      const json = await res.json();
      if (!res.ok || !json.ok) {
        toast.error(json.error ?? 'Submit failed');
        return;
      }
      toast.success('Submitted for review');
      router.push('/developers/publish');
      router.refresh();
    } catch {
      toast.error('Submit failed');
    } finally {
      setSubmitting(false);
    }
  };

  const canEdit = plugin.status === 'draft' || plugin.status === 'rejected';

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between gap-4">
        <div>
          <Link
            href="/developers/publish"
            className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
          >
            <ArrowLeft className="h-3 w-3" /> Back to dashboard
          </Link>
          <h1 className="mt-1 text-2xl font-bold tracking-tight">{plugin.name}</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            <Badge className="mr-2 bg-muted text-muted-foreground">{plugin.status}</Badge>
            <span className="text-xs">slug: {plugin.slug} · v{plugin.version}</span>
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button onClick={() => save()} disabled={saving || !canEdit} variant="outline">
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
            Save draft
          </Button>
          <Button onClick={verify} disabled={verifying || !canEdit} variant="outline">
            {verifying ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <ShieldCheck className="h-4 w-4" />
            )}
            Verify
          </Button>
          <Button
            onClick={submit}
            disabled={submitting || !canEdit}
            className="bg-emerald-600 text-white hover:bg-emerald-700"
          >
            {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
            Submit for review
          </Button>
        </div>
      </div>

      {!canEdit && (
        <div className="rounded-md border border-amber-500/30 bg-amber-500/5 p-3 text-xs">
          <ShieldAlert className="mr-1.5 inline h-3.5 w-3.5 text-amber-500" />
          This plugin is in status{' '}
          <span className="font-semibold">{plugin.status}</span> and can no longer
          be edited. {plugin.status === 'published' && 'Withdraw it via the dashboard to make changes.'}
        </div>
      )}

      {/* Verification banner */}
      {verification && (
        <Card className={verification.status === 'failed' ? 'border-rose-500/40' : verification.status === 'passed' ? 'border-emerald-500/40' : 'border-amber-500/40'}>
          <CardContent className="p-4">
            <div className="flex items-center gap-3">
              {verification.status === 'passed' ? (
                <ShieldCheck className="h-5 w-5 text-emerald-500" />
              ) : verification.status === 'failed' ? (
                <XCircle className="h-5 w-5 text-rose-500" />
              ) : (
                <ShieldAlert className="h-5 w-5 text-amber-500" />
              )}
              <div className="flex-1">
                <div className="text-sm font-semibold">
                  Verification: {verification.status} (score {verification.score})
                </div>
                <div className="text-xs text-muted-foreground">
                  {verification.findings.length} finding
                  {verification.findings.length === 1 ? '' : 's'} across{' '}
                  {verification.findings.length > 0
                    ? new Set(verification.findings.map((f) => f.stage)).size
                    : 0}{' '}
                  stage(s).
                </div>
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setStep(7)}
              >
                View findings
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Stepper */}
      <div className="flex flex-wrap items-center gap-2 rounded-lg border bg-card p-3">
        {STEPS.map((s, i) => {
          const Icon = s.icon;
          const active = step === s.n;
          const done = step > s.n;
          return (
            <React.Fragment key={s.n}>
              <button
                onClick={() => setStep(s.n)}
                className={`flex items-center gap-2 rounded-md px-3 py-1.5 text-sm transition-colors ${
                  active
                    ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400'
                    : done
                      ? 'text-emerald-600 dark:text-emerald-400'
                      : 'text-muted-foreground hover:bg-muted'
                }`}
              >
                {done ? (
                  <CheckCircle2 className="h-3.5 w-3.5" />
                ) : (
                  <Icon className="h-3.5 w-3.5" />
                )}
                <span>{s.n}. {s.label}</span>
              </button>
              {i < STEPS.length - 1 && (
                <div className="h-px w-4 bg-border sm:w-8" />
              )}
            </React.Fragment>
          );
        })}
      </div>

      {/* Step content */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            Step {step}: {STEPS[step - 1].label}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {step === 1 && (
            <BasicInfoStep
              name={name}
              setName={setName}
              description={description}
              setDescription={setDescription}
              category={category}
              setCategory={setCategory}
              iconUrl={iconUrl}
              setIconUrl={setIconUrl}
              version={version}
              setVersion={setVersion}
              longDescription={longDescription}
              setLongDescription={setLongDescription}
              tags={tags}
              setTags={setTags}
              tagInput={tagInput}
              setTagInput={setTagInput}
              developerBio={developerBio}
              setDeveloperBio={setDeveloperBio}
              documentationUrl={documentationUrl}
              setDocumentationUrl={setDocumentationUrl}
              supportUrl={supportUrl}
              setSupportUrl={setSupportUrl}
              privacyUrl={privacyUrl}
              setPrivacyUrl={setPrivacyUrl}
              termsUrl={termsUrl}
              setTermsUrl={setTermsUrl}
              canEdit={canEdit}
            />
          )}
          {step === 2 && (
            <ManifestStep
              manifestJson={manifestJson}
              setManifestJson={setManifestJson}
              manifestError={manifestError}
              canEdit={canEdit}
              onSyncManifest={(m) => {
                // Sync capabilities + permissions from manifest.
                setCapabilities(m.capabilities);
                setPermissions(m.permissions);
                toast.success('Manifest parsed — capabilities and permissions synced');
              }}
            />
          )}
          {step === 3 && (
            <CapabilitiesStep
              capabilities={capabilities}
              setCapabilities={setCapabilities}
              canEdit={canEdit}
            />
          )}
          {step === 4 && (
            <PermissionsStep
              permissions={permissions}
              setPermissions={setPermissions}
              canEdit={canEdit}
            />
          )}
          {step === 5 && (
            <PricingStep pricing={pricing} setPricing={setPricing} canEdit={canEdit} />
          )}
          {step === 6 && (
            <ScreenshotsStep
              screenshots={screenshots}
              setScreenshots={setScreenshots}
              dependencies={dependencies}
              setDependencies={setDependencies}
              canEdit={canEdit}
            />
          )}
          {step === 7 && (
            <ReviewStep
              name={name}
              description={description}
              category={category}
              version={version}
              capabilities={capabilities}
              permissions={permissions}
              pricing={pricing}
              screenshots={screenshots}
              documentationUrl={documentationUrl}
              tags={tags}
              dependencies={dependencies}
              verification={verification}
              reviewNotes={plugin.reviewNotes}
            />
          )}
        </CardContent>
      </Card>

      {/* Navigation */}
      <div className="flex items-center justify-between">
        <Button
          variant="outline"
          onClick={() => setStep((s) => Math.max(1, s - 1))}
          disabled={step === 1}
        >
          <ArrowLeft className="h-4 w-4" /> Previous
        </Button>
        <div className="text-xs text-muted-foreground">
          Step {step} of {STEPS.length}
        </div>
        {step < STEPS.length ? (
          <Button onClick={() => setStep((s) => Math.min(STEPS.length, s + 1))}>
            Next <ArrowRight className="h-4 w-4" />
          </Button>
        ) : (
          <Button
            onClick={submit}
            disabled={submitting || !canEdit}
            className="bg-emerald-600 text-white hover:bg-emerald-700"
          >
            {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
            Submit for review
          </Button>
        )}
      </div>
    </div>
  );
}

// ── Step components ──────────────────────────────────────────────────────

function BasicInfoStep(props: {
  name: string;
  setName: (v: string) => void;
  description: string;
  setDescription: (v: string) => void;
  category: MarketplaceCategory;
  setCategory: (v: MarketplaceCategory) => void;
  iconUrl: string;
  setIconUrl: (v: string) => void;
  version: string;
  setVersion: (v: string) => void;
  longDescription: string;
  setLongDescription: (v: string) => void;
  tags: string[];
  setTags: (v: string[]) => void;
  tagInput: string;
  setTagInput: (v: string) => void;
  developerBio: string;
  setDeveloperBio: (v: string) => void;
  documentationUrl: string;
  setDocumentationUrl: (v: string) => void;
  supportUrl: string;
  setSupportUrl: (v: string) => void;
  privacyUrl: string;
  setPrivacyUrl: (v: string) => void;
  termsUrl: string;
  setTermsUrl: (v: string) => void;
  canEdit: boolean;
}) {
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <div className="sm:col-span-2">
        <Label htmlFor="name">Plugin name</Label>
        <Input
          id="name"
          value={props.name}
          onChange={(e) => props.setName(e.target.value)}
          disabled={!props.canEdit}
          className="mt-1"
        />
      </div>
      <div>
        <Label htmlFor="version">Version (semver)</Label>
        <Input
          id="version"
          value={props.version}
          onChange={(e) => props.setVersion(e.target.value)}
          disabled={!props.canEdit}
          placeholder="1.0.0"
          className="mt-1"
        />
      </div>
      <div>
        <Label>Category</Label>
        <Select
          value={props.category}
          onValueChange={(v) => props.setCategory(v as MarketplaceCategory)}
          disabled={!props.canEdit}
        >
          <SelectTrigger className="mt-1">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {CATEGORY_META.map((c) => (
              <SelectItem key={c.key} value={c.key}>
                {c.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="sm:col-span-2">
        <Label htmlFor="desc">Short description</Label>
        <Input
          id="desc"
          value={props.description}
          onChange={(e) => props.setDescription(e.target.value)}
          disabled={!props.canEdit}
          placeholder="One-line summary shown on cards"
          className="mt-1"
        />
      </div>
      <div className="sm:col-span-2">
        <Label htmlFor="long">Long description</Label>
        <Textarea
          id="long"
          value={props.longDescription}
          onChange={(e) => props.setLongDescription(e.target.value)}
          disabled={!props.canEdit}
          placeholder="Marketing copy shown on the plugin page"
          className="mt-1 min-h-32"
        />
      </div>
      <div className="sm:col-span-2">
        <Label htmlFor="icon">Icon URL (optional)</Label>
        <Input
          id="icon"
          value={props.iconUrl}
          onChange={(e) => props.setIconUrl(e.target.value)}
          disabled={!props.canEdit}
          placeholder="https://…"
          className="mt-1"
        />
      </div>
      <div className="sm:col-span-2">
        <Label htmlFor="tags">Tags</Label>
        <div className="mt-1 flex gap-2">
          <Input
            id="tags"
            value={props.tagInput}
            onChange={(e) => props.setTagInput(e.target.value)}
            disabled={!props.canEdit}
            placeholder="Type a tag and press Enter"
            onKeyDown={(e) => {
              if (e.key === 'Enter' && props.tagInput.trim()) {
                e.preventDefault();
                if (!props.tags.includes(props.tagInput.trim())) {
                  props.setTags([...props.tags, props.tagInput.trim()]);
                }
                props.setTagInput('');
              }
            }}
          />
          <Button
            type="button"
            variant="outline"
            disabled={!props.canEdit || !props.tagInput.trim()}
            onClick={() => {
              if (props.tagInput.trim() && !props.tags.includes(props.tagInput.trim())) {
                props.setTags([...props.tags, props.tagInput.trim()]);
              }
              props.setTagInput('');
            }}
          >
            Add
          </Button>
        </div>
        {props.tags.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-1.5">
            {props.tags.map((t) => (
              <Badge key={t} variant="outline" className="gap-1">
                {t}
                {props.canEdit && (
                  <button
                    onClick={() => props.setTags(props.tags.filter((x) => x !== t))}
                    className="ml-0.5 text-muted-foreground hover:text-foreground"
                  >
                    ×
                  </button>
                )}
              </Badge>
            ))}
          </div>
        )}
      </div>
      <div>
        <Label htmlFor="docs">Documentation URL</Label>
        <Input
          id="docs"
          value={props.documentationUrl}
          onChange={(e) => props.setDocumentationUrl(e.target.value)}
          disabled={!props.canEdit}
          placeholder="https://docs.example.com/plugin"
          className="mt-1"
        />
      </div>
      <div>
        <Label htmlFor="support">Support URL</Label>
        <Input
          id="support"
          value={props.supportUrl}
          onChange={(e) => props.setSupportUrl(e.target.value)}
          disabled={!props.canEdit}
          placeholder="https://support.example.com"
          className="mt-1"
        />
      </div>
      <div>
        <Label htmlFor="privacy">Privacy policy URL</Label>
        <Input
          id="privacy"
          value={props.privacyUrl}
          onChange={(e) => props.setPrivacyUrl(e.target.value)}
          disabled={!props.canEdit}
          className="mt-1"
        />
      </div>
      <div>
        <Label htmlFor="terms">Terms of service URL</Label>
        <Input
          id="terms"
          value={props.termsUrl}
          onChange={(e) => props.setTermsUrl(e.target.value)}
          disabled={!props.canEdit}
          className="mt-1"
        />
      </div>
      <div className="sm:col-span-2">
        <Label htmlFor="bio">Developer bio (shown on your profile)</Label>
        <Textarea
          id="bio"
          value={props.developerBio}
          onChange={(e) => props.setDeveloperBio(e.target.value)}
          disabled={!props.canEdit}
          className="mt-1 min-h-20"
        />
      </div>
    </div>
  );
}

function ManifestStep(props: {
  manifestJson: string;
  setManifestJson: (v: string) => void;
  manifestError: string | null;
  canEdit: boolean;
  onSyncManifest: (m: PluginManifest) => void;
}) {
  const [parsed, setParsed] = React.useState<PluginManifest | null>(null);

  React.useEffect(() => {
    if (!props.manifestJson.trim()) {
      setParsed(null);
      return;
    }
    try {
      const m = JSON.parse(props.manifestJson) as PluginManifest;
      setParsed(m);
    } catch {
      setParsed(null);
    }
  }, [props.manifestJson]);

  return (
    <div className="space-y-3">
      <p className="text-sm text-muted-foreground">
        Paste your <code className="rounded bg-muted px-1">PluginManifest</code> JSON
        below. The wizard validates it on save and syncs capabilities + permissions
        from the manifest.
      </p>
      <Textarea
        value={props.manifestJson}
        onChange={(e) => props.setManifestJson(e.target.value)}
        disabled={!props.canEdit}
        placeholder={`{
  "name": "${'my-plugin'}",
  "version": "1.0.0",
  "description": "…",
  "author": "…",
  "capabilities": [...],
  "permissions": [...],
  "commands": [],
  "events": [],
  "views": [],
  "policies": [],
  "dependencies": [],
  "migrations": []
}`}
        className="min-h-96 font-mono text-xs"
      />
      {props.manifestError && (
        <div className="rounded-md border border-rose-500/30 bg-rose-500/5 p-2 text-xs text-rose-600 dark:text-rose-400">
          {props.manifestError}
        </div>
      )}
      {parsed && (
        <div className="rounded-md border border-emerald-500/30 bg-emerald-500/5 p-3 text-xs">
          <div className="flex items-center gap-2 font-medium text-emerald-600 dark:text-emerald-400">
            <CheckCircle2 className="h-3.5 w-3.5" /> Manifest parsed successfully
          </div>
          <ul className="mt-2 space-y-1 text-muted-foreground">
            <li>name: <code>{parsed.name}</code></li>
            <li>version: <code>{parsed.version}</code></li>
            <li>capabilities: {parsed.capabilities.length}</li>
            <li>permissions: {parsed.permissions.length}</li>
            <li>commands: {parsed.commands.length}</li>
            <li>events: {parsed.events.length}</li>
            <li>policies: {parsed.policies.length}</li>
            <li>dependencies: {parsed.dependencies.length}</li>
          </ul>
          <Button
            size="sm"
            variant="outline"
            className="mt-2"
            disabled={!props.canEdit}
            onClick={() => props.onSyncManifest(parsed)}
          >
            Sync capabilities + permissions from manifest
          </Button>
        </div>
      )}
    </div>
  );
}

function CapabilitiesStep(props: {
  capabilities: CapabilityDeclaration[];
  setCapabilities: (v: CapabilityDeclaration[]) => void;
  canEdit: boolean;
}) {
  const add = () => {
    props.setCapabilities([
      ...props.capabilities,
      { type: 'custom', id: `cap-${Date.now()}`, name: 'New capability' },
    ]);
  };
  return (
    <div className="space-y-3">
      <p className="text-sm text-muted-foreground">
        What does this plugin provide to the PaySwap runtime? Add one capability
        per role (settlement rail, wallet, compliance module, etc.).
      </p>
      {props.capabilities.length === 0 && (
        <div className="rounded-md border border-dashed p-6 text-center text-sm text-muted-foreground">
          No capabilities yet.
        </div>
      )}
      {props.capabilities.map((c, i) => (
        <div key={i} className="rounded-md border p-3 space-y-2">
          <div className="grid gap-2 sm:grid-cols-3">
            <div>
              <Label className="text-xs">Type</Label>
              <Select
                value={c.type}
                onValueChange={(v) => {
                  const next = [...props.capabilities];
                  next[i] = { ...c, type: v as CapabilityType };
                  props.setCapabilities(next);
                }}
                disabled={!props.canEdit}
              >
                <SelectTrigger className="mt-1 h-9">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {CAPABILITY_TYPES.map((t) => (
                    <SelectItem key={t} value={t}>
                      {t}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs">ID</Label>
              <Input
                value={c.id}
                onChange={(e) => {
                  const next = [...props.capabilities];
                  next[i] = { ...c, id: e.target.value };
                  props.setCapabilities(next);
                }}
                disabled={!props.canEdit}
                className="mt-1 h-9"
              />
            </div>
            <div>
              <Label className="text-xs">Name</Label>
              <Input
                value={c.name}
                onChange={(e) => {
                  const next = [...props.capabilities];
                  next[i] = { ...c, name: e.target.value };
                  props.setCapabilities(next);
                }}
                disabled={!props.canEdit}
                className="mt-1 h-9"
              />
            </div>
          </div>
          <div>
            <Label className="text-xs">Config (JSON, optional)</Label>
            <Textarea
              value={c.config ? JSON.stringify(c.config, null, 2) : ''}
              onChange={(e) => {
                let config: Record<string, unknown> | undefined;
                try {
                  config = e.target.value.trim() ? JSON.parse(e.target.value) : undefined;
                } catch {
                  return;
                }
                const next = [...props.capabilities];
                next[i] = { ...c, config };
                props.setCapabilities(next);
              }}
              disabled={!props.canEdit}
              placeholder='{"country":"GH","currency":"GHS"}'
              className="mt-1 min-h-16 font-mono text-xs"
            />
          </div>
          {props.canEdit && (
            <Button
              size="sm"
              variant="ghost"
              className="text-rose-600 hover:text-rose-700"
              onClick={() => props.setCapabilities(props.capabilities.filter((_, j) => j !== i))}
            >
              Remove
            </Button>
          )}
        </div>
      ))}
      {props.canEdit && (
        <Button onClick={add} variant="outline" size="sm">
          <Sparkles className="h-3.5 w-3.5" /> Add capability
        </Button>
      )}
    </div>
  );
}

function PermissionsStep(props: {
  permissions: Permission[];
  setPermissions: (v: Permission[]) => void;
  canEdit: boolean;
}) {
  const toggle = (p: Permission) => {
    if (props.permissions.includes(p)) {
      props.setPermissions(props.permissions.filter((x) => x !== p));
    } else {
      props.setPermissions([...props.permissions, p]);
    }
  };
  return (
    <div className="space-y-3">
      <p className="text-sm text-muted-foreground">
        Permissions the plugin needs. Sensitive write permissions are flagged.
      </p>
      <div className="grid gap-2 sm:grid-cols-2">
        {ALL_PERMISSIONS.map((p) => {
          const checked = props.permissions.includes(p);
          const dangerous = p.endsWith(':write');
          return (
            <label
              key={p}
              className={`flex items-start gap-3 rounded-md border p-3 ${
                dangerous ? 'border-amber-500/30 bg-amber-500/5' : ''
              }`}
            >
              <Checkbox
                checked={checked}
                onCheckedChange={() => toggle(p)}
                disabled={!props.canEdit}
              />
              <div className="flex-1">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium">{PERMISSION_LABELS[p]}</span>
                  {dangerous && (
                    <Badge className="bg-amber-500/15 text-amber-600 dark:text-amber-400 text-[10px]">
                      Sensitive
                    </Badge>
                  )}
                </div>
                <code className="text-[10px] text-muted-foreground">{p}</code>
              </div>
            </label>
          );
        })}
      </div>
    </div>
  );
}

function PricingStep(props: {
  pricing: PricingPlan;
  setPricing: (v: PricingPlan) => void;
  canEdit: boolean;
}) {
  const update = (patch: Partial<PricingPlan>) => {
    props.setPricing({ ...props.pricing, ...patch });
  };
  // Auto-update summary when relevant fields change.
  React.useEffect(() => {
    const p = props.pricing;
    let summary = p.summary;
    if (p.model === 'free') summary = 'Free';
    else if (p.model === 'one-time') summary = `$${p.price ?? 0} one-time`;
    else if (p.model === 'subscription') summary = `$${p.price ?? 0}/mo`;
    else if (p.model === 'usage-based')
      summary = `$${p.pricePerKCalls ?? 0} / 1k calls`;
    if (summary !== p.summary) update({ summary });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.pricing.model, props.pricing.price, props.pricing.pricePerKCalls]);

  return (
    <div className="space-y-4">
      <div>
        <Label>Pricing model</Label>
        <Select
          value={props.pricing.model}
          onValueChange={(v) => update({ model: v as PricingPlan['model'] })}
          disabled={!props.canEdit}
        >
          <SelectTrigger className="mt-1">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="free">Free</SelectItem>
            <SelectItem value="one-time">One-time purchase</SelectItem>
            <SelectItem value="subscription">Subscription (monthly)</SelectItem>
            <SelectItem value="usage-based">Usage-based (per 1k calls)</SelectItem>
          </SelectContent>
        </Select>
      </div>
      {props.pricing.model === 'one-time' && (
        <div>
          <Label htmlFor="price">Price (USD)</Label>
          <Input
            id="price"
            type="number"
            value={props.pricing.price ?? 0}
            onChange={(e) => update({ price: Number(e.target.value) })}
            disabled={!props.canEdit}
            className="mt-1"
            min={0}
          />
        </div>
      )}
      {props.pricing.model === 'subscription' && (
        <div>
          <Label htmlFor="price">Monthly price (USD)</Label>
          <Input
            id="price"
            type="number"
            value={props.pricing.price ?? 0}
            onChange={(e) => update({ price: Number(e.target.value) })}
            disabled={!props.canEdit}
            className="mt-1"
            min={0}
          />
        </div>
      )}
      {props.pricing.model === 'usage-based' && (
        <div>
          <Label htmlFor="ppk">Price per 1,000 calls (USD)</Label>
          <Input
            id="ppk"
            type="number"
            value={props.pricing.pricePerKCalls ?? 0}
            onChange={(e) => update({ pricePerKCalls: Number(e.target.value) })}
            disabled={!props.canEdit}
            className="mt-1"
            min={0}
            step={0.01}
          />
        </div>
      )}
      <div>
        <Label htmlFor="freetier">Free tier description (optional)</Label>
        <Input
          id="freetier"
          value={props.pricing.freeTier ?? ''}
          onChange={(e) => update({ freeTier: e.target.value })}
          disabled={!props.canEdit}
          placeholder="e.g. 1,000 calls/mo"
          className="mt-1"
        />
      </div>
      <div className="rounded-md border bg-muted/40 p-3 text-sm">
        <span className="text-muted-foreground">Summary: </span>
        <span className="font-medium">{props.pricing.summary}</span>
      </div>
    </div>
  );
}

function ScreenshotsStep(props: {
  screenshots: PluginScreenshot[];
  setScreenshots: (v: PluginScreenshot[]) => void;
  dependencies: Array<{ slug: string; minVersion?: string }>;
  setDependencies: (v: Array<{ slug: string; minVersion?: string }>) => void;
  canEdit: boolean;
}) {
  const [url, setUrl] = React.useState('');
  const [caption, setCaption] = React.useState('');
  const [depSlug, setDepSlug] = React.useState('');
  const [depVer, setDepVer] = React.useState('');

  return (
    <div className="space-y-6">
      {/* Screenshots */}
      <div className="space-y-3">
        <div>
          <h3 className="text-sm font-semibold">Screenshots</h3>
          <p className="text-xs text-muted-foreground">
            Add screenshots that show what your plugin does. They appear on the
            plugin detail page.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Input
            placeholder="Image URL"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            disabled={!props.canEdit}
            className="flex-1 min-w-40"
          />
          <Input
            placeholder="Caption"
            value={caption}
            onChange={(e) => setCaption(e.target.value)}
            disabled={!props.canEdit}
            className="flex-1 min-w-40"
          />
          <Button
            type="button"
            variant="outline"
            disabled={!props.canEdit || !url.trim()}
            onClick={() => {
              props.setScreenshots([
                ...props.screenshots,
                { url: url.trim(), caption: caption.trim() || 'Screenshot' },
              ]);
              setUrl('');
              setCaption('');
            }}
          >
            Add
          </Button>
        </div>
        {props.screenshots.length > 0 && (
          <div className="grid gap-3 sm:grid-cols-2">
            {props.screenshots.map((s, i) => (
              <figure key={i} className="overflow-hidden rounded-lg border bg-muted/40">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={s.url} alt={s.caption} className="aspect-video w-full object-cover" />
                <figcaption className="flex items-center justify-between p-2 text-xs">
                  <span>{s.caption}</span>
                  {props.canEdit && (
                    <button
                      onClick={() =>
                        props.setScreenshots(props.screenshots.filter((_, j) => j !== i))
                      }
                      className="text-rose-600 hover:underline"
                    >
                      Remove
                    </button>
                  )}
                </figcaption>
              </figure>
            ))}
          </div>
        )}
      </div>

      {/* Dependencies */}
      <div className="space-y-3">
        <div>
          <h3 className="text-sm font-semibold">Dependencies</h3>
          <p className="text-xs text-muted-foreground">
            Other marketplace plugins this plugin requires. Reference them by
            slug.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Input
            placeholder="Plugin slug"
            value={depSlug}
            onChange={(e) => setDepSlug(e.target.value)}
            disabled={!props.canEdit}
            className="flex-1 min-w-40"
          />
          <Input
            placeholder="Min version (optional)"
            value={depVer}
            onChange={(e) => setDepVer(e.target.value)}
            disabled={!props.canEdit}
            className="w-40"
          />
          <Button
            type="button"
            variant="outline"
            disabled={!props.canEdit || !depSlug.trim()}
            onClick={() => {
              props.setDependencies([
                ...props.dependencies,
                { slug: depSlug.trim(), minVersion: depVer.trim() || undefined },
              ]);
              setDepSlug('');
              setDepVer('');
            }}
          >
            Add
          </Button>
        </div>
        {props.dependencies.length > 0 && (
          <ul className="space-y-1">
            {props.dependencies.map((d, i) => (
              <li
                key={i}
                className="flex items-center gap-2 rounded-md border p-2 text-sm"
              >
                <code className="text-xs">{d.slug}</code>
                {d.minVersion && (
                  <span className="text-xs text-muted-foreground">
                    ≥ v{d.minVersion}
                  </span>
                )}
                {props.canEdit && (
                  <button
                    onClick={() =>
                      props.setDependencies(props.dependencies.filter((_, j) => j !== i))
                    }
                    className="ml-auto text-rose-600 hover:underline text-xs"
                  >
                    Remove
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function ReviewStep(props: {
  name: string;
  description: string;
  category: MarketplaceCategory;
  version: string;
  capabilities: CapabilityDeclaration[];
  permissions: Permission[];
  pricing: PricingPlan;
  screenshots: PluginScreenshot[];
  documentationUrl: string;
  tags: string[];
  dependencies: Array<{ slug: string; minVersion?: string }>;
  verification: VerificationResult | null;
  reviewNotes: string | null;
}) {
  return (
    <div className="space-y-4">
      <div className="rounded-md border bg-muted/40 p-4">
        <h3 className="text-base font-semibold">{props.name}</h3>
        <p className="mt-1 text-sm text-muted-foreground">{props.description}</p>
        <div className="mt-2 flex flex-wrap gap-2 text-xs">
          <Badge variant="outline">{props.category}</Badge>
          <Badge variant="outline">v{props.version}</Badge>
          <Badge variant="outline">{props.pricing.summary}</Badge>
          {props.tags.map((t) => (
            <Badge key={t} variant="outline">{t}</Badge>
          ))}
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="rounded-md border p-3">
          <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Capabilities ({props.capabilities.length})
          </div>
          <ul className="mt-2 space-y-1 text-xs">
            {props.capabilities.map((c) => (
              <li key={c.id}>
                <span className="font-medium">{c.name}</span>
                <span className="ml-1 text-muted-foreground">({c.type})</span>
              </li>
            ))}
          </ul>
        </div>
        <div className="rounded-md border p-3">
          <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Permissions ({props.permissions.length})
          </div>
          <div className="mt-2 flex flex-wrap gap-1">
            {props.permissions.map((p) => (
              <Badge key={p} variant="outline" className="text-[10px]">
                {p}
              </Badge>
            ))}
          </div>
        </div>
        <div className="rounded-md border p-3">
          <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Screenshots ({props.screenshots.length})
          </div>
        </div>
        <div className="rounded-md border p-3">
          <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Dependencies ({props.dependencies.length})
          </div>
          {props.dependencies.length > 0 && (
            <ul className="mt-2 space-y-1 text-xs">
              {props.dependencies.map((d, i) => (
                <li key={i}>
                  <code>{d.slug}</code>
                  {d.minVersion && (
                    <span className="ml-1 text-muted-foreground">≥ v{d.minVersion}</span>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      {props.verification && (
        <div className="rounded-md border p-4">
          <h4 className="text-sm font-semibold">Verification findings</h4>
          {props.verification.findings.length === 0 ? (
            <p className="mt-1 text-xs text-emerald-600 dark:text-emerald-400">
              <CheckCircle2 className="mr-1 inline h-3.5 w-3.5" />
              No findings — clean manifest.
            </p>
          ) : (
            <ul className="mt-2 space-y-1.5">
              {props.verification.findings.map((f, i) => (
                <li key={i} className="flex items-start gap-2 text-xs">
                  {f.severity === 'error' ? (
                    <XCircle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-rose-500" />
                  ) : f.severity === 'warning' ? (
                    <ShieldAlert className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-500" />
                  ) : (
                    <Info className="mt-0.5 h-3.5 w-3.5 shrink-0 text-sky-500" />
                  )}
                  <div>
                    <span className="font-medium uppercase text-muted-foreground">
                      {f.stage}:
                    </span>{' '}
                    {f.message}
                    {f.path && (
                      <code className="ml-1 text-[10px] text-muted-foreground">
                        {f.path}
                      </code>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {props.reviewNotes && (
        <div className="rounded-md border border-rose-500/30 bg-rose-500/5 p-3 text-xs">
          <div className="font-medium text-rose-600 dark:text-rose-400">
            Previous reviewer feedback:
          </div>
          <p className="mt-1 text-muted-foreground">{props.reviewNotes}</p>
        </div>
      )}

      <div className="rounded-md border border-emerald-500/30 bg-emerald-500/5 p-3 text-sm">
        <Star className="mr-1.5 inline h-3.5 w-3.5 text-emerald-500" />
        Ready to submit? Click <strong>Submit for review</strong> above. An
        admin reviewer will run the verification pipeline and either approve,
        reject (with feedback), or request changes.
      </div>
    </div>
  );
}
