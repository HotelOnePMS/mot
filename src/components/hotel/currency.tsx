'use client';

import * as React from 'react';
import { DEFAULT_CURRENCY } from '@/lib/currency';

/**
 * The currency of the hotel on screen. The console provides the selected
 * hotel's; charts, the agent's blocks and dialogs read it with `useCurrency`.
 * Amounts that carry their own currency (a booking's `currency`) use that.
 */
const CurrencyContext = React.createContext<string>(DEFAULT_CURRENCY);

export function CurrencyProvider({ currency, children }: { currency: string; children: React.ReactNode }) {
  return <CurrencyContext.Provider value={currency}>{children}</CurrencyContext.Provider>;
}

export const useCurrency = () => React.useContext(CurrencyContext);
