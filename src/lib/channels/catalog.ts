/**
 * Every OTA the channel manager can connect, with what each one needs to go live.
 * Client-safe (no server imports): the console pages, reports and the server all read it.
 *
 * "Direct" means HotelOne talks to the OTA's own API, which every OTA here only opens to
 * approved connectivity partners. "Via Channex" means HotelOne talks to Channex
 * (a white-label channel manager API for PMS companies) and Channex talks to the OTA.
 */

export type ChannelId =
  | 'EXPEDIA'
  | 'BOOKING_COM'
  | 'GOOGLE_HOTELS'
  | 'AIRBNB'
  | 'AGODA'
  | 'TRIP_COM'
  | 'HOPPER'
  | 'PRICELINE'
  | 'HOSTELWORLD';

/** How reservations reach HotelOne on a direct connection */
export type ReservationDelivery =
  | 'pull' // HotelOne polls the OTA (cron, Sync now)
  | 'webhook' // the OTA posts each reservation to HotelOne's webhook URL
  | 'none'; // no OTA bookings: guests book on the HotelOne booking site (Google free booking links)

/** Where the room and rate plan IDs used in mapping come from */
export type RoomCodeSource =
  | 'ota' // fetched from the OTA's API
  | 'pms'; // HotelOne publishes its own codes; the hotel enters them in the OTA's extranet mapping screen

export type ConnectivityProvider = 'CHANNEX';

export interface ChannelInfo {
  id: ChannelId;
  name: string;
  /** One line under the name on the Channels page */
  reach: string;
  /** Name of the API shown in the wizard */
  api: string;
  /** Tailwind classes for the badge, in the OTA's brand colour */
  color: string;
  /** Labels and onboarding steps for a direct live connection */
  direct: {
    idLabel: string;
    idPlaceholder: string;
    userLabel: string;
    passwordLabel: string;
    steps: string[];
    reservations: ReservationDelivery;
    roomCodes: RoomCodeSource;
    promotions: boolean;
  };
  /** Channex can carry this OTA (confirmed on channex.io) */
  viaChannex: boolean;
  /** What the business running HotelOne has to apply for before live mode works */
  partnerAccess: {
    program: string;
    /** Public starting point, when there is one we have checked */
    url: string | null;
    notes: string;
  };
  /** False when the message format is a best guess pending the OTA's spec (shown as a warning) */
  specConfirmed: boolean;
}

const OTA_EXTRANET_CODES = 'HotelOne shows a room code and rate code for each mapped room; enter them in the extranet mapping screen.';

