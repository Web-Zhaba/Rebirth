export function formatCoordinates(lat: number, lng: number, digits = 5): string {
  return `${lat.toFixed(digits)}, ${lng.toFixed(digits)}`;
}
