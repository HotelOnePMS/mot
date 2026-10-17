'use client';

import * as React from 'react';
import Link from 'next/link';
import useSWR from 'swr';
import { useRouter } from 'next/navigation';
import { ArrowLeftRight, BedDouble, Building2, CalendarCheck2, Check, EyeOff, MapPin, Pencil, Plus, SquareArrowOutUpRight } from 'lucide-react';
import { fetcher } from '@/lib/fetcher';
import { formatNumber } from '@/lib/status';
import { cn } from '@/lib/utils';
import { Badge } from '@/components/ui/badge';
import { Button, IconButton } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { EmptyState, PageHeader, Skeleton } from '@/components/ui/primitives';
import { SmartImage } from '@/components/ui/smart-image';
import { useConsole } from '@/components/console/ConsoleProvider';

interface PropertyRow {
  id: string;
  name: string;
  city: string;
  state: string;
  type: string | null;
  tagline: string | null;
  isActive: boolean;
  isDemo: boolean;
  primaryColor: string | null;
  photos: { url: string }[];
  roomTypes: { id: string; totalRooms: number; isActive: boolean }[];
  _count: { bookings: number; rooms: number };
}

const FRAME = 'mx-auto w-full max-w-7xl px-4 pb-12 pt-5 sm:px-6 sm:pt-6 lg:px-8 lg:pt-8';

function Marks({ p, current }: { p: PropertyRow; current: boolean }) {
  return (
    <>
      {current && (
        <Badge variant="default" size="sm" icon={Check}>
          Current
        </Badge>
      )}
      {!p.isActive && (
        <Badge variant="neutral" size="sm" icon={EyeOff}>
          Hidden from guests
        </Badge>
      )}
      {p.isDemo && (
        <Badge variant="outline" size="sm" className="bg-surface/90">
          Demo
        </Badge>
      )}
    </>
  );
}

export default function PropertiesPage() {
  const router = useRouter();
  const { can, propertyId, setPropertyId } = useConsole();
  const { data, isLoading, error } = useSWR<PropertyRow[]>('/api/admin/properties', fetcher);

  return (
    <div className={FRAME}>
      <div className="space-y-6">
        <PageHeader
          title="Properties"
          description={data ? `${formatNumber(data.length)} propert${data.length === 1 ? 'y' : 'ies'} you manage` : 'Loading your properties…'}
          actions={
            can('property.create') ? (
              <Button asChild>
                <Link href="/admin/properties/add">
                  <Plus aria-hidden /> Add property
                </Link>
              </Button>
            ) : undefined
          }
        />

        {isLoading ? (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3" aria-busy>
            {Array.from({ length: 3 }).map((_, i) => (
              <Skeleton key={i} className="h-[340px] rounded-2xl" />
            ))}
          </div>
        ) : error ? (
          <Card>
            <EmptyState icon={Building2} title="Couldn’t load your properties" description="Check your connection and refresh the page." />
          </Card>
        ) : !data?.length ? (
          <Card>
            <EmptyState
              icon={Building2}
              title="No properties yet"
              description="Add your first property — its name, address and brand color — to start taking bookings."
              action={
                can('property.create') ? (
                  <Button asChild>
                    <Link href="/admin/properties/add">
                      <Plus aria-hidden /> Add property
                    </Link>
                  </Button>
                ) : undefined
              }
            />
          </Card>
        ) : (
          <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {data.map((p) => {
              const rooms = p.roomTypes.filter((t) => t.isActive).reduce((s, t) => s + t.totalRooms, 0);
              const current = p.id === propertyId;
              const photo = p.photos[0]?.url;
              const accent = p.primaryColor ?? 'hsl(var(--primary))';
              return (
                <li key={p.id}>
                  <Card className={cn('flex h-full flex-col overflow-hidden p-0 transition-shadow hover:shadow-lifted', current && 'ring-2 ring-primary/30')}>
                    {photo ? (
                      <div className="relative">
                        <SmartImage src={photo} alt="" icon={Building2} aspectRatio="16 / 9" sizes="(min-width: 1024px) 400px, (min-width: 640px) 50vw, 100vw" className="w-full" />
                        <span className="absolute inset-x-0 bottom-0 h-1" style={{ backgroundColor: accent }} aria-hidden />
                        <div className="absolute left-3 top-3 flex flex-wrap gap-1.5">
                          <Marks p={p} current={current} />
                        </div>
                      </div>
                    ) : (
                      // No photo yet: a slim brand stripe instead of an empty placeholder block.
                      <span className="h-1.5 w-full" style={{ backgroundColor: accent }} aria-hidden />
                    )}
                    <div className="flex flex-1 flex-col p-5">
                      {!photo && (
                        <div className="mb-2 flex flex-wrap gap-1.5 empty:hidden">
                          <Marks p={p} current={current} />
                        </div>
                      )}
                      <h2 className="text-base font-semibold tracking-tight">{p.name}</h2>
                      <p className="mt-0.5 flex items-center gap-1 text-sm text-muted-foreground">
                        <MapPin className="size-3.5 shrink-0" aria-hidden />
                        <span className="truncate">
                          {p.city}, {p.state}
                          {p.type && ` · ${p.type}`}
                        </span>
                      </p>
                      {p.tagline && <p className="mt-2 line-clamp-2 text-sm text-foreground/85">{p.tagline}</p>}
                      <dl className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-sm text-muted-foreground">
                        <div className="flex items-center gap-1.5">
                          <BedDouble className="size-4" aria-hidden />
                          <dt className="sr-only">Rooms</dt>
                          <dd>
                            {formatNumber(rooms)} room{rooms === 1 ? '' : 's'}
                          </dd>
                        </div>
                        <div className="flex items-center gap-1.5">
                          <CalendarCheck2 className="size-4" aria-hidden />
                          <dt className="sr-only">Bookings</dt>
                          <dd>
                            {formatNumber(p._count.bookings)} booking{p._count.bookings === 1 ? '' : 's'}
                          </dd>
                        </div>
                      </dl>
                      <div className="mt-auto flex items-center gap-2 pt-5">
                        {!current && (
                          <Button
                            variant="outline"
                            size="sm"
                            className="flex-1"
                            onClick={() => {
                              setPropertyId(p.id);
                              router.push('/admin');
                            }}
                          >
                            <ArrowLeftRight aria-hidden /> Switch to
                          </Button>
                        )}
                        {can('property.write') && (
                          <Button asChild size="sm" variant={current ? 'default' : 'outline'} className="flex-1">
                            <Link href={`/admin/properties/${p.id}`}>
                              <Pencil aria-hidden /> Edit details
                            </Link>
                          </Button>
                        )}
                        <IconButton asChild label={`Open ${p.name}’s booking page (new tab)`} variant="ghost" size="icon-sm">
                          <Link href={`/properties/${p.id}`} target="_blank" rel="noopener">
                            <SquareArrowOutUpRight />
                          </Link>
                        </IconButton>
                      </div>
                    </div>
                  </Card>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