export const CHANNEL_CATALOG: Record<ChannelId, ChannelInfo> = {
  EXPEDIA: {
    id: 'EXPEDIA',
    name: 'Expedia',
    reach: 'Expedia, Hotels.com, Vrbo and the Expedia Group network',
    api: 'Expedia QuickConnect (EQC)',
    color: 'border-[#FFC72C]/60 bg-[#FFC72C]/15 text-foreground',
    direct: {
      idLabel: 'Expedia Hotel ID',
      idPlaceholder: 'e.g. 12345678',
      userLabel: 'EQC API username',
      passwordLabel: 'EQC API password',
      steps: [
        'In Expedia Partner Central, open the property and choose this PMS as its connectivity provider.',
        'Use the Expedia QuickConnect (EQC) API username and password issued to your connectivity account.',
        'The Hotel ID is the numeric property ID shown in Partner Central.',
      ],
      reservations: 'pull',
      roomCodes: 'ota',
      promotions: true,
    },
    viaChannex: true,
    partnerAccess: {
      program: 'Expedia Group connectivity partner program',
      url: 'https://developers.expediagroup.com/supply/lodging',
      notes: 'Certification against Expedia test properties (AR, PARR, BR, BC).',
    },
    specConfirmed: true,
  },
  BOOKING_COM: {
    id: 'BOOKING_COM',
    name: 'Booking.com',
    reach: 'Booking.com and its partner network',
    api: 'Booking.com Connectivity API',
    color: 'border-[#003580]/40 bg-[#003580]/10 text-foreground dark:border-[#5c8ae6]/50 dark:bg-[#5c8ae6]/15',
    direct: {
      idLabel: 'Booking.com Hotel ID',
      idPlaceholder: 'e.g. 1234567',
      userLabel: 'Machine account username',
      passwordLabel: 'Machine account password',
      steps: [
        'In the Booking.com Extranet, go to Account > Connectivity provider and select this PMS.',
        'Use the machine account credentials issued to your connectivity-provider account.',
        'The Hotel ID is the property ID shown at the top of the Extranet.',
      ],
      reservations: 'pull',
      roomCodes: 'ota',
      promotions: true,
    },
    viaChannex: true,
    partnerAccess: {
      program: 'Booking.com Connectivity Partner program',
      url: 'https://connect.booking.com',
      notes: 'Certification of B.XML and OTA messages against a Booking.com test hotel.',
    },
    specConfirmed: true,
  },
  GOOGLE_HOTELS: {
    id: 'GOOGLE_HOTELS',
    name: 'Google Hotels',
    reach: 'Free booking links on Google Search and Maps that send guests to your own booking site',
    api: 'Google Hotel Center ARI',
    color: 'border-[#34A853]/50 bg-[#34A853]/10 text-foreground',
    direct: {
      idLabel: 'Hotel ID in your Hotel Center feed',
      idPlaceholder: 'e.g. the HotelOne property ID',
      userLabel: 'Hotel Center partner key',
      passwordLabel: 'Not used (Google checks the sending IP address)',
      steps: [
        'Your Hotel Center account must be approved as an integration partner (or the hotel must link its own Hotel Center account to this PMS).',
        'Add the HotelOne Point of Sale (shown after you connect) in Hotel Center so free booking links open your booking site.',
        'Add the server IP addresses that send prices to Google in Hotel Center > Settings > Price settings.',
        'The Hotel ID is the ID this hotel has in your Hotel Center hotel list feed.',
      ],
      reservations: 'none',
      roomCodes: 'pms',
      promotions: true,
    },
    viaChannex: false,
    partnerAccess: {
      program: 'Google Hotel Center integration partner (free booking links)',
      url: 'https://developers.google.com/hotels/hotel-prices/dev-guide/ari-overview',
      notes:
        'Google accepts ARI only from allowlisted IP addresses. Vercel functions do not have fixed IPs, so this needs Vercel Static IPs (Secure Compute) or an outbound proxy with a fixed IP.',
    },
    specConfirmed: true,
  },
  AIRBNB: {
    id: 'AIRBNB',
    name: 'Airbnb',
    reach: 'Airbnb, including hotel listings',
    api: 'Airbnb API (software partners)',
    color: 'border-[#FF5A5F]/50 bg-[#FF5A5F]/10 text-foreground',
    direct: {
      idLabel: 'Airbnb host user ID',
      idPlaceholder: 'e.g. 123456789',
      userLabel: 'Not used',
      passwordLabel: 'Host OAuth access token',
      steps: [
        'The hotel signs in with Airbnb and grants HotelOne access to its listings (OAuth). Paste the access token here until the sign-in button is added.',
        'Each Airbnb listing (or multi-unit hotel room type) maps to one HotelOne room type.',
        'Add the webhook URL shown after you connect in the Airbnb partner dashboard so reservations arrive instantly.',
      ],
      reservations: 'webhook',
      roomCodes: 'ota',
      promotions: false,
    },
    viaChannex: true,
    partnerAccess: {
      program: 'Airbnb Software Partner program (API access is invite-only)',
      url: 'https://www.airbnb.com/partner',
      notes: 'Airbnb rarely admits new direct partners. Going through Channex (already an Airbnb Preferred+ software partner) is the realistic route.',
    },
    specConfirmed: false,
  },
  AGODA: {
    id: 'AGODA',
    name: 'Agoda',
    reach: 'Agoda and its Asia-Pacific partner network',
    api: 'Agoda Supply OTA API (2015B)',
    color: 'border-[#5542F6]/40 bg-[#5542F6]/10 text-foreground',
    direct: {
      idLabel: 'Agoda Hotel ID',
      idPlaceholder: 'e.g. 1234567',
      userLabel: 'Agoda supply API username',
      passwordLabel: 'Agoda supply API password',
      steps: [
        'In Agoda YCS, open Settings > Channel manager and select this PMS.',
        OTA_EXTRANET_CODES,
        'Add the webhook URL shown after you connect as the booking push endpoint, so reservations arrive instantly.',
      ],
      reservations: 'webhook',
      roomCodes: 'pms',
      promotions: false,
    },
    viaChannex: true,
    partnerAccess: {
      program: 'Agoda connectivity partner (Agoda Supply developer hub)',
      url: 'https://developer.agoda.com/supply',
      notes: 'Agoda issues supply API credentials and certifies the OTA_HotelAvailNotif / OTA_HotelRateAmountNotif messages and the booking push.',
    },
    specConfirmed: true,
  },
  TRIP_COM: {
    id: 'TRIP_COM',
    name: 'Trip.com',
    reach: 'Trip.com, Ctrip, Qunar and Skyscanner hotel listings',
    api: 'Trip.com Connectivity (OpenTravel)',
    color: 'border-[#287DFA]/40 bg-[#287DFA]/10 text-foreground',
    direct: {
      idLabel: 'Trip.com Hotel ID',
      idPlaceholder: 'e.g. 12345678',
      userLabel: 'Trip.com requestor ID',
      passwordLabel: 'Trip.com message password',
      steps: [
        'In the Trip.com eBooking portal, ask your market manager to connect the hotel to this PMS.',
        OTA_EXTRANET_CODES,
        'Give Trip.com the webhook URL shown after you connect for reservation delivery.',
      ],
      reservations: 'webhook',
      roomCodes: 'pms',
      promotions: false,
    },
    viaChannex: true,
    partnerAccess: {
      program: 'Trip.com Group connectivity partner',
      url: null,
      notes: 'Trip.com gives the endpoint URL, requestor ID and password during onboarding. Set TRIP_COM_OTA_URL to that endpoint.',
    },
    specConfirmed: false,
  },
  HOPPER: {
    id: 'HOPPER',
    name: 'Hopper',
    reach: 'Hopper app hotel inventory (direct supply)',
    api: 'Hopper direct supply',
    color: 'border-[#FA6866]/50 bg-[#FA6866]/10 text-foreground',
    direct: {
      idLabel: 'Hopper property ID',
      idPlaceholder: 'Issued by Hopper',
      userLabel: 'API username',
      passwordLabel: 'API password',
      steps: [
        'Hopper onboards direct hotel supply through approved channel managers. Once HotelOne is approved, Hopper issues credentials per property.',
        OTA_EXTRANET_CODES,
        'Give Hopper the webhook URL shown after you connect for reservation delivery.',
      ],
      reservations: 'webhook',
      roomCodes: 'pms',
      promotions: false,
    },
    viaChannex: false,
    partnerAccess: {
      program: 'Hopper supply partnerships',
      url: null,
      notes:
        'No public API spec. The adapter sends standard OpenTravel messages; expect to adjust it to the spec Hopper shares after approval. Set HOPPER_OTA_URL to the endpoint Hopper gives you.',
    },
    specConfirmed: false,
  },
  PRICELINE: {
    id: 'PRICELINE',
    name: 'Priceline',
    reach: 'Priceline.com (a separate listing from Booking.com)',
    api: 'Priceline Partner connectivity (OpenTravel)',
    color: 'border-[#0068EF]/40 bg-[#0068EF]/10 text-foreground',
    direct: {
      idLabel: 'Priceline Hotel ID',
      idPlaceholder: 'e.g. 700012345',
      userLabel: 'API username',
      passwordLabel: 'API password',
      steps: [
        'In the Priceline Partner Center extranet, choose this PMS as the connectivity provider.',
        OTA_EXTRANET_CODES,
        'Give Priceline the webhook URL shown after you connect for reservation delivery.',
      ],
      reservations: 'webhook',
      roomCodes: 'pms',
      promotions: false,
    },
    viaChannex: false,
    partnerAccess: {
      program: 'Priceline connectivity partner (Priceline Partner Network)',
      url: null,
      notes:
        'Priceline is owned by Booking Holdings but connects separately. The adapter sends standard OpenTravel messages; adjust to Priceline\'s spec after approval. Set PRICELINE_OTA_URL to the endpoint Priceline gives you.',
    },
    specConfirmed: false,
  },
  HOSTELWORLD: {
    id: 'HOSTELWORLD',
    name: 'Hostelworld',
    reach: 'Hostelworld (budget and hostel-style rooms)',
    api: 'Hostelworld channel manager connection',
    color: 'border-[#F25621]/50 bg-[#F25621]/10 text-foreground',
    direct: {
      idLabel: 'Hostelworld property number',
      idPlaceholder: 'e.g. 123456',
      userLabel: 'API username',
      passwordLabel: 'API password',
      steps: [
        'In Hostelworld Inbox, go to Channel manager and select this PMS.',
        OTA_EXTRANET_CODES,
        'Give Hostelworld the webhook URL shown after you connect for reservation delivery.',
      ],
      reservations: 'webhook',
      roomCodes: 'pms',
      promotions: false,
    },
    viaChannex: true,
    partnerAccess: {
      program: 'Hostelworld connectivity partner',
      url: 'https://support.hostelworld.com/knowledge/connecting-to-channel-manager',
      notes: 'Only worth it for budget or hostel-style rooms. Channex already carries Hostelworld, which is the quicker route. Set HOSTELWORLD_OTA_URL for a direct connection.',
    },
    specConfirmed: false,
  },
};

