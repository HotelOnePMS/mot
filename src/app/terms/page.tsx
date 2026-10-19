import type { Metadata } from 'next';
import { LegalPage, type LegalSection } from '@/components/legal/LegalPage';
import { PRODUCT_NAME, PRODUCT_SUPPORT_EMAIL } from '@/config/product';

export const metadata: Metadata = {
  title: 'Terms of Service',
  description: `The terms that apply when a hotel or a guest uses ${PRODUCT_NAME}.`,
  alternates: { canonical: '/terms' },
};

const SECTIONS: LegalSection[] = [
  {
    id: 'who',
    title: 'Who these terms are with',
    body: (
      <>
        <p>
          These terms are an agreement between you and the operator of {PRODUCT_NAME} (“we”, “us”). They cover the {PRODUCT_NAME} website, the staff console, the guest booking pages, the voice and chat
          agents, and the APIs we provide (together, the “Service”).
        </p>
        <p>
          If you use the Service for a hotel, you confirm you are allowed to bind that business (“the Hotel”). If you only book a stay, you are a “Guest”. By creating an account or using the Service you
          accept these terms.
        </p>
      </>
    ),
  },
  {
    id: 'service',
    title: 'What the Service is',
    body: (
      <>
        <p>
          {PRODUCT_NAME} is software for independent hotels: a booking website, a reservation system, an AI front desk and related tools. Each hotel runs its own business on the Service. The contract
          for a stay is between the Guest and the Hotel; we are not the hotel, are not a travel agent, and are not a party to that contract.
        </p>
        <p>We may change, add or remove features. If we make a change that materially reduces what a paying Hotel gets, we will give reasonable notice.</p>
      </>
    ),
  },
  {
    id: 'accounts',
    title: 'Accounts and security',
    body: (
      <ul>
        <li>Give accurate information and keep your login private. You are responsible for what happens under your account, including your staff’s accounts.</li>
        <li>Hotels decide who on their team gets access and at what role, and must remove access when someone leaves.</li>
        <li>Tell us promptly at {PRODUCT_SUPPORT_EMAIL} if you think an account has been compromised.</li>
      </ul>
    ),
  },
  {
    id: 'hotels',
    title: 'Hotel responsibilities',
    body: (
      <ul>
        <li>Keep rooms, rates, availability, photos, policies and contact details accurate. Bookings made through the Service are the Hotel’s to honour.</li>
        <li>Handle Guest bookings, cancellations, refunds and complaints under your own published policies and applicable law.</li>
        <li>Review what the AI agents say and do for your property. Changes to bookings made by an agent follow a confirmation step by a person; you remain responsible for your settings and policies.</li>
        <li>Get the consents and give the notices your local law requires for recording or transcribing calls handled by the voice agent.</li>
      </ul>
    ),
  },
  {
    id: 'guests',
    title: 'Guest use',
    body: (
      <ul>
        <li>Give accurate booking details and use the Service only to make genuine bookings.</li>
        <li>Cancellation and date-change rules are shown on the hotel’s page and in your confirmation. The Hotel’s rules apply to your stay.</li>
        <li>Payment is made to the Hotel, either at the hotel or, where the Hotel has enabled it, through our payment partner. We do not store card numbers.</li>
      </ul>
    ),
  },
  {
    id: 'acceptable',
    title: 'Acceptable use',
    body: (
      <>
        <p>Do not:</p>
        <ul>
          <li>break the law, or use the Service to defraud or harass anyone;</li>
          <li>probe, scrape or overload the Service, or try to access another hotel’s data;</li>
          <li>upload malware or content you have no right to share;</li>
          <li>resell or white-label the Service without our written agreement.</li>
        </ul>
        <p>We may suspend access to protect the Service, other customers or Guests, and will tell you why where we reasonably can.</p>
      </>
    ),
  },
  {
    id: 'data',
    title: 'Data and privacy',
    body: (
      <p>
        Hotels own their booking and guest data. For guest data a Hotel puts into the Service we act as its service provider (“processor”) and process it only on the Hotel’s instructions; a data
        processing agreement is available on request. How we handle personal data is described in the <a href="/privacy">Privacy Policy</a> and our use of cookies in the{' '}
        <a href="/cookies">Cookie Policy</a>.
      </p>
    ),
  },
  {
    id: 'fees',
    title: 'Fees and payment',
    body: (
      <>
        <p>
          Prices for hotels are shown on our website or in your order. Unless stated otherwise, fees are charged in advance, are non-refundable except where the law requires, and exclude taxes. We will
          give at least 30 days’ notice before changing the price of an existing plan.
        </p>
        <p>Card payments, where enabled, are processed by a third-party payment provider under its own terms. Funds go to the Hotel; we do not hold Guest money.</p>
      </>
    ),
  },
  {
    id: 'ai',
    title: 'AI features',
    body: (
      <p>
        The AI agents can be wrong. They may mishear, misunderstand or give incomplete answers. Hotels should check the information the agents rely on (rates, policies, FAQs) and review the logs.
        Do not rely on an AI agent for emergencies or for legal, medical or safety advice.
      </p>
    ),
  },
  {
    id: 'ip',
    title: 'Intellectual property',
    body: (
      <p>
        We own the Service and its software. Hotels keep ownership of their content (names, logos, photos, descriptions) and give us a licence to host and display it to run the Service for them.
        Feedback you give us may be used without obligation.
      </p>
    ),
  },
  {
    id: 'availability',
    title: 'Availability and support',
    body: (
      <p>
        We work to keep the Service available but do not promise it will be uninterrupted or error-free. Planned maintenance and third-party outages (hosting, telephony, payments, AI providers) may
        affect it. Support is by email at {PRODUCT_SUPPORT_EMAIL}.
      </p>
    ),
  },
  {
    id: 'liability',
    title: 'Warranty and liability',
    body: (
      <>
        <p>The Service is provided “as is” to the extent the law allows. We do not give implied warranties of merchantability, fitness for a particular purpose or non-infringement.</p>
        <p>
          To the extent the law allows, we are not liable for indirect or consequential loss (including lost profit or lost bookings), and our total liability for any claim is limited to the fees the
          Hotel paid us in the 12 months before the claim. Nothing here limits liability that cannot be limited by law.
        </p>
      </>
    ),
  },
  {
    id: 'termination',
    title: 'Ending your use',
    body: (
      <p>
        You may stop using the Service and ask us to close your account at any time. We may end or suspend access for a serious or repeated breach of these terms. Hotels can export their data before
        closing; after closure we delete or anonymise data as described in the Privacy Policy.
      </p>
    ),
  },
  {
    id: 'changes',
    title: 'Changes, law and contact',
    body: (
      <>
        <p>We may update these terms. We will post the new version here and, for material changes, notify account holders. Continued use after the change means you accept it.</p>
        <p>
          These terms are governed by the laws of [GOVERNING LAW / JURISDICTION], and the courts there have jurisdiction, subject to any mandatory consumer rights where you live. Contact:{' '}
          <a href={`mailto:${PRODUCT_SUPPORT_EMAIL}`}>{PRODUCT_SUPPORT_EMAIL}</a>.
        </p>
      </>
    ),
  },
];

export default function TermsPage() {
  return (
    <LegalPage
      current="/terms"
      title="Terms of Service"
      intro={`These terms explain how hotels and guests may use ${PRODUCT_NAME}. Please read them before you create an account or make a booking.`}
      sections={SECTIONS}
    />
  );
}
