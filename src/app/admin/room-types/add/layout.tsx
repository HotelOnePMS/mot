import type { Metadata } from 'next';

export const metadata: Metadata = { title: 'New room type' };

export default function AddRoomTypeLayout({ children }: { children: React.ReactNode }) {
  return children;
}
