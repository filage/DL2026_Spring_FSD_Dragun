<script lang="ts">
  import { onDestroy, onMount } from 'svelte';
  import mapboxgl from 'mapbox-gl';
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

  type Review = {
    id: string;
    rating: number;
    text: string;
    createdAt: string;
    user: { id: string; email: string; role: 'USER' | 'ADMIN' };
  };

  let me: AuthUser | null = null;
  const unsub = auth.subscribe((s) => {
    me = s.user;
  });

  let reviewsLoading = false;
  let reviewsError: string | null = null;
  let reviews: Review[] = [];
  let reviewRating = 5;
  let reviewText = '';

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

  let favoritesLoading = false;
  let favoritesError: string | null = null;
  let favorites: FavoriteItem[] = [];

  let visitsLoading = false;
  let visitsError: string | null = null;
  let visits: VisitItem[] = [];

  const apiBase = env.PUBLIC_API_BASE_URL || DEFAULT_API_BASE_URL;
  const token = env.PUBLIC_MAPBOX_ACCESS_TOKEN;

  async function getUserLocation(): Promise<{ lat: number; lng: number }> {
    return await new Promise((resolve, reject) => {
      navigator.geolocation.getCurrentPosition(
        (pos) => resolve({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
        (e) => reject(new Error(e.message)),
        { enableHighAccuracy: true, timeout: 10_000 }
      );
    });
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

  async function toggleFavorite() {
    if (!selected) return;
    if (!me) {
      favoritesError = 'Нужно войти, чтобы использовать избранное.';
      return;
    }

    favoritesLoading = true;
    favoritesError = null;
    try {
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
      visitsError = 'Нужно войти, чтобы отмечать посещения.';
      return;
    }

    visitsLoading = true;
    visitsError = null;
    try {
      const r = await apiFetch(apiBase, '/visits', {
        method: 'POST',
        body: JSON.stringify({ placeId: selected.id })
      });
      const json = await r.json();
      if (!r.ok || !json.ok) throw new Error(json.error ?? 'Failed to add visit');
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
          map.easeTo({ center: c, zoom: zoom ?? map.getZoom() });
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

    await authInit(apiBase);

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
    unsub();
    userMarker?.remove();
    map?.remove();
  });

  async function loadReviews(placeId: string) {
    // Ensure cached in backend DB for reviews/favorites.
    try {
      await fetch(`${apiBase}/places/${encodeURIComponent(placeId)}`);
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
      reviewsError = 'Нужно войти, чтобы оставить отзыв.';
      return;
    }

    reviewsLoading = true;
    reviewsError = null;
    try {
      const r = await apiFetch(apiBase, '/reviews', {
        method: 'POST',
        body: JSON.stringify({ placeId: selected.id, rating: reviewRating, text: reviewText })
      });
      const json = await r.json();
      if (!r.ok || !json.ok) throw new Error(json.error ?? 'Failed to create review');

      reviewText = '';
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

  $: if (map) updatePlacesOnMap();
  $: if (userLat != null && userLng != null) {
    // keep marker synced
    if (map) setUserMarker(userLat, userLng);
  }

  $: if (me) {
    // keep user panels in sync when auth changes
    void loadFavorites();
    void loadVisits();
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
    <div class="map" bind:this={mapEl}></div>

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
        <div class="panelTitle">Аккаунт</div>
        {#if me}
          <div class="selected">
            <div class="name">{me.email}</div>
            <div class="meta">Роль: {me.role}</div>
            <div class="actions">
              <button
                on:click={() => {
                  logout();
                }}
              >
                Выйти
              </button>
            </div>
          </div>
        {:else}
          <div class="empty">Чтобы добавлять отзывы и сохранять места, нужно войти.</div>
          <div class="actions">
            <a class="linkBtn" href="/login">Вход</a>
            <a class="linkBtn" href="/register">Регистрация</a>
          </div>
        {/if}
      </div>

      <div class="panel">
        <div class="panelTitle">Избранное</div>
        {#if favoritesError}
          <div class="error">{favoritesError}</div>
        {/if}
        {#if !me}
          <div class="empty">Войди, чтобы видеть избранное.</div>
        {:else if favoritesLoading}
          <div class="empty">Загрузка…</div>
        {:else}
          {#if favorites.length === 0}
            <div class="empty">Пока пусто.</div>
          {:else}
            <div class="list">
              {#each favorites as f (f.id)}
                <button
                  class:selected={selected?.id === f.place.id}
                  on:click={() =>
                    selectPlace({
                      id: f.place.id,
                      name: f.place.name,
                      category: 'cafe',
                      coordinates: { lat: f.place.lat, lng: f.place.lng },
                      distanceMeters: 0,
                      address: f.place.address
                    })}
                >
                  <div class="name">{f.place.name}</div>
                  {#if f.place.address}
                    <div class="addr">{f.place.address}</div>
                  {/if}
                </button>
              {/each}
            </div>
          {/if}
        {/if}
      </div>

      <div class="panel">
        <div class="panelTitle">История</div>
        {#if visitsError}
          <div class="error">{visitsError}</div>
        {/if}
        {#if !me}
          <div class="empty">Войди, чтобы видеть историю.</div>
        {:else if visitsLoading}
          <div class="empty">Загрузка…</div>
        {:else}
          {#if visits.length === 0}
            <div class="empty">Пока пусто.</div>
          {:else}
            <div class="list">
              {#each visits as v (v.id)}
                <button
                  class:selected={selected?.id === v.place.id}
                  on:click={() =>
                    selectPlace({
                      id: v.place.id,
                      name: v.place.name,
                      category: 'cafe',
                      coordinates: { lat: v.place.lat, lng: v.place.lng },
                      distanceMeters: 0,
                      address: v.place.address
                    })}
                >
                  <div class="name">{v.place.name}</div>
                  <div class="meta">{new Date(v.visitedAt).toLocaleString()}</div>
                </button>
              {/each}
            </div>
          {/if}
        {/if}
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
              <button on:click={toggleFavorite} disabled={!me || favoritesLoading}>
                {isSelectedFavorite() ? 'Убрать из избранного' : 'В избранное'}
              </button>
              <button on:click={addVisit} disabled={!me || visitsLoading}>Отметить посещение</button>
            </div>
          </div>

          <div class="reviews">
            <div class="panelTitle">Отзывы</div>
            {#if reviewsError}
              <div class="error">{reviewsError}</div>
            {/if}

            {#if reviewsLoading}
              <div class="empty">Загрузка…</div>
            {:else}
              {#if reviews.length === 0}
                <div class="empty">Пока нет отзывов.</div>
              {:else}
                <div class="reviewList">
                  {#each reviews as r (r.id)}
                    <div class="review">
                      <div class="reviewTop">
                        <div class="reviewMeta">
                          <div class="name">{r.user.email}</div>
                          <div class="meta">Оценка: {r.rating} / 5</div>
                        </div>
                        {#if me && (me.role === 'ADMIN' || me.id === r.user.id)}
                          <button class="danger" on:click={() => deleteReview(r.id)}>Удалить</button>
                        {/if}
                      </div>
                      <div class="addr">{r.text}</div>
                    </div>
                  {/each}
                </div>
              {/if}

              <div class="reviewForm">
                <div class="meta">Добавить отзыв</div>
                {#if me}
                  <div class="row">
                    <label>
                      Оценка
                      <input type="number" min="1" max="5" step="1" bind:value={reviewRating} />
                    </label>
                  </div>
                  <label>
                    Текст
                    <textarea rows="3" bind:value={reviewText}></textarea>
                  </label>
                  <button disabled={reviewsLoading || reviewText.trim().length === 0} on:click={submitReview}>
                    Отправить
                  </button>
                {:else}
                  <div class="empty">Войди, чтобы оставить отзыв.</div>
                {/if}
              </div>
            {/if}
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

  .linkBtn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    padding: 10px 12px;
    border-radius: 12px;
    text-decoration: none;
    background: rgba(255, 255, 255, 0.08);
    border: 1px solid rgba(255, 255, 255, 0.12);
    color: #e5e7eb;
    font-size: 13px;
  }

  textarea {
    background: rgba(255, 255, 255, 0.06);
    border: 1px solid rgba(255, 255, 255, 0.12);
    color: #e5e7eb;
    padding: 10px 12px;
    border-radius: 12px;
    resize: vertical;
  }

  .reviews {
    margin-top: 10px;
    display: grid;
    gap: 10px;
  }

  .reviewList {
    display: grid;
    gap: 10px;
  }

  .review {
    background: rgba(255, 255, 255, 0.03);
    border: 1px solid rgba(255, 255, 255, 0.06);
    border-radius: 12px;
    padding: 10px;
    display: grid;
    gap: 6px;
  }

  .reviewTop {
    display: flex;
    justify-content: space-between;
    gap: 10px;
    align-items: start;
  }

  .danger {
    background: rgba(239, 68, 68, 0.18);
    border: 1px solid rgba(239, 68, 68, 0.35);
  }

  .reviewForm {
    display: grid;
    gap: 8px;
  }
</style>
