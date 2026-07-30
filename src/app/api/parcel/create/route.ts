import { NextRequest, NextResponse } from 'next/server';
import { parcelService } from '@/extensions/parcel-delivery/store';
import { requireSession, unauthorized } from '@/lib/api-auth';
export const runtime = 'nodejs'; export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  const session = await requireSession();
  if (!session) return unauthorized();
  let body: Record<string, unknown> = {};
  try { body = await req.json(); } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }); }
  const delivery = parcelService.createDelivery({
    merchantId: (session.user as { id?: string }).id ?? 'unknown',
    customerId: body.customerId as string,
    senderName: body.senderName as string,
    senderAddress: body.senderAddress as string,
    recipientName: body.recipientName as string,
    recipientAddress: body.recipientAddress as string,
    recipientContact: body.recipientContact as string,
    deliveryWindow: body.deliveryWindow as never,
    specialInstructions: body.specialInstructions as string,
    parcel: body.parcel as never,
    shippingPayer: body.shippingPayer as never,
    priority: body.priority as never,
    maxBudget: body.maxBudget as number,
    preferredCourier: body.preferredCourier as string,
    deadline: body.deadline as number,
    insuranceRequired: body.insuranceRequired as boolean,
    signatureRequired: body.signatureRequired as boolean,
    groupedAllowed: body.groupedAllowed as boolean,
    transitHubsAllowed: body.transitHubsAllowed as boolean,
    partialDeliveryAllowed: body.partialDeliveryAllowed as boolean,
  });
  return NextResponse.json({ delivery, message: `✓ Delivery created — tracking: ${delivery.trackingNumber}, price: ${delivery.price.toString()}` }, { status: 201 });
}
