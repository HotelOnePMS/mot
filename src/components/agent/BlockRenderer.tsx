'use client';

import type { AgentBlock } from '@/lib/agent/blocks';
import { BookingCard, BookingsBlock, RoomOptionsBlock } from './blocks/bookings';
import { ClarifyBlock, ErrorBlock, NavigateBlock, ResultBlock, RichText, StatsBlock, SuggestionsBlock } from './blocks/core';
import { ActivityBlock, AlertsBlock, HousekeepingBlock, RoomsBlock } from './blocks/ops';
import { PlanCard } from './blocks/PlanCard';
import { BridgeTaskBlock } from './blocks/bridge';
import { AvailabilityBlock, ForecastBlock, OccupancyBlock } from './blocks/revenue';

export function BlockRenderer({ block }: { block: AgentBlock }) {
  switch (block.type) {
    case 'text':
      return <RichText text={block.text} />;
    case 'stats':
      return <StatsBlock block={block} />;
    case 'bookings':
      return <BookingsBlock block={block} />;
    case 'booking':
      return <BookingCard block={block} />;
    case 'rooms':
      return <RoomsBlock block={block} />;
    case 'roomOptions':
      return <RoomOptionsBlock block={block} />;
    case 'availability':
      return <AvailabilityBlock block={block} />;
    case 'occupancy':
      return <OccupancyBlock block={block} />;
    case 'forecast':
      return <ForecastBlock block={block} />;
    case 'housekeeping':
      return <HousekeepingBlock block={block} />;
    case 'alerts':
      return <AlertsBlock block={block} />;
    case 'plan':
      return <PlanCard block={block} />;
    case 'result':
      return <ResultBlock block={block} />;
    case 'activity':
      return <ActivityBlock block={block} />;
    case 'suggestions':
      return <SuggestionsBlock block={block} />;
    case 'navigate':
      return <NavigateBlock block={block} />;
    case 'clarify':
      return <ClarifyBlock block={block} />;
    case 'error':
      return <ErrorBlock block={block} />;
    case 'bridgeTask':
      return <BridgeTaskBlock block={block} />;
    default:
      return null;
  }
}
