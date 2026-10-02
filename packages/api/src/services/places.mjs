// Places search adapters (Station 11 "Find leads"). Ships OFF: the real one needs the Places API enabled on the
// project and a key, which are Christian's call (rails §3: cloud change, spend). The route never stores what a search
// returns except the place id (0013); the rest is used once, to find the business's own homepage.
//
//   search({ query, pageToken }) → { places: [{ placeId, name, website, address }], next: pageToken | null }

export const PAGE_SIZE = 20;

export function offPlaces() {
  return { name: 'off', async search() { throw new Error('places search is turned off'); } };
}

/** For tests and the dev server: a fixed list served in pages. */
export function fakePlaces(list, { fail = null } = {}) {
  const calls = [];
  return {
    name: 'fake', calls,
    async search({ query, pageToken = null }) {
      calls.push({ query, pageToken });
      if (fail) throw fail;
      const start = pageToken ? Number(pageToken) : 0;
      const places = list.slice(start, start + PAGE_SIZE);
      return { places, next: start + PAGE_SIZE < list.length ? String(start + PAGE_SIZE) : null };
    },
  };
}

// Places API (New) Text Search. [VERIFY https://developers.google.com/maps/documentation/places/web-service/text-search
// for the endpoint, the field mask names and per-request pricing before turning it on.] The key is read by name from
// the environment (OMNI_PLACES_KEY) and sent only in this header.
export function googlePlaces({ key, fetchImpl = fetch }) {
  return {
    name: 'google',
    async search({ query, pageToken = null }) {
      const res = await fetchImpl('https://places.googleapis.com/v1/places:searchText', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-goog-api-key': key,
          'x-goog-fieldmask': 'places.id,places.displayName,places.websiteUri,places.formattedAddress,nextPageToken' },
        body: JSON.stringify({ textQuery: query, pageSize: PAGE_SIZE, ...(pageToken ? { pageToken } : {}) }),
        signal: AbortSignal.timeout(10000),
      });
      if (!res.ok) throw new Error(`places search failed: http ${res.status}`);
      const d = await res.json();
      return {
        places: (d.places ?? []).map((p) => ({ placeId: p.id, name: p.displayName?.text ?? null, website: p.websiteUri ?? null, address: p.formattedAddress ?? null })),
        next: d.nextPageToken ?? null,
      };
    },
  };
}
