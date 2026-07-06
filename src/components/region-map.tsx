"use client";

import { useCallback, useEffect, useRef, useSyncExternalStore } from "react";
import maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";

type RegionPoint = {
  code: string | null;
  label: string;
  value: number;
  avgResolutionHours: number | null;
  lat: number | null;
  lon: number | null;
};

const GEOJSON_URL =
  "https://cdn.jsdelivr.net/gh/nvkelso/natural-earth-vector@v5.1.2/geojson/ne_110m_admin_0_countries.geojson";

const LIGHT_STYLE: maplibregl.StyleSpecification = {
  version: 8,
  sources: {},
  layers: [
    {
      id: "background",
      type: "background",
      paint: { "background-color": "#f8f8f8" },
    },
  ],
};

const DARK_STYLE: maplibregl.StyleSpecification = {
  version: 8,
  sources: {},
  layers: [
    {
      id: "background",
      type: "background",
      paint: { "background-color": "#1a1a1a" },
    },
  ],
};

function buildCountryLookup(regions: RegionPoint[]) {
  const map = new Map<string, RegionPoint>();
  for (const r of regions) {
    if (r.code) map.set(r.code, r);
  }
  return map;
}

function subscribeToDarkMode(cb: () => void) {
  const observer = new MutationObserver(cb);
  observer.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ["class"],
  });
  return () => observer.disconnect();
}

function getDarkSnapshot() {
  return document.documentElement.classList.contains("dark");
}

const SERVER_SNAPSHOT = false;

