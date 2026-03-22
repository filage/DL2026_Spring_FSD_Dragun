<script lang="ts">
  import { onDestroy, onMount } from 'svelte';
  import maplibregl from 'maplibre-gl';
  import { env } from '$env/dynamic/public';
  import { DEFAULT_API_BASE_URL } from '$lib/config';
  import { auth, authInit, apiFetch, logout, type AuthUser } from '$lib/auth';

  type Category = 'cafe' | 'museum' | 'park' | 'attraction';

  type Place = {
    id: string;
    name: string;
    category: Category;
    coordinates: { lat: number; lng: number };
    distanceMeters: number;
    address: string | null;
    description?: string | null;
    wikipedia?: string | null;
    website?: string | null;
  };

  const categories: { id: Category; label: string }[] = [
    { id: 'cafe', label: 'Кафе' },
    { id: 'museum', label: 'Музеи' },
    { id: 'park', label: 'Парки' },
    { id: 'attraction', label: 'Достопримечательности' }
  ];

  function categoryIcon(c: Category) {
    if (c === 'cafe') {
      return `<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path fill="currentColor" d="M3 3h14v8a5 5 0 0 1-5 5H8a5 5 0 0 1-5-5V3Zm16 3h2a2 2 0 0 1 0 4h-2V6Zm-2 12H5v2h12v-2Z"/></svg>`;
    }
    if (c === 'museum') {
      return `<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path fill="currentColor" d="M12 3 2 8v2h20V8L12 3Zm-7 9h2v7H5v-7Zm4 0h2v7H9v-7Zm4 0h2v7h-2v-7Zm4 0h2v7h-2v-7ZM3 21h18v-2H3v2Z"/></svg>`;
    }
    if (c === 'park') {
      return `<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path fill="currentColor" d="M12 2a4 4 0 0 0-4 4c0 .4.06.8.18 1.17A4 4 0 0 0 6 11c0 1.06.4 2.02 1.06 2.75A4.5 4.5 0 0 0 11 20.94V22h2v-1.06A4.5 4.5 0 0 0 16.94 13.75A4 4 0 0 0 18 11a4 4 0 0 0-2.18-3.83c.12-.37.18-.77.18-1.17a4 4 0 0 0-4-4Z"/></svg>`;
    }
    return `<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path fill="currentColor" d="M12 2a7 7 0 0 0-7 7c0 5.2 7 13 7 13s7-7.8 7-13a7 7 0 0 0-7-7Zm0 9.5A2.5 2.5 0 1 1 12 6a2.5 2.5 0 0 1 0 5.5Z"/></svg>`;
  }

  function ratingStars(rating: number) {
    const r = Math.max(0, Math.min(5, Math.round(rating)));
    return [1, 2, 3, 4, 5].map((n) => (n <= r ? '★' : '☆')).join('');
  }

  let mapEl: HTMLDivElement | null = $state(null);
  let map: maplibregl.Map | null = $state(null);
  let userMarker: maplibregl.Marker | null = $state(null);

  let selectedCategories = $state<Set<Category>>(new Set(categories.map((c) => c.id)));
  let radius = $state(2000);

  let drawer: 'none' | 'places' | 'favorites' | 'history' | 'place' | 'reviews' = $state('none');

  let topOpen = $state(true);

  let userLat: number | null = $state(null);
  let userLng: number | null = $state(null);

  let searchLat: number | null = $state(null);
  let searchLng: number | null = $state(null);

  let loading = $state(false);
  let error: string | null = $state(null);
  let places: Place[] = $state([]);
  let selected: Place | null = $state(null);

  let accuracyMeters: number | null = $state(null);

  let nearbyCache = $state<Record<string, { ts: number; places: Place[] }>>({});

  let selectedPopup: maplibregl.Popup | null = $state(null);
  let selectedPopupEl: HTMLDivElement | null = $state(null);

  let nearbyDebounce: number | null = null;

  let inflightNearby = $state<Record<string, Promise<Place[]>>>({});

  function scheduleNearby(reason: 'move' | 'category') {
    if (nearbyDebounce != null) window.clearTimeout(nearbyDebounce);
    nearbyDebounce = window.setTimeout(() => {
      if (!map) return;
      const c = map.getCenter();
      searchLat = c.lat;
      searchLng = c.lng;

      const b = map.getBounds();
      const ne = b.getNorthEast();
      const meters = haversineMeters(c.lat, c.lng, ne.lat, ne.lng);
      radius = Math.max(250, Math.min(50_000, Math.round(meters)));
      void loadNearby();
    }, reason === 'category' ? 50 : 450);
  }

  async function loadRatingSummary(placeId: string) {
    try {
      // Ensure cached in backend DB for reviews.
      try {
        if (selected && selected.id === placeId) {
          const u = new URL(`${apiBase}/places/${encodeURIComponent(placeId)}`);
          u.searchParams.set('name', selected.name);
          u.searchParams.set('lat', String(selected.coordinates.lat));
          u.searchParams.set('lng', String(selected.coordinates.lng));
          if (selected.address) u.searchParams.set('address', selected.address);
          u.searchParams.set('category', selected.category);
          await fetch(u);
        } else {
          await fetch(`${apiBase}/places/${encodeURIComponent(placeId)}`);
        }
      } catch {
        // ignore
      }

      const r = await fetch(`${apiBase}/reviews/place/${encodeURIComponent(placeId)}`);
      const json = await r.json();
      if (!r.ok || !json.ok) return;
      const list = (json.reviews as Review[]) ?? [];
      const count = list.length;
      const avg = count ? list.reduce((s, it) => s + it.rating, 0) / count : 0;
      ratingSummary = { ...ratingSummary, [placeId]: { avg, count } };

      if (selected && selected.id === placeId && selectedPopupEl) {
        const full = Math.round(avg);
        const stars = [1, 2, 3, 4, 5].map((n) => (n <= full ? '★' : '☆')).join('');
        const starsEl = selectedPopupEl.querySelector('.ppStars');
        if (starsEl) starsEl.textContent = stars;
        const countEl = selectedPopupEl.querySelector('.ppCount');
        if (countEl) countEl.textContent = String(count);
      }
    } catch {
      // ignore
    }
  }

  function openDrawer(kind: typeof drawer) {
    drawer = drawer === kind ? 'none' : kind;
  }

  function haversineMeters(lat1: number, lng1: number, lat2: number, lng2: number) {
    const R = 6371000;
    const dLat = ((lat2 - lat1) * Math.PI) / 180;
    const dLng = ((lng2 - lng1) * Math.PI) / 180;
    const a =
      Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLng / 2) * Math.sin(dLng / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
  }

  type Review = {
    id: string;
    rating: number;
    text: string;
    createdAt: string;
    user: { id: string; username: string; role: 'USER' | 'ADMIN' };
  };

  let me: AuthUser | null = $state(null);
  const unsub = auth.subscribe((s) => {
    me = s.user;
  });

  let reviewsLoading = $state(false);
  let reviewsError: string | null = $state(null);
  let reviews: Review[] = $state([]);
  let reviewRating = $state(5);
  let reviewText = $state('');
  let reviewFormOpen = $state(false);

  let ratingSummary = $state<Record<string, { avg: number; count: number }>>({});

  type FavoriteItem = {
    id: string;
    placeId: string;
    createdAt: string;
    place: {
      id: string;
      name: string;
      category: string;
      lat: number;
      lng: number;
      address: string | null;
    };
  };

  type VisitItem = {
    id: string;
    placeId: string;
    visitedAt: string;
    notes: string | null;
    place: {
      id: string;
      name: string;
      category: string;
      lat: number;
      lng: number;
      address: string | null;
    };
  };

  let favoritesLoading = $state(false);
  let favoritesError: string | null = $state(null);
  let favorites: FavoriteItem[] = $state([]);

  let visitsLoading = $state(false);
  let visitsError: string | null = $state(null);
  let visits: VisitItem[] = $state([]);

  const apiBase = env.PUBLIC_API_BASE_URL || DEFAULT_API_BASE_URL;

  async function getUserLocation(): Promise<{ lat: number; lng: number; accuracy: number | null }> {
    return await new Promise((resolve, reject) => {
      navigator.geolocation.getCurrentPosition(
        (pos) =>
          resolve({
            lat: pos.coords.latitude,
            lng: pos.coords.longitude,
            accuracy: typeof pos.coords.accuracy === 'number' ? pos.coords.accuracy : null
          }),
        (e) => reject(new Error(e.message)),
        { enableHighAccuracy: true, timeout: 20_000, maximumAge: 0 }
      );
    });
  }

  function startWatchLocation() {
    try {
      if (!navigator.geolocation) return;
      navigator.geolocation.watchPosition(
        (pos) => {
          const lat = pos.coords.latitude;
          const lng = pos.coords.longitude;
          const acc = typeof pos.coords.accuracy === 'number' ? pos.coords.accuracy : null;
          userLat = lat;
          userLng = lng;
          accuracyMeters = acc;
          setUserMarker(lat, lng);
        },
        () => {
          // ignore
        },
        { enableHighAccuracy: true, timeout: 20_000, maximumAge: 0 }
      );
    } catch {
      // ignore
    }
  }

  function bucketLatLng(lat: number, lng: number) {
    const latB = Math.round(lat * 1000) / 1000;
    const lngB = Math.round(lng * 1000) / 1000;
    return { latB, lngB };
  }

  function makeBaseKey(params: { latB: number; lngB: number; radius: number }) {
    return `${params.latB.toFixed(3)}:${params.lngB.toFixed(3)}:${Math.round(params.radius / 250) * 250}`;
  }

  function fetchNearbyOnce(params: {
    cacheKey: string;
    latB: number;
    lngB: number;
    radius: number;
    category: Category;
  }) {
    const existing = inflightNearby[params.cacheKey];
    if (existing) return existing;

    const p = (async () => {
      const url = new URL(`${apiBase}/places/nearby`);
      url.searchParams.set('lat', String(params.latB));
      url.searchParams.set('lng', String(params.lngB));
      url.searchParams.set('radius', String(params.radius));
      url.searchParams.set('category', params.category);
      url.searchParams.set('limit', '80');

      const ac = new AbortController();
      const t = window.setTimeout(() => ac.abort(), 25_000);
      try {
        const r = await fetch(url, { signal: ac.signal });
        const json = await r.json();
        if (!r.ok || !json.ok) throw new Error(json.error ?? 'Failed to load places');
        return json.places as Place[];
      } finally {
        window.clearTimeout(t);
      }
    })();

    inflightNearby = { ...inflightNearby, [params.cacheKey]: p };
    const cleanup = p.finally(() => {
      const { [params.cacheKey]: _removed, ...rest } = inflightNearby;
      inflightNearby = rest;
    });
    void cleanup.catch(() => {});

    return p;
  }

  async function prefetchCategories(params: {
    latB: number;
    lngB: number;
    radius: number;
    baseKey: string;
  }) {
    const toPrefetch: Category[] = ['cafe', 'museum', 'park', 'attraction'];
    const now = Date.now();

    const tasks = toPrefetch
      .filter((c) => !selectedCategories.has(c))
      .map(async (c) => {
        const key = `${c}:${params.baseKey}`;
        const hit = nearbyCache[key];
        if (hit && now - hit.ts < 60_000) return;

        try {
          const url = new URL(`${apiBase}/places/nearby`);
          url.searchParams.set('lat', String(params.latB));
          url.searchParams.set('lng', String(params.lngB));
          url.searchParams.set('radius', String(params.radius));
          url.searchParams.set('category', c);
          url.searchParams.set('limit', '80');

          const ac = new AbortController();
          const t = window.setTimeout(() => ac.abort(), 10_000);
          try {
            const r = await fetch(url, { signal: ac.signal });
            const json = await r.json();
            if (!r.ok || !json.ok) return;
            const ps = json.places as Place[];
            nearbyCache = { ...nearbyCache, [key]: { ts: Date.now(), places: ps } };
          } catch (e) {
            if (e instanceof DOMException && e.name === 'AbortError') return;
            return;
          } finally {
            window.clearTimeout(t);
          }
        } catch {
          // ignore prefetch errors
        }
      });

    await Promise.all(tasks);
  }

  async function loadFavorites() {
    if (!me) {
      favorites = [];
      return;
    }
    favoritesLoading = true;
    favoritesError = null;
    try {
      const r = await apiFetch(apiBase, '/favorites');
      const json = await r.json();
      if (!r.ok || !json.ok) throw new Error(json.error ?? 'Failed to load favorites');
      favorites = json.favorites as FavoriteItem[];
    } catch (e) {
      favoritesError = e instanceof Error ? e.message : 'Unknown error';
      favorites = [];
    } finally {
      favoritesLoading = false;
    }
  }

  async function loadVisits() {
    if (!me) {
      visits = [];
      return;
    }
    visitsLoading = true;
    visitsError = null;
    try {
      const r = await apiFetch(apiBase, '/visits');
      const json = await r.json();
      if (!r.ok || !json.ok) throw new Error(json.error ?? 'Failed to load visits');
      visits = json.visits as VisitItem[];
    } catch (e) {
      visitsError = e instanceof Error ? e.message : 'Unknown error';
      visits = [];
    } finally {
      visitsLoading = false;
    }
  }

  function isSelectedFavorite() {
    if (!selected) return false;
    return favorites.some((f) => f.placeId === selected!.id);
  }

  function isSelectedVisited() {
    if (!selected) return false;
    return visits.some((v) => v.placeId === selected!.id);
  }

  async function toggleFavorite() {
    if (!selected) return;
    if (!me) {
      return;
    }

    favoritesLoading = true;
    favoritesError = null;
    try {
      {
        const u = new URL(`${apiBase}/places/${encodeURIComponent(selected.id)}`);
        u.searchParams.set('name', selected.name);
        u.searchParams.set('lat', String(selected.coordinates.lat));
        u.searchParams.set('lng', String(selected.coordinates.lng));
        if (selected.address) u.searchParams.set('address', selected.address);
        u.searchParams.set('category', selected.category);
        await fetch(u);
      }

      const isFav = isSelectedFavorite();
      if (isFav) {
        const r = await apiFetch(apiBase, `/favorites/${encodeURIComponent(selected.id)}`, {
          method: 'DELETE'
        });
        const json = await r.json();
        if (!r.ok || !json.ok) throw new Error(json.error ?? 'Failed to remove favorite');
      } else {
        const r = await apiFetch(apiBase, '/favorites', {
          method: 'POST',
          body: JSON.stringify({ placeId: selected.id })
        });
        const json = await r.json();
        if (!r.ok || !json.ok) throw new Error(json.error ?? 'Failed to add favorite');
      }

      await loadFavorites();
    } catch (e) {
      favoritesError = e instanceof Error ? e.message : 'Unknown error';
    } finally {
      favoritesLoading = false;
    }
  }

  async function addVisit() {
    if (!selected) return;
    if (!me) {
      return;
    }

    visitsLoading = true;
    visitsError = null;
    try {
      {
        const u = new URL(`${apiBase}/places/${encodeURIComponent(selected.id)}`);
        await fetch(u);
      }

      const already = isSelectedVisited();
      const r = already
        ? await apiFetch(apiBase, `/visits/${encodeURIComponent(selected.id)}`, { method: 'DELETE' })
        : await apiFetch(apiBase, '/visits', {
            method: 'POST',
            body: JSON.stringify({ placeId: selected.id })
          });
      const json = await r.json();
      if (!r.ok || !json.ok) throw new Error(json.error ?? (already ? 'Failed to remove visit' : 'Failed to add visit'));
      await loadVisits();
    } catch (e) {
      visitsError = e instanceof Error ? e.message : 'Unknown error';
    } finally {
      visitsLoading = false;
    }
  }

  function ensureMap() {
    if (!mapEl) return;
    if (map) return;

    map = new maplibregl.Map({
      container: mapEl,
      style: {
        version: 8,
        sources: {
          carto: {
            type: 'raster',
            tiles: [
              'https://a.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png',
              'https://b.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png',
              'https://c.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png',
              'https://d.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png'
            ],
            tileSize: 256,
            attribution:
              '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>'
          }
        },
        layers: [
          {
            id: 'carto',
            type: 'raster',
            source: 'carto'
          }
        ]
      } as any,
      center: [37.6173, 55.7558],
      zoom: 12
    });

    map.addControl(new maplibregl.NavigationControl(), 'top-right');

    const geo = new maplibregl.GeolocateControl({
      positionOptions: {
        enableHighAccuracy: true,
        maximumAge: 0,
        timeout: 20_000
      },
      trackUserLocation: true,
      showUserLocation: true,
      showAccuracyCircle: true
    });
    map.addControl(geo, 'top-right');
    geo.on('geolocate', (e: any) => {
      if (!e?.coords) return;
      userLat = e.coords.latitude;
      userLng = e.coords.longitude;
      accuracyMeters = typeof e.coords.accuracy === 'number' ? e.coords.accuracy : null;
      // Refresh nearby places when a better fix arrives.
      if (selectedCategories.size) void loadNearby();
    });

    map.on('load', () => {
      if (!map) return;

      map.addSource('places', {
        type: 'geojson',
        data: { type: 'FeatureCollection', features: [] },
        cluster: true,
        clusterMaxZoom: 14,
        clusterRadius: 50
      });

      map.addLayer({
        id: 'clusters',
        type: 'circle',
        source: 'places',
        filter: ['has', 'point_count'],
        paint: {
          'circle-color': ['step', ['get', 'point_count'], '#4f46e5', 50, '#f59e0b', 150, '#ef4444'],
          'circle-radius': ['step', ['get', 'point_count'], 18, 50, 26, 150, 34]
        }
      });

      map.addLayer({
        id: 'cluster-count',
        type: 'symbol',
        source: 'places',
        filter: ['has', 'point_count'],
        layout: {
          'text-field': '{point_count_abbreviated}',
          'text-size': 12
        },
        paint: {
          'text-color': '#ffffff'
        }
      });

      map.addLayer({
        id: 'unclustered-point',
        type: 'circle',
        source: 'places',
        filter: ['!', ['has', 'point_count']],
        paint: {
          'circle-color': [
            'match',
            ['get', 'category'],
            'cafe',
            '#111827',
            'museum',
            '#4f46e5',
            'park',
            '#10b981',
            'attraction',
            '#f59e0b',
            '#111827'
          ],
          'circle-radius': 7,
          'circle-stroke-width': 2,
          'circle-stroke-color': '#ffffff'
        }
      });

      map.on('click', 'clusters', (e) => {
        if (!map) return;
        const features = map.queryRenderedFeatures(e.point, { layers: ['clusters'] });
        const clusterId = features[0]?.properties?.cluster_id;
        const source = map.getSource('places') as maplibregl.GeoJSONSource;

        if (clusterId == null) return;
        void (async () => {
          try {
            const zoom = await source.getClusterExpansionZoom(clusterId);
            if (!map) return;
            const c = (features[0].geometry as any).coordinates as [number, number];
            map.easeTo({ center: c, zoom: zoom ?? map.getZoom() });
          } catch {
            // ignore
          }
        })();
      });

      map.on('click', 'unclustered-point', (e) => {
        const feature = e.features?.[0];
        if (!feature) return;
        const props = feature.properties as any;
        const id = props?.id as string;
        const found = places.find((p) => p.id === id);
        if (found) selectPlace(found);
      });

      map.on('mouseenter', 'clusters', () => {
        map!.getCanvas().style.cursor = 'pointer';
      });
      map.on('mouseleave', 'clusters', () => {
        map!.getCanvas().style.cursor = '';
      });
      map.on('mouseenter', 'unclustered-point', () => {
        map!.getCanvas().style.cursor = 'pointer';
      });
      map.on('mouseleave', 'unclustered-point', () => {
        map!.getCanvas().style.cursor = '';
      });

      map.addSource('route', {
        type: 'geojson',
        data: { type: 'Feature', geometry: { type: 'LineString', coordinates: [] }, properties: {} }
      });

      map.addLayer({
        id: 'route-layer',
        type: 'line',
        source: 'route',
        paint: {
          'line-color': '#10b981',
          'line-width': 5
        }
      });
    });
  }

  function updatePlacesOnMap() {
    if (!map) return;
    const src = map.getSource('places') as maplibregl.GeoJSONSource | undefined;
    if (!src) return;

    src.setData({
      type: 'FeatureCollection',
      features: places.map((p) => ({
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [p.coordinates.lng, p.coordinates.lat] },
        properties: {
          id: p.id,
          name: p.name,
          category: p.category,
          distanceMeters: p.distanceMeters,
          address: p.address
        }
      }))
    } as any);
  }

  function setUserMarker(lat: number, lng: number) {
    if (!map) return;
    userMarker?.remove();
    userMarker = new maplibregl.Marker({ color: '#2563eb' }).setLngLat([lng, lat]).addTo(map);
  }

  async function loadNearby() {
    if (selectedCategories.size === 0) {
      places = [];
      updatePlacesOnMap();
      return;
    }
    const lat = userLat;
    const lng = userLng;
    if (lat == null || lng == null) return;

    const fixedRadius = 3000;
    radius = fixedRadius;

    const { latB, lngB } = bucketLatLng(lat, lng);
    const baseKey = makeBaseKey({ latB, lngB, radius: fixedRadius });
    const cats = Array.from(selectedCategories);
    const cacheKeys = cats.map((c) => `${c}:${baseKey}`);
    const now = Date.now();

    const cachedPlaces = cacheKeys
      .map((k) => nearbyCache[k])
      .filter((v) => v && v.places.length)
      .flatMap((v) => v!.places);

    const hasAnyCached = cachedPlaces.length > 0;

    if (hasAnyCached) {
      places = cachedPlaces.sort((a, b) => a.distanceMeters - b.distanceMeters);
      updatePlacesOnMap();
    }

    loading = !hasAnyCached;
    error = null;

    const catsAtStart = new Set(selectedCategories);
    const baseKeyAtStart = baseKey;

    const tasks = cats.map(async (c) => {
      const key = `${c}:${baseKeyAtStart}`;
      const hit = nearbyCache[key];
      if (hit && now - hit.ts < 45_000 && hit.places.length) return hit.places;

      const ps = await fetchNearbyOnce({ cacheKey: key, latB, lngB, radius: fixedRadius, category: c });
      nearbyCache = { ...nearbyCache, [key]: { ts: Date.now(), places: ps } };
      return ps;
    });

    Promise.allSettled(tasks)
      .then((results) => {
        const curLat = userLat;
        const curLng = userLng;
        if (curLat == null || curLng == null) return;
        const { latB: clatB, lngB: clngB } = bucketLatLng(curLat, curLng);
        const curBaseKey = makeBaseKey({ latB: clatB, lngB: clngB, radius: fixedRadius });
        if (curBaseKey !== baseKeyAtStart) return;
        if (selectedCategories.size !== catsAtStart.size) return;
        for (const c of catsAtStart) if (!selectedCategories.has(c)) return;

        const ps = results
          .filter((r): r is PromiseFulfilledResult<Place[]> => r.status === 'fulfilled')
          .flatMap((r) => r.value);
        places = ps.sort((a, b) => a.distanceMeters - b.distanceMeters);
        selected = null;
        updatePlacesOnMap();

        const rejected = results.find((r) => r.status === 'rejected');
        if (rejected && ps.length === 0) {
          const reason = (rejected as PromiseRejectedResult).reason;
          error = reason instanceof Error ? reason.message : 'Unknown error';
        }
      })
      .finally(() => {
        const curLat = userLat;
        const curLng = userLng;
        if (curLat == null || curLng == null) return;
        const { latB: clatB, lngB: clngB } = bucketLatLng(curLat, curLng);
        const curBaseKey = makeBaseKey({ latB: clatB, lngB: clngB, radius: fixedRadius });
        if (curBaseKey !== baseKeyAtStart) return;
        loading = false;
      });
  }

  async function selectPlace(p: Place) {
    selected = p;
    if (!map) return;

    void loadRatingSummary(p.id);

    if (selectedPopup) {
      try {
        selectedPopup.remove();
      } catch {
        // ignore
      }
      selectedPopup = null;
      selectedPopupEl = null;
    }

    const el = document.createElement('div');
    el.className = 'placePopup';
    selectedPopupEl = el;

    const s = ratingSummary[p.id];
    const avg = s?.avg ?? 0;
    const count = s?.count ?? 0;
    const full = Math.round(avg);
    const stars = [1, 2, 3, 4, 5].map((n) => (n <= full ? '★' : '☆')).join('');

    const desc = (p.description ?? p.wikipedia ?? p.website) || '';
    el.innerHTML = `
      <div class="ppTitle">${escapeHtml(p.name)}</div>
      <div class="ppMeta">${escapeHtml(p.address ?? '')}${p.distanceMeters > 0 ? ` · ${p.distanceMeters} м` : ''}</div>
      ${desc ? `<div class="ppDesc">${escapeHtml(desc)}</div>` : ''}
      <button class="ppRating" data-act="rating" aria-label="Отзывы" title="Отзывы">
        <span class="ppStars">${stars}</span>
        <span class="ppCount">${count}</span>
      </button>
      <div class="ppActions">
        <button class="ppIcon" data-act="route" aria-label="Маршрут" title="Маршрут">
          <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
            <path
              fill="currentColor"
              d="M7 2a3 3 0 1 0 0 6a3 3 0 0 0 0-6Zm0 4a1 1 0 1 1 0-2a1 1 0 0 1 0 2Zm10 10a3 3 0 1 0 0 6a3 3 0 0 0 0-6Zm0 4a1 1 0 1 1 0-2a1 1 0 0 1 0 2ZM9 6h5a3 3 0 0 1 3 3v6h-2V9a1 1 0 0 0-1-1H9V6Zm0 12h5v2H9a3 3 0 0 1-3-3V9h2v8a1 1 0 0 0 1 1Z"
            />
          </svg>
        </button>
        <button class="ppIcon ${isSelectedFavorite() ? 'active' : ''}" data-act="fav" aria-label="Избранное" title="Избранное">
          <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
            <path
              fill="currentColor"
              d="M6 3.75C6 3.33579 6.33579 3 6.75 3h10.5C17.6642 3 18 3.33579 18 3.75V21l-6-3-6 3V3.75z"
            />
          </svg>
        </button>
        <button class="ppIcon ${isSelectedVisited() ? 'active' : ''}" data-act="visit" aria-label="Посещение" title="Посещение">
          <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
            <path
              fill="currentColor"
              d="M9.0 16.2 4.8 12l-1.4 1.4L9 19 21 7l-1.4-1.4z"
            />
          </svg>
        </button>
      </div>
    `;

    const onClick = async (ev: MouseEvent) => {
      const t = ev.target as HTMLElement | null;
      const btn = t?.closest('button[data-act]') as HTMLButtonElement | null;
      if (!btn) return;
      const act = btn.dataset.act;
      if (act === 'rating') {
        drawer = 'reviews';
        if (selected) void loadReviews(selected.id);
      } else if (act === 'route') {
        await buildRouteToSelected();
      } else if (act === 'fav') {
        await toggleFavorite();
      } else if (act === 'visit') {
        await addVisit();
      }

      const fav = el.querySelector('button[data-act="fav"]');
      if (fav) fav.classList.toggle('active', isSelectedFavorite());
      const vis = el.querySelector('button[data-act="visit"]');
      if (vis) vis.classList.toggle('active', isSelectedVisited());
    };
    el.addEventListener('click', onClick);

    selectedPopup = new maplibregl.Popup({ closeOnClick: true, closeButton: false, offset: 12 })
      .setLngLat([p.coordinates.lng, p.coordinates.lat])
      .setDOMContent(el)
      .addTo(map);

    const src = map.getSource('route') as maplibregl.GeoJSONSource | undefined;
    if (src) {
      src.setData({
        type: 'Feature',
        geometry: { type: 'LineString', coordinates: [] },
        properties: {}
      } as any);
    }
  }

  async function buildRouteToSelected() {
    if (!selected) return;
    if (!map) return;
    if (userLat == null || userLng == null) return;

    try {
      const url = new URL(`${apiBase}/routes`);
      url.searchParams.set('fromLat', String(userLat));
      url.searchParams.set('fromLng', String(userLng));
      url.searchParams.set('toLat', String(selected.coordinates.lat));
      url.searchParams.set('toLng', String(selected.coordinates.lng));
      url.searchParams.set('mode', 'walking');

      const ac = new AbortController();
      const t = window.setTimeout(() => ac.abort(), 15_000);
      const r = await fetch(url, { signal: ac.signal });
      window.clearTimeout(t);
      const json = await r.json();
      if (!r.ok || !json.ok) return;

      const src = map.getSource('route') as maplibregl.GeoJSONSource | undefined;
      if (!src) return;

      src.setData({
        type: 'Feature',
        geometry: json.route.geometry,
        properties: {}
      } as any);
    } catch {
      // ignore route errors for now
    }
  }

  function escapeHtml(s: string) {
    return s
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;')
      .replaceAll("'", '&#039;');
  }

  onMount(async () => {
    ensureMap();

    await authInit(apiBase);

    try {
      const loc = await getUserLocation();
      userLat = loc.lat;
      userLng = loc.lng;
      accuracyMeters = loc.accuracy;

      if (map) {
        map.setCenter([userLng, userLat]);
        map.setZoom(14);
      }

      setUserMarker(userLat, userLng);
      startWatchLocation();
      if (selectedCategories.size) void loadNearby();
    } catch (e) {
      error = e instanceof Error ? e.message : 'Geolocation error';
    }
  });

  onDestroy(() => {
    unsub();
    userMarker?.remove();
    map?.remove();
  });

  async function loadReviews(placeId: string) {
    // Ensure cached in backend DB for reviews/favorites.
    try {
      if (selected && selected.id === placeId) {
        const u = new URL(`${apiBase}/places/${encodeURIComponent(placeId)}`);
        u.searchParams.set('name', selected.name);
        u.searchParams.set('lat', String(selected.coordinates.lat));
        u.searchParams.set('lng', String(selected.coordinates.lng));
        if (selected.address) u.searchParams.set('address', selected.address);
        u.searchParams.set('category', selected.category);
        await fetch(u);
      } else {
        await fetch(`${apiBase}/places/${encodeURIComponent(placeId)}`);
      }
    } catch {
      // ignore
    }

    reviewsLoading = true;
    reviewsError = null;
    try {
      const r = await fetch(`${apiBase}/reviews/place/${encodeURIComponent(placeId)}`);
      const json = await r.json();
      if (!r.ok || !json.ok) throw new Error(json.error ?? 'Failed to load reviews');
      reviews = json.reviews as Review[];
    } catch (e) {
      reviewsError = e instanceof Error ? e.message : 'Unknown error';
      reviews = [];
    } finally {
      reviewsLoading = false;
    }
  }

  async function submitReview() {
    if (!selected) return;
    if (!me) {
      return;
    }

    reviewsLoading = true;
    reviewsError = null;
    try {
      {
        const u = new URL(`${apiBase}/places/${encodeURIComponent(selected.id)}`);
        u.searchParams.set('name', selected.name);
        u.searchParams.set('lat', String(selected.coordinates.lat));
        u.searchParams.set('lng', String(selected.coordinates.lng));
        if (selected.address) u.searchParams.set('address', selected.address);
        u.searchParams.set('category', selected.category);
        await fetch(u);
      }

      const r = await apiFetch(apiBase, '/reviews', {
        method: 'POST',
        body: JSON.stringify({ placeId: selected.id, rating: reviewRating, text: reviewText })
      });
      const json = await r.json();
      if (!r.ok || !json.ok) throw new Error(json.error ?? 'Failed to create review');

      reviewText = '';
      reviewRating = 5;
      reviewFormOpen = false;
      await loadReviews(selected.id);
    } catch (e) {
      reviewsError = e instanceof Error ? e.message : 'Unknown error';
    } finally {
      reviewsLoading = false;
    }
  }

  async function deleteReview(id: string) {
    if (!me) return;
    reviewsLoading = true;
    reviewsError = null;
    try {
      const r = await apiFetch(apiBase, `/reviews/${encodeURIComponent(id)}`, { method: 'DELETE' });
      const json = await r.json();
      if (!r.ok || !json.ok) throw new Error(json.error ?? 'Failed to delete review');
      if (selected) await loadReviews(selected.id);
    } catch (e) {
      reviewsError = e instanceof Error ? e.message : 'Unknown error';
    } finally {
      reviewsLoading = false;
    }
  }

  $effect(() => {
    if (map) updatePlacesOnMap();
  });

  $effect(() => {
    if (me) {
      // keep user panels in sync when auth changes
      void loadFavorites();
      void loadVisits();
    }
  });
