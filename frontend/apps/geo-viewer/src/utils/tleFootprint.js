const DEG = 180 / Math.PI;
const RAD = Math.PI / 180;
const EARTH_RADIUS_KM = 6371.0;
const MU = 398600.4418;

const SATELLITE_META = {
  GK2: {
    directory: "GK2",
    fileCode: "GEMS",
    label: "GEMS",
    name: "GEO-KOMPSAT-2B",
    orbitType: "GEO",
    color: "#6ee7b7",
    bounds: [75, -5, 150, 45]
  },
  TEMPO: {
    directory: "TEMPO",
    fileCode: "TEMPO",
    label: "TEMPO",
    name: "DIRECTV 5",
    orbitType: "GEO",
    color: "#ffd670",
    bounds: [-155, 15, -50, 58]
  },
  SENTINEL5P: {
    directory: "SENTINEL5P",
    fileCode: "SENTINEL5P",
    label: "S5P",
    name: "SENTINEL-5P",
    orbitType: "LEO",
    color: "#93c5fd",
    swathKm: 2600,
    alongKm: 2600
  }
};

export function tleUrl(base, satelliteKind, stamp) {
  const meta = SATELLITE_META[satelliteKind] || SATELLITE_META.GK2;
  return `${base}/TLE/${meta.directory}/${stamp.yyyymm}/${stamp.dd}/${meta.fileCode}_TLE_${stamp.yyyymmdd}.txt`;
}

export function satelliteMeta(satelliteKind) {
  return SATELLITE_META[satelliteKind] || SATELLITE_META.GK2;
}

export function parseTle(text) {
  const lines = String(text || "").split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const line1 = lines.find((line) => line.startsWith("1 "));
  const line2 = lines.find((line) => line.startsWith("2 "));
  if (!line1 || !line2) throw new Error("TLE file does not contain line 1/2 records.");
  const epochYear = Number(line1.slice(18, 20));
  const epochDay = Number(line1.slice(20, 32));
  const year = epochYear < 57 ? 2000 + epochYear : 1900 + epochYear;
  const epoch = new Date(Date.UTC(year, 0, 1, 0, 0, 0, 0));
  epoch.setUTCSeconds((epochDay - 1) * 86400);
  return {
    epoch,
    inclination: Number(line2.slice(8, 16)) * RAD,
    raan: Number(line2.slice(17, 25)) * RAD,
    eccentricity: Number(`0.${line2.slice(26, 33).trim()}`),
    argPerigee: Number(line2.slice(34, 42)) * RAD,
    meanAnomaly: Number(line2.slice(43, 51)) * RAD,
    meanMotion: Number(line2.slice(52, 63))
  };
}

export function satelliteFootprint(tle, when = new Date()) {
  const state = satelliteState(tle, when);
  const r = vectorNorm(state.eci);
  const lonLat = eciToLonLat(state.eci, when);
  const radius = Math.max(2, Math.min(82, Math.acos(Math.min(1, EARTH_RADIUS_KM / Math.max(EARTH_RADIUS_KM + 1, r))) * DEG));
  return { center: lonLat, radius, altitudeKm: Math.max(0, r - EARTH_RADIUS_KM) };
}

export function satelliteObservationGeometry(tle, satelliteKind, when = new Date(), options = {}) {
  const meta = satelliteMeta(satelliteKind);
  const state = satelliteState(tle, when);
  const center = eciToLonLat(state.eci, when);
  const altitudeKm = Math.max(0, vectorNorm(state.eci) - EARTH_RADIUS_KM);
  const radiusKm = altitudeKm + EARTH_RADIUS_KM;
  const orbitGeometry = orbitLine(tle, when, options.orbitHours || 6);

  if (meta.bounds) {
    return {
      kind: satelliteKind,
      label: meta.label,
      name: meta.name,
      color: meta.color,
      orbitType: meta.orbitType,
      center,
      altitudeKm,
      radiusKm,
      orbitGeometry,
      geometry: boundsPolygon(meta.bounds)
    };
  }

  const ring = swathPolygon(tle, when, meta.swathKm || 1200, meta.alongKm || 900);

  return {
    kind: satelliteKind,
    label: meta.label,
    name: meta.name,
    color: meta.color,
    orbitType: meta.orbitType,
    center,
    altitudeKm,
    radiusKm,
    orbitGeometry,
    geometry: { type: "Polygon", coordinates: [ring] }
  };
}

function orbitLine(tle, when, orbitHours) {
  const rangeSec = Math.max(3600, Number(orbitHours || 6) * 3600);
  const samples = Math.max(48, Math.min(360, Math.round(rangeSec / 90)));
  const start = when.getTime() - rangeSec * 500;
  const points = [];
  for (let i = 0; i <= samples; i += 1) {
    const t = new Date(start + rangeSec * 1000 * i / samples);
    points.push(eciToLonLat(satelliteState(tle, t).eci, t));
  }
  const lines = splitAntimeridian(points);
  return lines.length === 1
    ? { type: "LineString", coordinates: lines[0] }
    : { type: "MultiLineString", coordinates: lines };
}

function splitAntimeridian(points) {
  const lines = [[]];
  for (const point of points) {
    const line = lines[lines.length - 1];
    const prev = line[line.length - 1];
    if (prev && Math.abs(point[0] - prev[0]) > 180) lines.push([]);
    lines[lines.length - 1].push(point);
  }
  return lines.filter((line) => line.length > 1);
}

