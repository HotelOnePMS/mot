/**
 * Central product configuration.
 *
 * The product name lives ONLY here. Renamed 2026-10-15: "HotelOne"
 * (hotelone.site; formerly StayOS). Every platform-brand surface (landing,
 * onboarding, nav, emails, titles, voice agents) must import PRODUCT_NAME
 * from here — never hardcode it.
 */
export const PRODUCT_NAME = "HotelOne";

export const PRODUCT_DOMAIN = "hotelone.site";
export const PRODUCT_URL = `https://${PRODUCT_DOMAIN}`;

// The non-breaking space keeps the dash from starting a line.
export const PRODUCT_TAGLINE = "Your hotel, fully booked — on your own website.";

export const PRODUCT_DESCRIPTION =
  "The all-in-one platform for independent hotels: a white-labeled booking website, an AI agent that answers calls and chats like your best front-desk clerk, and one dashboard that keeps your booking channels in sync.";

export const PRODUCT_SUPPORT_EMAIL = `hello@${PRODUCT_DOMAIN}`;

/**
 * Shared public-demo logins live on a domain that never resolves, so no
 * real email is ever sent to them. The old @stayos.demo domain is still
 * recognised until every database has been migrated.
 */
export const DEMO_EMAIL_DOMAIN = "hotelone.demo";
export const isDemoEmail = (email: string) => /@(hotelone|stayos)\.demo$/i.test(email.trim());
export const demoEmail = (local: string) => `${local}@${DEMO_EMAIL_DOMAIN}`;
