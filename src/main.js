import "./styles.css";
import { createClient } from "@supabase/supabase-js";
import L from "leaflet";

// import { createIcons, icons } from "lucide";

// // 1. INITIALIZE ICONSETS & ENV CONTROLS
// createIcons({icons});
// Optimized Alternative (Optional)
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
} from "lucide";

createIcons({
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
  },
});

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

// Solves the redeclaration error entirely
const supabaseClient =
  supabaseUrl && supabaseAnonKey
    ? createClient(supabaseUrl, supabaseAnonKey)
    : null;

if (!supabaseClient) {
  console.warn(
    "⚠️ Supabase credentials missing. Running in local fallback mockup mode.",
  );
}

// 2. CONFIG VARIABLE STATE
let map, userLocationMarker, rangeCircle;
let userCoords = { lat: 0, lng: 0 };
let dbRestaurants = [];
let dynamicMarkersMap = [];
let selectedCoords = null;
let activeRestaurantId = null;
let currentSlide = 0;

let activeRoutingLine = null; // <-- Holds the navigation path layer

const modal = document.getElementById("restaurantModal");
const modalContent = modal.querySelector(".bg-white");
const radiusSlider = document.getElementById("radiusSlider");
const radiusVal = document.getElementById("radiusVal");
const carouselTrack = document.getElementById("carouselTrack");

// Custom Marker Nodes Layout
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
  iconAnchor: [18, 36], // Anchor at the bottom tip of the pin
});

// 3. ENGINE ROUTINES
// function initApp() {
//   if (!navigator.geolocation) {
//     alert("Location scanning unavailable on this configuration setup.");
//     loadMap(51.505, -0.09);
//     return;
//   }

