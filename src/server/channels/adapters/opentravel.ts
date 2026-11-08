/**
 * OpenTravel (OTA) 2003/05 message pieces shared by the OTAs that speak it:
 * Booking.com, Agoda, Trip.com, Google Hotels, and the best-guess adapters for
 * Priceline, Hopper and Hostelworld.
 *
 *   OTA_HotelAvailNotifRQ       rooms to sell (BookingLimit), open/close, min stay
 *   OTA_HotelRateAmountNotifRQ  prices
 *   OTA_HotelResNotifRQ         new reservations (pushed or pulled)
 *   OTA_HotelResModifyNotifRQ   modifications and cancellations
 *   OTA_HotelResRQ / OTA_CancelRQ  booking push used by Agoda's generic push API
 */
import type { AriUpdate, OtaReservation, OtaReservationAction, ReservationConfirmation } from '../types';
import { asArray, attr, esc, text } from '../xml';

export const OTA_NS = 'http://www.opentravel.org/OTA/2003/05';

// OTA AgeQualifyingCode values
const AGE_ADULT = '10';
const AGE_CHILD = '8';

export function timestamp(): string {
  return new Date().toISOString().replace(/\.\d{3}Z$/, '+00:00');
}

export function echoToken(): string {
  return `ho-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

/** AvailStatusMessage elements for one update: rooms to sell per room type, restrictions per rate plan */
export function buildAvailMessages(update: AriUpdate, { includeBookingLimit = true } = {}): string[] {
  const control = (withRatePlan: boolean) =>
    `<StatusApplicationControl Start="${update.from}" End="${update.to}" InvTypeCode="${esc(update.otaRoomTypeId)}"${
      withRatePlan ? ` RatePlanCode="${esc(update.otaRatePlanId)}"` : ''
    }/>`;
  const messages: string[] = [];

  // Rooms to sell is set per room, without a rate plan
  if (includeBookingLimit && update.available !== null) {
    messages.push(`<AvailStatusMessage BookingLimit="${update.available}">${control(false)}</AvailStatusMessage>`);
  }
  if (update.closed !== null || update.minStay !== null) {
    const lengthOfStay =
      update.minStay === null
        ? ''
        : `<LengthsOfStay><LengthOfStay Time="${update.minStay}" TimeUnit="Day" MinMaxMessageType="SetMinLOS"/></LengthsOfStay>`;
    const status = update.closed === null ? '' : `<RestrictionStatus Status="${update.closed ? 'Close' : 'Open'}"/>`;
    messages.push(`<AvailStatusMessage>${control(true)}${lengthOfStay}${status}</AvailStatusMessage>`);
  }
  return messages;
}

/** RateAmountMessage for one update; `amountAttr` is AmountAfterTax unless the OTA wants pre-tax prices */
export function buildRateMessage(
  update: AriUpdate,
  currency: string,
  amountAttr: 'AmountAfterTax' | 'AmountBeforeTax' = 'AmountAfterTax'
): string | null {
  if (update.price === null) return null;
  return `<RateAmountMessage>
      <StatusApplicationControl Start="${update.from}" End="${update.to}" InvTypeCode="${esc(update.otaRoomTypeId)}" RatePlanCode="${esc(update.otaRatePlanId)}"/>
      <Rates><Rate><BaseByGuestAmts><BaseByGuestAmt ${amountAttr}="${update.price.toFixed(2)}" DecimalPlaces="2" CurrencyCode="${esc(currency)}"/></BaseByGuestAmts></Rate></Rates>
    </RateAmountMessage>`;
}

function actionFrom(resStatus: string | undefined, fallback: OtaReservationAction): OtaReservationAction {
  const status = (resStatus ?? '').toLowerCase();
  if (status === 'cancel' || status === 'cancelled') return 'CANCEL';
  if (status === 'modify') return 'MODIFY';
  if (status === 'commit' || status === 'book' || status === 'reserved') return 'BOOK';
  return fallback;
}

/**
 * Turns one OTA HotelReservation into one normalized reservation per room type.
 * `label` names the OTA in guest-name fallbacks and the payment note.
 */
export function parseHotelReservation(reservation: any, fallbackAction: OtaReservationAction, label: string): OtaReservation[] {
  const action = actionFrom(attr(reservation, 'ResStatus'), fallbackAction);

  const globalInfo = reservation.ResGlobalInfo ?? {};
  const reservationIds = asArray(globalInfo.HotelReservationIDs?.HotelReservationID);
  const groupId = attr(reservationIds[0], 'ResID_Value') ?? attr(asArray(reservation.UniqueID)[0], 'ID') ?? '';
  if (!groupId) return [];

  const customer = asArray(reservation.ResGuests?.ResGuest)[0]?.Profiles?.ProfileInfo?.Profile?.Customer;
  const guest = {
    firstName: text(customer?.PersonName?.GivenName) || label,
    lastName: text(customer?.PersonName?.Surname) || 'Guest',
    email: text(customer?.Email) || null,
    phone: attr(customer?.Telephone, 'PhoneNumber') ?? null,
  };
  const globalTotal = globalInfo.Total;
  const roomStays = asArray(reservation.RoomStays?.RoomStay);

  // Cancellations may arrive without room stays
  if (roomStays.length === 0) {
    return [
      {
        externalId: groupId,
        reservationGroupId: groupId,
        action,
        otaRoomTypeId: null,
        otaRatePlanId: null,
        checkIn: null,
        checkOut: null,
        rooms: 0,
        adults: 0,
        children: 0,
        totalAmount: attr(globalTotal, 'AmountAfterTax') ? Number(attr(globalTotal, 'AmountAfterTax')) : null,
        currency: attr(globalTotal, 'CurrencyCode') ?? null,
        guest,
        specialRequests: null,
        paymentModel: null,
        raw: reservation,
      },
    ];
  }

  const byRoomType = new Map<string, any[]>();
  for (const stay of roomStays) {
    const roomTypeCode = attr(asArray(stay.RoomTypes?.RoomType)[0], 'RoomTypeCode') ?? '';
    byRoomType.set(roomTypeCode, [...(byRoomType.get(roomTypeCode) ?? []), stay]);
  }

  const split = byRoomType.size > 1;
  return Array.from(byRoomType.entries()).map(([roomTypeCode, stays]) => {
    const first = stays[0];
    let adults = 0;
    let children = 0;
    let total = 0;
    let hasTotal = false;
    const requests: string[] = [];
    for (const stay of stays) {
      for (const count of asArray(stay.GuestCounts?.GuestCount)) {
        const value = Number(attr(count, 'Count') ?? 0);
        if (attr(count, 'AgeQualifyingCode') === AGE_CHILD) children += value;
        else if ((attr(count, 'AgeQualifyingCode') ?? AGE_ADULT) === AGE_ADULT) adults += value;
      }
      const amount = attr(stay.Total, 'AmountAfterTax');
      if (amount) {
        total += Number(amount);
        hasTotal = true;
      }
      for (const request of asArray(stay.SpecialRequests?.SpecialRequest)) {
        const value = text(request.Text) || text(request);
        if (value) requests.push(value);
      }
    }
    const globalAmount = attr(globalTotal, 'AmountAfterTax');

    return {
      externalId: split ? `${groupId}-${roomTypeCode}` : groupId,
      reservationGroupId: groupId,
      action,
      otaRoomTypeId: roomTypeCode || null,
      otaRatePlanId: attr(asArray(first.RatePlans?.RatePlan)[0], 'RatePlanCode') ?? null,
      checkIn: attr(first.TimeSpan, 'Start') ?? null,
      checkOut: attr(first.TimeSpan, 'End') ?? null,
      rooms: stays.length,
      adults: Math.max(adults, 1),
      children,
      totalAmount: hasTotal ? total : !split && globalAmount ? Number(globalAmount) : null,
      currency: attr(first.Total, 'CurrencyCode') ?? attr(globalTotal, 'CurrencyCode') ?? null,
      guest,
      specialRequests: requests.join('\n') || null,
      paymentModel: label,
      raw: reservation,
    };
  });
}

/** Root elements an OTA may push to the webhook, with the action they imply */
const PUSH_ROOTS: Array<{ root: string; list: (node: any) => any[]; action: OtaReservationAction }> = [
  { root: 'OTA_HotelResNotifRQ', list: (n) => asArray(n.HotelReservations?.HotelReservation), action: 'BOOK' },
  { root: 'OTA_HotelResRQ', list: (n) => asArray(n.HotelReservations?.HotelReservation), action: 'BOOK' },
  { root: 'OTA_HotelResModifyNotifRQ', list: (n) => asArray(n.HotelResModifies?.HotelResModify), action: 'MODIFY' },
];

export function pushedRootName(parsed: Record<string, any>): string | null {
  for (const name of [...PUSH_ROOTS.map((r) => r.root), 'OTA_CancelRQ']) {
    if (parsed[name]) return name;
  }
  return null;
}

/** Reservations in a pushed OTA message (new, modified or OTA_CancelRQ) */
export function parsePushedReservations(parsed: Record<string, any>, label: string): OtaReservation[] {
  for (const { root, list, action } of PUSH_ROOTS) {
    const node = parsed[root];
    if (node) return list(node).flatMap((reservation) => parseHotelReservation(reservation, action, label));
  }
  const cancel = parsed.OTA_CancelRQ;
  if (cancel) {
    const ids = asArray(cancel.UniqueID);
    const id = attr(ids.find((u: any) => attr(u, 'Type') === '14') ?? ids[0], 'ID');
    if (!id) return [];
    return [
      {
        externalId: id,
        reservationGroupId: id,
        action: 'CANCEL',
        otaRoomTypeId: null,
        otaRatePlanId: null,
        checkIn: null,
        checkOut: null,
        rooms: 0,
        adults: 0,
        children: 0,
        totalAmount: null,
        currency: null,
        guest: { firstName: label, lastName: 'Guest', email: null, phone: null },
        specialRequests: null,
        paymentModel: null,
        raw: cancel,
      },
    ];
  }
  return [];
}

/**
 * The RS for a pushed message: Success plus HotelOne's confirmation number per
 * reservation (ResID_Type 10 = the hotel's own confirmation), or Errors.
 */
export function pushedResponse(rootName: string, confirmations: ReservationConfirmation[], error: string | null): string {
  const rsName = rootName.replace(/RQ$/, 'RS');
  const head = `<?xml version="1.0" encoding="UTF-8"?>\n<${rsName} xmlns="${OTA_NS}" TimeStamp="${timestamp()}" Version="1.0">`;
  if (error) {
    return `${head}\n  <Errors><Error Type="3" ShortText="${esc(error.slice(0, 250))}"/></Errors>\n</${rsName}>`;
  }
  if (rootName === 'OTA_CancelRQ') {
    const first = confirmations[0];
    return `${head}\n  <Success/>${
      first ? `\n  <UniqueID Type="14" ID="${esc(first.reservationGroupId)}"/>\n  <CancelInfoRS><UniqueID Type="10" ID="${esc(first.pmsConfirmationNumber)}"/></CancelInfoRS>` : ''
    }\n</${rsName}>`;
  }
  const element = rootName === 'OTA_HotelResModifyNotifRQ' ? 'HotelResModify' : 'HotelReservation';
  const list = rootName === 'OTA_HotelResModifyNotifRQ' ? 'HotelResModifies' : 'HotelReservations';
  const items = confirmations
    .map(
      (c) => `    <${element}>
      <UniqueID Type="14" ID="${esc(c.reservationGroupId)}"/>
      <ResGlobalInfo><HotelReservationIDs><HotelReservationID ResID_Type="10" ResID_Value="${esc(c.pmsConfirmationNumber)}"/></HotelReservationIDs></ResGlobalInfo>
    </${element}>`
    )
    .join('\n');
  return `${head}\n  <Success/>\n  <${list}>\n${items}\n  </${list}>\n</${rsName}>`;
}
