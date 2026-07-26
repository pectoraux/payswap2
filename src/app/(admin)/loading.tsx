import { PageSkeleton } from '@/components/page-skeleton';

export default function Loading() {
  return <PageSkeleton kpiCount={4} tableRows={6} />;
}
