import {
  LayoutDashboard,
  CreditCard,
  ArrowDownToLine,
  Users,
  Package,
  FileText,
  BarChart3,
  Settings,
  KeyRound,
  Webhook,
  UserCog,
  Globe,
  Shield,
  QrCode,
  Link2,
  RefreshCcw,
  Repeat,
  FileBarChart,
  Boxes,
  Sparkles,
  Wallet,
  UserCircle,
  Vault,
  Route,
  Briefcase,
  ArrowLeftRight,
  TrendingUp,
  ShieldAlert,
  Ban,
  FolderOpen,
  UserCheck,
  Search,
  History,
  HeartPulse,
  Plug,
  BookOpen,
  Compass,
  FlaskConical,
  Activity,
  AlertTriangle,
  Terminal,
  Building2,
  Cpu,
  ScrollText,
  Gauge,
  Microscope,
  Database,
  Scale,
  Repeat2,
  Landmark,
  Users2,
  Puzzle,
  Box,
  Clock,
  Plane,
  Send,
} from 'lucide-react';

/**
 * Shared navigation types used by the unified shell and every role layout.
 */
export interface NavItem {
  label: string;
  href: string;
  icon: React.ReactNode;
}

export interface NavGroup {
  label: string;
  items: NavItem[];
}

/**
 * Landing page for each role. Used by the role switcher to navigate
 * when a user picks a different role from the sidebar header.
 */
export const ROLE_LANDING_PATH: Record<string, string> = {
  MERCHANT: '/dashboard',
  CUSTOMER: '/portal',
  LP: '/lp',
  TREASURY: '/treasury',
  COMPLIANCE: '/compliance',
  SUPPORT: '/support',
  OPERATIONS: '/ops',
  DEVELOPER: '/developers',
  ADMIN: '/admin',
  SUPER_ADMIN: '/admin',
};

/**
 * Human-readable label shown in the sidebar header / role switcher.
 */
export const ROLE_LABEL: Record<string, string> = {
  MERCHANT: 'Merchant',
  CUSTOMER: 'Customer',
  LP: 'Liquidity Provider',
  TREASURY: 'Treasury',
  COMPLIANCE: 'Compliance',
  SUPPORT: 'Support',
  OPERATIONS: 'Operations',
  DEVELOPER: 'Developer',
  ADMIN: 'Admin',
  SUPER_ADMIN: 'Super Admin',
};

/**
 * Ordering used by the role switcher. Roles that the user holds are
 * rendered in this order so the dropdown is deterministic.
 */
export const ROLE_ORDER: string[] = [
  'MERCHANT',
  'CUSTOMER',
  'LP',
  'TREASURY',
  'COMPLIANCE',
  'SUPPORT',
  'OPERATIONS',
  'DEVELOPER',
  'ADMIN',
  'SUPER_ADMIN',
];

export const merchantNav: NavGroup[] = [
  {
    label: 'Overview',
    items: [
      { label: 'Dashboard', href: '/dashboard', icon: <LayoutDashboard className="h-4 w-4" /> },
      { label: 'Activity', href: '/dashboard/activity', icon: <Activity className="h-4 w-4" /> },
      { label: 'Analytics', href: '/dashboard/analytics', icon: <BarChart3 className="h-4 w-4" /> },
      { label: 'Reports', href: '/dashboard/reports', icon: <FileBarChart className="h-4 w-4" /> },
    ],
  },
  {
    label: 'Accept Payments',
    items: [
      { label: 'Payments', href: '/dashboard/payments', icon: <CreditCard className="h-4 w-4" /> },
      { label: 'Checkout Builder', href: '/dashboard/checkout', icon: <Sparkles className="h-4 w-4" /> },
      { label: 'Payment Links', href: '/dashboard/payment-links', icon: <Link2 className="h-4 w-4" /> },
      { label: 'QR Payments', href: '/dashboard/qr', icon: <QrCode className="h-4 w-4" /> },
    ],
  },
  {
    label: 'Manage Business',
    items: [
      { label: 'Customers', href: '/dashboard/customers', icon: <Users className="h-4 w-4" /> },
      { label: 'Products', href: '/dashboard/products', icon: <Package className="h-4 w-4" /> },
      { label: 'Invoices', href: '/dashboard/invoices', icon: <FileText className="h-4 w-4" /> },
      { label: 'Subscriptions', href: '/dashboard/subscriptions', icon: <Repeat className="h-4 w-4" /> },
      { label: 'Refunds', href: '/dashboard/refunds', icon: <RefreshCcw className="h-4 w-4" /> },
      { label: 'Disputes', href: '/dashboard/disputes', icon: <ShieldAlert className="h-4 w-4" /> },
      { label: 'Payouts', href: '/dashboard/payouts', icon: <ArrowDownToLine className="h-4 w-4" /> },
    ],
  },
  {
    label: 'Extensions',
    items: [
      { label: 'Marketplace', href: '/dashboard/extensions', icon: <Boxes className="h-4 w-4" /> },
    ],
  },
  {
    label: 'Settings',
    items: [
      { label: 'General', href: '/dashboard/settings', icon: <Settings className="h-4 w-4" /> },
      { label: 'Organization', href: '/dashboard/settings/organization', icon: <Building2 className="h-4 w-4" /> },
      { label: 'API Keys', href: '/dashboard/settings/api-keys', icon: <KeyRound className="h-4 w-4" /> },
      { label: 'Webhooks', href: '/dashboard/settings/webhooks', icon: <Webhook className="h-4 w-4" /> },
      { label: 'Team', href: '/dashboard/settings/team', icon: <UserCog className="h-4 w-4" /> },
      { label: 'Billing', href: '/dashboard/settings/billing', icon: <CreditCard className="h-4 w-4" /> },
    ],
  },
];

