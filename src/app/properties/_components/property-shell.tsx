'use client';

import * as React from 'react';

/**
 * The few facts about a hotel that its layout reads on the server, so the
 * hotel's own name and colour are on screen from the first paint (no flash
 * of the platform brand while the full property loads).
 */
export interface PropertyShell {
  id: string;
  name: string;
  city: string;
  state: string;
  type: string | null;
  tagline: string | null;
  primaryColor: string | null;
  isDemo: boolean;
}

const PropertyShellContext = React.createContext<PropertyShell | null>(null);

export function PropertyShellProvider({ value, children }: { value: PropertyShell | null; children: React.ReactNode }) {
  return <PropertyShellContext.Provider value={value}>{children}</PropertyShellContext.Provider>;
}

export function usePropertyShell(): PropertyShell | null {
  return React.useContext(PropertyShellContext);
}