function swathPolygon(tle, when, swathKm, alongKm) {
  const halfSwath = swathKm * 0.5;
  const durationSec = Math.max(60, alongKm / 7.4);
  const samples = 10;
  const left = [];
  const right = [];

  for (let i = 0; i < samples; i += 1) {
    const t = -0.5 + i / (samples - 1);
    const sampleTime = new Date(when.getTime() + t * durationSec * 1000);
    const center = eciToLonLat(satelliteState(tle, sampleTime).eci, sampleTime);
    const beforeTime = new Date(sampleTime.getTime() - 15000);
    const afterTime = new Date(sampleTime.getTime() + 15000);
    const before = eciToLonLat(satelliteState(tle, beforeTime).eci, beforeTime);
    const after = eciToLonLat(satelliteState(tle, afterTime).eci, afterTime);
    const crossBearing = bearing(before, after) + 90;
    left.push(destinationPoint(center, crossBearing, halfSwath));
    right.push(destinationPoint(center, crossBearing + 180, halfSwath));
  }

  return rewindForD3([...left, ...right.reverse(), left[0]]);
}

function rewindForD3(ring) {
  if (planarRingArea(ring) < 0) return ring;
  return [...ring].reverse();
}

function planarRingArea(ring) {
  let area = 0;
  for (let i = 0; i < ring.length - 1; i += 1) {
    const [x1, y1] = ring[i];
    const [x2, y2] = ring[i + 1];
    area += x1 * y2 - x2 * y1;
  }
  return area * 0.5;
}

function satelliteState(tle, when) {
  const n = tle.meanMotion * 2 * Math.PI / 86400;
  const a = Math.cbrt(MU / (n * n));
  const dt = (when.getTime() - tle.epoch.getTime()) / 1000;
  const meanAnomaly = normalizeRadians(tle.meanAnomaly + n * dt);
  const eccentricAnomaly = solveKepler(meanAnomaly, tle.eccentricity);
  const cosE = Math.cos(eccentricAnomaly);
  const sinE = Math.sin(eccentricAnomaly);
  const r = a * (1 - tle.eccentricity * cosE);
  const trueAnomaly = Math.atan2(Math.sqrt(1 - tle.eccentricity * tle.eccentricity) * sinE, cosE - tle.eccentricity);
  const u = tle.argPerigee + trueAnomaly;
  const cosU = Math.cos(u), sinU = Math.sin(u);
  const cosO = Math.cos(tle.raan), sinO = Math.sin(tle.raan);
  const cosI = Math.cos(tle.inclination), sinI = Math.sin(tle.inclination);
  const x = r * (cosO * cosU - sinO * sinU * cosI);
  const y = r * (sinO * cosU + cosO * sinU * cosI);
  const z = r * (sinU * sinI);
  return { eci: [x, y, z] };
}

function eciToLonLat(eci, when) {
  const gmst = greenwichSiderealTime(when);
  const xe = eci[0] * Math.cos(gmst) + eci[1] * Math.sin(gmst);
  const ye = -eci[0] * Math.sin(gmst) + eci[1] * Math.cos(gmst);
  const z = eci[2];
  const lon = normalizeLon(Math.atan2(ye, xe) * DEG);
  const lat = Math.atan2(z, Math.hypot(xe, ye)) * DEG;
  return [lon, lat];
}

function vectorNorm(v) {
  return Math.hypot(v[0], v[1], v[2]);
}

function boundsPolygon([west, south, east, north]) {
  return {
    type: "Polygon",
    coordinates: [[
      [west, south],
      [west, north],
      [east, north],
      [east, south],
      [west, south]
    ]]
  };
}

function destinationPoint([lon, lat], bearingDeg, distanceKm) {
  const delta = distanceKm / EARTH_RADIUS_KM;
  const theta = bearingDeg * RAD;
  const phi1 = lat * RAD;
  const lambda1 = lon * RAD;
  const sinPhi1 = Math.sin(phi1), cosPhi1 = Math.cos(phi1);
  const sinDelta = Math.sin(delta), cosDelta = Math.cos(delta);
  const phi2 = Math.asin(sinPhi1 * cosDelta + cosPhi1 * sinDelta * Math.cos(theta));
  const lambda2 = lambda1 + Math.atan2(Math.sin(theta) * sinDelta * cosPhi1, cosDelta - sinPhi1 * Math.sin(phi2));
  return [normalizeLon(lambda2 * DEG), phi2 * DEG];
}

function bearing(from, to) {
  const phi1 = from[1] * RAD, phi2 = to[1] * RAD;
  const deltaLambda = (to[0] - from[0]) * RAD;
  const y = Math.sin(deltaLambda) * Math.cos(phi2);
  const x = Math.cos(phi1) * Math.sin(phi2) - Math.sin(phi1) * Math.cos(phi2) * Math.cos(deltaLambda);
  return (Math.atan2(y, x) * DEG + 360) % 360;
}

function solveKepler(meanAnomaly, eccentricity) {
  let e = meanAnomaly;
  for (let i = 0; i < 8; i += 1) {
    e -= (e - eccentricity * Math.sin(e) - meanAnomaly) / (1 - eccentricity * Math.cos(e));
  }
  return e;
}

function normalizeRadians(value) {
  return ((value % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
}

function normalizeLon(value) {
  return ((value + 540) % 360) - 180;
}

function greenwichSiderealTime(date) {
  const jd = date.getTime() / 86400000 + 2440587.5;
  const t = (jd - 2451545.0) / 36525;
  const gmst = 280.46061837 + 360.98564736629 * (jd - 2451545.0) + 0.000387933 * t * t - t * t * t / 38710000;
  return normalizeRadians(gmst * RAD);
}
