/**
 * The owner demo's made-up hotel. Every name, booking, amount and call here
 * is invented for the tour: the demo never reads the database, so no real
 * hotel's guests, bookings or payments can appear in it.
 */
export const SAMPLE = {
  kpis: [
    { label: 'Occupancy tonight', value: '86%', note: '37 of 43 rooms' },
    { label: 'Average rate', value: '$214', note: '+$12 vs last week' },
    { label: 'Revenue this month', value: '$48,920', note: '41% direct' },
    { label: 'Arrivals today', value: '9', note: '2 need a room' },
  ],
  attention: [
    { text: 'Card dispute: Daniel Reyes, $486', tone: 'danger', stop: 'disputes' },
    { text: 'Jordan Smith arriving, no room assigned', tone: 'warning', stop: 'front-desk' },
    { text: 'Room 212 out of order (AC)', tone: 'warning', stop: 'housekeeping' },
    { text: '4 voice messages for the team', tone: 'info', stop: 'voice' },
  ],
  agentPlan: {
    request: 'Check in the Smiths, quiet room on a high floor, note it’s their anniversary',
    steps: ['Find booking HL-2291 (Jordan Smith, Ocean King, 3 nights)', 'Assign room 508: clean, high floor, away from the lift', 'Add note: anniversary, bottle of wine on arrival', 'Mark checked in after ID and card are confirmed'],
  },
  arrivals: [
    { guest: 'Jordan Smith', room: 'Ocean King', nights: 3, status: 'No room', tone: 'warning', note: 'Anniversary' },
    { guest: 'Grace Okafor', room: 'Ocean King · 304', nights: 2, status: 'Ready', tone: 'success', note: '' },
    { guest: 'Lucas Silva', room: 'Family Suite', nights: 4, status: 'Late', tone: 'info', note: 'Flight delayed' },
    { guest: 'Mei Tanaka', room: 'Harbor Queen · 118', nights: 1, status: 'Ready', tone: 'success', note: 'Early check-in' },
    { guest: 'Priya Nair', room: 'Harbor Queen', nights: 2, status: 'No room', tone: 'warning', note: '' },
  ],
  bookings: [
    { code: 'HL-2291', guest: 'Jordan Smith', dates: 'Nov 7–10', source: 'Direct', total: 681, balance: 0, status: 'Confirmed' },
    { code: 'HL-2288', guest: 'Grace Okafor', dates: 'Nov 7–9', source: 'Booking.com', total: 438, balance: 438, status: 'Confirmed' },
    { code: 'HL-2284', guest: 'Lucas Silva', dates: 'Nov 7–11', source: 'Phone (voice)', total: 1196, balance: 300, status: 'Confirmed' },
    { code: 'HL-2279', guest: 'Ana Costa', dates: 'Nov 8–9', source: 'Expedia', total: 219, balance: 219, status: 'Confirmed' },
    { code: 'HL-2270', guest: 'Sam Patel', dates: 'Nov 5–7', source: 'Walk-in', total: 398, balance: 0, status: 'Checked out' },
    { code: 'HL-2264', guest: 'Elena Rossi', dates: 'Nov 12–15', source: 'Airbnb', total: 702, balance: 702, status: 'Confirmed' },
  ],
  rooms: [
    { room: '101', type: 'Harbor Queen', status: 'Clean' },
    { room: '102', type: 'Harbor Queen', status: 'Dirty' },
    { room: '118', type: 'Harbor Queen', status: 'Clean' },
    { room: '204', type: 'Ocean King', status: 'In progress' },
    { room: '212', type: 'Ocean King', status: 'Out of order' },
    { room: '304', type: 'Ocean King', status: 'Clean' },
    { room: '310', type: 'Ocean King', status: 'Dirty' },
    { room: '402', type: 'Family Suite', status: 'Clean' },
    { room: '508', type: 'Ocean King', status: 'Clean' },
  ],
  rateDays: ['Fri 7', 'Sat 8', 'Sun 9', 'Mon 10', 'Tue 11', 'Wed 12', 'Thu 13'],
  rates: [
    { type: 'Harbor Queen', prices: [189, 219, 169, 149, 149, 159, 179], left: [3, 1, 6, 9, 10, 8, 5] },
    { type: 'Ocean King', prices: [229, 259, 199, 179, 179, 189, 219], left: [2, 0, 4, 7, 8, 6, 3] },
    { type: 'Family Suite', prices: [299, 339, 269, 249, 249, 259, 289], left: [1, 1, 2, 3, 3, 3, 2] },
  ],
  channels: [
    { name: 'Booking.com', status: 'Connected', synced: '2 min ago', bookings: 38 },
    { name: 'Expedia', status: 'Connected', synced: '2 min ago', bookings: 21 },
    { name: 'Airbnb', status: 'Connected', synced: '3 min ago', bookings: 9 },
  ],
  payments: [
    { what: 'Jordan Smith · HL-2291', kind: 'Paid in full', amount: 681, when: 'Oct 30' },
    { what: 'Lucas Silva · HL-2284', kind: 'Deposit', amount: 300, when: 'Nov 2' },
    { what: 'Sam Patel · HL-2270', kind: 'Balance at check-out', amount: 398, when: 'Nov 7' },
    { what: 'Noah Kim · HL-2251', kind: 'Refund', amount: -149, when: 'Nov 3' },
  ],
  dispute: {
    guest: 'Daniel Reyes',
    booking: 'HL-2203 · Ocean King · Oct 18–20',
    amount: 486,
    reason: 'Bank reason: “Product not received” (the cardholder says they didn’t stay)',
    due: 'Respond within 6 days',
    evidence: [
      { label: 'ID matched the guest at check-in', detail: 'Driver’s licence checked by Maria, Oct 18, 3:42 pm' },
      { label: 'Registration card signed', detail: 'Signed on the front-desk tablet at check-in' },
      { label: 'Cancellation policy accepted', detail: 'Accepted on the booking site when booking, Oct 2' },
      { label: 'Stay completed', detail: 'Checked in Oct 18, checked out Oct 20; 2 room charges' },
      { label: 'Card shown at the desk', detail: 'Same card ending 4417 as the booking' },
    ],
  },
  report: {
    months: ['Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov'],
    occupancy: [71, 84, 89, 78, 74, 86],
    direct: [28, 31, 33, 36, 38, 41],
    stats: [
      { label: 'RevPAR', value: '$184' },
      { label: 'ADR', value: '$214' },
      { label: 'Direct share', value: '41%' },
      { label: 'Commission saved', value: '$3,870' },
    ],
  },
  calls: [
    { caller: 'Caller ending 0142', what: 'Booked Harbor Queen, Nov 21–23', outcome: 'Booked', tone: 'success' },
    { caller: 'Caller ending 7781', what: 'Asked about parking and late check-in', outcome: 'Answered', tone: 'info' },
    { caller: 'Caller ending 3350', what: 'Wedding block for 12 rooms in June', outcome: 'Message for team', tone: 'warning' },
    { caller: 'Caller ending 9024', what: 'Moved booking HL-2240 by one night', outcome: 'Booked', tone: 'success' },
  ],
  callStats: [
    { label: 'Calls this week', value: '63' },
    { label: 'Bookings', value: '11' },
    { label: 'Messages', value: '4' },
  ],
} as const;