export function InteractiveRegionMap({ regions }: { regions: RegionPoint[] }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const popupRef = useRef<maplibregl.Popup | null>(null);
  const getServerSnapshot = useCallback(() => SERVER_SNAPSHOT, []);
  const isDark = useSyncExternalStore(subscribeToDarkMode, getDarkSnapshot, getServerSnapshot);

  useEffect(() => {
    if (!containerRef.current) return;

    const lookup = buildCountryLookup(regions);
    const max = Math.max(1, ...regions.map((r) => r.value));

    const map = new maplibregl.Map({
      container: containerRef.current,
      style: isDark ? DARK_STYLE : LIGHT_STYLE,
      center: [20, 20],
      zoom: 1.2,
      minZoom: 0.8,
      maxZoom: 5,
      attributionControl: false,
      dragRotate: false,
      pitchWithRotate: false,
      touchPitch: false,
    });

    map.addControl(
      new maplibregl.NavigationControl({ showCompass: false }),
      "top-right"
    );

    const popup = new maplibregl.Popup({
      closeButton: false,
      closeOnClick: false,
      className: "region-map-popup",
      offset: 12,
    });
    popupRef.current = popup;

    map.on("load", () => {
      map.addSource("countries", {
        type: "geojson",
        data: GEOJSON_URL,
      });

      // Build match expressions dynamically — cast via unknown to satisfy
      // MapLibre's strict tuple types (the runtime expression is always valid).
      const colorParts: unknown[] = ["match", ["get", "ISO_A2"]];
      const opacityParts: unknown[] = ["match", ["get", "ISO_A2"]];

      for (const [code, r] of lookup) {
        colorParts.push(code, isDark ? "#ff8f40" : "#ff6a00");
        opacityParts.push(code, 0.15 + (r.value / max) * 0.85);
      }

      colorParts.push(isDark ? "#2a2a2a" : "#e0e0e0");
      opacityParts.push(isDark ? 0.6 : 0.8);

      map.addLayer({
        id: "countries-fill",
        type: "fill",
        source: "countries",
        paint: {
          "fill-color": colorParts as maplibregl.ExpressionSpecification,
          "fill-opacity": opacityParts as maplibregl.ExpressionSpecification,
        },
      });

      map.addLayer({
        id: "countries-border",
        type: "line",
        source: "countries",
        paint: {
          "line-color": isDark ? "#333333" : "#cccccc",
          "line-width": 0.5,
        },
      });

      map.addLayer({
        id: "countries-hover",
        type: "fill",
        source: "countries",
        paint: {
          "fill-color": isDark ? "#ffffff" : "#000000",
          "fill-opacity": [
            "case",
            ["boolean", ["feature-state", "hover"], false],
            0.1,
            0,
          ],
        },
      });

      let hoveredId: string | number | null = null;

      map.on("mousemove", "countries-fill", (e) => {
        if (!e.features?.length) return;
        const feature = e.features[0];
        const iso = feature.properties?.ISO_A2 as string;
        const name = feature.properties?.NAME as string;
        const region = lookup.get(iso);

        map.getCanvas().style.cursor = "pointer";

        if (hoveredId !== null) {
          map.setFeatureState({ source: "countries", id: hoveredId }, { hover: false });
        }
        hoveredId = feature.id ?? null;
        if (hoveredId !== null) {
          map.setFeatureState({ source: "countries", id: hoveredId }, { hover: true });
        }

        let html: string;
        if (region) {
          html =
            `<div class="rmp-name">${name}</div>` +
            `<div class="rmp-stat">${region.value} ticket${region.value === 1 ? "" : "s"}</div>` +
            (region.avgResolutionHours !== null
              ? `<div class="rmp-sub">Avg resolution: ${region.avgResolutionHours.toFixed(1)}h</div>`
              : "");
        } else {
          html = `<div class="rmp-name">${name}</div><div class="rmp-sub">No tickets</div>`;
        }

        popup.setLngLat(e.lngLat).setHTML(html).addTo(map);
      });

      map.on("mouseleave", "countries-fill", () => {
        map.getCanvas().style.cursor = "";
        if (hoveredId !== null) {
          map.setFeatureState({ source: "countries", id: hoveredId }, { hover: false });
          hoveredId = null;
        }
        popup.remove();
      });
    });

    mapRef.current = map;
    return () => {
      popup.remove();
      map.remove();
      mapRef.current = null;
    };
  }, [regions, isDark]);

  return (
    <>
      <style>{`
        .region-map-popup .maplibregl-popup-content {
          background: ${isDark ? "#1f1f1f" : "#ffffff"};
          border: 1px solid ${isDark ? "#333" : "#e5e5e5"};
          border-radius: 10px;
          padding: 10px 14px;
          box-shadow: 0 8px 24px -6px rgba(0,0,0,0.25);
          font-family: inherit;
        }
        .region-map-popup .maplibregl-popup-tip {
          border-top-color: ${isDark ? "#1f1f1f" : "#ffffff"};
        }
        .rmp-name {
          font-size: 13px;
          font-weight: 600;
          color: ${isDark ? "#e5e5e5" : "#111"};
        }
        .rmp-stat {
          font-size: 12px;
          font-weight: 500;
          color: #ff6a00;
          margin-top: 2px;
        }
        .rmp-sub {
          font-size: 11px;
          color: ${isDark ? "#888" : "#777"};
          margin-top: 1px;
        }
        .maplibregl-ctrl-group {
          background: ${isDark ? "#1f1f1f" : "#ffffff"} !important;
          border: 1px solid ${isDark ? "#333" : "#e5e5e5"} !important;
          border-radius: 8px !important;
          box-shadow: 0 2px 8px rgba(0,0,0,0.12) !important;
        }
        .maplibregl-ctrl-group button {
          width: 28px !important;
          height: 28px !important;
        }
        .maplibregl-ctrl-group button + button {
          border-top: 1px solid ${isDark ? "#333" : "#e5e5e5"} !important;
        }
        .maplibregl-ctrl-group button span {
          filter: ${isDark ? "invert(1)" : "none"};
        }
      `}</style>
      <div
        ref={containerRef}
        className="w-full rounded-xl overflow-hidden"
        style={{ height: 280 }}
      />
    </>
  );
}
