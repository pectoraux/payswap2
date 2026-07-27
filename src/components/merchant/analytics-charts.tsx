'use client';

import {
  ResponsiveContainer, AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip,
  BarChart, Bar, PieChart, Pie, Cell, Legend,
} from 'recharts';
import {
  Card, CardContent, CardDescription, CardHeader, CardTitle,
} from '@/components/ui/card';

export interface RevenuePoint { date: string; total: number; }
export interface MethodSlice { method: string; total: number; }
export interface TopCustomer { name: string; totalSpent: number; }

interface Props {
  revenueSeries: RevenuePoint[];
  methods: MethodSlice[];
  topCustomers: TopCustomer[];
  currency: string;
}

const PALETTE = ['#10b981', '#14b8a6', '#0ea5e9', '#a78bfa', '#f59e0b', '#f43f5e'];

function formatMoney(value: number, currency: string) {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency,
    maximumFractionDigits: 0,
  }).format(value ?? 0);
}

export function AnalyticsCharts({ revenueSeries, methods, topCustomers, currency }: Props) {
  const methodTotal = methods.reduce((s, m) => s + m.total, 0) || 1;

  return (
    <div className="grid gap-4 lg:grid-cols-3">
      {/* Revenue over time */}
      <Card className="lg:col-span-2">
        <CardHeader>
          <CardTitle className="text-base">Revenue over time</CardTitle>
          <CardDescription>Completed payments per day</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="h-72">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={revenueSeries} margin={{ top: 10, right: 16, bottom: 0, left: 0 }}>
                <defs>
                  <linearGradient id="revGradient" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#10b981" stopOpacity={0.35} />
                    <stop offset="95%" stopColor="#10b981" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(120,120,120,0.15)" vertical={false} />
                <XAxis
                  dataKey="date"
                  tick={{ fontSize: 11, fill: 'currentColor' }}
                  stroke="rgba(120,120,120,0.4)"
                  tickLine={false}
                />
                <YAxis
                  tick={{ fontSize: 11, fill: 'currentColor' }}
                  stroke="rgba(120,120,120,0.4)"
                  tickLine={false}
                  tickFormatter={(v) => formatMoney(Number(v), currency)}
                  width={70}
                />
                <Tooltip
                  contentStyle={{
                    backgroundColor: 'hsl(var(--popover))',
                    border: '1px solid hsl(var(--border))',
                    borderRadius: 8,
                    fontSize: 12,
                  }}
                  formatter={(value: number) => [formatMoney(value, currency), 'Revenue']}
                />
                <Area
                  type="monotone"
                  dataKey="total"
                  stroke="#10b981"
                  strokeWidth={2}
                  fill="url(#revGradient)"
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </CardContent>
      </Card>

      {/* Methods pie */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Payment methods</CardTitle>
          <CardDescription>Share of volume</CardDescription>
        </CardHeader>
        <CardContent>
          {methods.length === 0 ? (
            <div className="flex h-72 items-center justify-center text-sm text-muted-foreground">
              No data
            </div>
          ) : (
            <div className="h-72">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={methods}
                    dataKey="total"
                    nameKey="method"
                    cx="50%"
                    cy="50%"
                    innerRadius={50}
                    outerRadius={80}
                    paddingAngle={2}
                  >
                    {methods.map((_, i) => (
                      <Cell key={i} fill={PALETTE[i % PALETTE.length]} />
                    ))}
                  </Pie>
                  <Tooltip
                    contentStyle={{
                      backgroundColor: 'hsl(var(--popover))',
                      border: '1px solid hsl(var(--border))',
                      borderRadius: 8,
                      fontSize: 12,
                    }}
                    formatter={(value: number, _name: string, entry: any) => [
                      `${formatMoney(value, currency)} (${Math.round((value / methodTotal) * 100)}%)`,
                      entry?.payload?.method?.replace(/_/g, ' ') ?? 'Method',
                    ]}
                  />
                  <Legend
                    wrapperStyle={{ fontSize: 11 }}
                    formatter={(value: string) => value.replace(/_/g, ' ')}
                  />
                </PieChart>
              </ResponsiveContainer>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Top customers */}
      <Card className="lg:col-span-3">
        <CardHeader>
          <CardTitle className="text-base">Top customers by spend</CardTitle>
          <CardDescription>Lifetime value across all completed payments</CardDescription>
        </CardHeader>
        <CardContent>
          {topCustomers.length === 0 ? (
            <div className="flex h-56 items-center justify-center text-sm text-muted-foreground">
              No customer data yet.
            </div>
          ) : (
            <div className="h-64">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart
                  data={topCustomers}
                  layout="vertical"
                  margin={{ top: 0, right: 16, bottom: 0, left: 0 }}
                >
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(120,120,120,0.15)" horizontal={false} />
                  <XAxis
                    type="number"
                    tick={{ fontSize: 11, fill: 'currentColor' }}
                    stroke="rgba(120,120,120,0.4)"
                    tickFormatter={(v) => formatMoney(Number(v), currency)}
                  />
                  <YAxis
                    type="category"
                    dataKey="name"
                    tick={{ fontSize: 11, fill: 'currentColor' }}
                    stroke="rgba(120,120,120,0.4)"
                    width={120}
                  />
                  <Tooltip
                    contentStyle={{
                      backgroundColor: 'hsl(var(--popover))',
                      border: '1px solid hsl(var(--border))',
                      borderRadius: 8,
                      fontSize: 12,
                    }}
                    formatter={(value: number) => [formatMoney(value, currency), 'Spent']}
                  />
                  <Bar dataKey="totalSpent" radius={[0, 6, 6, 0]} fill="#14b8a6" />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
