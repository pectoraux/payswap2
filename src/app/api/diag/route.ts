import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { ensureDbInitialized } from '@/lib/db-init';
import bcrypt from 'bcryptjs';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  const diag: any = {
    timestamp: new Date().toISOString(),
    env: {
      NODE_ENV: process.env.NODE_ENV,
      DATABASE_URL: process.env.DATABASE_URL?.slice(0, 20) + '...',
      NEXTAUTH_URL: process.env.NEXTAUTH_URL,
      has_NEXTAUTH_SECRET: !!process.env.NEXTAUTH_SECRET,
    },
    steps: [] as string[],
  };

  try {
    diag.steps.push('Calling ensureDbInitialized...');
    await ensureDbInitialized();
    diag.steps.push('ensureDbInitialized completed');

    diag.steps.push('Querying User table...');
    const users = await db.user.findMany({ take: 5, select: { id: true, email: true, status: true, name: true } });
    diag.steps.push(`Found ${users.length} users`);
    diag.users = users;

    if (users.length > 0) {
      diag.steps.push('Testing password comparison...');
      const merchant = await db.user.findUnique({
        where: { email: 'merchant@payswap.demo' },
        include: { roles: true },
      });
      if (merchant) {
        diag.steps.push(`Found merchant: ${merchant.email}, status=${merchant.status}, hasHash=${!!merchant.passwordHash}`);
        const valid = await bcrypt.compare('Payswap123456', merchant.passwordHash!);
        diag.steps.push(`Password valid: ${valid}`);
        diag.merchant = { email: merchant.email, status: merchant.status, roles: merchant.roles.map(r => r.role) };
      } else {
        diag.steps.push('Merchant not found');
      }
    }
  } catch (e) {
    diag.steps.push(`ERROR: ${e instanceof Error ? e.message : String(e)}`);
    diag.error = e instanceof Error ? { message: e.message, stack: e.stack } : String(e);
  }

  return NextResponse.json(diag);
}