export const CHANNEL_IDS = Object.keys(CHANNEL_CATALOG) as ChannelId[];

export const CHANNEL_NAMES: Record<string, string> = Object.fromEntries(CHANNEL_IDS.map((id) => [id, CHANNEL_CATALOG[id].name]));

export function channelInfo(channel: string): ChannelInfo | undefined {
  return CHANNEL_CATALOG[channel as ChannelId];
}

export const CONNECTIVITY_PROVIDERS: Record<ConnectivityProvider, { name: string; url: string; idLabel: string; passwordLabel: string; steps: string[] }> = {
  CHANNEX: {
    name: 'Channex',
    url: 'https://channex.io',
    idLabel: 'Channex property ID',
    passwordLabel: 'Channex API key',
    steps: [
      'Create the hotel as a property in your Channex white-label account (or with the Channex API), with the same room types.',
      'In Channex, connect the property to the OTA and map Channex rooms and rates to the OTA ones.',
      'Paste the Channex property ID and an API key scoped to it here. Reservations come from the Channex booking feed.',
    ],
  },
};

/** Reservations on this connection: Channex is always pulled from its booking feed. */
export function reservationDelivery(channel: string, provider: string | null | undefined): ReservationDelivery {
  if (provider === 'CHANNEX') return 'pull';
  return channelInfo(channel)?.direct.reservations ?? 'pull';
}

export function roomCodeSource(channel: string, provider: string | null | undefined, mode: string): RoomCodeSource {
  if (mode === 'SANDBOX' || provider === 'CHANNEX') return 'ota';
  return channelInfo(channel)?.direct.roomCodes ?? 'ota';
}
