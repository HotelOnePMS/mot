/* eslint-disable @typescript-eslint/no-require-imports */
/**
 * Demo seed: one fully-operational property (The Saltwater Inn) with staff
 * for every role, numbered rooms, a realistic "today" at the front desk,
 * activity history and a configured voice front desk; a second hotel that
 * keeps its own PMS (Harbor Motel, bridge path); and two listing-only
 * properties.
 *
 * Dev: wipes the database first. Production: never wipes unless
 * ALLOW_SEED_WIPE=true, and never creates an admin without ADMIN_SEED_PASSWORD.
 *
 * Demo logins (password: demo1234 unless overridden by DEMO_PASSWORD):
 *   owner@hotelone.demo · manager@hotelone.demo · frontdesk@hotelone.demo
 *   housekeeping@hotelone.demo · guest@hotelone.demo
 */
const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');

const prisma = new PrismaClient();
const TZ = process.env.HOTEL_TIMEZONE || 'America/Los_Angeles';

// ---------- calendar helpers (dates are calendar days at 12:00 UTC) ----------
const today = new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
function addDays(day, n) {
  const d = new Date(`${day}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
const noon = (day) => new Date(`${day}T12:00:00Z`);
const midnight = (day) => new Date(`${day}T00:00:00Z`);
const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const code = () => Array.from({ length: 6 }, () => CODE_ALPHABET[crypto.randomInt(CODE_ALPHABET.length)]).join('');

async function wipe() {
  console.log('Clearing existing data…');
  await prisma.agentAuditLog.deleteMany({});
  await prisma.bridgeTask.deleteMany({});
  await prisma.pmsConnection.deleteMany({});
  await prisma.guestRequest.deleteMany({});
  await prisma.voiceSession.deleteMany({});
  await prisma.voiceAgentConfig.deleteMany({});
  await prisma.roomHousekeeping.deleteMany({});
  await prisma.bookingStatusHistory.deleteMany({});
  await prisma.booking.deleteMany({});
  await prisma.room.deleteMany({});
  await prisma.roomTypeRate.deleteMany({});
  await prisma.roomAvailability.deleteMany({});
  await prisma.roomTypePhoto.deleteMany({});
  await prisma.roomType.deleteMany({});
  await prisma.propertyPhoto.deleteMany({});
  await prisma.userPropertyAssignment.deleteMany({});
  await prisma.property.deleteMany({});
  await prisma.user.deleteMany({});
}

async function main() {
  // Builds on Vercel count as production even if NODE_ENV isn't set yet: never wipe there.
  const isProduction = process.env.NODE_ENV === 'production' || !!process.env.VERCEL;
  const allowWipe = process.env.ALLOW_SEED_WIPE === 'true' || !isProduction;
  if (allowWipe) await wipe();
  else console.log('Skipping data wipe (production without ALLOW_SEED_WIPE=true).');

  // ---------- users ----------
  const adminPassword = process.env.ADMIN_SEED_PASSWORD;
  if (isProduction && !adminPassword) {
    console.warn('NODE_ENV=production and ADMIN_SEED_PASSWORD not set — skipping admin creation.');
  } else {
    if (!adminPassword) console.warn('ADMIN_SEED_PASSWORD not set — using insecure default admin password (dev only).');
    await prisma.user.upsert({
      where: { email: 'admin@motelbooking.com' },
      update: {},
      create: {
        email: 'admin@motelbooking.com',
        password: await bcrypt.hash(adminPassword || 'admin123', 10),
        firstName: 'Platform',
        lastName: 'Admin',
        role: 'ADMIN',
      },
    });
  }

  if (isProduction && process.env.SEED_DEMO !== 'true') {
    console.log('Production: demo property/staff not seeded (set SEED_DEMO=true to include them).');
    return;
  }

  const demoHash = await bcrypt.hash(process.env.DEMO_PASSWORD || 'demo1234', 10);
  const mkUser = (email, firstName, lastName, role, phone) =>
    prisma.user.upsert({
      where: { email },
      // Re-running repairs the shared demo logins (password, role, active).
      update: /@(hotelone|stayos)\.demo$/.test(email) ? { password: demoHash, role, isActive: true } : {},
      create: { email, password: demoHash, firstName, lastName, role, phone: phone || null },
    });

  const owner = await mkUser('owner@hotelone.demo', 'Maya', 'Chen', 'OWNER', '+1 831 555 0101');
  const manager = await mkUser('manager@hotelone.demo', 'Diego', 'Alvarez', 'MANAGER', '+1 831 555 0102');
  const desk = await mkUser('frontdesk@hotelone.demo', 'Priya', 'Patel', 'FRONT_DESK', '+1 831 555 0103');
  const hk1 = await mkUser('housekeeping@hotelone.demo', 'Rosa', 'Martinez', 'HOUSEKEEPER', '+1 831 555 0104');
  const hk2 = await mkUser('housekeeping2@hotelone.demo', 'Tom', 'Becker', 'HOUSEKEEPER', '+1 831 555 0105');
  const guestUser = await mkUser('guest@hotelone.demo', 'Alex', 'Rivera', 'CUSTOMER', '+1 415 555 0199');
  await prisma.user.upsert({
    where: { email: 'customer@example.com' },
    update: {},
    create: { email: 'customer@example.com', password: demoHash, firstName: 'John', lastName: 'Doe', role: 'CUSTOMER' },
  });

  const guestNames = [
    ['Jordan', 'Smith'], ['Emily', 'Nakamura'], ['Marcus', 'Johnson'], ['Sofia', 'Rossi'], ['Liam', "O'Connor"],
    ['Aisha', 'Khan'], ['Noah', 'Williams'], ['Chloe', 'Dubois'], ['Ethan', 'Park'], ['Grace', 'Okafor'],
    ['Lucas', 'Silva'], ['Hannah', 'Becker'], ['Omar', 'Haddad'], ['Mia', 'Thompson'], ['Ben', 'Carter'],
    ['Zoe', 'Martin'], ['Ravi', 'Iyer'], ['Elena', 'Popescu'], ['Sam', 'Wright'], ['Ines', 'Moreau'],
  ];
  const guests = [];
  for (const [first, last] of guestNames) {
    const email = `${first}.${last}`.toLowerCase().replace(/[^a-z.]/g, '') + '@example.com';
    guests.push(await mkUser(email, first, last, 'CUSTOMER', `+1 555 01${String(guests.length).padStart(2, '0')}`));
  }

  // Safe to re-run (e.g. on every deploy): the hotels are created once.
  if (!allowWipe && (await prisma.property.findFirst({ where: { name: 'The Saltwater Inn', isDemo: true }, select: { id: true } }))) {
    // The platform was renamed (StayOS → HotelOne). Existing demo hotels are
    // never re-created, so swap the old name in their descriptions — once.
    const renamed = await prisma.property.findMany({ where: { isDemo: true, description: { contains: 'StayOS' } }, select: { id: true, description: true } });
    for (const p of renamed) {
      await prisma.property.update({ where: { id: p.id }, data: { description: p.description.replaceAll('StayOS', 'HotelOne') } });
    }
    if (renamed.length) console.log(`Renamed StayOS → HotelOne in ${renamed.length} demo hotel description(s).`);
    console.log('Demo hotels already present — logins checked, nothing else to seed.');
    return;
  }

  // ---------- the operational demo property ----------
  const inn = await prisma.property.create({
    data: {
      name: 'The Saltwater Inn',
      type: 'Boutique',
      tagline: 'Wake up to the Pacific.',
      description:
        'A 22-room boutique inn steps from West Cliff Drive. Sunlit rooms, a fire-pit garden, bikes on the house and the best sunset in Santa Cruz.',
      address: '210 West Cliff Drive',
      city: 'Santa Cruz',
      state: 'CA',
      zipCode: '95060',
      phone: '+1 831 555 0100',
      email: 'stay@saltwaterinn.example',
      primaryColor: '#0E7490',
      amenities: ['Ocean views', 'Free Wi-Fi', 'Fire-pit garden', 'Free parking', 'Bikes on the house', 'Breakfast', 'Pet friendly'],
      isDemo: true,
      interfaceMode: 'AGENTIC',
      photos: {
        create: [
          { url: 'https://images.unsplash.com/photo-1571896349842-33c89424de2d?auto=format&fit=crop&w=1600&q=80', publicId: 'saltwater_main', isMain: true },
          { url: 'https://images.unsplash.com/photo-1582719508461-905c673771fd?auto=format&fit=crop&w=1600&q=80', publicId: 'saltwater_room' },
          { url: 'https://images.unsplash.com/photo-1507525428034-b723cf961d3e?auto=format&fit=crop&w=1600&q=80', publicId: 'saltwater_beach' },
          { url: 'https://images.unsplash.com/photo-1445019980597-93fa8acb246c?auto=format&fit=crop&w=1600&q=80', publicId: 'saltwater_lobby' },
        ],
      },
    },
  });

  const rtOcean = await prisma.roomType.create({
    data: {
      propertyId: inn.id,
      name: 'Ocean King',
      description: 'King bed, floor-to-ceiling windows and a private balcony over the bay.',
      capacity: 2,
      basePrice: 289,
      totalRooms: 8,
      amenities: ['King bed', 'Ocean view', 'Balcony', 'Rain shower', 'Espresso machine'],
      photos: { create: [{ url: 'https://images.unsplash.com/photo-1590490360182-c33d57733427?auto=format&fit=crop&w=1200&q=80', publicId: 'ocean_king', isMain: true }] },
    },
  });
  const rtGarden = await prisma.roomType.create({
    data: {
      propertyId: inn.id,
      name: 'Garden Queen',
      description: 'A calm queen room opening onto the fire-pit garden.',
      capacity: 2,
      basePrice: 189,
      totalRooms: 10,
      amenities: ['Queen bed', 'Garden patio', 'Walk-in shower', 'Mini fridge'],
      photos: { create: [{ url: 'https://images.unsplash.com/photo-1566665797739-1674de7a421a?auto=format&fit=crop&w=1200&q=80', publicId: 'garden_queen', isMain: true }] },
    },
  });
  const rtSuite = await prisma.roomType.create({
    data: {
      propertyId: inn.id,
      name: 'Family Suite',
      description: 'Two rooms, a sofa bed and a kitchenette — space for the whole crew.',
      capacity: 5,
      basePrice: 349,
      totalRooms: 4,
      amenities: ['King + 2 twins', 'Sofa bed', 'Kitchenette', 'Partial ocean view'],
      photos: { create: [{ url: 'https://images.unsplash.com/photo-1578683010236-d716f9a3f461?auto=format&fit=crop&w=1200&q=80', publicId: 'family_suite', isMain: true }] },
    },
  });

  // Rooms: floor 1 garden, floors 2–3 ocean, suites on 3–4.
  const roomDefs = [
    ...['101', '102', '103', '104', '105', '106', '107', '108', '109', '110'].map((n, i) => ({
      n, floor: '1', rt: rtGarden.id, tags: [i === 0 ? 'accessible' : null, i >= 7 ? 'quiet' : null].filter(Boolean),
    })),
    ...['201', '202', '203', '204'].map((n, i) => ({ n, floor: '2', rt: rtOcean.id, tags: i === 3 ? ['corner'] : [] })),
    ...['301', '302', '303', '304'].map((n, i) => ({ n, floor: '3', rt: rtOcean.id, tags: i >= 2 ? ['quiet'] : ['view'] })),
    ...['305', '306'].map((n) => ({ n, floor: '3', rt: rtSuite.id, tags: [] })),
    ...['401', '402'].map((n) => ({ n, floor: '4', rt: rtSuite.id, tags: ['quiet', 'view'] })),
  ];
  const rooms = {};
  for (const d of roomDefs) {
    rooms[d.n] = await prisma.room.create({
      data: { propertyId: inn.id, roomTypeId: d.rt, roomNumber: d.n, floor: d.floor, tags: d.tags, status: 'CLEAN' },
    });
  }

  for (const u of [owner, manager, desk, hk1, hk2]) {
    await prisma.userPropertyAssignment.create({ data: { userId: u.id, propertyId: inn.id } });
  }

  // Weekend premiums for the next 90 days (Fri/Sat +20%), holiday-ish bump in 3 weeks.
  const rateRows = [];
  for (const rt of [rtOcean, rtGarden, rtSuite]) {
    for (let i = 0; i < 90; i++) {
      const day = addDays(today, i);
      const dow = new Date(`${day}T12:00:00Z`).getUTCDay();
      let price = Number(rt.basePrice);
      if (dow === 5 || dow === 6) price = Math.round(price * 1.2);
      if (i >= 20 && i <= 22) price = Math.round(price * 1.35);
      if (price !== Number(rt.basePrice)) rateRows.push({ roomTypeId: rt.id, date: midnight(day), price });
    }
  }
  await prisma.roomTypeRate.createMany({ data: rateRows });

  // ---------- bookings ----------
  const priceFor = async (rt, checkIn, checkOut, roomCount = 1) => {
    const rates = await prisma.roomTypeRate.findMany({ where: { roomTypeId: rt.id, date: { gte: midnight(checkIn), lt: midnight(checkOut) } } });
    const byDay = new Map(rates.map((r) => [r.date.toISOString().slice(0, 10), Number(r.price)]));
    let total = 0;
    for (let d = checkIn; d < checkOut; d = addDays(d, 1)) total += byDay.get(d) ?? Number(rt.basePrice);
    return Math.round(total * roomCount * 100) / 100;
  };
  // guests[0] (Jordan Smith, the anniversary couple) only gets their own stay.
  let g = 0;
  let n = 0;
  const nextGuest = () => guests[1 + (g++ % (guests.length - 1))];
  // Past stays get a real room of their type (rotating), like a working hotel.
  const pastRoom = {};
  const roomOfType = (rt) => {
    const list = roomDefs.filter((d) => d.rt === rt.id).map((d) => d.n);
    pastRoom[rt.id] = ((pastRoom[rt.id] ?? -1) + 1) % list.length;
    return list[pastRoom[rt.id]];
  };
  const hoursAfter = (date, h) => new Date(date.getTime() + h * 3600_000);
  const book = async ({ guest, rt, inOff, nights, status, room, guestsCount = 2, notes, payment = 'PAY_AT_PROPERTY' }) => {
    const checkIn = addDays(today, inOff);
    const checkOut = addDays(checkIn, nights);
    // Booked 2–40 days ahead (never in the future).
    const lead = 2 + ((n++ * 7) % 39);
    const bookedAt = new Date(Math.min(Date.now() - 3600_000 * (1 + (n % 9)), noon(addDays(checkIn, -lead)).getTime()));
    const history = [{ status: 'PENDING', notes: 'Booked online', createdAt: bookedAt }];
    if (status !== 'PENDING') history.push({ status: 'CONFIRMED', notes: 'Instant confirmation', createdAt: hoursAfter(bookedAt, 0.01) });
    if (['CHECKED_IN', 'CHECKED_OUT'].includes(status)) history.push({ status: 'CHECKED_IN', notes: 'Checked in by Priya Patel', createdAt: hoursAfter(noon(checkIn), 3.5 + (n % 4)) });
    if (status === 'CHECKED_OUT') history.push({ status: 'CHECKED_OUT', notes: 'Checked out by Priya Patel', createdAt: hoursAfter(noon(checkOut), -1.5) });
    if (status === 'CANCELLED') history.push({ status: 'CANCELLED', notes: 'Cancelled by guest', createdAt: hoursAfter(bookedAt, 30) });
    if (status === 'NO_SHOW') history.push({ status: 'NO_SHOW', notes: 'Marked no-show by night audit', createdAt: hoursAfter(noon(checkIn), 14) });
    const roomNumber = room ?? (status === 'CHECKED_OUT' ? roomOfType(rt) : undefined);
    return prisma.booking.create({
      data: {
        createdAt: bookedAt,
        userId: (guest || nextGuest()).id,
        propertyId: inn.id,
        roomTypeId: rt.id,
        roomId: roomNumber ? rooms[roomNumber].id : null,
        checkIn: noon(checkIn),
        checkOut: noon(checkOut),
        guests: guestsCount,
        rooms: 1,
        totalPrice: await priceFor(rt, checkIn, checkOut),
        status,
        paymentStatus: status === 'CHECKED_OUT' ? 'PAID' : payment,
        code: code(),
        notes: notes || null,
        statusHistory: { create: history },
      },
    });
  };

  // In house, leaving today (departures).
  await book({ rt: rtOcean, inOff: -3, nights: 3, status: 'CHECKED_IN', room: '201' });
  await book({ rt: rtGarden, inOff: -2, nights: 2, status: 'CHECKED_IN', room: '104' });
  await book({ rt: rtSuite, inOff: -4, nights: 4, status: 'CHECKED_IN', room: '305', guestsCount: 4 });
  // In house, staying on.
  await book({ rt: rtOcean, inOff: -1, nights: 4, status: 'CHECKED_IN', room: '302' });
  await book({ rt: rtOcean, inOff: -2, nights: 5, status: 'CHECKED_IN', room: '203', notes: 'Extra pillows' });
  await book({ rt: rtGarden, inOff: -1, nights: 3, status: 'CHECKED_IN', room: '107' });
  await book({ rt: rtGarden, inOff: -5, nights: 7, status: 'CHECKED_IN', room: '102', notes: 'Long stay — weekly linen change' });
  await book({ rt: rtSuite, inOff: -1, nights: 2, status: 'CHECKED_IN', room: '401', guestsCount: 5 });
  // Arrivals today.
  await book({ guest: guests[0], rt: rtOcean, inOff: 0, nights: 3, status: 'CONFIRMED', notes: 'Celebrating their 10th anniversary', guestsCount: 2 });
  await book({ rt: rtOcean, inOff: 0, nights: 2, status: 'CONFIRMED', room: '304' });
  await book({ rt: rtGarden, inOff: 0, nights: 1, status: 'CONFIRMED' });
  await book({ rt: rtGarden, inOff: 0, nights: 2, status: 'PENDING', payment: 'AWAITING_PAYMENT' });
  await book({ rt: rtSuite, inOff: 0, nights: 3, status: 'CONFIRMED', guestsCount: 4, notes: 'Travelling with a dog' });
  // Late arrival from yesterday.
  await book({ rt: rtGarden, inOff: -1, nights: 3, status: 'CONFIRMED', notes: 'Flight delayed' });
  // Future.
  const futurePlan = [
    [rtOcean, 1, 2], [rtGarden, 1, 3], [rtSuite, 2, 2], [rtOcean, 3, 2], [rtOcean, 4, 2], [rtGarden, 4, 2], [rtGarden, 5, 1],
    [rtOcean, 6, 3], [rtSuite, 6, 2], [rtGarden, 7, 2], [rtOcean, 9, 4], [rtGarden, 11, 2], [rtOcean, 12, 2], [rtSuite, 13, 3],
    [rtOcean, 18, 3], [rtGarden, 19, 2], [rtOcean, 20, 3], [rtOcean, 20, 2], [rtGarden, 20, 3], [rtSuite, 21, 2],
  ];
  for (const [rt, inOff, nights] of futurePlan) {
    await book({ rt, inOff, nights, status: 'CONFIRMED', payment: inOff % 3 === 0 ? 'PAID' : 'PAY_AT_PROPERTY' });
  }
  // Next weekend is nearly sold out; the one after is on pace (gives the forecast contrast).
  const fridayOffset = (() => {
    const dow = new Date(`${today}T12:00:00Z`).getUTCDay();
    const d = (5 - dow + 7) % 7;
    return d === 0 ? 7 : d;
  })();
  for (const [rt, count] of [[rtOcean, 6], [rtGarden, 8], [rtSuite, 3]]) {
    for (let i = 0; i < count; i++) await book({ rt, inOff: fridayOffset, nights: 2, status: 'CONFIRMED', payment: i % 2 ? 'PAID' : 'PAY_AT_PROPERTY' });
  }
  for (const [rt, count] of [[rtOcean, 4], [rtGarden, 5], [rtSuite, 2]]) {
    for (let i = 0; i < count; i++) await book({ rt, inOff: fridayOffset + 7, nights: 2, status: 'CONFIRMED' });
  }
  // Booked by the demo guest (for the guest dashboard).
  await book({ guest: guestUser, rt: rtOcean, inOff: 8, nights: 3, status: 'CONFIRMED', notes: 'Late arrival ~10pm' });
  await book({ guest: guestUser, rt: rtGarden, inOff: -30, nights: 2, status: 'CHECKED_OUT' });
  // History.
  for (let i = 0; i < 14; i++) {
    const rt = [rtOcean, rtGarden, rtSuite][i % 3];
    await book({ rt, inOff: -25 + i, nights: 2 + (i % 3), status: 'CHECKED_OUT', room: undefined });
  }
  await book({ rt: rtGarden, inOff: 5, nights: 2, status: 'CANCELLED' });
  await book({ rt: rtOcean, inOff: -2, nights: 1, status: 'NO_SHOW' });

  // ---------- room readiness + housekeeping ----------
  // Rooms of today's departures and a few vacant ones are dirty.
  for (const n of ['201', '104', '305', '108', '202', '303', '306']) {
    await prisma.room.update({ where: { id: rooms[n].id }, data: { status: 'DIRTY' } });
  }
  await prisma.room.update({ where: { id: rooms['110'].id }, data: { status: 'INSPECTED' } });
  await prisma.room.update({ where: { id: rooms['402'].id }, data: { status: 'INSPECTED' } });
  await prisma.room.update({
    where: { id: rooms['106'].id },
    data: { isOutOfOrder: true, outOfOrderReason: 'AC unit replacement — vendor booked', status: 'OUT_OF_ORDER' },
  });
  await prisma.roomHousekeeping.create({ data: { roomId: rooms['108'].id, assignedTo: hk1.id, status: 'IN_PROGRESS', priority: 2, notes: 'Stay-over refresh' } });
  await prisma.roomHousekeeping.create({ data: { roomId: rooms['202'].id, assignedTo: hk1.id, status: 'PENDING', priority: 1 } });
  await prisma.roomHousekeeping.create({ data: { roomId: rooms['303'].id, assignedTo: null, status: 'PENDING', priority: 1 } });

  // ---------- activity log (what the last day looked like) ----------
  const ago = (h) => new Date(Date.now() - h * 3600_000);
  const audit = (userId, propertyId, action, summary, source, hoursAgo) =>
    prisma.agentAuditLog.create({ data: { userId, propertyId, action, detail: JSON.stringify({ source, summary }), createdAt: ago(hoursAgo) } });
  await audit(desk.id, inn.id, 'COMMAND', 'Asked: “brief me”', 'agent', 3.2);
  await audit(desk.id, inn.id, 'BOOKING_STATUS', 'Checked in the guest in room 302 (via plan)', 'agent', 22);
  await audit(desk.id, inn.id, 'BOOKING_NOTE', 'Added a note: “Extra pillows” for room 203', 'agent', 21.5);
  await audit(manager.id, inn.id, 'HOUSEKEEPING_ASSIGN', 'Assigned rooms 108 and 202 to Rosa Martinez', 'classic', 2.4);
  await audit(manager.id, inn.id, 'RATES_UPDATE', 'Ocean King: 4 weekend nights adjusted +10%', 'agent', 26);
  await audit(owner.id, inn.id, 'VOICE_SETTINGS', 'Updated voice agent settings', 'classic', 30);
  await audit(desk.id, inn.id, 'ROOM_STATUS', 'Room 106 taken out of order — AC unit replacement', 'classic', 5);
  await audit(owner.id, inn.id, 'MODE_SWITCH', 'Default interface set to Agentic', 'classic', 48);

  // ---------- voice front desk ----------
  await prisma.voiceAgentConfig.create({
    data: {
      propertyId: inn.id,
      voice: 'marin',
      greeting: 'Thanks for calling the Saltwater Inn — this is the front desk. How can I help?',
      instructions: 'Always mention breakfast is included. Dogs under 30 lb are welcome for $25 a night. We don’t offer day-use rooms.',
      faqs: [
        { q: 'Is parking free?', a: 'Yes — free on-site parking for every guest, including EV chargers.' },
        { q: 'What time is breakfast?', a: 'Breakfast is included, 7 to 10:30 every morning in the garden room.' },
        { q: 'Can I check in early?', a: 'From 3 PM; earlier when the room is ready — we’ll text you. Bags can be dropped any time.' },
        { q: 'Do you allow pets?', a: 'Dogs under 30 pounds, $25 per night, in Garden Queen rooms.' },
      ],
      handoffPhone: '+1 831 555 0100',
    },
  });
  await prisma.guestRequest.create({ data: { propertyId: inn.id, name: 'Dana Whitfield', phone: '+1 408 555 0144', message: 'Planning a wedding block of 10 rooms for June 12–14 — would like group pricing.', createdAt: ago(1.5) } });
  await prisma.guestRequest.create({ data: { propertyId: inn.id, name: 'Kenji Mori', email: 'kenji.mori@example.com', message: 'Asked whether the Family Suite has a crib available.', status: 'DONE', handledById: desk.id, createdAt: ago(20) } });
  await prisma.voiceSession.createMany({
    data: [
      { propertyId: inn.id, audience: 'GUEST', liveSessionId: 'demo_1', toolCalls: 3, startedAt: ago(1.6), endedAt: ago(1.52) },
      { propertyId: inn.id, audience: 'GUEST', liveSessionId: 'demo_2', toolCalls: 2, startedAt: ago(6), endedAt: ago(5.95) },
      { propertyId: inn.id, audience: 'STAFF', userId: desk.id, liveSessionId: 'demo_3', toolCalls: 4, startedAt: ago(3.3), endedAt: ago(3.2) },
    ],
  });

  // ---------- a hotel that keeps its own PMS (bridge path) ----------
  const harbor = await prisma.property.create({
    data: {
      name: 'Harbor Motel',
      type: 'Motel',
      tagline: 'Simple rooms by the wharf.',
      description: 'A friendly 30-room motel two minutes from Fisherman’s Wharf. Runs on Cloudbeds — HotelOne works it through the bridge.',
      address: '12 Pier Road',
      city: 'Monterey',
      state: 'CA',
      zipCode: '93940',
      phone: '+1 831 555 0177',
      primaryColor: '#1D4ED8',
      amenities: ['Free parking', 'Free Wi-Fi', 'Pet friendly'],
      isDemo: true,
      setupPath: 'BRIDGE',
      interfaceMode: 'AGENTIC',
      photos: { create: [{ url: 'https://images.unsplash.com/photo-1566073771259-6a8506099945?auto=format&fit=crop&w=1600&q=80', publicId: 'harbor_main', isMain: true }] },
    },
  });
  await prisma.roomType.create({ data: { propertyId: harbor.id, name: 'Queen Room', capacity: 2, basePrice: 139, totalRooms: 20, amenities: ['Queen bed', 'Mini fridge'], description: 'Clean and comfortable, steps from the wharf.' } });
  await prisma.roomType.create({ data: { propertyId: harbor.id, name: 'Double Double', capacity: 4, basePrice: 169, totalRooms: 10, amenities: ['Two doubles'], description: 'Room for the family.' } });
  for (const u of [owner, manager, desk]) await prisma.userPropertyAssignment.create({ data: { userId: u.id, propertyId: harbor.id } });
  const conn = await prisma.pmsConnection.create({
    data: {
      propertyId: harbor.id,
      system: 'Cloudbeds',
      mode: 'DESKTOP',
      status: 'CONNECTED',
      loginUrl: 'https://hotels.cloudbeds.com',
      deviceName: 'Front desk PC',
      deviceTokenHash: crypto.createHash('sha256').update(crypto.randomBytes(32)).digest('hex'),
      lastSeenAt: ago(3),
    },
  });
  const task = (kind, instruction, status, summary, hoursAgo) =>
    prisma.bridgeTask.create({
      data: { propertyId: harbor.id, connectionId: conn.id, kind, instruction, status, result: summary ? { summary } : undefined, requestedById: desk.id, attempts: 1, createdAt: ago(hoursAgo), startedAt: ago(hoursAgo - 0.01), finishedAt: ago(hoursAgo - 0.02) },
    });
  await task('LOOKUP', 'who is arriving today?', 'DONE', '6 arrivals today: Patel (room 12), Moreno (14), Lee (unassigned), Okafor (21), Nguyen (unassigned), Fischer (7).', 4);
  await task('ACTION', 'check in Moreno into room 14', 'DONE', 'Checked in Ana Moreno to room 14 in Cloudbeds. Balance $0.00 (prepaid).', 3.8);
  await task('ACTION', 'move the Lee reservation to an accessible room', 'NEEDS_HELP', 'Two reservations named Lee arrive today (D. Lee and M. Lee). Which one should I move?', 3.5);
  // Harbor keeps its own PMS, so the voice quotes Harbor's own times and policy.
  await prisma.voiceAgentConfig.create({
    data: {
      propertyId: harbor.id,
      voice: 'cedar',
      greeting: 'Harbor Motel, how can I help?',
      handoffPhone: '+1 831 555 0177',
      checkInTime: '15:00',
      checkOutTime: '11:00',
      cancellationPolicy: 'Free cancellation until 24 hours before arrival; after that the first night is charged.',
    },
  });
  await audit(owner.id, harbor.id, 'BRIDGE_SETUP', 'Connected Cloudbeds (desktop connector)', 'classic', 50);

  // ---------- listing-only demo properties ----------
  const listing = async (data, roomTypes) => {
    const p = await prisma.property.create({ data: { ...data, isDemo: true } });
    for (const rt of roomTypes) await prisma.roomType.create({ data: { ...rt, propertyId: p.id } });
    return p;
  };
  await listing(
    {
      name: 'Juniper Ridge Lodge',
      type: 'Inn',
      tagline: 'Trailheads out the back door.',
      description: 'A cedar-and-stone mountain lodge with a wood-fired sauna and fireside breakfasts.',
      address: '456 Alpine Road',
      city: 'Aspen',
      state: 'CO',
      zipCode: '81611',
      phone: '+1 970 555 0187',
      primaryColor: '#3F6212',
      amenities: ['Fireplace lounge', 'Sauna', 'Ski storage', 'Breakfast', 'Free Wi-Fi'],
      photos: { create: [{ url: 'https://images.unsplash.com/photo-1506974210756-8e1b8985d348?auto=format&fit=crop&w=1600&q=80', publicId: 'juniper_main', isMain: true }] },
    },
    [
      { name: 'Mountain View King', capacity: 2, basePrice: 249, totalRooms: 8, amenities: ['King bed', 'Fireplace', 'Mountain view'], description: 'Cosy king room with a gas fireplace.' },
      { name: 'Bunk Cabin', capacity: 6, basePrice: 329, totalRooms: 4, amenities: ['Bunks', 'Kitchenette', 'Porch'], description: 'Rustic cabin that sleeps six.' },
    ]
  );
  await listing(
    {
      name: 'Route 66 Motor Court',
      type: 'Motel',
      tagline: 'Neon, pie and a pool that never closes.',
      description: 'A lovingly restored 1950s motor court with drive-up rooms, a heated pool and a diner next door.',
      address: '66 Mother Road',
      city: 'Flagstaff',
      state: 'AZ',
      zipCode: '86001',
      phone: '+1 928 555 0166',
      primaryColor: '#B45309',
      amenities: ['Heated pool', 'Free parking', 'Pet friendly', 'Diner next door'],
      photos: { create: [{ url: 'https://images.unsplash.com/photo-1561501900-3701fa6a0864?auto=format&fit=crop&w=1600&q=80', publicId: 'route66_main', isMain: true }] },
    },
    [
      { name: 'Classic Queen', capacity: 2, basePrice: 109, totalRooms: 12, amenities: ['Queen bed', 'Drive-up'], description: 'Retro queen room, parking at your door.' },
      { name: 'Double Double', capacity: 4, basePrice: 139, totalRooms: 8, amenities: ['Two doubles', 'Mini fridge'], description: 'Two double beds for families and road-trippers.' },
    ]
  );

  const counts = await Promise.all([prisma.booking.count(), prisma.room.count(), prisma.user.count()]);
  console.log(`Seeded: ${counts[0]} bookings, ${counts[1]} rooms, ${counts[2]} users. Hotel "today" = ${today} (${TZ}).`);
  console.log('Demo logins (password demo1234): owner@ / manager@ / frontdesk@ / housekeeping@ / guest@hotelone.demo');
  console.log('Owner, manager and front desk also see Harbor Motel — a hotel that keeps Cloudbeds (bridge path).');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
