import { redirect } from 'next/navigation';

/** Staff and guests share one sign-in page; it routes each role to its home. */
export default function AdminLoginRedirect() {
  redirect('/login?callbackUrl=/admin');
}
