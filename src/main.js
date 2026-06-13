import "./styles.css";
import { createClient } from "@supabase/supabase-js";
import L from "leaflet";
import {
  createIcons,
  MapPin,
  Layers,
  X,
  Star,
  MessageSquare,
  Send,
  ChevronLeft,
  ChevronRight,
  Navigation,
  WifiOff,
  MapPinOff,
} from "lucide";

// 1. INITIALIZE ICONSETS
const iconConfig = {
  icons: {
    MapPin,
    Layers,
    X,
    Star,
    MessageSquare,
    Send,
    ChevronLeft,
    ChevronRight,
    Navigation,
    WifiOff,
    MapPinOff,
  },
};
createIcons(iconConfig);

// 2. SUPABASE INITIALIZATION
const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;
const supabaseClient =
  supabaseUrl && supabaseAnonKey
    ? createClient(supabaseUrl, supabaseAnonKey)
    : null;

// 3. APPLICATION STATE
let map, userLocationMarker, rangeCircle;
let userCoords = { lat: 0, lng: 0 };
let dbRestaurants = [];
let activeMarkersMap = new Map();
let activeRoutingLine = null;
let selectedCoords = null;
let activeRestaurantId = null;
let currentSlide = 0;

const modal = document.getElementById("restaurantModal");
const modalContent = modal.querySelector(".bg-white");
const radiusSlider = document.getElementById("radiusSlider");
const radiusVal = document.getElementById("radiusVal");
const carouselTrack = document.getElementById("carouselTrack");

// Alert Layout Dom Hook references
const offlineAlert = document.getElementById("offlineAlert");
const gpsAlert = document.getElementById("gpsAlert");

const userIcon = L.divIcon({
  html: `<div class="relative flex items-center justify-center"><div class="absolute w-8 h-8 bg-blue-500/30 rounded-full animate-ping"></div><div class="w-4 h-4 bg-blue-600 border-2 border-white rounded-full shadow-lg"></div></div>`,
  className: "",
  iconSize: [32, 32],
  iconAnchor: [16, 16],
});

const restaurantIcon = L.divIcon({
  html: `
    <div class="bg-emerald-500 text-white p-2 rounded-full shadow-lg border-2 border-white flex items-center justify-center transform transition-transform hover:scale-110">
      <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
        <path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z"></path>
        <circle cx="12" cy="10" r="3"></circle>
      </svg>
    </div>
  `,
  className: "",
  iconSize: [36, 36],
  iconAnchor: [18, 36],
});

// =========================================================================
// 4. NETWORK & CONNECTIVITY DIAGNOSTICS LOGIC (NEW)
// =========================================================================
function toggleAlertNotification(element, show) {
  if (show) {
    element.classList.remove("hidden");
    setTimeout(
      () => element.classList.remove("-translate-y-4", "opacity-0"),
      10,
    );
  } else {
    element.classList.add("-translate-y-4", "opacity-0");
    setTimeout(() => element.classList.add("hidden"), 300);
  }
}

window.addEventListener("online", () => {
  toggleAlertNotification(offlineAlert, false);
  fetchRestaurants(); // Automatically re-sync data when connection returns
});

window.addEventListener("offline", () => {
  toggleAlertNotification(offlineAlert, true);
});

// Run an initial telemetry sweep on launch
if (!navigator.onLine) {
  toggleAlertNotification(offlineAlert, true);
}

// =========================================================================
// 5. GEOLOCATION MONITORING ENGINE
// =========================================================================
function initApp() {
  if (!navigator.geolocation) {
    alert("Location scanning unavailable on this configuration setup.");
    // loadMap(51.505, -0.09);
    //loadMap(6.5965, 3.342);
    loadMap(6.6392, 3.3677);
    return;
  }

  navigator.geolocation.watchPosition(
    (position) => {
      // Hide geolocation tracking alerts if live GPS connection is healthy
      toggleAlertNotification(gpsAlert, false);

      userCoords.lat = position.coords.latitude;
      userCoords.lng = position.coords.longitude;

      if (!map) {
        loadMap(userCoords.lat, userCoords.lng);
      } else {
        if (userLocationMarker)
          userLocationMarker.setLatLng([userCoords.lat, userCoords.lng]);
        if (rangeCircle)
          rangeCircle.setLatLng([userCoords.lat, userCoords.lng]);
        renderFilteredMarkers();

        if (activeRoutingLine) {
          const targetLatLng = activeRoutingLine.getLatLngs()[1];
          if (targetLatLng) {
            activeRoutingLine.setLatLngs([
              [userCoords.lat, userCoords.lng],
              targetLatLng,
            ]);
          }
        }
      }
    },
    (error) => {
      // Catch and log location access denials or failures (New)
      toggleAlertNotification(gpsAlert, true);

      if (!map) {
        console.warn(
          "GPS access blocked. Defaulting map to fallback coordinates setup.",
        );
        //  userCoords = { lat: 37.7749, lng: -122.4194 }; // San Francisco fallback
        userCoords = { lat: 6.6392, lng: 3.3677 }; // Isheri fallback ,
        loadMap(userCoords.lat, userCoords.lng);
      }
    },
    { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 },
  );
}