export const adminNav: NavGroup[] = [
  {
    label: 'Platform',
    items: [
      { label: 'Overview', href: '/admin', icon: <LayoutDashboard className="h-4 w-4" /> },
      { label: 'Waitlist', href: '/admin/waitlist', icon: <Users className="h-4 w-4" /> },
      { label: 'Users', href: '/admin/users', icon: <Users className="h-4 w-4" /> },
      { label: 'Merchants', href: '/admin/merchants', icon: <Package className="h-4 w-4" /> },
      { label: 'Extensions', href: '/admin/extensions', icon: <Boxes className="h-4 w-4" /> },
      { label: 'Capability SDK', href: '/admin/sdk', icon: <Puzzle className="h-4 w-4" /> },
    ],
  },
  {
    label: 'System',
    items: [
      { label: 'Runtime', href: '/admin/runtime', icon: <Globe className="h-4 w-4" /> },
      { label: 'Platform', href: '/admin/platform', icon: <Activity className="h-4 w-4" /> },
      { label: 'Network', href: '/admin/network', icon: <Globe className="h-4 w-4" /> },
      { label: 'Digital Twin', href: '/admin/digital-twin', icon: <Box className="h-4 w-4" /> },
      { label: 'Time Machine', href: '/admin/time-machine', icon: <Clock className="h-4 w-4" /> },
      { label: 'Simulations', href: '/admin/simulations', icon: <History className="h-4 w-4" /> },
      { label: 'Audit Trail', href: '/admin/audit', icon: <Shield className="h-4 w-4" /> },
    ],
  },
];

export const customerNav: NavGroup[] = [
  {
    label: 'Overview',
    items: [
      { label: 'Overview', href: '/portal', icon: <LayoutDashboard className="h-4 w-4" /> },
    ],
  },
  {
    label: 'Activity',
    items: [
      { label: 'Payments', href: '/portal/payments', icon: <CreditCard className="h-4 w-4" /> },
      { label: 'Wallet', href: '/portal/wallet', icon: <Wallet className="h-4 w-4" /> },
      { label: 'Invoices', href: '/portal/invoices', icon: <FileText className="h-4 w-4" /> },
    ],
  },
  {
    label: 'Account',
    items: [
      { label: 'Profile', href: '/portal/profile', icon: <UserCircle className="h-4 w-4" /> },
    ],
  },
];

export const lpNav: NavGroup[] = [
  {
    label: 'Overview',
    items: [
      { label: 'Overview', href: '/lp', icon: <LayoutDashboard className="h-4 w-4" /> },
    ],
  },
  {
    label: 'Liquidity',
    items: [
      { label: 'Positions', href: '/lp/positions', icon: <Briefcase className="h-4 w-4" /> },
      { label: 'Corridors', href: '/lp/corridors', icon: <Route className="h-4 w-4" /> },
      { label: 'Settlements', href: '/lp/settlements', icon: <ArrowLeftRight className="h-4 w-4" /> },
      { label: 'Profitability', href: '/lp/profitability', icon: <TrendingUp className="h-4 w-4" /> },
    ],
  },
  {
    label: 'Account',
    items: [
      { label: 'Settings', href: '/lp/settings', icon: <Settings className="h-4 w-4" /> },
    ],
  },
];

