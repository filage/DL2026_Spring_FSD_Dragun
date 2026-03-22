<script lang="ts">
  import { onDestroy, onMount } from 'svelte';
  import mapboxgl from 'mapbox-gl';
  import { PUBLIC_API_BASE_URL, PUBLIC_MAPBOX_ACCESS_TOKEN } from '$env/static/public';
  import { DEFAULT_API_BASE_URL } from '$lib/config';

  type Category = 'cafe' | 'museum' | 'park' | 'attraction';

  type Place = {
    id: string;
    name: string;
    category: Category;
    coordinates: { lat: number; lng: number };
    distanceMeters: number;
    address: string | null;
  };

  const categories: { id: Category; label: string }[] = [
    { id: 'cafe', label: 'Кафе' },
    { id: 'museum', label: 'Музеи' },
    { id: 'park', label: 'Парки' },
    { id: 'attraction', label: 'Достопримечательности' }
  ];

  let mapEl: HTMLDivElement | null = null;
  let map: mapboxgl.Map | null = null;
  let userMarker: mapboxgl.Marker | null = null;

  let category: Category = 'cafe';
  let radius = 2000;

  let userLat: number | null = null;
  let userLng: number | null = null;

  let loading = false;
  let error: string | null = null;
  let places: Place[] = [];
  let selected: Place | null = null;

  const apiBase = PUBLIC_API_BASE_URL || DEFAULT_API_BASE_URL;
  const token = PUBLIC_MAPBOX_ACCESS_TOKEN;

  async function getUserLocation(): Promise<{ lat: number; lng: number }> {
    return await new Promise((resolve, reject) => {
      navigator.geolocation.getCurrentPosition(
        (pos) => resolve({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
        (e) => reject(new Error(e.message)),
        { enableHighAccuracy: true, timeout: 10_000 }
      );
    });
  }

  function ensureMap() {
    if (!mapEl) return;
    if (map) return;

    if (!token) {
      error = 'Не задан PUBLIC_MAPBOX_ACCESS_TOKEN. Создаи токен в Mapbox и добавь его в frontend/.env (см. frontend/.env.example).';
      return;
    }

    mapboxgl.accessToken = token;
    map = new mapboxgl.Map({
      container: mapEl,
      style: 'mapbox://styles/mapbox/streets-v12',
      center: [37.6173, 55.7558],
      zoom: 12
    });

    map.addControl(new mapboxgl.NavigationControl(), 'top-right');

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
          'circle-color': '#111827',
          'circle-radius': 7,
          'circle-stroke-width': 2,
          'circle-stroke-color': '#ffffff'
        }
      });

      map.on('click', 'clusters', (e) => {
        if (!map) return;
        const features = map.queryRenderedFeatures(e.point, { layers: ['clusters'] });
        const clusterId = features[0]?.properties?.cluster_id;
        const source = map.getSource('places') as mapboxgl.GeoJSONSource;

        if (clusterId == null) return;
        source.getClusterExpansionZoom(clusterId, (err, zoom) => {
          if (err || !map) return;
          const c = (features[0].geometry as any).coordinates as [number, number];
          map.easeTo({ center: c, zoom });
        });
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
    const src = map.getSource('places') as mapboxgl.GeoJSONSource | undefined;
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
    userMarker = new mapboxgl.Marker({ color: '#2563eb' }).setLngLat([lng, lat]).addTo(map);
  }

  async function loadNearby() {
    if (userLat == null || userLng == null) return;
    loading = true;
    error = null;

    try {
      const url = new URL(`${apiBase}/places/nearby`);
      url.searchParams.set('lat', String(userLat));
      url.searchParams.set('lng', String(userLng));
      url.searchParams.set('radius', String(radius));
      url.searchParams.set('category', category);
      url.searchParams.set('limit', '50');

      const r = await fetch(url);
      const json = await r.json();
      if (!r.ok || !json.ok) throw new Error(json.error ?? 'Failed to load nearby places');

      places = json.places as Place[];
      selected = null;
      updatePlacesOnMap();
    } catch (e) {
      error = e instanceof Error ? e.message : 'Unknown error';
    } finally {
      loading = false;
    }
  }

  async function selectPlace(p: Place) {
    selected = p;
    if (!map) return;

    new mapboxgl.Popup({ closeOnClick: true })
      .setLngLat([p.coordinates.lng, p.coordinates.lat])
      .setHTML(
        `<div style="font-weight:600;margin-bottom:4px">${escapeHtml(p.name)}</div><div style="opacity:.8">${escapeHtml(p.address ?? '')}</div><div style="opacity:.8">${p.distanceMeters} м</div>`
      )
      .addTo(map);

    if (userLat == null || userLng == null) return;

    try {
      const url = new URL(`${apiBase}/routes`);
      url.searchParams.set('fromLat', String(userLat));
      url.searchParams.set('fromLng', String(userLng));
      url.searchParams.set('toLat', String(p.coordinates.lat));
      url.searchParams.set('toLng', String(p.coordinates.lng));
      url.searchParams.set('mode', 'walking');

      const r = await fetch(url);
      const json = await r.json();
      if (!r.ok || !json.ok) return;

      const src = map.getSource('route') as mapboxgl.GeoJSONSource | undefined;
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

  function speakSelected() {
    if (!selected) return;
    const text = `${selected.name}. ${selected.address ?? ''}. Расстояние ${selected.distanceMeters} метров.`;

    const synth = window.speechSynthesis;
    synth.cancel();
    synth.speak(new SpeechSynthesisUtterance(text));
  }

  onMount(async () => {
    ensureMap();

    try {
      const loc = await getUserLocation();
      userLat = loc.lat;
      userLng = loc.lng;

      if (map) {
        map.setCenter([userLng, userLat]);
        map.setZoom(14);
      }

      setUserMarker(userLat, userLng);
      await loadNearby();
    } catch (e) {
      error = e instanceof Error ? e.message : 'Geolocation error';
    }
  });

  onDestroy(() => {
    userMarker?.remove();
    map?.remove();
  });

  $: if (map) updatePlacesOnMap();
  $: if (userLat != null && userLng != null) {
    // keep marker synced
    if (map) setUserMarker(userLat, userLng);
  }
</script>

<svelte:head>
  <link href="https://api.mapbox.com/mapbox-gl-js/v3.18.1/mapbox-gl.css" rel="stylesheet" />
</svelte:head>

<div class="page">
  <header class="topbar">
    <div class="title">
      <div class="h1">GeoGuide</div>
      <div class="h2">Ближайшие места рядом с тобои</div>
    </div>

    <div class="controls">
      <div class="row">
        {#each categories as c}
          <button
            class:selected={category === c.id}
            on:click={async () => {
              category = c.id;
              await loadNearby();
            }}
          >
            {c.label}
          </button>
        {/each}
      </div>
      <div class="row">
        <label>
          Радиус (м)
          <input
            type="number"
            min="250"
            max="50000"
            step="250"
            bind:value={radius}
            on:change={loadNearby}
          />
        </label>
        <button on:click={loadNearby} disabled={loading || userLat == null}>Обновить</button>
      </div>
    </div>
  </header>

  {#if error}
    <div class="error">{error}</div>
  {/if}

  <main class="content">
    <div class="map" bind:this={mapEl} />

    <aside class="side">
      <div class="panel">
        <div class="panelTitle">Рядом</div>
        <div class="panelSubtitle">Найдено: {places.length}</div>

        <div class="list">
          {#each places as p (p.id)}
            <button class:selected={selected?.id === p.id} on:click={() => selectPlace(p)}>
              <div class="name">{p.name}</div>
              <div class="meta">{p.distanceMeters} м</div>
              {#if p.address}
                <div class="addr">{p.address}</div>
              {/if}
            </button>
          {/each}
        </div>
      </div>

      <div class="panel">
        <div class="panelTitle">Выбрано</div>
        {#if selected}
          <div class="selected">
            <div class="name">{selected.name}</div>
            <div class="meta">{selected.distanceMeters} м</div>
            {#if selected.address}
              <div class="addr">{selected.address}</div>
            {/if}
            <div class="actions">
              <button on:click={speakSelected}>Гид (аудио)</button>
            </div>
          </div>
        {:else}
          <div class="empty">Нажми на место на карте или в списке.</div>
        {/if}
      </div>
    </aside>
  </main>
</div>

<style>
  .page {
    height: 100vh;
    display: grid;
    grid-template-rows: auto 1fr;
    background: #0b1020;
    color: #e5e7eb;
  }
  .topbar {
    display: grid;
    grid-template-columns: 1fr auto;
    gap: 16px;
    padding: 16px;
    border-bottom: 1px solid rgba(255, 255, 255, 0.08);
  }
  .h1 {
    font-weight: 800;
    letter-spacing: 0.2px;
    font-size: 18px;
  }
  .h2 {
    margin-top: 2px;
    opacity: 0.75;
    font-size: 13px;
  }
  .controls {
    display: grid;
    gap: 10px;
    justify-items: end;
  }
  .row {
    display: flex;
    gap: 8px;
    flex-wrap: wrap;
    justify-content: flex-end;
  }
  button {
    background: rgba(255, 255, 255, 0.08);
    border: 1px solid rgba(255, 255, 255, 0.12);
    color: #e5e7eb;
    padding: 8px 10px;
    border-radius: 10px;
    cursor: pointer;
    font-size: 13px;
  }
  button.selected {
    background: rgba(79, 70, 229, 0.35);
    border-color: rgba(79, 70, 229, 0.8);
  }
  button:disabled {
    opacity: 0.6;
    cursor: not-allowed;
  }
  label {
    display: grid;
    gap: 6px;
    font-size: 12px;
    opacity: 0.9;
  }
  input {
    background: rgba(255, 255, 255, 0.06);
    border: 1px solid rgba(255, 255, 255, 0.12);
    color: #e5e7eb;
    padding: 8px 10px;
    border-radius: 10px;
    width: 120px;
  }
  .error {
    padding: 10px 16px;
    background: rgba(239, 68, 68, 0.18);
    border-bottom: 1px solid rgba(239, 68, 68, 0.25);
  }
  .content {
    display: grid;
    grid-template-columns: 1fr 360px;
    min-height: 0;
  }
  .map {
    min-height: 0;
  }
  .side {
    border-left: 1px solid rgba(255, 255, 255, 0.08);
    padding: 12px;
    display: grid;
    gap: 12px;
    overflow: auto;
  }
  .panel {
    background: rgba(255, 255, 255, 0.04);
    border: 1px solid rgba(255, 255, 255, 0.08);
    border-radius: 14px;
    padding: 12px;
    display: grid;
    gap: 10px;
  }
  .panelTitle {
    font-weight: 700;
  }
  .panelSubtitle {
    opacity: 0.75;
    font-size: 12px;
    margin-top: -6px;
  }
  .list {
    display: grid;
    gap: 8px;
  }
  .list > button {
    text-align: left;
    display: grid;
    gap: 2px;
  }
  .name {
    font-weight: 650;
  }
  .meta {
    opacity: 0.8;
    font-size: 12px;
  }
  .addr {
    opacity: 0.7;
    font-size: 12px;
  }
  .empty {
    opacity: 0.75;
    font-size: 13px;
  }
  .selected {
    display: grid;
    gap: 6px;
  }
  .actions {
    display: flex;
    gap: 8px;
    margin-top: 6px;
  }
</style>
