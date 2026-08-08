import { NextRequest, NextResponse } from 'next/server';
import { callLLM } from '@/lib/ai-helpers';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * POST /api/ai/financial-model
 * AI assistant for the financial model tab — answers questions about the
 * PaySwap economic model, pricing, reserves, LP economics, etc.
 */
export async function POST(req: NextRequest) {
  let body: Record<string, unknown> = {};
  try { body = await req.json(); } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }); }

  const question = body.question as string;
  const context = body.context as Record<string, unknown> | undefined;

  if (!question) return NextResponse.json({ error: 'question is required' }, { status: 400 });

  const systemPrompt = `You are the PaySwap Financial Model AI Assistant. You help investors and operators understand PaySwap's economic model.

PaySwap is a cross-border settlement network for Africa. Key facts:
- 5 settlement strategies: LOCAL_RAIL (same country, 80bps), RESERVE_TO_RESERVE (both countries have reserves, 80bps), RESERVE_TO_MARKET (sender has reserve, 120bps), MARKET_TO_RESERVE (receiver has reserve, 100bps), MARKET_TO_MARKET (neither has reserve, 150bps)
- 3 bandwidth flavors: fiat (LP bank authorization), stablecoin (LP USDC), twin_token (LP stake)
- Revenue split: LOCAL_RAIL/RESERVE_TO_RESERVE = 100% PaySwap; MARKET strategies = 10-40% PaySwap, 60-90% LPs
- Competitors: Paystack 1.5%/3.9%, Flutterwave 1.4%/3.8%, Stripe 2.9%/3.4%, Mobile Money 1%/2.5%, CinetPay 1.8%/3.5%, Western Union 5%/7%
- Bootstrap model: start with $70K in Ghana, rely on LPs for other corridors, reinvest 50% of revenue into reserves
- Route optimization: 5 deterministic candidate generators compete via 8-objective weighted scoring (cost, speed, safety, liquidity, satisfaction, community, carbon, treasury health). NO LLM is used for route selection — the "AI weights" are configurable scoring parameters.
- Break-even fee: 50bps. Recommended: 80-100bps.

Answer questions clearly, concisely, and with specific numbers. Use the provided simulation context if available. If asked about competitors, compare specific fees. If asked about pricing, reference the break-even and competitive positioning.`;

  const userPrompt = context
    ? `Simulation context: ${JSON.stringify(context).slice(0, 2000)}\n\nQuestion: ${question}`
    : `Question: ${question}`;

  const response = await callLLM(systemPrompt, userPrompt);

  if (!response) {
    return NextResponse.json({
      ok: false,
      error: 'AI assistant unavailable',
      debug: {
        hasZaiApiKey: !!process.env.ZAI_API_KEY,
        hasZaiBaseUrl: !!process.env.ZAI_BASE_URL,
        zaiApiKeyPrefix: process.env.ZAI_API_KEY?.slice(0, 10) ?? 'missing',
        zaiBaseUrl: process.env.ZAI_BASE_URL ?? 'missing',
      },
      fallback: 'The AI assistant is currently unavailable. Please try again later.',
    }, { status: 503 });
  }

  return NextResponse.json({ ok: true, response });
}
