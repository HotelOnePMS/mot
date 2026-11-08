import type { Metadata } from 'next';
import { LegalPage, type LegalSection } from '@/components/legal/LegalPage';
import { PRODUCT_NAME, PRODUCT_SUPPORT_EMAIL } from '@/config/product';

export const metadata: Metadata = {
  title: 'Privacy Policy',
  description: `How ${PRODUCT_NAME} collects, uses and protects personal data for hotels and guests.`,
  alternates: { canonical: '/privacy' },
};

const SUBPROCESSORS = [
  { name: 'Vercel', purpose: 'Application hosting and delivery', location: '[REGION]' },
  { name: '[Database provider]', purpose: 'Primary database (PostgreSQL)', location: '[REGION]' },
  { name: 'Resend', purpose: 'Transactional email (confirmations, account emails)', location: '[REGION]' },
  { name: 'ElevenLabs / OpenAI', purpose: 'Voice and AI agents (speech, language models)', location: '[REGION]' },
  { name: 'Twilio (if a hotel connects a number)', purpose: 'Phone and messaging', location: '[REGION]' },
  { name: 'Stripe (if enabled)', purpose: 'Card payments', location: '[REGION]' },
  { name: 'Cloudinary / Vercel Blob', purpose: 'Hotel photo storage', location: '[REGION]' },
];

