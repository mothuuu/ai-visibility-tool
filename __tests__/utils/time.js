/**
 * Time Manipulation Utilities for Testing
 * Uses Jest fake timers to freeze and advance time
 */

let frozenTime = null;

/**
 * Freeze time at a specific date/time
 * @param {string|Date} dateTime - ISO string or Date object
 */
function freezeAt(dateTime) {
  const timestamp = typeof dateTime === 'string' ? new Date(dateTime).getTime() : dateTime.getTime();
  frozenTime = timestamp;
  jest.setSystemTime(timestamp);
  console.log(`⏰ Time frozen at: ${new Date(timestamp).toISOString()}`);
}

/**
 * Advance frozen time by specified duration
 * @param {object} duration - {days, hours, minutes, seconds}
 */
function advanceBy(duration = {}) {
  if (!frozenTime) {
    throw new Error('Time not frozen. Call freezeAt() first.');
  }

  const { days = 0, hours = 0, minutes = 0, seconds = 0 } = duration;
  const milliseconds =
    days * 24 * 60 * 60 * 1000 +
    hours * 60 * 60 * 1000 +
    minutes * 60 * 1000 +
    seconds * 1000;

  frozenTime += milliseconds;
  jest.setSystemTime(frozenTime);
  console.log(`⏰ Time advanced to: ${new Date(frozenTime).toISOString()}`);
}

/**
 * Reset time to real system time
 */
function resetTime() {
  frozenTime = null;
  jest.useRealTimers();
  console.log(`⏰ Time reset to real system time`);
}

/**
 * Get current frozen time or real time
 * @returns {number} timestamp in milliseconds
 */
function now() {
  return frozenTime || Date.now();
}

module.exports = {
  freezeAt,
  advanceBy,
  resetTime,
  now
};