function loadMap(lat, lng) {
  // FIXED: zoomControl disabled here, we inject it below into the bottom-right corner instead
  map = L.map("map", { zoomControl: false }).setView([lat, lng], 15);

  // Reposition zoom handles to bottomright out of range-slider's way
  L.control.zoom({ position: "bottomright" }).addTo(map);

  const mainTileLayer = L.tileLayer(
    "https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png",
    {
      attribution: "&copy; OpenStreetMap &copy; CARTO",
      subdomains: "abcd",
      maxZoom: 20,
    },
  ).addTo(map);

  mainTileLayer.on("tileerror", () => {
    map.removeLayer(mainTileLayer);
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      attribution: "&copy; OpenStreetMap contributors",
    }).addTo(map);
  });

  userLocationMarker = L.marker([lat, lng], { icon: userIcon }).addTo(map);

  rangeCircle = L.circle([lat, lng], {
    radius: parseInt(radiusSlider.value),
    color: "#10b981",
    fillColor: "#10b981",
    fillOpacity: 0.12,
    weight: 1.5,
  }).addTo(map);

  userLocationMarker.on("click", (e) => {
    L.DomEvent.stopPropagation(e);
    handleCoordinateSelection(userCoords.lat, userCoords.lng);
  });

  fetchRestaurants();
}

function computeDistance(lat1, lon1, lat2, lon2) {
  const R = 6371000;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);
  return R * (2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)));
}

async function fetchRestaurants() {
  if (!supabaseClient || !navigator.onLine) {
    dbRestaurants = JSON.parse(localStorage.getItem("mock_restaurants")) || [];
    renderFilteredMarkers();
    return;
  }
  try {
    const { data, error } = await supabaseClient
      .from("restaurants")
      .select("*");
    if (error) throw error;
    dbRestaurants = data || [];
    renderFilteredMarkers();
  } catch (err) {
    console.error("Data tracking pipeline extraction issue:", err.message);
  }
}

function renderFilteredMarkers() {
  const maxRadius = parseInt(radiusSlider.value);
  const currentVisibleIds = new Set();

  dbRestaurants.forEach((item) => {
    if (
      computeDistance(userCoords.lat, userCoords.lng, item.lat, item.lng) <=
      maxRadius
    ) {
      currentVisibleIds.add(item.id);

      if (!activeMarkersMap.has(item.id)) {
        const markerInstance = L.marker([item.lat, item.lng], {
          icon: restaurantIcon,
        }).addTo(map);
        markerInstance.on("click", (e) => {
          L.DomEvent.stopPropagation(e);
          handleCoordinateSelection(item.lat, item.lng, item);
        });
        activeMarkersMap.set(item.id, markerInstance);
      }
    }
  });

  for (const [id, markerInstance] of activeMarkersMap.entries()) {
    if (!currentVisibleIds.has(id)) {
      map.removeLayer(markerInstance);
      activeMarkersMap.delete(id);
    }
  }
}

