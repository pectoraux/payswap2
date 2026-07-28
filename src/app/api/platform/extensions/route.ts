/**
 * GET /api/platform/extensions — list marketplace extensions.
 * POST /api/platform/extensions — register/install an extension.
 */

import { NextResponse } from 'next/server';
import { runtime } from '@/runtime';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const marketplace = runtime.platform.getMarketplace();
    return NextResponse.json({ ok: true, ...marketplace });
  } catch (err) {
    return NextResponse.json({ ok: false, error: err instanceof Error ? err.message : 'Unknown' }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const action = body.action;

    if (action === 'register') {
      const ext = runtime.platform.registerExtension({
        name: body.name,
        description: body.description,
        developerId: body.developerId,
        category: body.category,
        status: 'draft',
        version: body.version || '1.0.0',
        permissions: body.permissions || [],
      });
      return NextResponse.json({ ok: true, extension: ext });
    }

    if (action === 'install') {
      const ext = runtime.platform.updateExtensionStatus(body.extensionId, 'installed');
      return NextResponse.json({ ok: true, extension: ext });
    }

    if (action === 'enable') {
      const ext = runtime.platform.updateExtensionStatus(body.extensionId, 'enabled');
      return NextResponse.json({ ok: true, extension: ext });
    }

    return NextResponse.json({ ok: false, error: 'Unknown action' }, { status: 400 });
  } catch (err) {
    return NextResponse.json({ ok: false, error: err instanceof Error ? err.message : 'Unknown' }, { status: 500 });
  }
}
