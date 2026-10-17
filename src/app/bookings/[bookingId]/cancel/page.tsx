import { redirect } from 'next/navigation';

/** Old cancel links (e.g. in confirmation emails) open the booking with the cancel dialog. */
export default async function CancelRedirect({ params }: { params: Promise<{ bookingId: string }> }) {
  const { bookingId } = await params;
  redirect(`/bookings/${bookingId}?action=cancel`);
}