export const treasuryNav: NavGroup[] = [
  {
    label: 'Overview',
    items: [
      { label: 'Overview', href: '/treasury', icon: <LayoutDashboard className="h-4 w-4" /> },
    ],
  },
  {
    label: 'Treasury',
    items: [
      { label: 'Reserves', href: '/treasury/reserves', icon: <Vault className="h-4 w-4" /> },
      { label: 'Corridors', href: '/treasury/corridors', icon: <Route className="h-4 w-4" /> },
      { label: 'Reports', href: '/treasury/reports', icon: <FileBarChart className="h-4 w-4" /> },
    ],
  },
  {
    label: 'Controls',
    items: [
      { label: 'Emergency', href: '/treasury/emergency', icon: <ShieldAlert className="h-4 w-4" /> },
    ],
  },
];

export const complianceNav: NavGroup[] = [
  {
    label: 'Overview',
    items: [
      { label: 'Overview', href: '/compliance', icon: <LayoutDashboard className="h-4 w-4" /> },
    ],
  },
  {
    label: 'Investigations',
    items: [
      { label: 'AML Alerts', href: '/compliance/alerts', icon: <ShieldAlert className="h-4 w-4" /> },
      { label: 'Sanctions', href: '/compliance/sanctions', icon: <Ban className="h-4 w-4" /> },
      { label: 'Cases', href: '/compliance/cases', icon: <FolderOpen className="h-4 w-4" /> },
      { label: 'KYC Review', href: '/compliance/kyc', icon: <UserCheck className="h-4 w-4" /> },
    ],
  },
];

export const supportNav: NavGroup[] = [
  {
    label: 'Overview',
    items: [
      { label: 'Overview', href: '/support', icon: <LayoutDashboard className="h-4 w-4" /> },
    ],
  },
  {
    label: 'Tools',
    items: [
      { label: 'Search', href: '/support/search', icon: <Search className="h-4 w-4" /> },
      { label: 'Audit Trail', href: '/support/audit', icon: <History className="h-4 w-4" /> },
    ],
  },
];

export const opsNav: NavGroup[] = [
  {
    label: 'Overview',
    items: [
      { label: 'Overview', href: '/ops', icon: <LayoutDashboard className="h-4 w-4" /> },
    ],
  },
  {
    label: 'Operations',
    items: [
      { label: 'Health', href: '/ops/health', icon: <HeartPulse className="h-4 w-4" /> },
      { label: 'Connectors', href: '/ops/connectors', icon: <Plug className="h-4 w-4" /> },
      { label: 'Metrics', href: '/ops/metrics', icon: <BarChart3 className="h-4 w-4" /> },
      { label: 'Incidents', href: '/ops/incidents', icon: <AlertTriangle className="h-4 w-4" /> },
      { label: 'Status', href: '/ops/status', icon: <Activity className="h-4 w-4" /> },
      { label: 'SRE', href: '/ops/sre', icon: <Terminal className="h-4 w-4" /> },
    ],
  },
];

export const developerNav: NavGroup[] = [
  {
    label: 'Overview',
    items: [
      { label: 'Console', href: '/developers', icon: <LayoutDashboard className="h-4 w-4" /> },
    ],
  },
  {
    label: 'Build',
    items: [
      { label: 'Sandbox', href: '/developers/sandbox', icon: <FlaskConical className="h-4 w-4" /> },
      { label: 'API Keys', href: '/developers/api-keys', icon: <KeyRound className="h-4 w-4" /> },
      { label: 'Webhooks', href: '/developers/webhooks', icon: <Webhook className="h-4 w-4" /> },
      { label: 'Simulator', href: '/developers/simulator', icon: <Cpu className="h-4 w-4" /> },
      { label: 'Extensions', href: '/developers/extensions', icon: <Boxes className="h-4 w-4" /> },
      { label: 'Digital Twin', href: '/developers/digital-twin', icon: <Box className="h-4 w-4" /> },
      { label: 'Time Machine', href: '/developers/time-machine', icon: <Clock className="h-4 w-4" /> },
    ],
  },
  {
    label: 'Observe',
    items: [
      { label: 'Logs', href: '/developers/logs', icon: <ScrollText className="h-4 w-4" /> },
      { label: 'Metrics', href: '/developers/metrics', icon: <Gauge className="h-4 w-4" /> },
      { label: 'Inspectors', href: '/developers/inspectors', icon: <Microscope className="h-4 w-4" /> },
    ],
  },
  {
    label: 'Reference',
    items: [
      { label: 'API Docs', href: '/developers/docs', icon: <BookOpen className="h-4 w-4" /> },
      { label: 'API Explorer', href: '/developers/explorer', icon: <Compass className="h-4 w-4" /> },
    ],
  },
];
