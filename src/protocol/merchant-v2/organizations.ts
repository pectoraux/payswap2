/**
 * PaySwap Protocol — Merchant Platform (v2) — Organizations.
 *
 * Multi-merchant organisations. An organisation owns multiple merchants,
 * has owners (full control), and can invite team members at the org level.
 * Member management delegates to `teamService` with `scopeType='org'` so
 * that there is a single source of truth for team member records.
 *
 * Roles (see `team.ts` for the permission matrix):
 *   owner      — full control
 *   admin      — manage merchants + members
 *   developer  — API keys + webhooks
 *   analyst    — read-only analytics
 *   viewer     — read-only
 *   support    — refunds + customer service
 *
 * Events emitted on the kernel `eventEngine`:
 *  - `merchant.organization_created`         — on `createOrganization`.
 *  - `merchant.organization_merchant_added`  — on `addMerchant`.
 *  - `merchant.organization_merchant_removed`— on `removeMerchant`.
 *
 * The kernel is FROZEN — this module imports only `uid`, `nowTs` from
 * `@/kernel/support`, `eventEngine` from `@/kernel/event`, and
 * `teamService` from `./team`. No kernel files are modified.
 */
import { uid, nowTs } from '@/kernel/support';
import { eventEngine } from '@/kernel/event';
import { teamService } from './team';
import type { Organization, TeamMember, TeamRole } from './types';

/** Parameters for `createOrganization`. */
export interface CreateOrganizationParams {
  name: string;
  owners: string[];
  billingEmail: string;
  taxId?: string;
  address: string;
  merchants?: string[];
}

/**
 * OrganizationService owns the organisation records and the merchant
 * membership lists. Team-member management is delegated to `teamService`.
 */
export class OrganizationService {
  private orgs = new Map<string, Organization>();

  // ---------------------------------------------------------- createOrganization
  createOrganization(params: CreateOrganizationParams): Organization {
    const org: Organization = {
      id: uid('org'),
      name: params.name,
      owners: [...params.owners],
      billingEmail: params.billingEmail,
      taxId: params.taxId,
      address: params.address,
      merchants: [...(params.merchants ?? [])],
      createdAt: nowTs(),
    };
    this.orgs.set(org.id, org);
    eventEngine.emit('merchant.organization_created', {
      orgId: org.id,
      name: org.name,
      owners: org.owners,
      billingEmail: org.billingEmail,
      merchants: org.merchants,
    });
    return org;
  }

  // ----------------------------------------------------------------- addMerchant
  /**
   * Link a merchant to an organisation. Idempotent. Returns the updated
   * org or `null` if the org does not exist.
   */
  addMerchant(orgId: string, merchantId: string): Organization | null {
    const org = this.orgs.get(orgId);
    if (!org) return null;
    if (!org.merchants.includes(merchantId)) {
      org.merchants.push(merchantId);
      eventEngine.emit('merchant.organization_merchant_added', {
        orgId,
        merchantId,
      });
    }
    return org;
  }

  // -------------------------------------------------------------- removeMerchant
  removeMerchant(orgId: string, merchantId: string): Organization | null {
    const org = this.orgs.get(orgId);
    if (!org) return null;
    const before = org.merchants.length;
    org.merchants = org.merchants.filter((m) => m !== merchantId);
    if (org.merchants.length !== before) {
      eventEngine.emit('merchant.organization_merchant_removed', {
        orgId,
        merchantId,
      });
    }
    return org;
  }

  // ------------------------------------------------------------------- addMember
  /**
   * Invite a team member to an organisation (delegates to `teamService`).
   */
  addMember(orgId: string, email: string, role: TeamRole): TeamMember | null {
    const org = this.orgs.get(orgId);
    if (!org) return null;
    return teamService.inviteMember(orgId, 'org', email, role);
  }

  // ---------------------------------------------------------------- removeMember
  removeMember(orgId: string, memberId: string): boolean {
    const org = this.orgs.get(orgId);
    if (!org) return false;
    return teamService.removeMember(memberId);
  }

  // -------------------------------------------------------------- updateMemberRole
  updateMemberRole(orgId: string, memberId: string, role: TeamRole): TeamMember | null {
    const org = this.orgs.get(orgId);
    if (!org) return null;
    return teamService.updateRole(memberId, role);
  }

  // -------------------------------------------------------------------- getters
  getOrganization(id: string): Organization | undefined {
    return this.orgs.get(id);
  }

  getByOwner(ownerId: string): Organization[] {
    return [...this.orgs.values()].filter((o) => o.owners.includes(ownerId));
  }

  /** Return all team members attached to an organisation. */
  getMembers(orgId: string): TeamMember[] {
    return teamService.getMembers(orgId);
  }

  /** Return all merchants linked to an organisation. */
  getMerchants(orgId: string): string[] {
    return this.orgs.get(orgId)?.merchants ?? [];
  }

  all(): Organization[] {
    return [...this.orgs.values()];
  }

  // --------------------------------------------------------------------- reset
  reset(): void {
    this.orgs.clear();
  }
}

// Singleton.
const _g = globalThis as unknown as { __PAYSWAP_ORGANIZATION_SERVICE?: OrganizationService };
export const organizationService: OrganizationService =
  _g.__PAYSWAP_ORGANIZATION_SERVICE ?? new OrganizationService();
if (!_g.__PAYSWAP_ORGANIZATION_SERVICE) {
  _g.__PAYSWAP_ORGANIZATION_SERVICE = organizationService;
}