//   navigator.geolocation.getCurrentPosition(
//     (position) => {
//       userCoords.lat = position.coords.latitude;
//       userCoords.lng = position.coords.longitude;
//       loadMap(userCoords.lat, userCoords.lng);
//     },
//     () => {
//       alert(
//         "Location access denied or timed out. Defaulting to fallback center coordinates.",
//       );
//       userCoords = { lat: 37.7749, lng: -122.4194 };
//       loadMap(userCoords.lat, userCoords.lng);
//     },
//     { enableHighAccuracy: true, timeout: 9000 },
//   );
// }
function initApp() {
  if (!navigator.geolocation) {
    alert("Location scanning unavailable on this configuration setup.");
    loadMap(51.505, -0.09);
    return;
  }

  // Best practice: watchPosition monitors location changes in real time
  navigator.geolocation.watchPosition(
    (position) => {
      userCoords.lat = position.coords.latitude;
      userCoords.lng = position.coords.longitude;

      if (!map) {
        // First boot initialize configuration
        loadMap(userCoords.lat, userCoords.lng);
      } else {
        // Dynamically shift user anchor and bounding circle radius targets
        if (userLocationMarker)
          userLocationMarker.setLatLng([userCoords.lat, userCoords.lng]);
        if (rangeCircle)
          rangeCircle.setLatLng([userCoords.lat, userCoords.lng]);

        // Recalculate which markers fall within the updated location radius
        renderFilteredMarkers();

        // Dynamic path recalculation fallback update loop if navigation is active
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
    () => {
      if (!map) {
        alert(
          "Location access denied or timed out. Defaulting to fallback center coordinates.",
        );
        // userCoords = { lat: 37.7749, lng: -122.4194 };
        userCoords = { lat: 6.4474, lng: 3.3903 };
        loadMap(userCoords.lat, userCoords.lng);
      }
    },
    { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 },
  );
}

function loadMap(lat, lng) {
  map = L.map("map", { zoomControl: false }).setView([lat, lng], 15);

  L.tileLayer(
    "https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png",
    {
      attribution: "&copy; OpenStreetMap &copy; CARTO",
    },
  ).addTo(map);

  userLocationMarker = L.marker([lat, lng], { icon: userIcon }).addTo(map);

  rangeCircle = L.circle([lat, lng], {
    radius: parseInt(radiusSlider.value),
    color: "#10b981",
    fillColor: "#10b981",
    fillOpacity: 0.12,
    weight: 1.5,
  }).addTo(map);

  // FIXED: Removed the map.on('click') line completely.
  // Now, clicking empty map terrain will safely do nothing.

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
  if (!supabaseClient) {
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
    console.error("Data pipeline broken:", err.message);
  }
}

function renderFilteredMarkers() {
  dynamicMarkersMap.forEach((m) => map.removeLayer(m));
  dynamicMarkersMap = [];
  const maxRadius = parseInt(radiusSlider.value);

  dbRestaurants.forEach((item) => {
    if (
      computeDistance(userCoords.lat, userCoords.lng, item.lat, item.lng) <=
      maxRadius
    ) {
      const m = L.marker([item.lat, item.lng], { icon: restaurantIcon }).addTo(
        map,
      );
      m.on("click", (e) => {
        L.DomEvent.stopPropagation(e);
        handleCoordinateSelection(item.lat, item.lng, item);
      });
      dynamicMarkersMap.push(m);
    }
  });
}

// function handleCoordinateSelection(lat, lng, existingRecord = null) {
//   selectedCoords = { lat, lng };
//   document.getElementById("addRestaurantForm").classList.add("hidden");
//   document.getElementById("viewRestaurantDetails").classList.add("hidden");

//   if (!existingRecord) {
//     existingRecord = dbRestaurants.find(
//       (r) => Math.abs(r.lat - lat) < 0.0001 && Math.abs(r.lng - lng) < 0.0001,
//     );
//   }

//   if (existingRecord) {
//     activeRestaurantId = existingRecord.id;
//     document.getElementById("modalTitle").innerText = existingRecord.name;
//     document.getElementById("modalSub").innerText =
//       existingRecord.address || `${lat.toFixed(4)}, ${lng.toFixed(4)}`;
//     document.getElementById("viewReviewText").innerText = existingRecord.review;
//     document.getElementById("viewRestaurantDetails").classList.remove("hidden");
//     fetchComments(activeRestaurantId);
//   } else {
//     activeRestaurantId = null;
//     document.getElementById("modalTitle").innerText = "Add New Location";
//     document.getElementById("modalSub").innerText =
//       `Coordinates: ${lat.toFixed(4)}, ${lng.toFixed(4)}`;
//     document.getElementById("addRestaurantForm").reset();
//     document.getElementById("addRestaurantForm").classList.remove("hidden");
//   }
//   openModal();
// }
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

    // Target insertion clean injection layer container element mapping
    const detailsContainer = document.getElementById("viewRestaurantDetails");

    // Clear out any stale route action buttons before re-rendering
    const staleBtn = document.getElementById("modalNavBtn");
    if (staleBtn) staleBtn.remove();

    // Inject the navigation button at the top of the details view state panel
    const navBtnHtml = `
      <button id="modalNavBtn" class="w-full mb-2 bg-blue-600 hover:bg-blue-700 active:scale-[0.99] text-white font-medium py-2.5 px-4 rounded-xl shadow-md flex items-center justify-center gap-2 transition-all text-sm">
        <i data-lucide="navigation" class="w-4 h-4 fill-white"></i> Get Directions
      </button>
    `;
    detailsContainer.insertAdjacentHTML("afterbegin", navBtnHtml);
    createIcons(); // Refresh Lucide icons for the newly injected element

    // Bind execution handler routine to the new button
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

  if (!supabaseClient) {
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

// 4. LISTENERS & EVENTS
document
  .getElementById("addRestaurantForm")
  .addEventListener("submit", async (e) => {
    e.preventDefault();
    const payload = {
      name: document.getElementById("restName").value,
      address: document.getElementById("restAddress").value,
      review: document.getElementById("restReview").value,
      lat: selectedCoords.lat,
      lng: selectedCoords.lng,
    };

    if (!supabaseClient) {
      payload.id = crypto.randomUUID();
      dbRestaurants.push(payload);
      localStorage.setItem("mock_restaurants", JSON.stringify(dbRestaurants));
      closeModal();
      fetchRestaurants();
      return;
    }
    try {
      const { error } = await supabaseClient
        .from("restaurants")
        .insert([payload]);
      if (error) throw error;
      closeModal();
      fetchRestaurants();
    } catch (err) {
      alert(err.message);
    }
  });

document
  .getElementById("addCommentForm")
  .addEventListener("submit", async (e) => {
    e.preventDefault();
    const inputEl = document.getElementById("newCommentText");
    const payload = {
      restaurant_id: activeRestaurantId,
      comment: inputEl.value,
    };

    if (!supabaseClient) {
      payload.id = crypto.randomUUID();
      payload.created_at = new Date().toISOString();
      const mockC = JSON.parse(localStorage.getItem("mock_comments")) || [];
      mockC.push(payload);
      localStorage.setItem("mock_comments", JSON.stringify(mockC));
      inputEl.value = "";
      fetchComments(activeRestaurantId);
      return;
    }
    try {
      const { error } = await supabaseClient.from("comments").insert([payload]);
      if (error) throw error;
      inputEl.value = "";
      fetchComments(activeRestaurantId);
    } catch (err) {
      alert(err.message);
    }
  });

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

  // Wait for the slide-down animation to complete before turning off pointer events
  setTimeout(() => {
    modal.classList.add("pointer-events-none");
  }, 300);
}

// Bind close event behaviors to both the X button AND clicking the overlay background itself
document.getElementById("closeModalBtn").addEventListener("click", closeModal);
modal.addEventListener("click", (e) => {
  if (e.target === modal) {
    closeModal();
  }
});

// FAB / Panel Carousel Logic
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

function drawNavigationRoute(targetLat, targetLng) {
  // 1. Wipe out any active path lines currently rendering on the canvas
  if (activeRoutingLine) {
    map.removeLayer(activeRoutingLine);
    activeRoutingLine = null;
  }

  // 2. Generate a Leaflet polyline layer array matching coordinates metrics points
  const pointsArray = [
    [userCoords.lat, userCoords.lng],
    [targetLat, targetLng],
  ];

  // 3. Create and style the path line
  activeRoutingLine = L.polyline(pointsArray, {
    color: "#2563eb", // Tailwind blue-600 color match theme profile
    weight: 4, // Line thickness
    opacity: 0.8, // Transparency profile
    dashArray: "10, 8", // Creates a clean, modern dashed navigation effect
    lineCap: "round",
  }).addTo(map);

  // 4. Dismiss modal to show the route map layout
  closeModal();

  // 5. Adjust the map bounds to neatly fit the entire route on screen
  map.fitBounds(activeRoutingLine.getBounds(), {
    padding: [60, 60], // Safe margin spacing in pixels around screen boundaries
    maxZoom: 16, // Prevents over-zooming on exceptionally short routes
  });
}

window.onload = initApp;
