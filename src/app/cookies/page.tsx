import type { Metadata } from 'next';
import { LegalPage, type LegalSection } from '@/components/legal/LegalPage';
import { PRODUCT_NAME, PRODUCT_SUPPORT_EMAIL } from '@/config/product';

export const metadata: Metadata = {
  title: 'Cookie Policy',
  description: `The cookies and similar storage ${PRODUCT_NAME} uses, and why.`,
  alternates: { canonical: '/cookies' },
};

const SECTIONS: LegalSection[] = [
  {
    id: 'what',
    title: 'What cookies are',
    body: <p>Cookies are small files a website stores in your browser. Similar technologies, such as local storage, work the same way. We call them all “cookies” here.</p>,
  },
  {
    id: 'use',
    title: 'What we use',
    body: (
      <>
        <p>
          {PRODUCT_NAME} uses only the cookies needed to run the site. We do not use advertising or cross-site tracking cookies. [Update this section if analytics or marketing tools are added.]
        </p>
        <div className="overflow-x-auto rounded-xl border">
          <table className="w-full text-left text-sm">
            <thead className="bg-surface-sunken text-xs uppercase tracking-wider text-muted-foreground">
              <tr>
                <th className="px-3 py-2 font-semibold">Name</th>
                <th className="px-3 py-2 font-semibold">Purpose</th>
                <th className="px-3 py-2 font-semibold">Lasts</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              <tr>
                <td className="px-3 py-2 font-mono text-xs">next-auth.session-token (with a __Secure- prefix in production)</td>
                <td className="px-3 py-2">Keeps you signed in (strictly necessary, HTTP-only).</td>
                <td className="px-3 py-2">Up to 7 days</td>
              </tr>
              <tr>
                <td className="px-3 py-2">Sign-in security cookies (CSRF token and callback address)</td>
                <td className="px-3 py-2">Protects sign-in and sign-out from forged requests and returns you to the right page.</td>
                <td className="px-3 py-2">Session</td>
              </tr>
              <tr>
                <td className="px-3 py-2">Theme and display preferences</td>
                <td className="px-3 py-2">Remembers light or dark mode and similar choices in local storage.</td>
                <td className="px-3 py-2">Until cleared</td>
              </tr>
            </tbody>
          </table>
        </div>
      </>
    ),
  },
  {
    id: 'voice',
    title: 'Microphone and voice',
    body: <p>The voice assistant uses your microphone only after you start a call and your browser asks permission. You can revoke the permission in your browser settings at any time.</p>,
  },
  {
    id: 'third',
    title: 'Third-party content',
    body: <p>Some pages load images from our hosting and media providers, and payment pages are hosted by our payment provider where card payment is enabled. Those providers may set their own cookies under their own policies.</p>,
  },
  {
    id: 'control',
    title: 'Your choices',
    body: (
      <p>
        You can block or delete cookies in your browser settings. If you block the strictly necessary ones, signing in will not work. Questions? Email{' '}
        <a href={`mailto:${PRODUCT_SUPPORT_EMAIL}`}>{PRODUCT_SUPPORT_EMAIL}</a>. See also the <a href="/privacy">Privacy Policy</a>.
      </p>
    ),
  },
];

export default function CookiesPage() {
  return (
    <LegalPage
      current="/cookies"
      title="Cookie Policy"
      intro={`${PRODUCT_NAME} keeps cookies to a minimum. This page lists what we set and why.`}
      sections={SECTIONS}
    />
  );
}
