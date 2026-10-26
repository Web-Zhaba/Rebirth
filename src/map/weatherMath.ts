const clamp = (x: number, a: number, b: number) => Math.min(b, Math.max(a, x));

const smoothstep = (a: number, b: number, x: number) => {
  const t = clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};

// Snow on the ground: absent below a dusting, a paper-white veil at half opacity once the pack is deep.
export function snowOpacity(snowpack: number): number {
  return 0.5 * smoothstep(0.01, 0.4, snowpack);
}

// Ice on water: nothing until the ice has some thickness, then a translucent pale sheet.
export function iceOpacity(ice: number): number {
  return 0.55 * smoothstep(0.15, 0.8, ice);
}

// A cool haze for overcast and wet weather; rain adds a little more than cloud alone.
export function overcastOpacity(cloud: number, precip: number): number {
  const cover = clamp(cloud, 0, 1);
  const rain = smoothstep(0.05, 2, precip);
  return 0.12 * Math.min(1, 0.8 * cover + 0.2 * rain);
}

// How many particles a given rain rate deserves.
export function precipDensity(precip: number): number {
  return smoothstep(0.05, 3, precip);
}

// Horizontal drift per unit of fall, from wind speed in m/s.
export function precipSlant(wind: number): number {
  return clamp(wind * 0.09, -1.2, 1.2);
}

// Particles belong to the town view only, fading in as the camera closes in.
export function precipVisibility(zoom: number): number {
  return smoothstep(8.5, 11.5, zoom);
}

// Ground cover and haze belong to the near view: the globe is the clouds' stage, not a white ball painted with the
// town's snow depth.
export function weatherCoverVisibility(zoom: number): number {
  return smoothstep(6.5, 9, zoom);
}

const RAD = Math.PI / 180;

// Compass bearing from (lng, lat) to the subsolar point of a unit sun vector, degrees clockwise from north.
export function sunAzimuth(sun: [number, number, number], lng: number, lat: number): number {
  const [x, y, z] = sun;
  const subLat = Math.asin(clamp(z, -1, 1));
  const subLng = Math.atan2(y, x);
  const p1 = lat * RAD;
  const p2 = subLat;
  const dl = subLng - lng * RAD;
  const bearing = Math.atan2(Math.sin(dl) * Math.cos(p2), Math.cos(p1) * Math.sin(p2) - Math.sin(p1) * Math.cos(p2) * Math.cos(dl));
  return ((bearing / RAD) % 360 + 360) % 360;
}
