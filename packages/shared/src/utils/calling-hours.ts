export function isWithinCallingHours(
  destinationTimezone: string,
  startTime: string,
  endTime: string,
): boolean {
  const now = new Date();

  let localTimeStr: string;
  try {
    localTimeStr = now.toLocaleTimeString('en-US', {
      timeZone: destinationTimezone,
      hour12: false,
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return false;
  }

  const [hours, minutes] = localTimeStr.split(':').map(Number);
  const currentMinutes = hours! * 60 + minutes!;

  const [startH, startM] = startTime.split(':').map(Number);
  const startMinutes = startH! * 60 + startM!;

  const [endH, endM] = endTime.split(':').map(Number);
  const endMinutes = endH! * 60 + endM!;

  return currentMinutes >= startMinutes && currentMinutes <= endMinutes;
}

export function getLocalTime(timezone: string): string {
  return new Date().toLocaleTimeString('en-US', {
    timeZone: timezone,
    hour12: true,
    hour: 'numeric',
    minute: '2-digit',
  });
}
