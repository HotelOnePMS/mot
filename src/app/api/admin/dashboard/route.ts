import { NextRequest } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { requireStaff, resolvePropertyId } from '@/server/authz';
import { addDaysISO, atNoonUTC, hotelToday } from '@/server/dates';
import { handleRoute, json, parseQuery } from '@/server/http';
import { frontDeskSummary, occupancySeries } from '@/server/services/frontdesk';
import { bookingInclude, toBookingSummary } from '@/server/services/mappers';

/**
 * GET /api/admin/dashboard?propertyId — the owner/manager overview:
 * today, the next two weeks, revenue on the books and a setup checklist.
 */
export const GET = handleRoute(async (request: NextRequest) => {
  const actor = await requireStaff('analytics.view');
  const q = parseQuery(request, z.object({ propertyId: z.string().optional() }));
  const propertyId = await resolvePropertyId(actor, q.propertyId);
  const today = hotelToday();
  const monthStart = `${today.slice(0, 8)}01`;

  const [summary, forecast, property, monthRevenue, upcomingRevenue, recent, counts] = await Promise.all([
    frontDeskSummary(actor, propertyId, today),
    occupancySeries(propertyId, today, addDaysISO(today, 14)),
    prisma.property.findUnique({
      where: { id: propertyId },
      select: { id: true, name: true, city: true, state: true, primaryColor: true, interfaceMode: true, isDemo: true, tagline: true },
    }),
    prisma.booking.aggregate({
      where: { propertyId, status: { notIn: ['CANCELLED', 'NO_SHOW'] }, createdAt: { gte: new Date(`${monthStart}T00:00:00Z`) } },
      _sum: { totalPrice: true },
      _count: { _all: true },
    }),
    prisma.booking.aggregate({
      where: {
        propertyId,
        status: { in: ['PENDING', 'CONFIRMED', 'CHECKED_IN'] },
        checkIn: { gte: atNoonUTC(today), lt: atNoonUTC(addDaysISO(today, 30)) },
      },
      _sum: { totalPrice: true },
      _count: { _all: true },
    }),
    prisma.booking.findMany({ where: { propertyId }, include: bookingInclude, orderBy: { createdAt: 'desc' }, take: 6 }),
    Promise.all([
      prisma.roomType.count({ where: { propertyId, isActive: true } }),
      prisma.room.count({ where: { propertyId } }),
      prisma.propertyPhoto.count({ where: { propertyId } }),
      prisma.roomTypeRate.count({ where: { roomType: { propertyId } } }),
      prisma.userPropertyAssignment.count({ where: { propertyId, user: { role: { in: ['MANAGER', 'FRONT_DESK', 'HOUSEKEEPER'] } } } }),
      prisma.booking.count({ where: { propertyId } }),
      prisma.agentAuditLog.count({ where: { propertyId, action: 'COMMAND' } }),
    ]),
  ]);

  const [roomTypes, rooms, photos, customRates, team, bookings, agentCommands] = counts;
  const checklist = [
    { id: 'room-types', label: 'Add your room types', done: roomTypes > 0, href: '/admin/room-types/add' },
    { id: 'rooms', label: 'Add room numbers', done: rooms > 0, href: '/admin/room-types' },
    { id: 'photos', label: 'Upload property photos', done: photos > 0, href: `/admin/properties/${propertyId}` },
    { id: 'rates', label: 'Set seasonal or weekend rates', done: customRates > 0, href: '/admin/rate-calendar' },
    { id: 'team', label: 'Invite your team', done: team > 0, href: '/admin/users' },
    { id: 'agent', label: 'Try the agent: “who’s arriving today?”', done: agentCommands > 0, href: '/admin/agent' },
    { id: 'booking', label: 'Take your first booking', done: bookings > 0, href: `/properties/${propertyId}` },
  ];

  return json({
    property,
    today: summary,
    forecast,
    revenue: {
      monthToDate: Number(monthRevenue._sum.totalPrice ?? 0),
      monthBookings: monthRevenue._count._all,
      next30Days: Number(upcomingRevenue._sum.totalPrice ?? 0),
      next30Bookings: upcomingRevenue._count._all,
    },
    recent: recent.map(toBookingSummary),
    checklist,
  });
});
