import { supabase } from './supabaseClient';
import { smsService } from './smsService';
import { familyService } from './familyService';

// Get current user's organization ID
const getCurrentUserOrganizationId = async () => {
  try {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return null;

    const { data: userProfile } = await supabase
      .from('organization_users')
      .select('organization_id')
      .eq('user_id', user.id)
      .eq('status', 'active')
      .eq('approval_status', 'approved')
      .single();

    return userProfile?.organization_id || null;
  } catch (error) {
    console.error('Error getting user organization ID:', error);
    return null;
  }
};

export const dashboardService = {
  // Consolidated dashboard data fetch - reduces multiple API calls to just a few
  async getDashboardData() {
    try {
      const organizationId = await getCurrentUserOrganizationId();
      if (!organizationId) {
        throw new Error('User not associated with any organization');
      }

      // Fetch all data in parallel for better performance
      const [membersData, donationsData, eventsData, tasksData, smsData, celebrationsData, attendanceData, familyData] = await Promise.all([
        this.getMembersData(organizationId),
        this.getDonationsData(organizationId),
        this.getEventsData(organizationId),
        this.getTasksData(organizationId),
        this.getSMSData(organizationId),
        this.getCelebrationsData(organizationId),
        this.getAttendanceData(organizationId),
        this.getFamilyData(organizationId)
      ]);

      return {
        members: membersData,
        donations: donationsData,
        events: eventsData,
        tasks: tasksData,
        sms: smsData,
        celebrations: celebrationsData,
        attendance: attendanceData,
        family: familyData
      };
    } catch (error) {
      console.error('Error fetching dashboard data:', error);
      throw error;
    }
  },

  // Members data - single API call instead of multiple
  async getMembersData(organizationId) {
    const { data: members, error } = await supabase
      .from('members')
      .select('*')
      .eq('organization_id', organizationId)
      .order('created_at', { ascending: false });

    if (error) throw error;

    const activeMembers = members.filter(m => m.status === 'active');
    const inactiveMembers = members.filter(m => m.status === 'inactive');
    const visitors = members.filter(m => m.status === 'visitor');
    const recentMembers = members.slice(0, 5);

    return {
      all: members,
      active: activeMembers,
      inactive: inactiveMembers,
      visitors,
      recent: recentMembers,
      counts: {
        total: members.length,
        active: activeMembers.length,
        inactive: inactiveMembers.length,
        visitors: visitors.length
      }
    };
  },

  // Donations data with all calculations - single API call instead of multiple
  async getDonationsData(organizationId) {
    const { data: donations, error } = await supabase
      .from('donations')
      .select('*')
      .eq('organization_id', organizationId)
      .order('date', { ascending: false });

    if (error) throw error;

    const now = new Date();
    const currentYear = now.getFullYear();
    const currentMonth = now.getMonth();

    // Calculate various donation metrics
    const totalDonations = donations.reduce((sum, d) => sum + (parseFloat(d.amount) || 0), 0);
    
    const monthlyDonations = donations
      .filter(d => d.date.startsWith(`${currentYear}-${(currentMonth + 1).toString().padStart(2, '0')}`))
      .reduce((sum, d) => sum + (parseFloat(d.amount) || 0), 0);

    // Last month calculations
    const lastMonth = new Date(currentYear, currentMonth - 1, 1);
    const lastMonthEnd = new Date(currentYear, currentMonth, 0);
    const lastMonthStr = lastMonth.toISOString().split('T')[0];
    const lastMonthEndStr = lastMonthEnd.toISOString().split('T')[0];
    
    const lastMonthDonations = donations
      .filter(d => d.date >= lastMonthStr && d.date <= lastMonthEndStr)
      .reduce((sum, d) => sum + (parseFloat(d.amount) || 0), 0);

    // Two months ago calculations
    const twoMonthsAgo = new Date(currentYear, currentMonth - 2, 1);
    const twoMonthsAgoEnd = new Date(currentYear, currentMonth - 1, 0);
    const twoMonthsAgoStr = twoMonthsAgo.toISOString().split('T')[0];
    const twoMonthsAgoEndStr = twoMonthsAgoEnd.toISOString().split('T')[0];
    
    const twoMonthsAgoDonations = donations
      .filter(d => d.date >= twoMonthsAgoStr && d.date <= twoMonthsAgoEndStr)
      .reduce((sum, d) => sum + (parseFloat(d.amount) || 0), 0);

    // Weekly calculations
    const weeklyDonationTotals = {};
    donations.forEach(donation => {
      try {
        const date = new Date(donation.date);
        if (isNaN(date.getTime())) return;
        
        const startOfWeek = new Date(date);
        const dayOfWeek = date.getDay();
        startOfWeek.setDate(date.getDate() - dayOfWeek);
        startOfWeek.setHours(0, 0, 0, 0);
        
        const weekKey = startOfWeek.toISOString().split('T')[0];
        const amount = parseFloat(donation.amount) || 0;
        
        if (!weeklyDonationTotals[weekKey]) {
          weeklyDonationTotals[weekKey] = 0;
        }
        weeklyDonationTotals[weekKey] += amount;
      } catch (error) {
        console.error('Error processing donation for weekly average:', donation, error);
      }
    });

    const weeklyTotals = Object.values(weeklyDonationTotals);
    const weeklyAverage = weeklyTotals.length > 0 ? 
      weeklyTotals.reduce((sum, total) => sum + total, 0) / weeklyTotals.length : 0;

    // Monthly average calculation
    const donationDates = donations.map(d => d.date);
    const uniqueMonths = new Set();
    const avgCurrentYear = new Date().getFullYear();
    const avgCurrentMonth = new Date().getMonth();
    
    const totalDonationsExcludingCurrent = donations.reduce((sum, donation) => {
      try {
        const donationDate = new Date(donation.date + 'T00:00:00');
        if (donationDate.getFullYear() !== avgCurrentYear || donationDate.getMonth() !== avgCurrentMonth) {
          const amount = parseFloat(donation.amount) || 0;
          return sum + amount;
        }
        return sum;
      } catch (error) {
        return sum;
      }
    }, 0);
    
    donationDates.forEach(dateStr => {
      const date = new Date(dateStr);
      const yearMonth = `${date.getFullYear()}-${(date.getMonth() + 1).toString().padStart(2, '0')}`;
      if (date.getFullYear() !== avgCurrentYear || date.getMonth() !== avgCurrentMonth) {
        uniqueMonths.add(yearMonth);
      }
    });
    
    const actualMonthsWithData = uniqueMonths.size;
    const monthlyAverage = actualMonthsWithData > 0 ? totalDonationsExcludingCurrent / actualMonthsWithData : 0;
    const growthRate = monthlyAverage > 0 ? ((monthlyDonations - monthlyAverage) / monthlyAverage) * 100 : 0;

    // Last Sunday calculations
    const lastSunday = new Date();
    const dayOfWeek = lastSunday.getDay();
    const daysToSubtract = dayOfWeek === 0 ? 7 : dayOfWeek;
    lastSunday.setDate(lastSunday.getDate() - daysToSubtract);
    lastSunday.setHours(0, 0, 0, 0);
    
    const lastSundayDonations = donations.filter(donation => {
      try {
        const donationDate = new Date(donation.date + 'T00:00:00');
        const donationSunday = new Date(donationDate);
        const donationDayOfWeek = donationDate.getDay();
        donationSunday.setDate(donationDate.getDate() - donationDayOfWeek);
        donationSunday.setHours(0, 0, 0, 0);
        return donationSunday.toDateString() === lastSunday.toDateString();
      } catch (error) {
        return false;
      }
    }).reduce((sum, donation) => sum + (parseFloat(donation.amount) || 0), 0);

    return {
      all: donations,
      recent: donations.slice(0, 7),
      stats: {
        total: totalDonations,
        monthly: monthlyDonations,
        lastMonth: lastMonthDonations,
        twoMonthsAgo: twoMonthsAgoDonations,
        lastSunday: lastSundayDonations,
        weeklyAverage,
        monthlyAverage,
        growthRate
      }
    };
  },

  // Events data - single API call instead of multiple
  async getEventsData(organizationId) {
    const { data: events, error } = await supabase
      .from('events')
      .select('*')
      .eq('organization_id', organizationId)
      .order('start_date', { ascending: true });

    if (error) throw error;

    const now = new Date();
    const upcomingEvents = events.filter(e => new Date(e.start_date) >= now).slice(0, 5);
    
    const weekFromNow = new Date();
    weekFromNow.setDate(weekFromNow.getDate() + 7);
    const monthFromNow = new Date();
    monthFromNow.setMonth(monthFromNow.getMonth() + 1);

    const eventsThisWeek = events.filter(e => {
      const eventDate = new Date(e.start_date);
      return eventDate >= now && eventDate <= weekFromNow;
    }).length;

    const eventsThisMonth = events.filter(e => {
      const eventDate = new Date(e.start_date);
      return eventDate >= now && eventDate <= monthFromNow;
    }).length;

    // Calculate average events per month
    const sixMonthsAgo = new Date();
    sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);
    
    const eventsLast6Months = events.filter(e => {
      const eventDate = new Date(e.start_date);
      return eventDate >= sixMonthsAgo && eventDate <= now;
    });

    const monthsWithEvents = new Set();
    eventsLast6Months.forEach(event => {
      const eventDate = new Date(event.start_date);
      const monthKey = `${eventDate.getFullYear()}-${eventDate.getMonth()}`;
      monthsWithEvents.add(monthKey);
    });
    
    const actualMonthsWithEvents = monthsWithEvents.size;
    const averageEventsPerMonth = actualMonthsWithEvents > 0 ? 
      Math.round(eventsLast6Months.length / actualMonthsWithEvents) : 0;

    // Event types breakdown
    const eventTypesBreakdown = {};
    upcomingEvents.forEach(event => {
      const eventType = event.event_type || 'Other';
      eventTypesBreakdown[eventType] = (eventTypesBreakdown[eventType] || 0) + 1;
    });
    
    const mostCommonEventType = Object.keys(eventTypesBreakdown).length > 0 
      ? Object.keys(eventTypesBreakdown).reduce((a, b) => 
          eventTypesBreakdown[a] > eventTypesBreakdown[b] ? a : b
        )
      : 'None';

    const eventsNeedingVolunteers = upcomingEvents.filter(e => e.needs_volunteers === true).length;

    return {
      all: events,
      upcoming: upcomingEvents,
      stats: {
        total: events.length,
        upcoming: upcomingEvents.length,
        thisWeek: eventsThisWeek,
        thisMonth: eventsThisMonth,
        averagePerMonth: averageEventsPerMonth,
        mostCommonType: mostCommonEventType,
        needingVolunteers: eventsNeedingVolunteers
      }
    };
  },

  // Tasks data - single API call
  async getTasksData(organizationId) {
    const { data: tasks, error } = await supabase
      .from('tasks')
      .select('*')
      .eq('organization_id', organizationId);

    if (error) throw error;

    const now = new Date();
    const taskStats = {
      total: tasks.length,
      pending: tasks.filter(t => t.status === 'pending').length,
      completed: tasks.filter(t => t.status === 'completed').length,
      overdue: tasks.filter(t => 
        t.status !== 'completed' && 
        t.due_date && 
        new Date(t.due_date) < now
      ).length
    };

    return {
      all: tasks,
      stats: taskStats
    };
  },

  // SMS data - single API call instead of multiple
  async getSMSData(organizationId) {
    const { data: messages, error: messagesError } = await supabase
      .from('sms_messages')
      .select('*')
      .eq('organization_id', organizationId)
      .order('created_at', { ascending: false });

    if (messagesError) throw messagesError;

    const { data: conversations, error: conversationsError } = await supabase
      .from('sms_conversations')
      .select('*')
      .eq('organization_id', organizationId)
      .order('updated_at', { ascending: false });

    if (conversationsError) throw conversationsError;

    const now = new Date();
    const thirtyDaysAgo = new Date(now.getTime() - (30 * 24 * 60 * 60 * 1000));
    const thirtyDaysAgoStr = thirtyDaysAgo.toISOString();

    const recentMessages = messages.filter(m => m.created_at >= thirtyDaysAgoStr);
    const activeConversations = conversations.filter(c => c.status === 'active');
    const outboundMessages = messages.filter(m => m.direction === 'outbound');
    const inboundMessages = messages.filter(m => m.direction === 'inbound');
    const recentConversations = conversations.slice(0, 5);

    return {
      totalMessages: messages.length,
      recentMessages: recentMessages.length,
      totalConversations: conversations.length,
      activeConversations: activeConversations.length,
      outboundMessages: outboundMessages.length,
      inboundMessages: inboundMessages.length,
      recentConversations
    };
  },

  // Celebrations data - birthdays, anniversaries, memberships
  async getCelebrationsData(organizationId) {
    const { data: members, error } = await supabase
      .from('members')
      .select('birth_date, join_date, anniversary_date')
      .eq('organization_id', organizationId);

    if (error) throw error;

    const now = new Date();
    const thirtyDaysFromNow = new Date(now.getTime() + (30 * 24 * 60 * 60 * 1000));

    let upcomingBirthdays = 0;
    let upcomingAnniversaries = 0;
    let upcomingMemberships = 0;

    members.forEach(member => {
      // Check birthdays
      if (member.birth_date) {
        const birthDate = new Date(member.birth_date);
        const nextBirthday = new Date(now.getFullYear(), birthDate.getMonth(), birthDate.getDate());
        if (nextBirthday < now) {
          nextBirthday.setFullYear(now.getFullYear() + 1);
        }
        if (nextBirthday <= thirtyDaysFromNow) {
          upcomingBirthdays++;
        }
      }

      // Check anniversaries
      if (member.anniversary_date) {
        const anniversaryDate = new Date(member.anniversary_date);
        const nextAnniversary = new Date(now.getFullYear(), anniversaryDate.getMonth(), anniversaryDate.getDate());
        if (nextAnniversary < now) {
          nextAnniversary.setFullYear(now.getFullYear() + 1);
        }
        if (nextAnniversary <= thirtyDaysFromNow) {
          upcomingAnniversaries++;
        }
      }

      // Check memberships (join dates)
      if (member.join_date) {
        const joinDate = new Date(member.join_date);
        const nextMembership = new Date(now.getFullYear(), joinDate.getMonth(), joinDate.getDate());
        if (nextMembership < now) {
          nextMembership.setFullYear(now.getFullYear() + 1);
        }
        if (nextMembership <= thirtyDaysFromNow) {
          upcomingMemberships++;
        }
      }
    });

    return {
      upcomingBirthdays,
      upcomingAnniversaries,
      upcomingMemberships,
      totalUpcoming: upcomingBirthdays + upcomingAnniversaries + upcomingMemberships
    };
  },

  // Attendance data by event type
  async getAttendanceData(organizationId) {
    // Get active members count first
    const { data: activeMembers, error: membersError } = await supabase
      .from('members')
      .select('id')
      .eq('organization_id', organizationId)
      .eq('status', 'active');

    if (membersError) throw membersError;
    const activeMemberCount = activeMembers?.length || 0;

    const sixMonthsAgo = new Date();
    sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);
    const sixMonthsAgoStr = sixMonthsAgo.toISOString().split('T')[0];

    // Get events and attendance for last 6 months
    const { data: events, error: eventsError } = await supabase
      .from('events')
      .select('id, event_type, start_date')
      .eq('organization_id', organizationId)
      .gte('start_date', sixMonthsAgoStr)
      .order('start_date', { ascending: false });

    if (eventsError) throw eventsError;

    if (!events || events.length === 0) {
      return {
        sundayServiceRate: 0,
        sundayServiceAttendance: 0,
        sundayServiceEvents: 0,
        bibleStudyAttendance: 0,
        bibleStudyEvents: 0,
        fellowshipAttendance: 0,
        fellowshipEvents: 0
      };
    }

    const eventIds = events.map(e => e.id);
    const { data: attendance, error: attendanceError } = await supabase
      .from('event_attendance')
      .select('event_id, status, member_id')
      .in('event_id', eventIds);

    if (attendanceError) throw attendanceError;

    // Helper function to normalize event types
    const normalizeEventType = (eventType) => {
      if (!eventType) return 'Other';
      const type = eventType.toLowerCase();
      
      if (type.includes('sunday') || type.includes('worship') || type.includes('church')) {
        return 'Sunday Service';
      }
      if (type.includes('bible') || type.includes('study')) {
        return 'Bible Study';
      }
      if (type.includes('fellowship') || type.includes('social') || type.includes('gathering')) {
        return 'Fellowship';
      }
      return eventType; // Keep original if no match
    };

    // Calculate attendance by event type
    const eventTypeStats = {};
    let eventsWithRecords = 0;
    let eventsWithoutRecords = 0;
    
    events.forEach(event => {
      const eventType = normalizeEventType(event.event_type);
      const eventAttendance = attendance.filter(a => a.event_id === event.id);
      const attendingCount = eventAttendance.filter(a => a.status === 'checked-in' || a.status === 'attending').length;
      
      // Only count events that have attendance records
      if (eventAttendance.length > 0) {
        eventsWithRecords++;
        if (!eventTypeStats[eventType]) {
          eventTypeStats[eventType] = {
            totalAttendance: 0,
            eventCount: 0,
            averageAttendance: 0
          };
        }
        
        eventTypeStats[eventType].totalAttendance += attendingCount;
        eventTypeStats[eventType].eventCount += 1;
        
      } else {
        eventsWithoutRecords++;
      }
    });

    // Calculate averages
    Object.keys(eventTypeStats).forEach(eventType => {
      const stats = eventTypeStats[eventType];
      stats.averageAttendance = stats.eventCount > 0 ? 
        Math.round(stats.totalAttendance / stats.eventCount) : 0;
    });

    // Map to the existing stats structure
    const sundayServiceStats = eventTypeStats['Sunday Service'] || { averageAttendance: 0, eventCount: 0, totalAttendance: 0 };
    const bibleStudyStats = eventTypeStats['Bible Study'] || { averageAttendance: 0, eventCount: 0, totalAttendance: 0 };
    const fellowshipStats = eventTypeStats['Fellowship'] || { averageAttendance: 0, eventCount: 0, totalAttendance: 0 };

    // Calculate Sunday Service Rate (percentage of active members who attend each week)
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
    const thirtyDaysAgoStr = thirtyDaysAgo.toISOString().split('T')[0];

    // Look for Sunday Worship Service events in the last 30 days
    const recentSundayEvents = events.filter(e => 
      e.event_type === 'Sunday Worship Service' && e.start_date >= thirtyDaysAgoStr
    );

    // Get unique active members who attended Sunday services in the last 30 days
    const sundayAttendees = new Set();
    const activeMemberIds = new Set(activeMembers.map(m => m.id));
    
    recentSundayEvents.forEach(event => {
      const eventAttendance = attendance.filter(a => a.event_id === event.id);
      eventAttendance
        .filter(a => (a.status === 'checked-in' || a.status === 'attending') && a.member_id && activeMemberIds.has(a.member_id))
        .forEach(a => sundayAttendees.add(a.member_id));
    });

    // Calculate percentage of active members who attend Sunday services
    const sundayServiceRate = activeMemberCount > 0 ? 
      Math.round((sundayAttendees.size / activeMemberCount) * 100) : 0;

    console.log('Sunday Service Rate calculation:', {
      activeMemberCount,
      sundayAttendees: sundayAttendees.size,
      sundayServiceRate: `${sundayServiceRate}%`,
      sundayServiceEvents: recentSundayEvents.length,
      activeMemberIds: activeMemberIds.size
    });

    return {
      sundayServiceRate: sundayServiceRate,
      sundayServiceAttendance: sundayServiceStats.totalAttendance,
      sundayServiceEvents: sundayServiceStats.eventCount,
      sundayServicePercentage: sundayServiceStats.averageAttendance,
      bibleStudyAttendance: bibleStudyStats.totalAttendance,
      bibleStudyEvents: bibleStudyStats.eventCount,
      bibleStudyPercentage: bibleStudyStats.averageAttendance,
      fellowshipAttendance: fellowshipStats.totalAttendance,
      fellowshipEvents: fellowshipStats.eventCount,
      fellowshipPercentage: fellowshipStats.averageAttendance
    };
  },

  // Family data
  async getFamilyData(organizationId) {
    // Get active adult members only
    const { data: activeAdults, error: activeAdultsError } = await supabase
      .from('members')
      .select('id, birth_date, status, member_type')
      .eq('organization_id', organizationId)
      .eq('status', 'active')
      .in('member_type', ['adult', null]); // null defaults to adult

    if (activeAdultsError) throw activeAdultsError;

    // Get all children (regardless of status)
    const { data: allChildren, error: childrenError } = await supabase
      .from('members')
      .select('id, birth_date, status, member_type')
      .eq('organization_id', organizationId)
      .eq('member_type', 'child');

    if (childrenError) throw childrenError;

    // Get all family relationships for active adults
    const activeAdultIds = activeAdults.map(m => m.id);
    const { data: familyRelationships, error: relationshipsError } = await supabase
      .from('family_relationships')
      .select('family_id, member_id')
      .in('member_id', activeAdultIds);

    if (relationshipsError) throw relationshipsError;

    // Get family details for families that have active adult members
    const familyIds = [...new Set(familyRelationships.map(fr => fr.family_id))];
    const { data: families, error: familiesError } = await supabase
      .from('families')
      .select('id, family_name')
      .in('id', familyIds);

    if (familiesError) throw familiesError;

    // Count unique families that have active adult members
    const familyIdsWithActiveMembers = new Set(familyRelationships.map(fr => fr.family_id));
    const totalFamilies = familyIdsWithActiveMembers.size;

    // Count active adults in families vs individual active adults
    const memberIdsInFamilies = new Set(familyRelationships.map(fr => fr.member_id));
    const membersInFamilies = memberIdsInFamilies.size;
    const unassignedMembers = activeAdults.length - membersInFamilies;

    // Count adults vs children
    const adults = activeAdults.length;
    const children = allChildren.length;

    console.log('Family calculation debug:', {
      totalActiveAdults: adults,
      totalChildren: children,
      totalFamilies,
      familyIdsWithActiveMembers: Array.from(familyIdsWithActiveMembers),
      membersInFamilies,
      unassignedMembers,
      sampleFamilyRelationships: familyRelationships.slice(0, 5),
      sampleActiveAdults: activeAdults.slice(0, 5).map(m => ({ id: m.id, member_type: m.member_type })),
      sampleChildren: allChildren.slice(0, 5).map(m => ({ id: m.id, member_type: m.member_type })),
      familiesData: families.slice(0, 5)
    });

    return {
      totalFamilies,
      membersInFamilies,
      membersWithoutFamilies: unassignedMembers,
      unassignedMembers,
      adults,
      children,
      totalActiveMembers: adults // Only count adults as active members
    };
  },

  // Volunteer data
  async getVolunteerData(organizationId) {
    // This would need to be implemented based on your volunteer system
    // For now, returning placeholder data
    return {
      totalVolunteers: 0,
      upcomingVolunteers: 0,
      recentVolunteers: 0,
      eventsWithVolunteersEnabled: 0,
      totalVolunteersSignedUp: 0,
      eventsStillNeedingVolunteers: 0
    };
  }
}; 