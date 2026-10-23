// Phase 3: Haversine great-circle distance formula
export function haversine(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371; // km
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLon / 2) ** 2;
  return +(R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))).toFixed(2);
}

export interface PHC { name: string; lat: number; lon: number; phone: string; email: string; }

// Stub PHC list of mock health clinics in Kolkata
export const PHC_LIST: PHC[] = [
  { name: "Kolkata Care Health Centre",      lat: 22.5398, lon: 88.3444, phone: "+91 98310 XXXXX", email: "care@kolkatahealth.org" },
  { name: "Hooghly River Community Clinic",  lat: 22.5746, lon: 88.3612, phone: "+91 98302 XXXXX", email: "river@kolkatahealth.org" },
  { name: "Salt Lake Medical Outpost",       lat: 22.5638, lon: 88.3687, phone: "+91 94330 XXXXX", email: "saltlake@kolkatahealth.org" },
  { name: "Howrah Bridge Wellness Centre",   lat: 22.5986, lon: 88.3789, phone: "+91 98740 XXXXX", email: "wellness@kolkatahealth.org" },
  { name: "Victoria Memorial Clinic",        lat: 22.5405, lon: 88.3718, phone: "+91 91630 XXXXX", email: "victoria@kolkatahealth.org" },
];

export function nearestPHC(lat: number, lon: number): (PHC & { distanceKm: number })[] {
  return PHC_LIST
    .map(p => ({ ...p, distanceKm: haversine(lat, lon, p.lat, p.lon) }))
    .sort((a, b) => a.distanceKm - b.distanceKm);
}
