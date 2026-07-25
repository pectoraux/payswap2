/**
 * Seed organizations — creates orgs for existing merchants, LPs, and platform.
 */
import { db } from '../src/lib/db';

async function main() {
  console.log('🏢 Seeding organizations...\n');

  // Get all existing merchants
  const merchants = await db.merchant.findMany();
  for (const m of merchants) {
    const slug = m.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    const existing = await db.organization.findUnique({ where: { slug } });
    if (existing) { console.log(`  ⏭️  ${m.name} org already exists`); continue; }

    // Get the merchant's owner
    const owner = await db.userRole.findFirst({
      where: { merchantId: m.id, role: 'MERCHANT' },
      include: { user: true },
    });

    const org = await db.organization.create({
      data: {
        name: m.name,
        slug,
        type: 'merchant',
        status: 'active',
        billingEmail: m.email,
        country: m.country,
        currency: m.currency,
        plan: m.tier === 'PREMIUM' ? 'enterprise' : m.tier === 'TRUSTED' ? 'growth' : 'starter',
      },
    });

    if (owner) {
      await db.organizationMember.create({
        data: {
          organizationId: org.id,
          userId: owner.userId,
          role: 'owner',
          status: 'active',
          joinedAt: new Date(),
        },
      });
    }

    console.log(`✅ ${m.name} → org:${org.slug}`);
  }

  // Create LP organization
  const lps = await db.lPProfile.findMany();
  for (const lp of lps) {
    const slug = lp.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    const existing = await db.organization.findUnique({ where: { slug } });
    if (existing) { console.log(`  ⏭️  ${lp.name} org already exists`); continue; }

    const lpUser = await db.user.findFirst({ where: { name: lp.name } });
    const org = await db.organization.create({
      data: {
        name: lp.name,
        slug,
        type: 'lp',
        status: 'active',
        country: lp.country,
        currency: 'GHS',
        plan: 'enterprise',
      },
    });

    if (lpUser) {
      await db.organizationMember.create({
        data: {
          organizationId: org.id,
          userId: lpUser.id,
          role: 'owner',
          status: 'active',
          joinedAt: new Date(),
        },
      });
    }

    console.log(`✅ ${lp.name} → org:${org.slug}`);
  }

  // Create platform org
  const admin = await db.user.findUnique({ where: { email: 'ekontetevi@gmail.com' } });
  if (admin) {
    const existing = await db.organization.findUnique({ where: { slug: 'payswap-platform' } });
    if (!existing) {
      const org = await db.organization.create({
        data: {
          name: 'PaySwap Platform',
          slug: 'payswap-platform',
          type: 'platform',
          status: 'active',
          country: 'Ghana',
          currency: 'GHS',
          plan: 'enterprise',
        },
      });
      await db.organizationMember.create({
        data: {
          organizationId: org.id,
          userId: admin.id,
          role: 'owner',
          status: 'active',
          joinedAt: new Date(),
        },
      });
      console.log(`✅ PaySwap Platform → org:payswap-platform`);
    }
  }

  // Add admin to all merchant orgs as well
  if (admin) {
    const merchantOrgs = await db.organization.findMany({ where: { type: 'merchant' } });
    for (const org of merchantOrgs) {
      const existing = await db.organizationMember.findUnique({
        where: { organizationId_userId: { organizationId: org.id, userId: admin.id } },
      });
      if (!existing) {
        await db.organizationMember.create({
          data: {
            organizationId: org.id,
            userId: admin.id,
            role: 'admin',
            status: 'active',
            joinedAt: new Date(),
          },
        });
      }
    }
  }

  // Count
  const orgCount = await db.organization.count();
  const memberCount = await db.organizationMember.count();
  console.log(`\n🎉 ${orgCount} organizations, ${memberCount} memberships`);
}

main().then(() => db.$disconnect()).catch(e => { console.error(e); db.$disconnect(); process.exit(1); });
