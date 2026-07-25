/**
 * Organization context — resolves the current organization from the session.
 *
 * A user can belong to multiple organizations. The active organization is
 * stored in a cookie (set by the OrgSwitcher client component).
 *
 * This is the Stripe-style workspace model:
 *   User → Organization → Role → Workspace
 *
 * Role switching happens within an organization context.
 */

import { cookies } from 'next/headers';
import { db } from '@/lib/db';

export interface OrgContext {
  organizationId: string;
  organizationName: string;
  organizationSlug: string;
  organizationType: string;
  role: string;
}

/**
 * Get the current organization from the cookie + session.
 * Returns null if the user has no organization memberships.
 */
export async function getOrgContext(userId: string): Promise<OrgContext | null> {
  const cookieStore = await cookies();
  const orgCookie = cookieStore.get('payswap-org-id');

  // Get all org memberships for this user
  const memberships = await db.organizationMember.findMany({
    where: { userId, status: 'active' },
    include: { organization: true },
  });

  if (memberships.length === 0) return null;

  // Try the cookie-specified org
  if (orgCookie?.value) {
    const membership = memberships.find(m => m.organizationId === orgCookie.value);
    if (membership) {
      return {
        organizationId: membership.organizationId,
        organizationName: membership.organization.name,
        organizationSlug: membership.organization.slug,
        organizationType: membership.organization.type,
        role: membership.role,
      };
    }
  }

  // Default to the first membership
  const first = memberships[0];
  return {
    organizationId: first.organizationId,
    organizationName: first.organization.name,
    organizationSlug: first.organization.slug,
    organizationType: first.organization.type,
    role: first.role,
  };
}

/**
 * Get all organizations the user belongs to.
 */
export async function getUserOrganizations(userId: string) {
  const memberships = await db.organizationMember.findMany({
    where: { userId, status: 'active' },
    include: { organization: true },
  });
  return memberships.map(m => ({
    id: m.organization.id,
    name: m.organization.name,
    slug: m.organization.slug,
    type: m.organization.type,
    role: m.role,
    logoUrl: m.organization.logoUrl,
  }));
}