// 6. MODAL SYSTEM DYNAMICS
function handleCoordinateSelection(lat, lng, existingRecord = null) {
  selectedCoords = { lat, lng };
  document.getElementById("addRestaurantForm").classList.add("hidden");
  document.getElementById("viewRestaurantDetails").classList.add("hidden");

  if (!existingRecord) {
    existingRecord = dbRestaurants.find(
      (r) => Math.abs(r.lat - lat) < 0.0001 && Math.abs(r.lng - lng) < 0.0001,
    );
  }

  if (existingRecord) {
    activeRestaurantId = existingRecord.id;
    document.getElementById("modalTitle").innerText = existingRecord.name;
    document.getElementById("modalSub").innerText =
      existingRecord.address || `${lat.toFixed(4)}, ${lng.toFixed(4)}`;
    document.getElementById("viewReviewText").innerText = existingRecord.review;

    const detailsContainer = document.getElementById("viewRestaurantDetails");
    const staleBtn = document.getElementById("modalNavBtn");
    if (staleBtn) staleBtn.remove();

    const navBtnHtml = `
      <button id="modalNavBtn" class="w-full mb-2 bg-blue-600 hover:bg-blue-700 active:scale-[0.99] text-white font-medium py-2.5 px-4 rounded-xl shadow-md flex items-center justify-center gap-2 transition-all text-sm cursor-pointer">
        <i data-lucide="navigation" class="w-4 h-4 fill-white"></i> Get Directions
      </button>
    `;
    detailsContainer.insertAdjacentHTML("afterbegin", navBtnHtml);
    createIcons(iconConfig);

    document.getElementById("modalNavBtn").addEventListener("click", () => {
      drawNavigationRoute(existingRecord.lat, existingRecord.lng);
    });

    detailsContainer.classList.remove("hidden");
    fetchComments(activeRestaurantId);
  } else {
    activeRestaurantId = null;
    document.getElementById("modalTitle").innerText = "Add New Location";
    document.getElementById("modalSub").innerText =
      `Coordinates: ${lat.toFixed(4)}, ${lng.toFixed(4)}`;
    document.getElementById("addRestaurantForm").reset();
    document.getElementById("addRestaurantForm").classList.remove("hidden");
  }
  openModal();
}

async function fetchComments(restaurantId) {
  const container = document.getElementById("commentsContainer");
  container.innerHTML = `<p class="text-xs text-slate-400 animate-pulse">Gathering community inputs...</p>`;

  if (!supabaseClient || !navigator.onLine) {
    const allComments = JSON.parse(localStorage.getItem("mock_comments")) || [];
    renderCommentsList(
      allComments.filter((c) => c.restaurant_id === restaurantId),
    );
    return;
  }
  try {
    const { data, error } = await supabaseClient
      .from("comments")
      .select("*")
      .eq("restaurant_id", restaurantId)
      .order("created_at", { ascending: true });
    if (error) throw error;
    renderCommentsList(data || []);
  } catch (err) {
    container.innerHTML = `<p class="text-xs text-rose-500">Failed to render comments.</p>`;
  }
}

function renderCommentsList(comments) {
  const container = document.getElementById("commentsContainer");
  if (comments.length === 0) {
    container.innerHTML = `<p class="text-xs text-slate-400 italic py-2">No comments logged yet.</p>`;
    return;
  }
  container.innerHTML = comments
    .map(
      (c) => `
    <div class="bg-slate-50 border border-slate-100 p-2.5 rounded-xl text-xs">
      <p class="text-slate-700">${escapeHTML(c.comment)}</p>
    </div>
  `,
    )
    .join("");
  container.scrollTop = container.scrollHeight;
}

// 7. FORM SUBMISSIONS WITH LOADING STATES
document
  .getElementById("addRestaurantForm")
  .addEventListener("submit", async (e) => {
    e.preventDefault();

    const submitBtn = e.target.querySelector('button[type="submit"]');
    const originalText = submitBtn.innerText;

    submitBtn.disabled = true;
    submitBtn.innerText = "Saving Spot Data...";
    submitBtn.classList.add("opacity-70", "cursor-not-allowed");

    const payload = {
      name: document.getElementById("restName").value,
      address: document.getElementById("restAddress").value,
      review: document.getElementById("restReview").value,
      lat: selectedCoords.lat,
      lng: selectedCoords.lng,
    };

    try {
      if (!supabaseClient || !navigator.onLine) {
        payload.id = crypto.randomUUID();
        dbRestaurants.push(payload);
        localStorage.setItem("mock_restaurants", JSON.stringify(dbRestaurants));
      } else {
        const { error } = await supabaseClient
          .from("restaurants")
          .insert([payload]);
        if (error) throw error;
      }

      closeModal();
      await fetchRestaurants();
    } catch (err) {
      alert("Write operation error: " + err.message);
    } finally {
      submitBtn.disabled = false;
      submitBtn.innerText = originalText;
      submitBtn.classList.remove("opacity-70", "cursor-not-allowed");
    }
  });

document
  .getElementById("addCommentForm")
  .addEventListener("submit", async (e) => {
    e.preventDefault();
    const inputEl = document.getElementById("newCommentText");
    const submitBtn = e.target.querySelector('button[type="submit"]');

    submitBtn.disabled = true;
    submitBtn.classList.add("opacity-50");

    const payload = {
      restaurant_id: activeRestaurantId,
      comment: inputEl.value,
    };

    try {
      if (!supabaseClient || !navigator.onLine) {
        payload.id = crypto.randomUUID();
        payload.created_at = new Date().toISOString();
        const mockC = JSON.parse(localStorage.getItem("mock_comments")) || [];
        mockC.push(payload);
        localStorage.setItem("mock_comments", JSON.stringify(mockC));
      } else {
        const { error } = await supabaseClient
          .from("comments")
          .insert([payload]);
        if (error) throw error;
      }
      inputEl.value = "";
      await fetchComments(activeRestaurantId);
    } catch (err) {
      alert(err.message);
    } finally {
      submitBtn.disabled = false;
      submitBtn.classList.remove("opacity-50");
    }
  });

