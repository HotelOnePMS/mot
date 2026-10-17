import type { Metadata } from 'next';

export const metadata: Metadata = { title: 'Properties' };

export default function PropertiesLayout({ children }: { children: React.ReactNode }) {
  return children;
}
