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
  };

  const categories: { id: Category; label: string }[] = [
    { id: 'cafe', label: 'Кафе' },
    { id: 'museum', label: 'Музеи' },
    { id: 'park', label: 'Парки' },
    { id: 'attraction', label: 'Достопримечательности' }
  ];

  let mapEl: HTMLDivElement | null = $state(null);
  let map: maplibregl.Map | null = $state(null);
  let userMarker: maplibregl.Marker | null = $state(null);

  let category: Category = $state('cafe');
  let radius = $state(2000);

  let drawer: 'none' | 'places' | 'favorites' | 'history' = $state('none');

  let userLat: number | null = $state(null);
  let userLng: number | null = $state(null);

  let loading = $state(false);
  let error: string | null = $state(null);
  let places: Place[] = $state([]);
  let selected: Place | null = $state(null);

  function openDrawer(kind: typeof drawer) {
    drawer = drawer === kind ? 'none' : kind;
  }

  type Review = {
    id: string;
    rating: number;
    text: string;
    createdAt: string;
    user: { id: string; email: string; role: 'USER' | 'ADMIN' };
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

    map = new maplibregl.Map({
      container: mapEl,
      style: {
        version: 8,
        sources: {
          osm: {
            type: 'raster',
            tiles: ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'],
            tileSize: 256,
            attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
          }
        },
        layers: [
          {
            id: 'osm',
            type: 'raster',
            source: 'osm'
          }
        ]
      } as any,
      center: [37.6173, 55.7558],
      zoom: 12
    });

    map.addControl(new maplibregl.NavigationControl(), 'top-right');

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

    new maplibregl.Popup({ closeOnClick: true })
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

  $effect(() => {
    if (map) updatePlacesOnMap();
  });

  $effect(() => {
    if (userLat != null && userLng != null && map) {
      // keep marker synced
      setUserMarker(userLat, userLng);
    }
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
      <div class="sub">Гид по местам рядом с тобои</div>
    </div>

    <div class="pill">
      <div class="segmented" aria-label="Категория">
        {#each categories as c}
          <button
            class:active={category === c.id}
            type="button"
            onclick={async () => {
              category = c.id;
              await loadNearby();
            }}
          >
            {c.label}
          </button>
        {/each}
      </div>

      <div class="controls">
        <label class="field">
          <span>Радиус</span>
          <input
            type="range"
            min="250"
            max="5000"
            step="250"
            bind:value={radius}
            onchange={loadNearby}
          />
          <b>{radius} м</b>
        </label>

        <button class="primary" type="button" onclick={loadNearby} disabled={loading || userLat == null}>
          {loading ? 'Ищем…' : 'Обновить'}
        </button>

        <button class="ghost" type="button" onclick={() => openDrawer('places')}>Места</button>
        <button class="ghost" type="button" onclick={() => openDrawer('favorites')} disabled={!me}>
          Избранное
        </button>
        <button class="ghost" type="button" onclick={() => openDrawer('history')} disabled={!me}>
          История
        </button>

        <div class="account">
          {#if me}
            <button class="ghost" type="button" onclick={logout}>Выйти</button>
          {:else}
            <a class="ghost link" href="/login">Вход</a>
            <a class="ghost link" href="/register">Регистрация</a>
          {/if}
        </div>
      </div>
    </div>
  </div>

  {#if drawer !== 'none'}
    <button class="scrim" type="button" aria-label="Закрыть" onclick={() => (drawer = 'none')}></button>
    <section class="drawer" aria-label="Список">
      <div class="drawerHead">
        <div class="drawerTitle">
          {drawer === 'places' ? 'Места рядом' : drawer === 'favorites' ? 'Избранное' : 'История'}
        </div>
        <button class="ghost" type="button" onclick={() => (drawer = 'none')}>Закрыть</button>
      </div>

      {#if drawer === 'places'}
        <div class="drawerBody">
          {#if places.length === 0}
            <div class="muted">Пока пусто. Нажми "Обновить".</div>
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
      {:else}
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
      {/if}
    </section>
  {/if}

  {#if selected}
    <section class="sheet" aria-label="Выбрано">
      <div class="sheetTop">
        <div>
          <div class="sheetTitle">{selected.name}</div>
          <div class="sheetMeta">
            {#if selected.address}{selected.address}{/if}
            {#if selected.distanceMeters > 0}
              <span>· {selected.distanceMeters} м</span>
            {/if}
          </div>
        </div>
        <button class="ghost" type="button" onclick={() => (selected = null)}>Закрыть</button>
      </div>

      <div class="sheetActions">
        <button class="primary" type="button" onclick={speakSelected}>Аудио гид</button>
        <button class="ghost" type="button" onclick={toggleFavorite} disabled={!me || favoritesLoading}>
          {isSelectedFavorite() ? 'Убрать из избранного' : 'В избранное'}
        </button>
        <button class="ghost" type="button" onclick={addVisit} disabled={!me || visitsLoading}>
          Отметить посещение
        </button>
      </div>

      <div class="sheetBody">
        <div class="sectionTitle">Отзывы</div>

        {#if reviewsError}
          <div class="toast" role="alert">{reviewsError}</div>
        {/if}

        {#if reviewsLoading}
          <div class="muted">Загрузка…</div>
        {:else}
          {#if reviews.length === 0}
            <div class="muted">Пока нет отзывов.</div>
          {:else}
            <div class="reviewList">
              {#each reviews as r (r.id)}
                <div class="review">
                  <div class="reviewTop">
                    <div>
                      <div class="name">{r.user.email}</div>
                      <div class="meta">Оценка: {r.rating} / 5</div>
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

          <div class="reviewForm">
            {#if me}
              <div class="row">
                <label class="field">
                  <span>Оценка</span>
                  <input type="number" min="1" max="5" step="1" bind:value={reviewRating} />
                </label>
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
            {:else}
              <div class="muted">Войди, чтобы оставить отзыв.</div>
            {/if}
          </div>
        {/if}
      </div>
    </section>
  {/if}
</div>

<style>
  :global(body) {
    margin: 0;
  }

  .app {
    height: 100vh;
    width: 100vw;
    position: relative;
    overflow: hidden;
    background: #070b14;
    color: #e7eaf2;
    font-family: 'IBM Plex Sans', system-ui, -apple-system, Segoe UI, sans-serif;
  }

  .map {
    position: absolute;
    inset: 0;
  }

  .top {
    position: absolute;
    left: 12px;
    right: 12px;
    top: 12px;
    z-index: 20;
    display: grid;
    gap: 10px;
  }

  .brand {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: 10px;
  }

  .logo {
    font-family: 'Fraunces', serif;
    font-weight: 600;
    letter-spacing: 0.2px;
    font-size: 18px;
  }

  .sub {
    opacity: 0.75;
    font-size: 12px;
  }

  .pill {
    background: rgba(12, 16, 30, 0.72);
    border: 1px solid rgba(255, 255, 255, 0.10);
    border-radius: 18px;
    padding: 10px;
    backdrop-filter: blur(12px);
    box-shadow:
      0 18px 45px rgba(0, 0, 0, 0.35),
      0 1px 0 rgba(255, 255, 255, 0.06) inset;
    display: grid;
    gap: 10px;
  }

  .segmented {
    display: flex;
    gap: 6px;
    flex-wrap: wrap;
  }

  .segmented button {
    border-radius: 999px;
    padding: 8px 10px;
    font-size: 13px;
    background: rgba(255, 255, 255, 0.06);
    border: 1px solid rgba(255, 255, 255, 0.10);
    color: #e7eaf2;
    cursor: pointer;
  }

  .segmented button.active {
    background: rgba(56, 189, 248, 0.16);
    border-color: rgba(56, 189, 248, 0.35);
  }

  .controls {
    display: flex;
    gap: 8px;
    flex-wrap: wrap;
    align-items: center;
  }

  .field {
    display: grid;
    grid-template-columns: auto 1fr auto;
    gap: 8px;
    align-items: center;
    padding: 8px 10px;
    border-radius: 14px;
    background: rgba(255, 255, 255, 0.04);
    border: 1px solid rgba(255, 255, 255, 0.08);
  }

  .field span {
    font-size: 12px;
    opacity: 0.8;
  }

  input[type='range'] {
    width: 160px;
  }

  .primary,
  .ghost,
  .danger {
    border-radius: 14px;
    padding: 9px 12px;
    font-size: 13px;
    border: 1px solid rgba(255, 255, 255, 0.10);
    background: rgba(255, 255, 255, 0.06);
    color: #e7eaf2;
    cursor: pointer;
    text-decoration: none;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 8px;
  }

  .primary {
    background: rgba(56, 189, 248, 0.18);
    border-color: rgba(56, 189, 248, 0.35);
  }

  .ghost.link {
    user-select: none;
  }

  .danger {
    background: rgba(239, 68, 68, 0.18);
    border-color: rgba(239, 68, 68, 0.35);
  }

  button:disabled {
    opacity: 0.6;
    cursor: not-allowed;
  }

  .account {
    display: inline-flex;
    gap: 8px;
    margin-left: auto;
  }

  .toast {
    position: absolute;
    left: 12px;
    right: 12px;
    top: 118px;
    z-index: 30;
    padding: 10px 12px;
    border-radius: 14px;
    background: rgba(239, 68, 68, 0.18);
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
    left: 12px;
    right: 12px;
    bottom: 12px;
    z-index: 26;
    max-height: 55vh;
    overflow: hidden;
    border-radius: 18px;
    background: rgba(12, 16, 30, 0.86);
    border: 1px solid rgba(255, 255, 255, 0.10);
    backdrop-filter: blur(12px);
    box-shadow: 0 24px 60px rgba(0, 0, 0, 0.5);
    display: grid;
    grid-template-rows: auto 1fr;
  }

  .drawerHead {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 10px;
    padding: 10px;
    border-bottom: 1px solid rgba(255, 255, 255, 0.08);
  }

  .drawerTitle {
    font-weight: 600;
  }

  .drawerBody {
    padding: 10px;
    overflow: auto;
  }

  .list {
    display: grid;
    gap: 8px;
  }

  .list button {
    text-align: left;
    border-radius: 14px;
    padding: 10px 12px;
    background: rgba(255, 255, 255, 0.05);
    border: 1px solid rgba(255, 255, 255, 0.08);
    color: #e7eaf2;
    cursor: pointer;
  }

  .list button.selected {
    background: rgba(56, 189, 248, 0.12);
    border-color: rgba(56, 189, 248, 0.28);
  }

  .name {
    font-weight: 600;
  }

  .meta {
    opacity: 0.78;
    font-size: 12px;
  }

  .addr {
    opacity: 0.88;
    font-size: 12px;
    line-height: 1.35;
  }

  .muted {
    opacity: 0.75;
    font-size: 13px;
  }

  .sheet {
    position: absolute;
    left: 12px;
    right: 12px;
    bottom: 12px;
    z-index: 24;
    border-radius: 18px;
    background: rgba(12, 16, 30, 0.86);
    border: 1px solid rgba(255, 255, 255, 0.10);
    backdrop-filter: blur(12px);
    box-shadow: 0 24px 60px rgba(0, 0, 0, 0.5);
    padding: 12px;
    display: grid;
    gap: 10px;
    max-height: 52vh;
    overflow: auto;
  }

  .sheetTop {
    display: flex;
    justify-content: space-between;
    align-items: start;
    gap: 10px;
  }

  .sheetTitle {
    font-size: 16px;
    font-weight: 600;
  }

  .sheetMeta {
    opacity: 0.78;
    font-size: 12px;
  }

  .sheetActions {
    display: flex;
    gap: 8px;
    flex-wrap: wrap;
  }

  .sheetBody {
    display: grid;
    gap: 10px;
  }

  .sectionTitle {
    font-weight: 600;
    opacity: 0.9;
  }

  .reviewList {
    display: grid;
    gap: 8px;
  }

  .review {
    padding: 10px;
    border-radius: 14px;
    background: rgba(255, 255, 255, 0.04);
    border: 1px solid rgba(255, 255, 255, 0.08);
    display: grid;
    gap: 6px;
  }

  .reviewTop {
    display: flex;
    justify-content: space-between;
    gap: 10px;
    align-items: start;
  }

  textarea,
  input[type='number'] {
    background: rgba(255, 255, 255, 0.04);
    border: 1px solid rgba(255, 255, 255, 0.10);
    border-radius: 14px;
    color: #e7eaf2;
    padding: 10px 12px;
  }

  textarea {
    resize: vertical;
  }

  .reviewForm {
    display: grid;
    gap: 8px;
  }

  @media (max-width: 720px) {
    input[type='range'] {
      width: 120px;
    }

    .account {
      width: 100%;
      justify-content: flex-start;
    }
  }
</style>
