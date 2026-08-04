/**
 * Google Maps live connector — real Distance Matrix + Directions API calls.
 *
 * Used by the Parcel Delivery route planner to replace the haversine
 * approximation with real driving distances and durations.
 *
 * Auth: URL query param `key=AIza...`
 * Docs: https://developers.google.com/maps/documentation/distance-matrix
 */

import { requireEnv, redactKey, timed, type LiveTestResult } from './types';

const MAPS_API = 'https://maps.googleapis.com/maps/api';

interface DistanceMatrixRow {
  elements: Array<{
    status: string;
    distance?: { text: string; value: number }; // meters
    duration?: { text: string; value: number };  // seconds
  }>;
}

interface DistanceMatrixResponse {
  status: string;
  origin_addresses: string[];
  destination_addresses: string[];
  rows: DistanceMatrixRow[];
  error_message?: string;
}

interface GeocodeResponse {
  status: string;
  results: Array<{
    formatted_address: string;
    geometry: { location: { lat: number; lng: number } };
  }>;
  error_message?: string;
}

/** Get real driving distance + duration between two addresses. */
export async function getDistanceMatrix(opts: {
  origins: string[];
  destinations: string[];
}): Promise<LiveTestResult<DistanceMatrixResponse>> {
  const key = requireEnv('GOOGLE_MAPS_API_KEY');
  const timestamp = new Date().toISOString();
  const params = new URLSearchParams({
    key,
    origins: opts.origins.join('|'),
    destinations: opts.destinations.join('|'),
  });

  try {
    const { result: resp, latencyMs } = await timed(() =>
      fetch(`${MAPS_API}/distancematrix/json?${params}`),
    );
    const json = (await resp.json()) as DistanceMatrixResponse;

    if (!resp.ok || json.status !== 'OK') {
      return {
        provider: 'Google Maps', operation: 'distanceMatrix', success: false,
        status: resp.status, latencyMs, environment: 'production', timestamp,
        summary: `Maps API error: ${json.error_message ?? json.status ?? resp.statusText}`,
        error: json.error_message ?? json.status ?? `HTTP ${resp.status}`,
        requestPreview: { origins: opts.origins, destinations: opts.destinations, key: redactKey(key) },
      };
    }

    const firstElement = json.rows[0]?.elements[0];
    const summary = firstElement?.distance
      ? `Driving distance: ${firstElement.distance.text} (${firstElement.duration?.text}).`
      : 'Distance matrix retrieved.';

    return {
      provider: 'Google Maps', operation: 'distanceMatrix', success: true,
      status: 200, latencyMs, environment: 'production', timestamp,
      data: json,
      summary,
      requestPreview: { origins: opts.origins, destinations: opts.destinations, endpoint: '/distancematrix/json' },
      rawResponse: {
        origin_addresses: json.origin_addresses,
        destination_addresses: json.destination_addresses,
        rows: json.rows.map((r) => ({
          elements: r.elements.map((e) => ({
            status: e.status,
            distance: e.distance ? { text: e.distance.text, value: e.distance.value } : null,
            duration: e.duration ? { text: e.duration.text, value: e.duration.value } : null,
          })),
        })),
      },
    };
  } catch (e) {
    return {
      provider: 'Google Maps', operation: 'distanceMatrix', success: false,
      status: 0, latencyMs: 0, environment: 'production', timestamp,
      summary: `Network error: ${e instanceof Error ? e.message : 'unknown'}`,
      error: e instanceof Error ? e.message : String(e),
    };
  }
}

/** Geocode an address to lat/lng. */
export async function geocode(address: string): Promise<LiveTestResult<{ lat: number; lng: number; formatted: string }>> {
  const key = requireEnv('GOOGLE_MAPS_API_KEY');
  const timestamp = new Date().toISOString();
  const params = new URLSearchParams({ key, address });

  try {
    const { result: resp, latencyMs } = await timed(() =>
      fetch(`${MAPS_API}/geocode/json?${params}`),
    );
    const json = (await resp.json()) as GeocodeResponse;

    if (!resp.ok || json.status !== 'OK' || json.results.length === 0) {
      return {
        provider: 'Google Maps', operation: 'geocode', success: false,
        status: resp.status, latencyMs, environment: 'production', timestamp,
        summary: `Geocode failed: ${json.error_message ?? json.status ?? 'no results'}`,
        error: json.error_message ?? json.status ?? 'No results',
        requestPreview: { address, key: redactKey(key) },
      };
    }

    const loc = json.results[0].geometry.location;
    return {
      provider: 'Google Maps', operation: 'geocode', success: true,
      status: 200, latencyMs, environment: 'production', timestamp,
      data: { lat: loc.lat, lng: loc.lng, formatted: json.results[0].formatted_address },
      summary: `Geocoded "${address}" → ${loc.lat.toFixed(4)}, ${loc.lng.toFixed(4)} (${json.results[0].formatted_address}).`,
      requestPreview: { address, endpoint: '/geocode/json' },
      rawResponse: { lat: loc.lat, lng: loc.lng, formatted_address: json.results[0].formatted_address },
    };
  } catch (e) {
    return {
      provider: 'Google Maps', operation: 'geocode', success: false,
      status: 0, latencyMs: 0, environment: 'production', timestamp,
      summary: `Network error: ${e instanceof Error ? e.message : 'unknown'}`,
      error: e instanceof Error ? e.message : String(e),
    };
  }
}

/** Run the full Maps test suite: geocode two cities + get driving distance. */
export async function runMapsTest(): Promise<{
  origin: LiveTestResult<{ lat: number; lng: number; formatted: string }>;
  destination: LiveTestResult<{ lat: number; lng: number; formatted: string }>;
  distance: LiveTestResult<DistanceMatrixResponse>;
}> {
  const origin = await geocode('Accra Mall, Accra, Ghana');
  const destination = await geocode('Kumasi, Ghana');
  const distance = await getDistanceMatrix({
    origins: ['Accra Mall, Accra, Ghana'],
    destinations: ['Kumasi, Ghana'],
  });
  return { origin, destination, distance };
}