</script>

<svelte:head>
  <link href="https://unpkg.com/maplibre-gl@5.7.3/dist/maplibre-gl.css" rel="stylesheet" />
  <link rel="preconnect" href="https://fonts.googleapis.com" />
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin="anonymous" />
  <link
    href="https://fonts.googleapis.com/css2?family=IBM+Plex+Sans:wght@400;500;600&family=Fraunces:opsz,wght@9..144,600&display=swap"
    rel="stylesheet"
  />
</svelte:head>

<div class="app">
  <div class="map" bind:this={mapEl}></div>

  {#if error}
    <div class="toast" role="alert">{error}</div>
  {/if}

  <div class="top">
    <div class="brand">
      <div class="logo">GeoGuide</div>
      <button class="pillToggle" type="button" aria-label="Фильтры" title="Фильтры" onclick={() => (topOpen = !topOpen)}>
        <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
          <path fill="currentColor" d="M3 5h18v2H3V5Zm4 6h10v2H7v-2Zm3 6h4v2h-4v-2Z" />
        </svg>
      </button>
    </div>

    <div class="pill" class:closed={!topOpen}>
      <div class="pillRow">
        <div class="segmented" aria-label="Категория">
          {#each categories as c}
            <button
              class:active={selectedCategories.has(c.id)}
              type="button"
              aria-label={c.label}
              title={c.label}
              onclick={() => {
                const next = new Set(selectedCategories);
                if (next.has(c.id)) next.delete(c.id);
                else next.add(c.id);
                selectedCategories = next;
                void loadNearby();
              }}
            >
              {@html categoryIcon(c.id)}
            </button>
          {/each}
        </div>

        <div class="controls">
          <div class="dot" class:show={loading} aria-hidden="true"></div>
          <button class="ghost icon" type="button" onclick={() => openDrawer('places')} aria-label="Места" title="Места">
            <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
              <path fill="currentColor" d="M4 6.5a1.5 1.5 0 1 1 3 0a1.5 1.5 0 0 1-3 0Zm4 0h12v2H8v-2Zm-4 5a1.5 1.5 0 1 1 3 0a1.5 1.5 0 0 1-3 0Zm4 0h12v2H8v-2Zm-4 5a1.5 1.5 0 1 1 3 0a1.5 1.5 0 0 1-3 0Zm4 0h12v2H8v-2Z" />
            </svg>
          </button>
          <button
            class="ghost icon"
            type="button"
            onclick={() => openDrawer('favorites')}
            disabled={!me}
            aria-label="Избранное"
            title="Избранное"
          >
            <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
              <path
                fill="currentColor"
                d="M6 3.75C6 3.33579 6.33579 3 6.75 3h10.5C17.6642 3 18 3.33579 18 3.75V21l-6-3-6 3V3.75z"
              />
            </svg>
          </button>
          <button
            class="ghost icon"
            type="button"
            onclick={() => openDrawer('history')}
            disabled={!me}
            aria-label="История"
            title="История"
          >
            <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
              <path fill="currentColor" d="M12 2a10 10 0 1 0 0 20a10 10 0 0 0 0-20Zm0 2a8 8 0 1 1 0 16a8 8 0 0 1 0-16Zm-1 3a1 1 0 0 1 2 0v5.2l3 1.7a1 1 0 1 1-1.1 1.6l-3.4-2.3A1 1 0 0 1 11 13V7Z" />
            </svg>
          </button>

          <div class="authActions">
            {#if me}
              <div class="userBadge">{me.username}</div>
              <button class="ghost logout" type="button" onclick={logout}>Выйти</button>
            {:else}
              <a class="ghost link" href="/login">Вход</a>
            {/if}
          </div>
        </div>
      </div>
    </div>
  </div>
</div>

{#if drawer !== 'none'}
  <button class="scrim" type="button" aria-label="Закрыть" onclick={() => (drawer = 'none')}></button>
  <section class="drawer" aria-label="Список">
    <div class="drawerHead">
      <div class="drawerTitle">
        {drawer === 'places'
          ? 'Места рядом'
          : drawer === 'favorites'
            ? 'Избранное'
            : drawer === 'history'
              ? 'История'
              : drawer === 'reviews'
                ? 'Отзывы'
                : selected
                  ? selected.name
                  : 'Место'}
      </div>
      <button class="ghost" type="button" onclick={() => (drawer = 'none')}>Закрыть</button>
    </div>

    {#if drawer === 'places'}
      <div class="drawerBody">
        {#if places.length === 0}
          <div class="muted">Пока пусто.</div>
        {:else}
          <div class="list">
            {#each places as p (p.id)}
              <button
                class:selected={selected?.id === p.id}
                type="button"
                onclick={() => {
                  selectPlace(p);
                  drawer = 'none';
                }}
              >
                <div class="name">{p.name}</div>
                <div class="meta">{p.distanceMeters} м</div>
                {#if p.address}
                  <div class="addr">{p.address}</div>
                {/if}
              </button>
            {/each}
          </div>
        {/if}
      </div>
    {:else if drawer === 'favorites'}
      <div class="drawerBody">
        {#if favoritesError}
          <div class="toast" role="alert">{favoritesError}</div>
        {/if}
        {#if favoritesLoading}
          <div class="muted">Загрузка…</div>
        {:else if favorites.length === 0}
          <div class="muted">Пока пусто.</div>
        {:else}
          <div class="list">
            {#each favorites as f (f.id)}
              <button
                class:selected={selected?.id === f.place.id}
                type="button"
                onclick={() => {
                  selectPlace({
                    id: f.place.id,
                    name: f.place.name,
                    category: 'cafe',
                    coordinates: { lat: f.place.lat, lng: f.place.lng },
                    distanceMeters: 0,
                    address: f.place.address
                  });
                  drawer = 'none';
                }}
              >
                <div class="name">{f.place.name}</div>
                {#if f.place.address}
                  <div class="addr">{f.place.address}</div>
                {/if}
              </button>
            {/each}
          </div>
        {/if}
      </div>
    {:else if drawer === 'history'}
      <div class="drawerBody">
        {#if visitsError}
          <div class="toast" role="alert">{visitsError}</div>
        {/if}
        {#if visitsLoading}
          <div class="muted">Загрузка…</div>
        {:else if visits.length === 0}
          <div class="muted">Пока пусто.</div>
        {:else}
          <div class="list">
            {#each visits as v (v.id)}
              <button
                class:selected={selected?.id === v.place.id}
                type="button"
                onclick={() => {
                  selectPlace({
                    id: v.place.id,
                    name: v.place.name,
                    category: 'cafe',
                    coordinates: { lat: v.place.lat, lng: v.place.lng },
                    distanceMeters: 0,
                    address: v.place.address
                  });
                  drawer = 'none';
                }}
              >
                <div class="name">{v.place.name}</div>
                <div class="meta">{new Date(v.visitedAt).toLocaleString()}</div>
              </button>
            {/each}
          </div>
        {/if}
      </div>
    {:else if drawer === 'place'}
      <div class="drawerBody">
        {#if !selected}
          <div class="muted">Выбери место на карте.</div>
        {:else}
          <div class="placePanel">
            <div class="placePanelTop">
              <div>
                <div class="placePanelTitle">{selected.name}</div>
                <div class="placePanelMeta">
                  {#if selected.address}{selected.address}{/if}
                  {#if selected.distanceMeters > 0}
                    <span>· {selected.distanceMeters} м</span>
                  {/if}
                </div>
                {#if selected.description || selected.wikipedia || selected.website}
                  <div class="placePanelDesc">{selected.description ?? selected.wikipedia ?? selected.website}</div>
                {/if}
              </div>
              <div class="placePanelActions" aria-label="Действия">
                <button class="ppIcon" type="button" onclick={buildRouteToSelected} aria-label="Маршрут" title="Маршрут">
                  <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
                    <path
                      fill="currentColor"
                      d="M7 2a3 3 0 1 0 0 6a3 3 0 0 0 0-6Zm0 4a1 1 0 1 1 0-2a1 1 0 0 1 0 2Zm10 10a3 3 0 1 0 0 6a3 3 0 0 0 0-6Zm0 4a1 1 0 1 1 0-2a1 1 0 0 1 0 2ZM9 6h5a3 3 0 0 1 3 3v6h-2V9a1 1 0 0 0-1-1H9V6Zm0 12h5v2H9a3 3 0 0 1-3-3V9h2v8a1 1 0 0 0 1 1Z"
                    />
                  </svg>
                </button>
                <button
                  class="ppIcon"
                  class:active={isSelectedFavorite()}
                  type="button"
                  onclick={toggleFavorite}
                  aria-label="Избранное"
                  title="Избранное"
                  disabled={!me || favoritesLoading}
                >
                  <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
                    <path
                      fill="currentColor"
                      d="M6 3.75C6 3.33579 6.33579 3 6.75 3h10.5C17.6642 3 18 3.33579 18 3.75V21l-6-3-6 3V3.75z"
                    />
                  </svg>
                </button>
                <button
                  class="ppIcon"
                  class:active={isSelectedVisited()}
                  type="button"
                  onclick={addVisit}
                  aria-label="Посещение"
                  title="Посещение"
                  disabled={!me || visitsLoading}
                >
                  <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
                    <path fill="currentColor" d="M9.0 16.2 4.8 12l-1.4 1.4L9 19 21 7l-1.4-1.4z" />
                  </svg>
                </button>
              </div>
            </div>
            {#if favoritesError}
              <div class="toast" role="alert">{favoritesError}</div>
            {/if}
            {#if visitsError}
              <div class="toast" role="alert">{visitsError}</div>
            {/if}
          </div>
        {/if}
      </div>
    {:else if drawer === 'reviews'}
      <div class="drawerBody">
        {#if !selected}
          <div class="muted">Выбери место на карте.</div>
        {:else}
          {#if reviewsError}
            <div class="toast" role="alert">{reviewsError}</div>
          {/if}
          {#if reviewsLoading}
            <div class="muted">Загрузка…</div>
          {:else}
            <div class="reviewActions">
              <button class="ghost" type="button" onclick={() => (reviewFormOpen = !reviewFormOpen)} disabled={!me}>
                {reviewFormOpen ? 'Закрыть форму' : 'Оставить отзыв'}
              </button>
            </div>
            {#if reviews.length === 0}
              <div class="muted">Пока нет отзывов.</div>
            {:else}
              <div class="reviewList">
                {#each reviews as r (r.id)}
                  <div class="review">
                    <div class="reviewTop">
                      <div>
                        <div class="name">{r.user.username}</div>
                        <div class="meta"><span class="rStars">{ratingStars(r.rating)}</span></div>
                      </div>
                      {#if me && (me.role === 'ADMIN' || me.id === r.user.id)}
                        <button class="danger" type="button" onclick={() => deleteReview(r.id)}>Удалить</button>
                      {/if}
                    </div>
                    <div class="addr">{r.text}</div>
                  </div>
                {/each}
              </div>
            {/if}

            {#if reviewFormOpen}
              <div class="reviewForm">
                <div class="row">
                  <div class="field">
                    <span>Оценка</span>
                    <div class="stars" role="radiogroup" aria-label="Оценка">
                      {#each [1, 2, 3, 4, 5] as n (n)}
                        <button
                          type="button"
                          class="star"
                          class:active={reviewRating >= n}
                          onclick={() => (reviewRating = n)}
                          aria-label={`${n} / 5`}
                        >
                          ★
                        </button>
                      {/each}
                    </div>
                  </div>
                </div>
                <label class="field">
                  <span>Текст</span>
                  <textarea rows="3" bind:value={reviewText}></textarea>
                </label>
                <button
                  class="primary"
                  type="button"
                  disabled={reviewsLoading || reviewText.trim().length === 0}
                  onclick={submitReview}
                >
                  Отправить
                </button>
              </div>
            {/if}
          {/if}
        {/if}
      </div>
    {/if}
  </section>
{/if}

  
<style>
  :global(body) {
    margin: 0;
  }

  .app {
    height: 100vh;
    width: 100vw;
    position: relative;
    overflow: hidden;
    background: transparent;
    color: #111827;
    font-family: 'IBM Plex Sans', system-ui, -apple-system, Segoe UI, sans-serif;
  }

  .map {
    position: absolute;
    inset: 0;
  }

  .top {
    position: absolute;
    left: 12px;
    top: 12px;
    z-index: 20;
    display: grid;
    gap: 10px;
    width: min(420px, calc(100vw - 24px));
  }

  .brand {
    display: flex;
    align-items: center;
    justify-content: flex-start;
    gap: 8px;
  }

  .logo {
    font-family: 'Fraunces', serif;
    font-weight: 600;
    letter-spacing: 0.2px;
    font-size: 18px;
    color: rgba(17, 24, 39, 0.92);
  }

  .pillToggle {
    width: 38px;
    height: 38px;
    border-radius: 16px;
    border: 1px solid rgba(17, 24, 39, 0.18);
    background: rgba(255, 255, 255, 0.62);
    backdrop-filter: blur(12px);
    color: rgba(17, 24, 39, 0.78);
    cursor: pointer;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    transition:
      transform 140ms ease,
      background 140ms ease,
      border-color 140ms ease,
      color 140ms ease;
  }

  .pillToggle:hover {
    background: rgba(255, 255, 255, 0.78);
    color: rgba(17, 24, 39, 0.90);
  }

  .pillToggle:active {
    transform: scale(0.97);
  }

  :global(.maplibregl-popup-content) {
    background: transparent;
    padding: 0;
    box-shadow: none;
  }

  :global(.maplibregl-popup-tip) {
    border-top-color: rgba(255, 255, 255, 0.78);
  }

  :global(.placePopup) {
    min-width: 220px;
    max-width: 280px;
    background: linear-gradient(180deg, rgba(255, 255, 255, 0.90) 0%, rgba(255, 255, 255, 0.78) 100%);
    border: 1px solid rgba(17, 24, 39, 0.18);
    border-radius: 16px;
    padding: 10px 10px 8px;
    backdrop-filter: blur(12px);
    box-shadow: 0 18px 44px rgba(0, 0, 0, 0.25);
    color: rgba(17, 24, 39, 0.92);
  }

  :global(.ppTitle) {
    font-weight: 650;
    font-size: 14px;
    line-height: 1.2;
  }

  :global(.ppMeta) {
    margin-top: 4px;
    font-size: 12px;
    color: rgba(17, 24, 39, 0.76);
    line-height: 1.25;
  }

  :global(.ppDesc) {
    margin-top: 6px;
    font-size: 12px;
    color: rgba(17, 24, 39, 0.70);
    line-height: 1.25;
    display: -webkit-box;
    line-clamp: 2;
    -webkit-line-clamp: 2;
    -webkit-box-orient: vertical;
    overflow: hidden;
  }

  :global(.ppRating) {
    width: fit-content;
    margin-top: 8px;
    padding: 6px 10px;
    border-radius: 999px;
    border: 1px solid rgba(17, 24, 39, 0.14);
    background: rgba(255, 255, 255, 0.62);
    color: rgba(17, 24, 39, 0.86);
    cursor: pointer;
    display: inline-flex;
    align-items: center;
    gap: 8px;
    transition:
      transform 140ms ease,
      background 140ms ease,
      border-color 140ms ease,
      color 140ms ease;
  }

  :global(.ppRating:hover) {
    background: rgba(255, 255, 255, 0.80);
  }

  :global(.ppRating:active) {
    transform: scale(0.98);
  }

  :global(.ppStars) {
    letter-spacing: 0.6px;
    font-size: 13px;
    line-height: 1;
    color: rgba(245, 158, 11, 0.95);
  }

  :global(.ppCount) {
    font-size: 12px;
    color: rgba(17, 24, 39, 0.65);
  }

  :global(.ppActions) {
    display: flex;
    gap: 8px;
    margin-top: 10px;
  }

  :global(.ppIcon) {
    width: 36px;
    height: 36px;
    border-radius: 14px;
    border: 1px solid rgba(17, 24, 39, 0.18);
    background: rgba(255, 255, 255, 0.62);
    color: rgba(17, 24, 39, 0.80);
    cursor: pointer;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    transition:
      transform 140ms ease,
      background 140ms ease,
      border-color 140ms ease,
      color 140ms ease;
  }

  :global(.ppIcon:hover) {
    background: rgba(255, 255, 255, 0.80);
    transform: translateY(-1px);
  }

  :global(.ppIcon:active) {
    transform: translateY(0) scale(0.97);
  }

  :global(.ppIcon.active) {
    background: rgba(56, 189, 248, 0.16);
    border-color: rgba(56, 189, 248, 0.45);
    color: rgba(17, 24, 39, 0.92);
  }

  .pill {
    background: linear-gradient(
      180deg,
      rgba(255, 255, 255, 0.82) 0%,
      rgba(255, 255, 255, 0.70) 100%
    );
    border: 1px solid rgba(17, 24, 39, 0.18);
    border-radius: 18px;
    padding: 10px;
    backdrop-filter: blur(12px);
    box-shadow:
      0 10px 28px rgba(0, 0, 0, 0.25),
      0 1px 0 rgba(255, 255, 255, 0.40) inset;
    display: grid;
    gap: 10px;
    transform-origin: top left;
    transition:
      opacity 180ms ease,
      transform 180ms ease,
      max-height 220ms ease,
      padding 180ms ease,
      border-color 180ms ease;
    max-height: 180px;
  }

  .pill.closed {
    opacity: 0;
    transform: translateY(-6px) scale(0.98);
    max-height: 0;
    padding: 0;
    border-color: rgba(17, 24, 39, 0);
    pointer-events: none;
  }

  .pillRow {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 10px;
  }

  .ghost.icon {
    width: 38px;
    height: 38px;
    padding: 0;
  }

  .ghost.icon svg {
    display: block;
  }

  .segmented {
    display: flex;
    gap: 6px;
    flex-wrap: nowrap;
    overflow-x: auto;
    -webkit-overflow-scrolling: touch;
  }

  .segmented::-webkit-scrollbar {
    height: 0;
  }

  .segmented button {
    border-radius: 999px;
    width: 38px;
    height: 38px;
    padding: 0;
    font-size: 13px;
    background: rgba(255, 255, 255, 0.55);
    border: 1px solid rgba(17, 24, 39, 0.18);
    color: rgba(17, 24, 39, 0.92);
    cursor: pointer;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    transition:
      transform 140ms ease,
      background 140ms ease,
      border-color 140ms ease,
      color 140ms ease;
  }

  .segmented button:hover {
    background: rgba(255, 255, 255, 0.78);
    transform: translateY(-1px);
  }

  .segmented button:active {
    transform: translateY(0) scale(0.98);
  }

  .segmented button.active {
    background: rgba(56, 189, 248, 0.18);
    border-color: rgba(56, 189, 248, 0.45);
  }

  .controls {
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .controls button {
    transition:
      transform 140ms ease,
      background 140ms ease,
      border-color 140ms ease,
      color 140ms ease;
  }

  .controls button:hover {
    transform: translateY(-1px);
  }

  .controls button:active {
    transform: translateY(0) scale(0.98);
  }

  .ghost.logout:hover {
    background: rgba(239, 68, 68, 0.10);
    border-color: rgba(239, 68, 68, 0.35);
    color: rgba(185, 28, 28, 0.95);
  }

  .field {
    display: grid;
    grid-template-columns: auto 1fr auto;
    gap: 8px;
    align-items: center;
    padding: 8px 10px;
    border-radius: 14px;
    background: rgba(255, 255, 255, 0.55);
    border: 1px solid rgba(17, 24, 39, 0.18);
  }

  .field span {
    font-size: 12px;
    opacity: 0.8;
  }


  .primary,
  .ghost,
  .danger {
    border-radius: 14px;
    padding: 9px 12px;
    font-size: 13px;
    border: 1px solid rgba(17, 24, 39, 0.18);
    background: rgba(255, 255, 255, 0.62);
    color: rgba(17, 24, 39, 0.92);
    cursor: pointer;
    text-decoration: none;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 8px;
  }

  .primary:hover,
  .ghost:hover,
  .danger:hover {
    background: rgba(255, 255, 255, 0.78);
  }

  .primary:focus-visible,
  .ghost:focus-visible,
  .danger:focus-visible,
  .segmented button:focus-visible,
  .star:focus-visible {
    outline: 2px solid rgba(56, 189, 248, 0.55);
    outline-offset: 2px;
  }

  .primary {
    background: rgba(56, 189, 248, 0.18);
    border-color: rgba(56, 189, 248, 0.45);
  }

  .ghost.link {
    user-select: none;
  }

  .danger {
    background: rgba(239, 68, 68, 0.14);
    border-color: rgba(239, 68, 68, 0.35);
  }

  .danger:hover {
    background: rgba(239, 68, 68, 0.18);
  }

  button:disabled {
    opacity: 0.6;
    cursor: not-allowed;
  }

  .toast {
    position: absolute;
    left: 12px;
    right: 12px;
    top: 118px;
    z-index: 30;
    padding: 10px 12px;
    border-radius: 14px;
    background: rgba(239, 68, 68, 0.12);
    border: 1px solid rgba(239, 68, 68, 0.25);
    backdrop-filter: blur(10px);
    pointer-events: auto;
  }

  .scrim {
    position: absolute;
    inset: 0;
    z-index: 25;
    background: rgba(0, 0, 0, 0.35);
    border: 0;
    cursor: pointer;
  }

  .drawer {
    position: absolute;
    left: 50%;
    transform: translateX(-50%);
    width: min(520px, calc(100vw - 24px));
    bottom: 12px;
    z-index: 26;
    max-height: 55vh;
    overflow: hidden;
    border-radius: 18px;
    background: linear-gradient(
      180deg,
      rgba(255, 255, 255, 0.86) 0%,
      rgba(255, 255, 255, 0.72) 100%
    );
    border: 1px solid rgba(17, 24, 39, 0.18);
    backdrop-filter: blur(12px);
    box-shadow: 0 18px 44px rgba(0, 0, 0, 0.35);
    display: grid;
    grid-template-rows: auto 1fr;
  }

  .rStars {
    letter-spacing: 0.6px;
    color: rgba(245, 158, 11, 0.95);
    font-size: 13px;
    line-height: 1;
  }

  .drawerHead {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 10px;
    padding: 10px;
    border-bottom: 1px solid rgba(17, 24, 39, 0.12);
  }

  .drawerTitle {
    font-weight: 600;
  }

  .drawerBody {
    padding: 10px;
    overflow: auto;
    overflow-x: hidden;
  }

  .placePanelDesc {
    margin-top: 6px;
    font-size: 12px;
    color: rgba(17, 24, 39, 0.72);
    line-height: 1.25;
    display: -webkit-box;
    line-clamp: 2;
    -webkit-line-clamp: 2;
    -webkit-box-orient: vertical;
    overflow: hidden;
  }

  .list {
    display: grid;
    gap: 8px;
  }

  .list button {
    text-align: left;
    border-radius: 14px;
    padding: 10px 12px;
    background: rgba(255, 255, 255, 0.60);
    border: 1px solid rgba(17, 24, 39, 0.14);
    color: rgba(17, 24, 39, 0.92);
    cursor: pointer;
  }

  .list button:hover {
    background: rgba(255, 255, 255, 0.78);
  }

  .list button.selected {
    background: rgba(56, 189, 248, 0.12);
    border-color: rgba(56, 189, 248, 0.28);
  }

  .name {
    width: min(420px, calc(100vw - 24px));
  }

  .addr {
    opacity: 0.92;
    font-size: 12px;
    line-height: 1.35;
    color: rgba(17, 24, 39, 0.88);
  }

  .muted {
    opacity: 0.85;
    font-size: 13px;
    color: rgba(17, 24, 39, 0.70);
  }


  .reviewList {
    display: grid;
    gap: 8px;
  }

  .review {
    padding: 10px;
    border-radius: 14px;
    background: rgba(255, 255, 255, 0.60);
    border: 1px solid rgba(17, 24, 39, 0.14);
    display: grid;
    gap: 6px;
    max-width: 100%;
    overflow: hidden;
  }

  .reviewTop {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto;
    gap: 10px;
    align-items: start;
    max-width: 100%;
  }

  .reviewTop > div {
    min-width: 0;
  }

  .reviewTop > button {
    justify-self: end;
  }

  .reviewTop .name,
  .reviewTop .meta,
  .review .addr {
    max-width: 100%;
    overflow-wrap: anywhere;
    word-break: break-word;
  }

  .reviewActions {
    display: flex;
    justify-content: flex-start;
    margin-bottom: 6px;
  }

  .stars {
    display: inline-flex;
    gap: 6px;
    padding-top: 6px;
  }

  .star {
    width: 34px;
    height: 34px;
    border-radius: 12px;
    border: 1px solid rgba(17, 24, 39, 0.14);
    background: rgba(255, 255, 255, 0.62);
    color: rgba(17, 24, 39, 0.55);
    cursor: pointer;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    font-size: 16px;
    line-height: 1;
    transition:
      transform 140ms ease,
      background 140ms ease,
      border-color 140ms ease,
      color 140ms ease;
  }

  .star:active {
    transform: scale(0.96);
  }

  .star.active {
    background: rgba(245, 158, 11, 0.16);
    border-color: rgba(245, 158, 11, 0.30);
    color: rgba(17, 24, 39, 0.92);
  }

  textarea {
    background: rgba(255, 255, 255, 0.70);
    border: 1px solid rgba(17, 24, 39, 0.18);
    border-radius: 14px;
    color: rgba(17, 24, 39, 0.92);
    padding: 10px 12px;
  }

  textarea {
    min-height: 80px;
    resize: vertical;
  }

  .reviewForm {
    display: grid;
    gap: 8px;
  }

  .userBadge {
    font-size: 13px;
    font-weight: 600;
    padding: 7px 10px;
    border-radius: 12px;
    z-index: 30;
    padding: 10px 12px;
    border-radius: 14px;
    background: rgba(239, 68, 68, 0.12);
    border: 1px solid rgba(239, 68, 68, 0.25);
  }

  @media (max-width: 720px) {
    .userBadge {
      display: none;
    }
  }
</style>