// 8. INTERFACE LISTENERS
radiusSlider.addEventListener("input", (e) => {
  const val = e.target.value;
  radiusVal.innerText =
    val >= 1000 ? `${(val / 1000).toFixed(1)} km` : `${val} m`;
  if (rangeCircle) rangeCircle.setRadius(parseInt(val));
  renderFilteredMarkers();
});

function openModal() {
  modal.classList.remove("pointer-events-none", "opacity-0");
  modal.classList.add("opacity-100");
  modalContent.classList.remove("translate-y-full");
}

function closeModal() {
  modal.classList.remove("opacity-100");
  modal.classList.add("opacity-0");
  modalContent.classList.add("translate-y-full");
  setTimeout(() => modal.classList.add("pointer-events-none"), 300);
}

document.getElementById("closeModalBtn").addEventListener("click", closeModal);
modal.addEventListener("click", (e) => {
  if (e.target === modal) closeModal();
});

// function drawNavigationRoute(targetLat, targetLng) {
//   if (activeRoutingLine) {
//     map.removeLayer(activeRoutingLine);
//   }

//   const pointsArray = [
//     [userCoords.lat, userCoords.lng],
//     [targetLat, targetLng],
//   ];

//   activeRoutingLine = L.polyline(pointsArray, {
//     color: "#2563eb",
//     weight: 4,
//     opacity: 0.8,
//     dashArray: "10, 8",
//     lineCap: "round",
//   }).addTo(map);

//   closeModal();
//   map.fitBounds(activeRoutingLine.getBounds(), {
//     padding: [60, 60],
//     maxZoom: 16,
//   });
// }
function drawNavigationRoute(targetLat, targetLng) {
  // 1. Calculate the distance between the user and the restaurant first
  const distanceToTarget = computeDistance(
    userCoords.lat,
    userCoords.lng,
    targetLat,
    targetLng,
  );

  // 2. If the user is closer than 5 meters, they are already there!
  if (distanceToTarget < 5) {
    closeModal();

    // Smoothly pan to the spot instead of jarringly zooming in
    map.panTo([targetLat, targetLng]);

    alert("📍 You've arrived! You are currently at this establishment.");
    return; // Halt execution so we don't draw a 0-meter line
  }

  // 3. Otherwise, proceed with drawing the route as normal
  if (activeRoutingLine) {
    map.removeLayer(activeRoutingLine);
  }

  const pointsArray = [
    [userCoords.lat, userCoords.lng],
    [targetLat, targetLng],
  ];

  activeRoutingLine = L.polyline(pointsArray, {
    color: "#2563eb",
    weight: 4,
    opacity: 0.8,
    dashArray: "10, 8",
    lineCap: "round",
  }).addTo(map);

  closeModal();
  map.fitBounds(activeRoutingLine.getBounds(), {
    padding: [60, 60],
    maxZoom: 16,
  });
}

// CAROUSEL DISPLAY HANDLERS
document.getElementById("fabBtn").addEventListener("click", () => {
  const panel = document.getElementById("carouselPanel");
  panel.classList.toggle("hidden");
  setTimeout(() => {
    panel.classList.toggle("translate-x-[120%]");
    panel.classList.toggle("translate-x-0");
  }, 10);
});

document.getElementById("closeCarouselBtn").addEventListener("click", () => {
  const panel = document.getElementById("carouselPanel");
  panel.classList.add("translate-x-[120%]");
  panel.classList.remove("translate-x-0");
  setTimeout(() => panel.classList.add("hidden"), 300);
});

document.getElementById("nextSlide").addEventListener("click", () => {
  currentSlide = (currentSlide + 1) % 2;
  carouselTrack.style.transform = `translateX(-${currentSlide * 100}%)`;
});
document.getElementById("prevSlide").addEventListener("click", () => {
  currentSlide = (currentSlide - 1 + 2) % 2;
  carouselTrack.style.transform = `translateX(-${currentSlide * 100}%)`;
});

function escapeHTML(str) {
  return str.replace(
    /[&<>'"]/g,
    (t) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[
        t
      ] || t,
  );
}

window.onload = initApp;
