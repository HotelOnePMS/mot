'use client';

import * as React from 'react';
import Link from 'next/link';
import { ArrowUpRight } from 'lucide-react';
import type { AgentBlock } from '@/lib/agent/blocks';
import { Button } from '@/components/ui/button';
import { FolioSummary } from '@/components/frontdesk/FolioCard';
import { BlockCard, BlockHeader } from './core';

type FolioBlockData = Extract<AgentBlock, { type: 'folio' }>;

/**
 * A reservation's folio in the conversation: the same live folio as on the reservation page, so lines can also be
 * changed by hand right here (for staff allowed to edit folios).
 */
export function FolioBlock({ block }: { block: FolioBlockData }) {
  const id = React.useId();
  return (
    <BlockCard aria-labelledby={id}>
      <BlockHeader
        id={id}
        title={`Folio · ${block.guestName}`}
        description={`#${block.code}`}
        meta={
          <Button asChild size="sm" variant="ghost">
            <Link href={`/admin/bookings/${block.bookingId}`}>
              Open reservation <ArrowUpRight aria-hidden />
            </Link>
          </Button>
        }
      />
      <div className="px-4 pb-4 pt-2">
        <FolioSummary bookingId={block.bookingId} editable />
      </div>
    </BlockCard>
  );
}
