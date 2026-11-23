import { describe, expect, it } from "vitest";
import { calendar } from "../sim/clock";
import { YEAR_MIN } from "../sim/time";
import { clockFace } from "./clockFace";
import { dayPhase, pad } from "./topbarModel";

// The composition the top bar built inline before the clock became its own component; the face must stay identical.
const before = (gameMinutes: number) => {
  const cal = calendar(gameMinutes);
  return {
    time: `${pad(cal.hour)}:${pad(cal.minute)}`,
    needle: ((cal.hour * 60 + cal.minute) / 1440) * 100,
    phase: dayPhase(cal.hour),
    year: cal.year,
    season: cal.season,
    dayOfSeason: cal.dayOfSeason,
  };
};

describe("clockFace", () => {
  it("keeps the text, the needle and the date of the inline clock over a whole game year", () => {
    for (let m = 0; m < YEAR_MIN + 2000; m += 7) expect({ m, face: clockFace(m) }).toEqual({ m, face: before(m) });
  });

  it("shows two digits either side, from the 06:00 the game starts at", () => {
    expect(clockFace(0).time).toBe("06:00");
    expect(clockFace(65).time).toBe("07:05");
    expect(clockFace(16 * 60 + 9).time).toBe("22:09");
    // Midnight rolls the day, not the time.
    expect(clockFace(18 * 60).time).toBe("00:00");
    expect(clockFace(18 * 60).dayOfSeason).toBe(2);
  });

  it("puts the needle where the minute is in the day", () => {
    expect(clockFace(0).needle).toBeCloseTo((6 * 60 * 100) / 1440, 10);
    expect(clockFace(18 * 60).needle).toBe(0); // 00:00 at the left edge
    expect(clockFace(0).needle).toBeGreaterThan(0);
  });

  it("keeps the four day phases, night where clock.ts isNight says so", () => {
    const at = (hour: number) => clockFace((hour - 6) * 60).phase; // the first day starts at 06:00
    expect(at(4)).toBe("night"); // night ends at 05:00, as in clock.ts isNight
    expect(at(5)).toBe("morning");
    expect(at(10)).toBe("morning");
    expect(at(11)).toBe("day");
    expect(at(16)).toBe("day");
    expect(at(17)).toBe("evening");
    expect(at(21)).toBe("evening");
    expect(at(22)).toBe("night");
    expect(clockFace((22 - 6) * 60 - 1).phase).toBe("evening");
  });
});