const SECTIONS: LegalSection[] = [
  {
    id: 'roles',
    title: 'Who is responsible for your data',
    body: (
      <>
        <p>
          {PRODUCT_NAME} (“we”) plays two roles. For <strong>hotels’ guest and booking data</strong> we are a <em>processor</em> (service provider): the hotel decides why and how the data is used and we
          process it on the hotel’s behalf. For <strong>account, website and billing data</strong> about hotel staff and visitors we are the <em>controller</em>.
        </p>
        <p>If you are a guest, the hotel you booked with is the controller of your booking data. You can contact the hotel or us; we will help route your request.</p>
      </>
    ),
  },
  {
    id: 'collect',
    title: 'What we collect',
    body: (
      <ul>
        <li>
          <strong>Account data:</strong> name, email, phone (optional), password (stored only as a salted hash) and role.
        </li>
        <li>
          <strong>Booking data:</strong> stay dates, room, number of guests, notes, booking status and payment status, and contact details the guest provides.
        </li>
        <li>
          <strong>Hotel data:</strong> property details, rooms, rates, photos, staff accounts and activity logs.
        </li>
        <li>
          <strong>Voice and chat data:</strong> when someone talks to a hotel’s AI agent we process the conversation, and, where the hotel has turned it on, keep a transcript or message record.
        </li>
        <li>
          <strong>Payments:</strong> where card payment is enabled, card details are entered with our payment provider. We never see or store full card numbers.
        </li>
        <li>
          <strong>Card authorizations:</strong> when someone pays for another person’s stay, the hotel can ask the cardholder to sign an authorization: their name and contact details, billing address, the last four digits of the card, the type, country and last four characters of their photo ID, a photo of that ID (stored encrypted), their signature, and the IP address and device they signed from.
        </li>
        <li>
          <strong>Check-in:</strong> when a guest checks in, the hotel records their photo ID: the type, issuing country, last four characters, expiry date and name in readable form, and the full ID number, date of birth, address and a photo of the front of the ID stored encrypted. The guest signs a registration card on the hotel’s device; we keep it as signed, like a paper card: its wording (with the name, home address and stay details printed on it), their signature, and the IP address and device it was signed on.
        </li>
        <li>
          <strong>Technical data:</strong> IP address, device and browser information, and security logs.
        </li>
      </ul>
    ),
  },
  {
    id: 'use',
    title: 'How we use it',
    body: (
      <ul>
        <li>To provide the Service: take and manage bookings, run the front desk, send confirmations and answer guests.</li>
        <li>To secure the Service, prevent abuse and fix problems.</li>
        <li>To communicate about your account, billing and service changes.</li>
        <li>To meet legal obligations.</li>
        <li>We do not sell personal data, and we do not use guest data to advertise to guests.</li>
      </ul>
    ),
  },
  {
    id: 'basis',
    title: 'Legal bases (where GDPR or similar law applies)',
    body: (
      <p>
        Performing a contract (running accounts and bookings), our legitimate interests (security, product improvement, support), legal obligation, and consent where we ask for it (for example, optional
        recordings).
      </p>
    ),
  },
  {
    id: 'share',
    title: 'Who we share data with',
    body: (
      <>
        <p>With the hotel you booked with, and with service providers who help us run the Service under written terms (“subprocessors”). Current list (draft, to be completed before launch):</p>
        <div className="overflow-x-auto rounded-xl border">
          <table className="w-full text-left text-sm">
            <thead className="bg-surface-sunken text-xs uppercase tracking-wider text-muted-foreground">
              <tr>
                <th className="px-3 py-2 font-semibold">Provider</th>
                <th className="px-3 py-2 font-semibold">Purpose</th>
                <th className="px-3 py-2 font-semibold">Location</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {SUBPROCESSORS.map((s) => (
                <tr key={s.name}>
                  <td className="px-3 py-2 font-medium">{s.name}</td>
                  <td className="px-3 py-2">{s.purpose}</td>
                  <td className="px-3 py-2">{s.location}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p>We may also disclose data when the law requires it, or in a business transfer, with notice to account holders.</p>
      </>
    ),
  },
  {
    id: 'transfers',
    title: 'International transfers',
    body: <p>Data may be processed in countries other than yours, including the United States. Where required, we rely on appropriate safeguards such as standard contractual clauses.</p>,
  },
  {
    id: 'retention',
    title: 'How long we keep data',
    body: (
      <ul>
        <li>Account data: while the account is open, then deleted or anonymised within [90] days of closure.</li>
        <li>Booking and guest data: for as long as the hotel keeps it in the Service, and as the hotel instructs. Records we must keep for tax or accounting are kept for the legally required period.</li>
        <li>Photos of ID taken for a card authorization: deleted 180 days after check-out (or the period the hotel’s deployment sets), unless a payment dispute about the stay is still open. The rest of the signed authorization is kept with the booking as a record.</li>
        <li>Photos of ID and the encrypted ID details recorded at check-in: deleted on the same schedule. The ID’s type, country, last four characters and the signed registration card (including the address printed on it) are kept with the booking as a record.</li>
        <li>Voice transcripts and messages: [30–90] days unless the hotel sets a different period.</li>
        <li>Security and access logs: up to [12] months.</li>
        <li>Backups roll off within [35] days.</li>
      </ul>
    ),
  },
  {
    id: 'security',
    title: 'Security',
    body: (
      <p>
        Traffic uses HTTPS. Passwords are hashed. Access is limited by role and by property so staff see only their own hotel’s data, and sensitive hotel credentials are encrypted. No system is perfectly
        secure; if a breach affects your data we will tell you and the hotel as the law requires.
      </p>
    ),
  },
  {
    id: 'rights',
    title: 'Your rights',
    body: (
      <>
        <p>
          Depending on where you live you may have the right to access, correct, delete or export your data, to object to or restrict some processing, to withdraw consent, and to complain to your data
          protection authority.
        </p>
        <p>
          Email <a href={`mailto:${PRODUCT_SUPPORT_EMAIL}`}>{PRODUCT_SUPPORT_EMAIL}</a>. If your request is about a stay, we may pass it to the hotel (the controller) or ask them to act on it. We will
          respond within the time the law requires (usually one month).
        </p>
      </>
    ),
  },
  {
    id: 'children',
    title: 'Children',
    body: <p>The Service is not directed at children under 16, and accounts are for adults. Hotels may record the number of children travelling as part of a booking.</p>,
  },
  {
    id: 'changes',
    title: 'Changes and contact',
    body: (
      <p>
        We will post changes here and notify account holders of material changes. Contact: <a href={`mailto:${PRODUCT_SUPPORT_EMAIL}`}>{PRODUCT_SUPPORT_EMAIL}</a>. Postal address: [COMPANY NAME AND ADDRESS].
      </p>
    ),
  },
];

export default function PrivacyPage() {
  return (
    <LegalPage
      current="/privacy"
      title="Privacy Policy"
      intro={`This policy explains what personal data ${PRODUCT_NAME} handles, why, who sees it and what choices you have.`}
      sections={SECTIONS}
    />
  );
}
